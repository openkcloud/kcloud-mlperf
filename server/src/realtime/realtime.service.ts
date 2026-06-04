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
import {
  DeviceTelemetryService,
  type SlotTelemetry,
} from './device-telemetry.service';

export const GPU_SWEEP_SERVICE_TOKEN = 'GPU_SWEEP_SERVICE';

export interface IGpuSweepService {
  getStatus(): Promise<SweepStatusResponse>;
}

// Wire shape consumed by the frontend
export type MetricsStatus = 'available' | 'unavailable' | 'pending';

/**
 * SlotState rules:
 *  'running'     — job in DB as RUNNING + last metric/heartbeat <2 min ago
 *  'stale'       — job in DB as RUNNING but no heartbeat for >=2 min (zombie)
 *  'idle'        — no active job
 *  'preparing'   — job in DB as PREPARING
 *  'error'       — job in DB as ERROR
 *  'pending_join'— node not yet in k8s cluster
 *  'unavailable' — hardware absent from device registry
 *  'unknown'     — fallback
 */
export type SlotState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'preparing'
  | 'completed'
  | 'failed'
  | 'stale'
  | 'unavailable'
  | 'unknown'
  | 'error'
  | 'pending_join';

export interface RealtimeSlot {
  device_type: 'gpu' | 'npu';
  vendor: 'nvidia' | 'furiosa' | 'rebellions';
  model: string;
  node: string;
  slot_id: number;
  status: SlotState;
  pending_join_reason?: string;
  /** ISO timestamp of the last heartbeat/metric — populated when status is 'stale'. */
  last_seen: string | null;
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
  /**
   * Live device telemetry sourced from Prometheus (DCGM / vLLM). Optional —
   * absent only if telemetry collection itself threw an uncaught error.
   */
  telemetry?: SlotTelemetry;
}

/** Jobs with no result heartbeat older than this are considered stale. */
const STALE_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * Window during which a RUNNING exam that has not yet emitted its first
 * heartbeat is still treated as 'running' (not 'stale'). Long-warmup
 * workloads (full MLPerf model load, vLLM compile, NPU graph build) can take
 * several minutes before producing the first result row. Marking them
 * 'stale' just because last_seen is null misrepresents healthy work as
 * broken. Once this window elapses without any heartbeat, the slot does
 * flip to 'stale' so a genuinely silent worker is still surfaced.
 */
const NEVER_HEARTBEAT_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Pick the most recently started item from a list. Used by both GPU and
 * NPU slot matchers so that outage-orphaned RUNNING rows (multi-day-old
 * exams whose pods never reconciled) don't pin a slot in front of a
 * currently-active exam. Ties broken by id desc.
 */
export function pickMostRecentActive<T extends { id?: number; started_at?: string | Date | null }>(
  list: T[],
): T | undefined {
  return list
    .slice()
    .sort((a, b) => {
      const at = a.started_at ? new Date(a.started_at).getTime() : 0;
      const bt = b.started_at ? new Date(b.started_at).getTime() : 0;
      if (bt !== at) return bt - at;
      return (b.id ?? 0) - (a.id ?? 0);
    })[0];
}

/**
 * Decide the SlotState for an active exam based on heartbeat timing and exam
 * status. Centralised so GPU and NPU paths share one rule and can't drift.
 *
 * @param examStatus DB status string for the exam
 * @param startedAt RFC3339 timestamp of exam.started_at
 * @param lastSeen RFC3339 timestamp of the latest result-row, or null
 * @param now optional now override for tests
 */
// Exported under a `__test__` name (and re-exported below) so the spec can
// import the helper without exposing it as part of the public module API.
export function computeSlotStatus(
  examStatus: StatusEnum | string,
  startedAt: string | Date | null | undefined,
  lastSeen: string | Date | null,
  now: number = Date.now(),
): SlotState {
  if (examStatus !== StatusEnum.RUNNING) {
    if (examStatus === StatusEnum.PREPARING) return 'preparing';
    if (examStatus === StatusEnum.ERROR) return 'error';
    return 'idle';
  }
  if (lastSeen) {
    const age = now - new Date(lastSeen).getTime();
    return age >= STALE_THRESHOLD_MS ? 'stale' : 'running';
  }
  // No heartbeat received yet — common during model load / NPU graph build.
  // Only flip to stale once the never-heartbeat window expires.
  if (!startedAt) return 'running';
  const startAge = now - new Date(startedAt).getTime();
  return startAge >= NEVER_HEARTBEAT_THRESHOLD_MS ? 'stale' : 'running';
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
    private readonly deviceTelemetry: DeviceTelemetryService,
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
            last_seen: null,
            current_exam: null,
            last_known_metric: { tps: null, tt100t_seconds: null },
            last_metric_timestamp: null,
            metrics_status: 'unavailable' as const,
          };
        }

        if (device.type === 'npu') {
          return this.buildNpuSlotWithTelemetry(
            device,
            npuActives,
            npuResultByExamId,
          );
        }

        return this.buildGpuSlotWithTelemetry(
          device,
          mpActives,
          mmActives,
          resultByExamId,
        );
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
        const filtered = devices.filter((d) => d.type === 'gpu' || d.type === 'npu');
        // Only use registry result when it has entries; an empty list means the
        // cluster.yaml was unreadable or k8s API is unavailable — fall through
        // to the hardcoded baseline so the dashboard is never blank.
        if (filtered.length > 0) return filtered;
        this.logger.warn(
          'DeviceRegistryService returned 0 gpu/npu devices, using hardcoded fallback',
        );
      } catch (err) {
        this.logger.warn(
          'DeviceRegistryService.getDevices() failed, falling back: ' +
            String(err),
        );
      }
    }

    // Fallback: hardcoded 4 NVIDIA GPU slots + 2 NPU slots (RNGD on node4 and
    // Atom+ on node5). v38 adds the NPU entries so the snapshot always exposes
    // NPU telemetry even when cluster.yaml is unmounted in the pod image.
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
      {
        node: 'node4',
        type: 'npu',
        vendor: 'furiosa',
        model: 'RNGD',
        slot_id: 0,
        state: 'ready',
        k8s_node_status: 'Ready',
        allocatable_resource_name: 'furiosa.ai/npu',
        allocatable_count: 1,
        source: 'cluster_yaml',
      },
      {
        node: 'node5',
        type: 'npu',
        vendor: 'rebellions',
        model: 'Atom+',
        slot_id: 0,
        state: 'ready',
        k8s_node_status: 'Ready',
        allocatable_resource_name: 'rebellions.ai/atomplus',
        allocatable_count: 2,
        source: 'cluster_yaml',
      },
    ];
  }

  /** GPU slot builder with async Prometheus telemetry overlay. */
  private async buildGpuSlotWithTelemetry(
    device: DeviceEntry,
    mpActives: MpExam[],
    mmActives: MmExam[],
    resultByExamId: Map<number, MpExamResult>,
  ): Promise<RealtimeSlot> {
    const slot = this.buildGpuSlot(device, mpActives, mmActives, resultByExamId);
    if (this.deviceTelemetry) {
      const [telResult] = await Promise.allSettled([
        this.deviceTelemetry.getGpuTelemetry(device.node, device.slot_id),
      ]);
      slot.telemetry =
        telResult.status === 'fulfilled'
          ? telResult.value
          : { source: 'unavailable' as const };
    }
    return slot;
  }

  /** NPU slot builder with async Prometheus telemetry overlay.
   *  Rebellions Atom+ nodes also get a vLLM overlay when the counter is live. */
  private async buildNpuSlotWithTelemetry(
    device: DeviceEntry,
    npuActives: NpuExam[],
    npuResultByExamId: Map<number, NpuExamResult>,
  ): Promise<RealtimeSlot> {
    const slot = this.buildNpuSlot(device, npuActives, npuResultByExamId);
    if (this.deviceTelemetry) {
      const vendor = device.vendor as 'furiosa' | 'rebellions';
      const [npuTelResult] = await Promise.allSettled([
        this.deviceTelemetry.getNpuTelemetry(vendor, device.node),
      ]);
      const npuTel: SlotTelemetry =
        npuTelResult.status === 'fulfilled'
          ? npuTelResult.value
          : { source: 'unavailable' as const, exporter_status: 'timeout' };

      // Atom+ (node5, rebellions) also exposes vLLM tokens-per-second.
      if (vendor === 'rebellions') {
        const [vllmResult] = await Promise.allSettled([
          this.deviceTelemetry.getVllmTelemetry(
            'rebellions/Llama-3.1-8B-Instruct',
          ),
        ]);
        // Null-guard vllmResult.value before reading tokens_per_sec — the
        // telemetry method returns null when vllm-atomplus is parked,
        // unreachable, or doesn't report the metric yet. Without this guard
        // the dashboard crashes the moment Atom+ is unparked.
        if (
          vllmResult.status === 'fulfilled' &&
          vllmResult.value &&
          vllmResult.value.tokens_per_sec != null
        ) {
          slot.telemetry = { ...npuTel, ...vllmResult.value };
        } else {
          slot.telemetry = npuTel;
        }
      } else {
        slot.telemetry = npuTel;
      }
    }
    return slot;
  }

  private buildGpuSlot(
    device: DeviceEntry,
    mpActives: MpExam[],
    mmActives: MmExam[],
    resultByExamId: Map<number, MpExamResult>,
  ): RealtimeSlot {
    const sku = device.model;
    // SKU comparison must be robust: device-registry can return either bare
    // ('L40', 'A40-44GiB') or fully-qualified ('NVIDIA-L40') labels, while
    // mp_exam.gpu_type is consistently fully-qualified ('NVIDIA-L40'). Normalize
    // both sides so we don't miss a Running exam (the L40 idle-when-running bug).
    const norm = (s: string | null | undefined): string =>
      (s ?? '').replace(/^NVIDIA-/i, '').toLowerCase();
    // GPU family normalization collapses SKU variants — e.g. 'l40' and
    // 'l40-44gib' both → 'l40'. Used as the loose fallback when an exam's
    // k8s_node_name is set but the SKU string differs from the slot's
    // (e.g. user requested 'NVIDIA-A40' and k8s scheduled it onto node3
    // which only has 'A40-44GiB'). Without family matching the exam shows
    // on the wrong node's slot and the dashboard misleads the demo audience.
    const family = (s: string | null | undefined): string =>
      norm(s).replace(/-\d+gi?b?$/i, '');
    const skuN = norm(sku);
    const skuFam = family(sku);

    // Prefer matches that agree on k8s_node_name first (most precise), then
    // strict SKU, then family-on-same-node. Slots whose node disagrees with
    // a populated k8s_node_name are skipped entirely so #281 (gpu_type=A40,
    // ran on node3) doesn't get pinned to node2's A40 slot.
    const onWrongNode = (e: { k8s_node_name?: string | null }): boolean =>
      !!e.k8s_node_name && e.k8s_node_name !== device.node;
    // Same most-recent-active rule as the NPU path: stale RUNNING rows
    // (outage-orphaned) must not pin a slot to a days-old exam over a
    // fresh one. Filter, then pick most-recent via shared helper.
    const findFor = <T extends { id?: number; gpu_type: string; k8s_node_name?: string | null; started_at?: string | Date | null }>(
      list: T[],
    ): T | undefined =>
      pickMostRecentActive(
        list.filter(
          (e) =>
            !onWrongNode(e) &&
            (norm(e.gpu_type) === skuN ||
              (e.k8s_node_name === device.node && family(e.gpu_type) === skuFam)),
        ),
      );
    const mpExam = findFor(mpActives) as MpExam | undefined;
    const mmExam = !mpExam ? (findFor(mmActives) as MmExam | undefined) : undefined;
    const activeExam = mpExam ?? mmExam;

    if (!activeExam) {
      return {
        device_type: 'gpu',
        vendor: 'nvidia',
        model: device.model,
        node: device.node,
        slot_id: device.slot_id,
        status: 'idle',
        last_seen: null,
        current_exam: null,
        last_known_metric: { tps: null, tt100t_seconds: null },
        last_metric_timestamp: null,
        metrics_status: 'unavailable',
      };
    }

    const kind: 'mp' | 'mm' = mpExam ? 'mp' : 'mm';
    const exam_name: string | null = activeExam.name ?? null;

    let tps: number | null = null;
    let tt100t_seconds: number | null = null;
    let last_metric_timestamp: string | null = null;
    let metrics_status: MetricsStatus = 'unavailable';
    let last_seen: string | null = null;

    if (kind === 'mp') {
      const result = resultByExamId.get(activeExam.id);
      if (result) {
        tps = result.result_perf_tps ?? null;
        // mp_exam stores tt100t in milliseconds; divide by 1000 — same convention as comparison.service.ts:511
        tt100t_seconds =
          result.result_tt100t != null ? result.result_tt100t / 1000 : null;
        const created = result.created_at;
        last_metric_timestamp =
          created instanceof Date
            ? created.toISOString()
            : typeof created === 'string'
              ? new Date(created).toISOString()
              : null;
        last_seen = last_metric_timestamp;
        metrics_status =
          tps !== null || tt100t_seconds !== null ? 'available' : 'pending';
      } else {
        metrics_status = 'pending';
      }
    } else {
      // mm exams have no streaming perf metrics — be explicit about why.
      metrics_status = 'unavailable';
    }

    // B4 defense-in-depth: never surface a Completed / Stopped / Error exam as
    // the slot's current_exam.  Even though buildSnapshot() pre-filters to
    // ACTIVE_STATUSES, this guard catches zombies where the DB row was flipped
    // between queries — without it, 47h-old "completed" runs got pinned to
    // their slot as `current_exam`.
    const gpuExamStatus = activeExam.status as StatusEnum;
    if (
      gpuExamStatus === StatusEnum.COMPLETED ||
      gpuExamStatus === StatusEnum.STOPPED ||
      gpuExamStatus === StatusEnum.ERROR
    ) {
      return {
        device_type: 'gpu',
        vendor: 'nvidia',
        model: device.model,
        node: device.node,
        slot_id: device.slot_id,
        status: 'idle',
        last_seen: null,
        current_exam: null,
        last_known_metric: { tps: null, tt100t_seconds: null },
        last_metric_timestamp: null,
        metrics_status: 'unavailable',
      };
    }

    const status = computeSlotStatus(
      activeExam.status,
      activeExam.started_at,
      last_seen,
    );

    const elapsedSeconds = activeExam.started_at
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(activeExam.started_at).getTime()) / 1000,
          ),
        )
      : 0;

    return {
      device_type: 'gpu',
      vendor: 'nvidia',
      model: device.model,
      node: device.node,
      slot_id: device.slot_id,
      status,
      last_seen,
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
    // Normalize model names for matching: strip vendor prefix and lowercase.
    // e.g. 'RNGD' == 'rngd', 'Atom+' == 'atom+', 'ATOM' == 'atom'.
    const normNpu = (s: string | null | undefined): string =>
      (s ?? '').toLowerCase().trim();
    const deviceModelN = normNpu(device.model);

    // Vendor guard: only match exams whose npu_type resolves to the same vendor.
    // furiosa.ai → RNGD family; rebellions.ai → ATOM/Atom+ family.
    const vendorPrefixes: Record<string, string[]> = {
      furiosa: ['rngd'],
      rebellions: ['atom'],
    };
    const allowedPrefixes = vendorPrefixes[device.vendor] ?? [];
    const vendorMatch = (npuType: string): boolean => {
      const n = normNpu(npuType);
      // Exact match takes priority; then prefix check prevents cross-leakage.
      if (n === deviceModelN) return true;
      return allowedPrefixes.some(
        (p) => n.startsWith(p) && deviceModelN.startsWith(p),
      );
    };

    // Pick most-recent active matching exam (see pickMostRecentActive doc).
    const activeExam = pickMostRecentActive(
      npuActives.filter((e) => vendorMatch(e.npu_type)),
    );

    if (!activeExam) {
      return {
        device_type: 'npu',
        vendor: device.vendor as 'furiosa' | 'rebellions',
        model: device.model,
        node: device.node,
        slot_id: device.slot_id,
        status: 'idle',
        last_seen: null,
        current_exam: null,
        last_known_metric: { tps: null, tt100t_seconds: null },
        last_metric_timestamp: null,
        metrics_status: 'unavailable',
      };
    }

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

    const last_seen = last_metric_timestamp;

    const metrics_status: MetricsStatus = result
      ? tps !== null || tt100t_seconds !== null
        ? 'available'
        : 'pending'
      : 'pending';

    // B4 defense-in-depth — see buildGpuSlot() above.
    const npuExamStatus = activeExam.status as StatusEnum;
    if (
      npuExamStatus === StatusEnum.COMPLETED ||
      npuExamStatus === StatusEnum.STOPPED ||
      npuExamStatus === StatusEnum.ERROR
    ) {
      return {
        device_type: 'npu',
        vendor: device.vendor as 'furiosa' | 'rebellions',
        model: device.model,
        node: device.node,
        slot_id: device.slot_id,
        status: 'idle',
        last_seen: null,
        current_exam: null,
        last_known_metric: { tps: null, tt100t_seconds: null },
        last_metric_timestamp: null,
        metrics_status: 'unavailable',
      };
    }

    const status = computeSlotStatus(
      activeExam.status,
      activeExam.started_at,
      last_seen,
    );

    const elapsedSeconds = activeExam.started_at
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(activeExam.started_at).getTime()) / 1000,
          ),
        )
      : 0;

    return {
      device_type: 'npu',
      vendor: device.vendor as 'furiosa' | 'rebellions',
      model: device.model,
      node: device.node,
      slot_id: device.slot_id,
      status,
      last_seen,
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
