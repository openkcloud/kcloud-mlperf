import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { MpExamService } from '../mp-exam/mp-exam.service';
import { MmExamService } from '../mm-exam/mm-exam.service';
import { MpExamModeEnum } from '../enums/mp-exam-mode.enum';

import {
  GpuSweep,
  GpuSweepMode,
  GpuSweepStatus,
} from './entities/gpu-sweep.entity';
import {
  GpuSweepCell,
  GpuSweepCellKind,
  GpuSweepCellStatus,
} from './entities/gpu-sweep-cell.entity';
import {
  expandMatrix,
  buildTimeline,
  DEDUP_KEYS,
  CANONICAL_CELL,
  MatrixOptions,
} from './matrix';
import {
  CalibrationResponse,
  SweepCellSpec,
  SweepPreviewResponse,
  SweepStatusResponse,
  StartSweepDto,
} from './dto/gpu-sweep.dto';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Seoul';
const TS_FORMAT = 'YYYY-MM-DDTHH:mm:ssZ';

interface NodeMutexState {
  busy: boolean;
  last_dispatch_at: number | null;
  current_cell_key: string | null;
}

@Injectable()
export class GpuSweepService {
  private readonly logger = new Logger(GpuSweepService.name);
  private readonly nodeMutex: Record<'node2' | 'node3', NodeMutexState> = {
    node2: { busy: false, last_dispatch_at: null, current_cell_key: null },
    node3: { busy: false, last_dispatch_at: null, current_cell_key: null },
  };
  // Internal queue of dispatched cells per node, used by the unit test to
  // verify stagger discipline. Production reads pull from DB.
  private readonly nodeQueue: Record<'node2' | 'node3', GpuSweepCell[]> = {
    node2: [],
    node3: [],
  };
  private activeSweepId: number | null = null;
  private staggerSeconds: number;

  constructor(
    @InjectRepository(GpuSweep)
    private readonly sweepRepo: Repository<GpuSweep>,
    @InjectRepository(GpuSweepCell)
    private readonly cellRepo: Repository<GpuSweepCell>,
    private readonly mpExamService: MpExamService,
    private readonly mmExamService: MmExamService,
    private readonly config: ConfigService,
  ) {
    const cfg = this.config.get<string>('GPU_SWEEP_MIN_STAGGER_SECONDS');
    this.staggerSeconds = cfg ? parseInt(cfg, 10) : 60;
  }

  isEnabled(): boolean {
    const flag = this.config.get<string>('GPU_SWEEP_ENABLED');
    return flag === 'true' || flag === '1';
  }

  /** True while the cron-driven quiet window is active. */
  private quietWindowActive = false;

  /**
   * Enter quiet window — fired by the cron at 09:00 KST Mon-Fri.
   * Default cron: GPU_SWEEP_QUIET_WINDOW_CRON='0 9-18 * * *'
   * The @Cron decorator uses the cron expression from env; falls back to
   * '0 9 * * 1-5' (09:00 Mon-Fri KST) which marks the window open at 09:00
   * and the companion CLOSE cron fires at 18:00.
   */
  @Cron(process.env.GPU_SWEEP_QUIET_WINDOW_CRON ?? '0 9 * * 1-5', {
    timeZone: 'Asia/Seoul',
    name: 'quiet_window_open',
  })
  handleQuietWindowOpen(): void {
    this.quietWindowActive = true;
    this.logger.warn('[sweep:quiet_window] Demo quiet window OPEN — new sweeps blocked.');
  }

  @Cron('0 18 * * 1-5', { timeZone: 'Asia/Seoul', name: 'quiet_window_close' })
  handleQuietWindowClose(): void {
    this.quietWindowActive = false;
    this.logger.log('[sweep:quiet_window] Demo quiet window CLOSED — sweeps allowed.');
  }

  isDemoQuietWindow(): boolean {
    return this.quietWindowActive;
  }

  // -------------------------- Phase -1: preview --------------------------

  preview(options: MatrixOptions = {}): SweepPreviewResponse {
    const cells = expandMatrix(options);
    const timeline = buildTimeline(cells);
    return {
      total_cells: cells.length,
      cells,
      timeline,
      dedup_keys_excluded: DEDUP_KEYS,
    };
  }

  // -------------------------- Phase 1: start ----------------------------

  async startSweep(body: StartSweepDto): Promise<GpuSweep> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException({ enabled: false });
    }
    if (this.isDemoQuietWindow()) {
      const hourKST = dayjs().tz(TZ).hour();
      this.logger.warn(
        `[sweep:demo-gate] Start blocked — quiet window active (KST hour=${hourKST})`,
      );
      throw new HttpException(
        { blocked: true, reason: 'demo_quiet_window', hour_kst: hourKST },
        HttpStatus.LOCKED,
      );
    }
    const mode = body.mode ?? GpuSweepMode.FULL;

    let cells: SweepCellSpec[];
    if (mode === GpuSweepMode.CALIBRATION) {
      // Calibration: canonical L40 / fp8 / bs=1 / n=500 / TP=1 cell on BOTH
      // matched-pair nodes (node2 L40 and node3 L40-44GiB).
      cells = [
        {
          ...this.buildCanonicalCellOnNode('node2', 0, 'NVIDIA-L40'),
        },
        {
          ...this.buildCanonicalCellOnNode('node3', 0, 'NVIDIA-L40-44GiB'),
        },
      ];
    } else {
      const m = body.matrix ?? {};
      cells = expandMatrix({
        gpu_skus: m.gpu_skus,
        benchmarks: m.benchmarks?.filter(
          (b): b is 'mlperf' | 'mmlu' => b === 'mlperf' || b === 'mmlu',
        ),
        precisions: m.precisions?.filter(
          (p): p is 'bf16' | 'fp8' => p === 'bf16' || p === 'fp8',
        ),
      });
    }

    const sweep = this.sweepRepo.create({
      name:
        body.name ?? `sweep-${dayjs().tz(TZ).format('YYYYMMDD-HHmmss')}`,
      mode,
      status: GpuSweepStatus.RUNNING,
      total_cells: cells.length,
      completed_cells: 0,
      matrix_config: (body.matrix as Record<string, unknown>) ?? {},
      started_at: dayjs().tz(TZ).format(TS_FORMAT),
    });
    const saved = await this.sweepRepo.save(sweep);
    this.logger.log(
      JSON.stringify({ event: 'sweep_started', sweep_id: saved.id, mode, total_cells: cells.length }),
    );

    const cellRows = cells.map((c) =>
      this.cellRepo.create({
        sweep_id: saved.id,
        cell_key: c.cell_key,
        kind: c.kind,
        gpu_type: c.gpu_type,
        node: c.node,
        precision: c.precision,
        batch_size: c.batch_size,
        data_number: c.data_number,
        tensor_parallel_size: c.tensor_parallel_size,
        scenario: c.scenario,
        retry_num: c.retry_num,
        status: GpuSweepCellStatus.PENDING,
      }),
    );
    await this.cellRepo.save(cellRows);

    this.activeSweepId = saved.id;

    // Kick off the queue in background. Unit tests drive the queue directly.
    void this.runQueue(saved.id).catch((err) => {
      this.logger.error(
        `Sweep ${saved.id} queue failed: ${err?.message ?? err}`,
      );
    });

    return saved;
  }

  private buildCanonicalCellOnNode(
    node: 'node2' | 'node3',
    gpu_index: 0 | 1,
    gpu_type: string,
  ): SweepCellSpec {
    return {
      cell_key: `mlperf|${gpu_type}|fp8|bs1|n500|tp1|offline`,
      kind: GpuSweepCellKind.MLPERF,
      gpu_type,
      node,
      gpu_index,
      precision: CANONICAL_CELL.precision,
      batch_size: CANONICAL_CELL.batch_size,
      data_number: CANONICAL_CELL.data_number,
      tensor_parallel_size: CANONICAL_CELL.tensor_parallel_size,
      scenario: CANONICAL_CELL.scenario,
      retry_num: 1,
    };
  }

  // -------------------------- queue / dispatch loop ----------------------

  private async runQueue(sweepId: number): Promise<void> {
    let progress = true;
    while (progress) {
      progress = false;
      const sweep = await this.sweepRepo.findOne({ where: { id: sweepId } });
      if (!sweep) return;
      if (
        sweep.status === GpuSweepStatus.PAUSED ||
        sweep.status === GpuSweepStatus.DRAINED ||
        sweep.status === GpuSweepStatus.COMPLETED
      ) {
        return;
      }

      const pending = await this.cellRepo.find({
        where: { sweep_id: sweepId, status: GpuSweepCellStatus.PENDING },
        order: { id: 'ASC' },
      });
      if (pending.length === 0) {
        await this.sweepRepo.update(sweepId, {
          status: GpuSweepStatus.COMPLETED,
          completed_at: dayjs().tz(TZ).format(TS_FORMAT),
        });
        return;
      }

      for (const cell of pending) {
        const node = cell.node as 'node2' | 'node3';
        if (!this.canDispatchOn(node)) continue;

        try {
          await this.dispatchCell(sweep, cell);
          progress = true;
        } catch (err) {
          this.logger.error(
            `Dispatch failed for cell ${cell.cell_key}: ${
              (err as Error)?.message ?? err
            }`,
          );
        }
      }

      // Yield. In tests this runs synchronously because canDispatchOn returns
      // true only after the test advances `last_dispatch_at`.
      if (!progress) return;
    }
  }

  private canDispatchOn(node: 'node2' | 'node3'): boolean {
    const state = this.nodeMutex[node];
    if (state.busy) return false;
    if (state.last_dispatch_at === null) return true;
    const elapsed = (Date.now() - state.last_dispatch_at) / 1000;
    return elapsed >= this.staggerSeconds;
  }

  private async dispatchCell(
    sweep: GpuSweep,
    cell: GpuSweepCell,
  ): Promise<void> {
    const node = cell.node as 'node2' | 'node3';
    this.nodeMutex[node].busy = true;
    this.nodeMutex[node].current_cell_key = cell.cell_key;
    this.nodeMutex[node].last_dispatch_at = Date.now();
    this.nodeQueue[node].push(cell);

    const startedAt = dayjs().tz(TZ).format(TS_FORMAT);
    const description = `[sweep:${sweep.id} cell:${cell.id}] ${cell.cell_key}`;

    let exam_id: number | null = null;

    try {
      if (cell.kind === GpuSweepCellKind.MLPERF) {
        const mp = await this.mpExamService.create({
          name: `sweep-${sweep.id}-cell-${cell.id}`,
          description,
          model: 'Llama-3.1-8B-Instruct',
          precision: cell.precision,
          mode: MpExamModeEnum.PERFORMANCE,
          framework: 'vllm',
          batch_size: cell.batch_size,
          min_duration: 0,
          dataset: 'cnn-dailymail',
          data_number: cell.data_number,
          scenario: cell.scenario,
          target_qps: cell.scenario === 'server' ? 1 : 0,
          num_workers: 1,
          tensor_parallel_size: cell.tensor_parallel_size,
          device_type: 'GPU',
          gpu_type: cell.gpu_type,
          gpu_num: cell.tensor_parallel_size,
          cpu_core: 8,
          ram_capacity: 32,
          retry_num: cell.retry_num,
          started_at: startedAt,
          status: undefined as never,
          error_log: undefined as never,
          end_at: undefined as never,
        });
        exam_id = mp?.id ?? null;
      } else {
        const mm = await this.mmExamService.create({
          name: `sweep-${sweep.id}-cell-${cell.id}`,
          description,
          model: 'Llama-3.1-8B-Instruct',
          precision: cell.precision,
          framework: 'vllm',
          subject: 'all',
          dataset: 'mmlu',
          data_number: cell.data_number,
          batch_size: cell.batch_size,
          gpu_util: 0.9,
          device_type: 'GPU',
          gpu_type: cell.gpu_type,
          gpu_num: cell.tensor_parallel_size,
          cpu_core: 8,
          ram_capacity: 32,
          n_train: 1,
          retry_num: cell.retry_num,
          started_at: startedAt,
          status: undefined as never,
          end_at: undefined as never,
          error_log: undefined as never,
        });
        exam_id = mm?.id ?? null;
      }

      await this.cellRepo.update(cell.id, {
        status: GpuSweepCellStatus.DISPATCHED,
        exam_id,
        dispatched_at: startedAt,
      });
      this.logger.log(
        JSON.stringify({
          event: 'GPU_SWEEP_CELL_DISPATCHED',
          sweep_id: sweep.id,
          cell_id: cell.id,
          gpu_type: cell.gpu_type,
          mp_exam_id: cell.kind === GpuSweepCellKind.MLPERF ? exam_id : undefined,
          mm_exam_id: cell.kind === GpuSweepCellKind.MMLU ? exam_id : undefined,
        }),
      );
    } catch (err) {
      const willRetry = (cell.retry_num ?? 0) > 0;
      this.logger.error(
        JSON.stringify({
          event: 'OperatorRaceFailed',
          sweep_id: sweep.id,
          cell_id: cell.id,
          retried: willRetry,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      this.nodeMutex[node].busy = false;
      this.nodeMutex[node].current_cell_key = null;
      await this.cellRepo.update(cell.id, {
        status: GpuSweepCellStatus.RACE_FAILED,
        error_log: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      // Mutex released in catch (on error) or by markCellComplete (on success).
    }
  }

  // ----------------- callbacks used by realtime/poller side --------------

  async markCellComplete(
    cellId: number,
    metrics: { tt100t_seconds?: number | null; tps?: number | null } = {},
  ): Promise<GpuSweepCell> {
    const cell = await this.cellRepo.findOne({ where: { id: cellId } });
    if (!cell) throw new NotFoundException(`Cell ${cellId} not found`);

    await this.cellRepo.update(cellId, {
      status: GpuSweepCellStatus.COMPLETED,
      tt100t_seconds: metrics.tt100t_seconds ?? null,
      tps: metrics.tps ?? null,
      completed_at: dayjs().tz(TZ).format(TS_FORMAT),
    });

    const node = cell.node as 'node2' | 'node3';
    this.nodeMutex[node].busy = false;
    this.nodeMutex[node].current_cell_key = null;

    await this.sweepRepo.increment(
      { id: cell.sweep_id },
      'completed_cells',
      1,
    );

    this.logger.log(
      JSON.stringify({
        event: 'GPU_SWEEP_CELL_COMPLETED',
        sweep_id: cell.sweep_id,
        cell_id: cellId,
        duration_seconds: cell.dispatched_at
          ? dayjs().diff(dayjs(cell.dispatched_at), 'second')
          : null,
      }),
    );

    return (await this.cellRepo.findOne({ where: { id: cellId } }))!;
  }

  // ----------------------- Phase 7: calibration --------------------------

  async runCalibration(): Promise<CalibrationResponse> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException({ enabled: false });
    }
    const sweep = await this.startSweep({ mode: GpuSweepMode.CALIBRATION });
    const cells = await this.cellRepo.find({ where: { sweep_id: sweep.id } });

    // For the contract response, gather metrics. In real operation these are
    // populated by markCellComplete; this method returns the *contract shape*
    // even when metrics are still pending so the UI can subscribe.
    const runs = cells.map((c) => ({
      node: c.node as 'node2' | 'node3',
      exam_id: c.exam_id ?? -1,
      tt100t_seconds: c.tt100t_seconds ?? 0,
      tps: c.tps ?? 0,
    }));

    const tt100ts = runs
      .map((r) => r.tt100t_seconds)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    let variance_pct = 0;
    let passed = false;
    if (tt100ts.length >= 2) {
      const mean = tt100ts.reduce((a, b) => a + b, 0) / tt100ts.length;
      const max = Math.max(...tt100ts);
      const min = Math.min(...tt100ts);
      variance_pct = mean > 0 ? ((max - min) / mean) * 100 : 0;
      passed = variance_pct < 5;
    }

    return {
      sweep_id: sweep.id,
      canonical_cell: {
        gpu_type: 'NVIDIA-L40',
        precision: CANONICAL_CELL.precision,
        batch_size: CANONICAL_CELL.batch_size,
        data_number: CANONICAL_CELL.data_number,
        tp: CANONICAL_CELL.tensor_parallel_size,
      },
      runs,
      variance_pct,
      passed,
      started_at: sweep.started_at ?? dayjs().tz(TZ).format(TS_FORMAT),
      completed_at: sweep.completed_at,
    };
  }

  // ------------------------- pause / drain / status ----------------------

  async pause(id: number): Promise<GpuSweep> {
    const sweep = await this.sweepRepo.findOne({ where: { id } });
    if (!sweep) throw new NotFoundException(`Sweep ${id} not found`);
    await this.sweepRepo.update(id, { status: GpuSweepStatus.PAUSED });
    return (await this.sweepRepo.findOne({ where: { id } }))!;
  }

  async drain(id: number): Promise<GpuSweep> {
    const sweep = await this.sweepRepo.findOne({ where: { id } });
    if (!sweep) throw new NotFoundException(`Sweep ${id} not found`);

    // Idempotent: stop any running/dispatched cells, then mark sweep drained.
    const inflight = await this.cellRepo.find({
      where: [
        { sweep_id: id, status: GpuSweepCellStatus.DISPATCHED },
        { sweep_id: id, status: GpuSweepCellStatus.RUNNING },
        { sweep_id: id, status: GpuSweepCellStatus.PENDING },
      ],
    });
    for (const cell of inflight) {
      try {
        if (cell.exam_id != null) {
          if (cell.kind === GpuSweepCellKind.MLPERF) {
            await this.mpExamService.stopMpExam(cell.exam_id);
          } else {
            // mm-exam stop method
            await (this.mmExamService as unknown as {
              stopMmExam: (id: number) => Promise<unknown>;
            }).stopMmExam(cell.exam_id);
          }
        }
      } catch (err) {
        this.logger.warn(
          `Drain: stop failed for cell ${cell.id}: ${(err as Error).message}`,
        );
      }
      await this.cellRepo.update(cell.id, {
        status: GpuSweepCellStatus.STOPPED,
      });
    }

    await this.sweepRepo.update(id, { status: GpuSweepStatus.DRAINED });
    if (this.activeSweepId === id) this.activeSweepId = null;
    this.logger.log(
      JSON.stringify({ event: 'sweep_drained', sweep_id: id, inflight_stopped: inflight.length }),
    );

    // Reset mutex regardless — drained means free.
    this.nodeMutex.node2 = {
      busy: false,
      last_dispatch_at: this.nodeMutex.node2.last_dispatch_at,
      current_cell_key: null,
    };
    this.nodeMutex.node3 = {
      busy: false,
      last_dispatch_at: this.nodeMutex.node3.last_dispatch_at,
      current_cell_key: null,
    };

    return (await this.sweepRepo.findOne({ where: { id } }))!;
  }

  async pauseActiveSweep(): Promise<GpuSweep> {
    if (this.activeSweepId == null) {
      throw new BadRequestException('No active sweep');
    }
    return this.pause(this.activeSweepId);
  }

  async drainActiveSweep(): Promise<GpuSweep> {
    if (this.activeSweepId == null) {
      throw new BadRequestException('No active sweep');
    }
    return this.drain(this.activeSweepId);
  }

  async getStatus(): Promise<SweepStatusResponse> {
    const enabled = this.isEnabled();
    let active_sweep: SweepStatusResponse['active_sweep'] = null;

    if (this.activeSweepId != null) {
      const sweep = await this.sweepRepo.findOne({
        where: { id: this.activeSweepId },
      });
      if (sweep) {
        active_sweep = {
          id: sweep.id,
          name: sweep.name,
          mode: sweep.mode,
          status: sweep.status,
          total_cells: sweep.total_cells,
          completed_cells: sweep.completed_cells,
          started_at: sweep.started_at,
        };
      }
    }

    const fmtMutex = (s: NodeMutexState) => ({
      busy: s.busy,
      last_dispatch_at: s.last_dispatch_at
        ? dayjs(s.last_dispatch_at).tz(TZ).format(TS_FORMAT)
        : null,
      current_cell_key: s.current_cell_key,
    });

    const paused = this.quietWindowActive;
    const quiet_window = {
      active: this.quietWindowActive,
      start_hour: parseInt(process.env.GPU_SWEEP_QUIET_WINDOW_START ?? '10', 10),
      end_hour: parseInt(process.env.GPU_SWEEP_QUIET_WINDOW_END ?? '18', 10),
      tz: 'Asia/Seoul',
    };
    return {
      enabled,
      paused,
      reason: paused ? 'quiet_window' : null,
      active_sweep,
      node_state: {
        node2: fmtMutex(this.nodeMutex.node2),
        node3: fmtMutex(this.nodeMutex.node3),
      },
      quiet_window,
    };
  }

  async listCells(sweepId: number): Promise<GpuSweepCell[]> {
    const sweep = await this.sweepRepo.findOne({ where: { id: sweepId } });
    if (!sweep) throw new NotFoundException(`Sweep ${sweepId} not found`);
    return this.cellRepo.find({ where: { sweep_id: sweepId }, order: { id: 'ASC' } });
  }

  // ---------------------- test-only helpers (internal) -------------------

  /** @internal */
  _testGetMutex() {
    return this.nodeMutex;
  }
  /** @internal */
  _testGetNodeQueue() {
    return this.nodeQueue;
  }
  /** @internal */
  _testReleaseNode(node: 'node2' | 'node3') {
    this.nodeMutex[node].busy = false;
    this.nodeMutex[node].current_cell_key = null;
  }
  /** @internal */
  _testSetStaggerSeconds(s: number) {
    this.staggerSeconds = s;
  }
  /** @internal */
  _testSetLastDispatch(node: 'node2' | 'node3', timestampMs: number | null) {
    this.nodeMutex[node].last_dispatch_at = timestampMs;
  }
  /** @internal */
  _testCanDispatchOn(node: 'node2' | 'node3') {
    return this.canDispatchOn(node);
  }
}

// Re-thrown explicitly as HttpException at the controller boundary if the
// service is invoked while disabled.
export function disabledServiceError(): HttpException {
  return new HttpException({ enabled: false }, HttpStatus.SERVICE_UNAVAILABLE);
}
