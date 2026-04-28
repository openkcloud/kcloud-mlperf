import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { StatusEnum } from '../enums/status.enum';
import type { SweepStatusResponse } from '../gpu-sweep/dto/gpu-sweep.dto';

export const GPU_SWEEP_SERVICE_TOKEN = 'GPU_SWEEP_SERVICE';

export interface IGpuSweepService {
  getStatus(): Promise<SweepStatusResponse>;
}

// Internal intermediate shape — not exposed over the wire
export interface GpuSnapshot {
  sku: 'NVIDIA-L40' | 'NVIDIA-A40' | 'NVIDIA-L40-44GiB' | 'NVIDIA-A40-44GiB';
  node: 'node2' | 'node3';
  slot_status: 'idle' | 'running' | 'preparing' | 'error';
  current_exam: {
    id: number;
    kind: 'mp' | 'mm';
    elapsed_seconds: number;
    last_known_metric: { tt100t?: number; tps?: number };
  } | null;
}

// Wire shape consumed by the frontend
export interface RealtimeSlot {
  gpu_type: string;
  node: string;
  slot_id: number;
  status: 'idle' | 'running' | 'preparing' | 'error';
  current_exam: {
    id: number;
    kind: 'mp' | 'mm';
    exam_name: string | null;
    elapsed_seconds: number;
  } | null;
  last_known_metric: { tps: number | null; tt100t_seconds: number | null };
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

// (node, sku) pairs that define the 4 monitored GPU slots
const GPU_SLOTS: Array<{ node: 'node2' | 'node3'; sku: GpuSnapshot['sku'] }> = [
  { node: 'node2', sku: 'NVIDIA-L40' },
  { node: 'node2', sku: 'NVIDIA-A40' },
  { node: 'node3', sku: 'NVIDIA-L40-44GiB' },
  { node: 'node3', sku: 'NVIDIA-A40-44GiB' },
];

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
    @Optional() @Inject(GPU_SWEEP_SERVICE_TOKEN)
    private readonly gpuSweepService: IGpuSweepService | null,
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
    this.logger.log(
      JSON.stringify({ event: 'OperatorRaceFailed', since }),
    );
  }

  async buildSnapshot(): Promise<RealtimeSnapshot> {
    const [mpActives, mmActives] = await Promise.all([
      this.mpExamRepo.find({ where: { status: In(ACTIVE_STATUSES) } }),
      this.mmExamRepo.find({ where: { status: In(ACTIVE_STATUSES) } }),
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

    // Index latest result per exam_id
    const resultByExamId = new Map<number, MpExamResult>();
    for (const r of latestMpResults) {
      if (!resultByExamId.has(r.exam_id)) {
        resultByExamId.set(r.exam_id, r);
      }
    }

    const slots: RealtimeSlot[] = await Promise.all(
      GPU_SLOTS.map(async ({ node, sku }, slotIndex) => {
        const mpExam = mpActives.find((e) => e.gpu_type === sku);
        const mmExam = !mpExam
          ? mmActives.find((e) => e.gpu_type === sku)
          : undefined;

        const activeExam = mpExam ?? mmExam;

        if (!activeExam) {
          return {
            gpu_type: sku,
            node,
            slot_id: slotIndex,
            status: 'idle' as const,
            current_exam: null,
            last_known_metric: { tps: null, tt100t_seconds: null },
          };
        }

        const status =
          activeExam.status === StatusEnum.RUNNING
            ? 'running' as const
            : activeExam.status === StatusEnum.PREPARING
              ? 'preparing' as const
              : activeExam.status === StatusEnum.ERROR
                ? 'error' as const
                : 'idle' as const;

        const elapsedSeconds = activeExam.started_at
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - new Date(activeExam.started_at).getTime()) / 1000,
              ),
            )
          : 0;

        const kind: 'mp' | 'mm' = mpExam ? 'mp' : 'mm';

        // Look up exam name from the entity
        let exam_name: string | null = activeExam.name ?? null;

        let tps: number | null = null;
        let tt100t_seconds: number | null = null;

        if (kind === 'mp') {
          const result = resultByExamId.get(activeExam.id);
          if (result) {
            tps = result.result_perf_tps ?? null;
            tt100t_seconds = result.result_tt100t ?? null;
          }
        }

        return {
          gpu_type: sku,
          node,
          slot_id: slotIndex,
          status,
          current_exam: {
            id: activeExam.id,
            kind,
            exam_name,
            elapsed_seconds: elapsedSeconds,
          },
          last_known_metric: { tps, tt100t_seconds },
        };
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

    // Count operator-race alerts (total count across all recorded events)
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
}
