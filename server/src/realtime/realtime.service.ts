import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { StatusEnum } from '../enums/status.enum';
import type { SweepStatusResponse } from '../gpu-sweep/dto/gpu-sweep.dto';
import type { DeviceEntry } from '../device-registry/device-registry.types';
import { DeviceRegistryService } from '../device-registry/device-registry.service';

export const GPU_SWEEP_SERVICE_TOKEN = 'GPU_SWEEP_SERVICE';

export interface IGpuSweepService {
  getStatus(): Promise<SweepStatusResponse>;
}

// Wire shape consumed by the frontend
export type MetricsStatus = 'available' | 'unavailable' | 'pending';

export interface RealtimeSlot {
  device_type: 'gpu' | 'npu';
  vendor: 'nvidia' | 'furiosa' | 'rebellions';
  model: string;
  node: string;
  slot_id: number;
  status: 'idle' | 'running' | 'preparing' | 'error' | 'pending_join';
  pending_join_reason?: string;
  current_exam: {
    id: number;
    kind: 'mp' | 'mm' | 'npu';
    exam_name: string | null;
    elapsed_seconds: number;
  } | null;
  last_known_metric: { tps: number | null; tt100t_seconds: number | null };
  /** ISO timestamp of the most recent metric reading, or null if none seen yet. */
  last_metric_timestamp: string | null;
  /**
   * Why metrics may be missing. Frontend MUST render explicitly — never blank.
   *  - 'available'   : tps/tt100t populated from the latest emitted result row.
   *  - 'pending'     : exam preparing or just started — no result row yet.
   *  - 'unavailable' : exam kind has no streaming perf metrics (e.g. mm), or
   *                    upstream emitter is down, or slot is idle/pending_join.
   */
  metrics_status: MetricsStatus;
}

export interface RealtimeSweepProgress {
  completed: number;
  total: number;
  active_sweep_id: number | null;
  paused: boolean;
}

export interface RealtimeSnapshot {
  timestamp: string;
  slots: RealtimeSlot[];
  sweep_progress: RealtimeSweepProgress;
  operator_race_alerts: number;
}

const ACTIVE_STATUSES = [StatusEnum.RUNNING, StatusEnum.PREPARING];

// Ring buffer for operator-race alerts — keyed by since-ISO-string
interface RaceAlert {
  count: number;
  since: string;
}

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly raceAlerts = new Map<string, RaceAlert>();

  constructor(
    @InjectRepository(MpExam) private readonly mpExamRepo: Repository<MpExam>,
    @InjectRepository(MmExam) private readonly mmExamRepo: Repository<MmExam>,
    @InjectRepository(MpExamResult)
    private readonly mpResultRepo: Repository<MpExamResult>,
    @InjectRepository(NpuExam)
    private readonly npuExamRepo: Repository<NpuExam>,
    @InjectRepository(NpuExamResult)
    private readonly npuResultRepo: Repository<NpuExamResult>,
    @Optional()
    @Inject(GPU_SWEEP_SERVICE_TOKEN)
    private readonly gpuSweepService: IGpuSweepService | null,
    @Optional()
    @Inject(DeviceRegistryService)
    private readonly deviceRegistry: DeviceRegistryService | null,
  ) {}

  onModuleDestroy() {}

  /** Record an operator-race failure for the alert ring buffer. */
  recordOperatorRaceFailed() {
    const since = new Date().toISOString();
    const existing = this.raceAlerts.get(since);
    this.raceAlerts.set(since, {
      count: (existing?.count ?? 0) + 1,
      since,
    });
    this.logger.log(JSON.stringify({ event: 'OperatorRaceFailed', since }));
  }

  async buildSnapshot(): Promise<RealtimeSnapshot> {
    const [mpActives, mmActives, npuActives] = await Promise.all([
      this.mpExamRepo.find({ where: { status: In(ACTIVE_STATUSES) } }),
      this.mmExamRepo.find({ where: { status: In(ACTIVE_STATUSES) } }),
      this.npuExamRepo.find({ where: { status: In(ACTIVE_STATUSES) } }),
    ]);

    // Fetch latest mp-results for running mp exams (for tt100t/tps)
    const runningMpIds = mpActives
      .filter((e) => e.status === StatusEnum.RUNNING)
      .map((e) => e.id);

    const latestMpResults =
      runningMpIds.length > 0
        ? await this.mpResultRepo
            .createQueryBuilder('r')
            .where('r.exam_id IN (:...ids)', { ids: runningMpIds })
            .orderBy('r.created_at', 'DESC')
            .getMany()
        : [];

    const resultByExamId = new Map<number, MpExamResult>();
    for (const r of latestMpResults) {
      if (!resultByExamId.has(r.exam_id)) {
        resultByExamId.set(r.exam_id, r);
      }
    }

    // Fetch latest npu-results for running npu exams
    const runningNpuIds = npuActives
      .filter((e) => e.status === StatusEnum.RUNNING)
      .map((e) => e.id);

    const latestNpuResults =
      runningNpuIds.length > 0
        ? await this.npuResultRepo
            .createQueryBuilder('r')
            .where('r.exam_id IN (:...ids)', { ids: runningNpuIds })
            .orderBy('r.created_at', 'DESC')
            .getMany()
        : [];

    const npuResultByExamId = new Map<number, NpuExamResult>();
    for (const r of latestNpuResults) {
      if (!npuResultByExamId.has(r.exam_id)) {
        npuResultByExamId.set(r.exam_id, r);
      }
    }

    // Resolve device slots from registry (falls back to hardcoded GPU slots)
    const deviceSlots = await this.resolveDeviceSlots();

    const slots: RealtimeSlot[] = await Promise.all(
      deviceSlots.map(async (device) => {
        // pending_join nodes surface as unavailable slots with explicit reason
        if (device.state === 'pending_join') {
          return {
            device_type: device.type as 'gpu' | 'npu',
            vendor: device.vendor as 'nvidia' | 'furiosa' | 'rebellions',
            model: device.model,
            node: device.node,
            slot_id: device.slot_id,
            status: 'pending_join' as const,
            pending_join_reason: `Node ${device.node} has not joined the k8s cluster (k8s_node_status=Absent)`,
            current_exam: null,
            last_known_metric: { tps: null, tt100t_seconds: null },
            last_metric_timestamp: null,
            metrics_status: 'unavailable' as const,
          };
        }

        if (device.type === 'npu') {
          return this.buildNpuSlot(device, npuActives, npuResultByExamId);
        }

        return this.buildGpuSlot(device, mpActives, mmActives, resultByExamId);
      }),
    );

    // Derive sweep_progress from GpuSweepService
    let sweep_progress: RealtimeSweepProgress = {
      completed: 0,
      total: 0,
      active_sweep_id: null,
      paused: false,
    };

    if (this.gpuSweepService) {
      try {
        const sweepStatus = await this.gpuSweepService.getStatus();
        if (sweepStatus.active_sweep) {
          const s = sweepStatus.active_sweep;
          sweep_progress = {
            completed: s.completed_cells,
            total: s.total_cells,
            active_sweep_id: s.id,
            paused: s.status === 'Paused' || s.status === 'Drained',
          };
        }
      } catch (err) {
        this.logger.warn('GpuSweepService.getStatus() failed: ' + String(err));
      }
    }

    const operator_race_alerts = [...this.raceAlerts.values()].reduce(
      (sum, a) => sum + a.count,
      0,
    );

    return {
      timestamp: new Date().toISOString(),
      slots,
      sweep_progress,
      operator_race_alerts,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Fetch device list from DeviceRegistryService; fall back to hardcoded GPU slots. */
  private async resolveDeviceSlots(): Promise<DeviceEntry[]> {
    if (this.deviceRegistry) {
      try {
        const devices = await this.deviceRegistry.getDevices();
        return devices.filter((d) => d.type === 'gpu' || d.type === 'npu');
      } catch (err) {
        this.logger.warn(
          'DeviceRegistryService.getDevices() failed, falling back: ' +
            String(err),
        );
      }
    }

    // Fallback: hardcoded 4 NVIDIA GPU slots (pre-NPU behaviour)
    return [
      {
        node: 'node2',
        type: 'gpu',
        vendor: 'nvidia',
        model: 'NVIDIA-L40',
        slot_id: 0,
        state: 'ready',
        k8s_node_status: 'Ready',
        allocatable_resource_name: 'nvidia.com/gpu',
        allocatable_count: 1,
        source: 'cluster_yaml',
      },
      {
        node: 'node2',
        type: 'gpu',
        vendor: 'nvidia',
        model: 'NVIDIA-A40',
        slot_id: 1,
        state: 'ready',
        k8s_node_status: 'Ready',
        allocatable_resource_name: 'nvidia.com/gpu',
        allocatable_count: 1,
        source: 'cluster_yaml',
      },
      {
        node: 'node3',
        type: 'gpu',
        vendor: 'nvidia',
        model: 'NVIDIA-L40-44GiB',
        slot_id: 0,
        state: 'ready',
        k8s_node_status: 'Ready',
        allocatable_resource_name: 'nvidia.com/gpu',
        allocatable_count: 1,
        source: 'cluster_yaml',
      },
      {
        node: 'node3',
        type: 'gpu',
        vendor: 'nvidia',
        model: 'NVIDIA-A40-44GiB',
        slot_id: 1,
        state: 'ready',
        k8s_node_status: 'Ready',
        allocatable_resource_name: 'nvidia.com/gpu',
        allocatable_count: 1,
        source: 'cluster_yaml',
      },
    ];
  }

  private buildGpuSlot(
    device: DeviceEntry,
    mpActives: MpExam[],
    mmActives: MmExam[],
    resultByExamId: Map<number, MpExamResult>,
  ): RealtimeSlot {
    const sku = device.model;
    const mpExam = mpActives.find((e) => e.gpu_type === sku);
    const mmExam = !mpExam
      ? mmActives.find((e) => e.gpu_type === sku)
      : undefined;
    const activeExam = mpExam ?? mmExam;

    if (!activeExam) {
      return {
        device_type: 'gpu',
        vendor: 'nvidia',
        model: device.model,
        node: device.node,
        slot_id: device.slot_id,
        status: 'idle',
        current_exam: null,
        last_known_metric: { tps: null, tt100t_seconds: null },
        last_metric_timestamp: null,
        metrics_status: 'unavailable',
      };
    }

    const status =
      activeExam.status === StatusEnum.RUNNING
        ? ('running' as const)
        : activeExam.status === StatusEnum.PREPARING
          ? ('preparing' as const)
          : activeExam.status === StatusEnum.ERROR
            ? ('error' as const)
            : ('idle' as const);

    const elapsedSeconds = activeExam.started_at
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(activeExam.started_at).getTime()) / 1000,
          ),
        )
      : 0;

    const kind: 'mp' | 'mm' = mpExam ? 'mp' : 'mm';
    const exam_name: string | null = activeExam.name ?? null;

    let tps: number | null = null;
    let tt100t_seconds: number | null = null;
    let last_metric_timestamp: string | null = null;
    let metrics_status: MetricsStatus = 'unavailable';

    if (kind === 'mp') {
      const result = resultByExamId.get(activeExam.id);
      if (result) {
        tps = result.result_perf_tps ?? null;
        tt100t_seconds = result.result_tt100t ?? null;
        const created = result.created_at;
        last_metric_timestamp =
          created instanceof Date
            ? created.toISOString()
            : typeof created === 'string'
              ? new Date(created).toISOString()
              : null;
        metrics_status =
          tps !== null || tt100t_seconds !== null ? 'available' : 'pending';
      } else {
        // running/preparing mp-exam with no result rows yet — pending, not faked
        metrics_status = 'pending';
      }
    } else {
      // mm exams have no streaming perf metrics — be explicit about why.
      metrics_status = 'unavailable';
    }

    return {
      device_type: 'gpu',
      vendor: 'nvidia',
      model: device.model,
      node: device.node,
      slot_id: device.slot_id,
      status,
      current_exam: {
        id: activeExam.id,
        kind,
        exam_name,
        elapsed_seconds: elapsedSeconds,
      },
      last_known_metric: { tps, tt100t_seconds },
      last_metric_timestamp,
      metrics_status,
    };
  }

  private buildNpuSlot(
    device: DeviceEntry,
    npuActives: NpuExam[],
    npuResultByExamId: Map<number, NpuExamResult>,
  ): RealtimeSlot {
    const activeExam = npuActives.find((e) => e.npu_type === device.model);

    if (!activeExam) {
      return {
        device_type: 'npu',
        vendor: device.vendor as 'furiosa' | 'rebellions',
        model: device.model,
        node: device.node,
        slot_id: device.slot_id,
        status: 'idle',
        current_exam: null,
        last_known_metric: { tps: null, tt100t_seconds: null },
        last_metric_timestamp: null,
        metrics_status: 'unavailable',
      };
    }

    const status =
      activeExam.status === StatusEnum.RUNNING
        ? ('running' as const)
        : activeExam.status === StatusEnum.PREPARING
          ? ('preparing' as const)
          : activeExam.status === StatusEnum.ERROR
            ? ('error' as const)
            : ('idle' as const);

    const elapsedSeconds = activeExam.started_at
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(activeExam.started_at).getTime()) / 1000,
          ),
        )
      : 0;

    const result = npuResultByExamId.get(activeExam.id);
    const tps = result?.result_tps ?? null;
    const tt100t_seconds = result?.result_tt100t ?? null;

    let last_metric_timestamp: string | null = null;
    if (result) {
      const created = (result as { created_at?: Date | string }).created_at;
      last_metric_timestamp =
        created instanceof Date
          ? created.toISOString()
          : typeof created === 'string'
            ? new Date(created).toISOString()
            : null;
    }

    const metrics_status: MetricsStatus = result
      ? tps !== null || tt100t_seconds !== null
        ? 'available'
        : 'pending'
      : 'pending';

    return {
      device_type: 'npu',
      vendor: device.vendor as 'furiosa' | 'rebellions',
      model: device.model,
      node: device.node,
      slot_id: device.slot_id,
      status,
      current_exam: {
        id: activeExam.id,
        kind: 'npu',
        exam_name: activeExam.name ?? null,
        elapsed_seconds: elapsedSeconds,
      },
      last_known_metric: { tps, tt100t_seconds },
      last_metric_timestamp,
      metrics_status,
    };
  }
}
