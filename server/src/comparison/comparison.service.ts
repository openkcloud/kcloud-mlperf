import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { MpExam } from '../entities/mp-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { StatusEnum } from '../enums/status.enum';

// ----------------------------------------------------------------------
// Types — public contract for the unified comparison API.
// ----------------------------------------------------------------------

export type BenchmarkFilter = 'mlperf' | 'mmlu' | 'all';
export type HardwareFilter = 'gpu' | 'npu' | 'all';

export type HardwareType = 'gpu' | 'npu';
export type HardwareVendor = 'nvidia' | 'furiosa' | 'rebellions' | 'unknown';

export interface NormalizedHardware {
  type: HardwareType;
  vendor: HardwareVendor;
  model: string;
  node: string | null;
}

export interface NormalizedMetrics {
  tt100t_seconds: number | null;
  tps: number | null;
  accuracy_pct: number | null;
  throughput: number | null;
}

export interface NormalizedRun {
  id: number;
  benchmark: 'mlperf' | 'mmlu';
  name: string;
  model: string;
  hardware: NormalizedHardware;
  status: StatusEnum;
  started_at: string | null;
  completed_at: string | null;
  metrics: NormalizedMetrics;
  artifacts: string[];
  // Settings used for candidate comparability matching.
  precision: string | null;
  scenario: string | null;
  batch_size: number | null;
  dataset: string | null;
  data_number: number | null;
  max_output_tokens: number | null;
  source_table: 'mp_exam' | 'mm_exam' | 'npu_exam';
}

export type EmptyReason =
  | 'no_runs_exist'
  | 'all_runs_filtered'
  | 'ingestion_failed'
  | 'hardware_not_ready';

export interface DiagnosticEnvelope {
  empty: true;
  reason: EmptyReason;
  message: string;
  total_runs: number;
  filtered_runs: number;
  filters_applied: {
    benchmark: BenchmarkFilter;
    hardware: HardwareFilter;
    node: string | null;
  };
}

export interface ListResponse {
  empty: false;
  total: number;
  runs: NormalizedRun[];
}

export interface PairComparisonResponse {
  benchmark: 'mlperf' | 'mmlu';
  a: NormalizedRun;
  b: NormalizedRun;
  delta: {
    tt100t_seconds: number | null;
    tps: number | null;
    accuracy_pct: number | null;
    throughput: number | null;
  };
}

export interface DiagnosticsResponse {
  benchmarks: {
    mlperf: BenchmarkDiagnostic;
    mmlu: BenchmarkDiagnostic;
    npu_eval: BenchmarkDiagnostic;
  };
  hardware: {
    gpu_available: boolean;
    npu_available: boolean;
    nodes_seen: string[];
    vendors_seen: HardwareVendor[];
  };
  ingestion: {
    errors: number;
    last_error: string | null;
  };
  generated_at: string;
}

interface BenchmarkDiagnostic {
  total: number;
  completed: number;
  running: number;
  failed: number;
  idle: number;
}

// ----------------------------------------------------------------------

@Injectable()
export class ComparisonService {
  private readonly logger = new Logger(ComparisonService.name);
  private ingestionErrorCount = 0;
  private lastIngestionError: string | null = null;

  constructor(
    @InjectRepository(MpExam)
    private readonly mpExamRepo: Repository<MpExam>,
    @InjectRepository(MpExamResult)
    private readonly mpExamResultRepo: Repository<MpExamResult>,
    @InjectRepository(MmExam)
    private readonly mmExamRepo: Repository<MmExam>,
    @InjectRepository(MmExamResult)
    private readonly mmExamResultRepo: Repository<MmExamResult>,
    @InjectRepository(NpuExam)
    private readonly npuExamRepo: Repository<NpuExam>,
    @InjectRepository(NpuExamResult)
    private readonly npuExamResultRepo: Repository<NpuExamResult>,
  ) {}

  // ---------------------------------------------------------------------
  // GET /api/comparison/list
  // ---------------------------------------------------------------------

  async list(filters: {
    benchmark: BenchmarkFilter;
    hardware: HardwareFilter;
    node: string | null;
  }): Promise<ListResponse | DiagnosticEnvelope> {
    let mpExams: MpExam[] = [];
    let mmExams: MmExam[] = [];
    let npuExams: NpuExam[] = [];

    try {
      [mpExams, mmExams, npuExams] = await Promise.all([
        this.mpExamRepo.find({ relations: ['results'] }),
        this.mmExamRepo.find({ relations: ['results'] }),
        this.npuExamRepo.find({ relations: ['results'] }),
      ]);
    } catch (err) {
      this.recordIngestionError(err);
      return {
        empty: true,
        reason: 'ingestion_failed',
        message:
          (err as Error)?.message ||
          'Failed to read benchmark records from the database.',
        total_runs: 0,
        filtered_runs: 0,
        filters_applied: filters,
      };
    }

    const allNormalized: NormalizedRun[] = [
      ...mpExams.map((e) => this.normalizeMpExam(e)),
      ...mmExams.map((e) => this.normalizeMmExam(e)),
      ...npuExams.map((e) => this.normalizeNpuExam(e)),
    ];

    const totalRuns = allNormalized.length;

    if (totalRuns === 0) {
      return {
        empty: true,
        reason: 'no_runs_exist',
        message:
          'No benchmark runs have been recorded yet across mlperf, mmlu, or npu-eval.',
        total_runs: 0,
        filtered_runs: 0,
        filters_applied: filters,
      };
    }

    const filtered = allNormalized.filter((run) => {
      if (filters.benchmark !== 'all' && run.benchmark !== filters.benchmark) {
        return false;
      }
      if (filters.hardware !== 'all' && run.hardware.type !== filters.hardware) {
        return false;
      }
      if (filters.node && run.hardware.node !== filters.node) {
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      return {
        empty: true,
        reason: 'all_runs_filtered',
        message: `${totalRuns} run(s) exist but all were excluded by the active filters.`,
        total_runs: totalRuns,
        filtered_runs: 0,
        filters_applied: filters,
      };
    }

    filtered.sort((a, b) => {
      const aTs = a.started_at ? Date.parse(a.started_at) : 0;
      const bTs = b.started_at ? Date.parse(b.started_at) : 0;
      return bTs - aTs;
    });

    return {
      empty: false,
      total: filtered.length,
      runs: filtered,
    };
  }

  // ---------------------------------------------------------------------
  // GET /api/comparison/:benchmark/:idA/:idB
  // ---------------------------------------------------------------------

  async pair(
    benchmark: 'mlperf' | 'mmlu',
    idA: number,
    idB: number,
  ): Promise<PairComparisonResponse> {
    const [a, b] = await Promise.all([
      this.findUnifiedRun(benchmark, idA),
      this.findUnifiedRun(benchmark, idB),
    ]);

    if (!a) {
      throw new NotFoundException(
        `No ${benchmark} run found with id=${idA} across mp-exam, mm-exam, or npu-eval`,
      );
    }
    if (!b) {
      throw new NotFoundException(
        `No ${benchmark} run found with id=${idB} across mp-exam, mm-exam, or npu-eval`,
      );
    }

    return {
      benchmark,
      a,
      b,
      delta: {
        tt100t_seconds: this.delta(
          a.metrics.tt100t_seconds,
          b.metrics.tt100t_seconds,
        ),
        tps: this.delta(a.metrics.tps, b.metrics.tps),
        accuracy_pct: this.delta(
          a.metrics.accuracy_pct,
          b.metrics.accuracy_pct,
        ),
        throughput: this.delta(a.metrics.throughput, b.metrics.throughput),
      },
    };
  }

  // ---------------------------------------------------------------------
  // GET /api/comparison/diagnostics
  // ---------------------------------------------------------------------

  async diagnostics(): Promise<DiagnosticsResponse> {
    let mpExams: MpExam[] = [];
    let mmExams: MmExam[] = [];
    let npuExams: NpuExam[] = [];

    try {
      [mpExams, mmExams, npuExams] = await Promise.all([
        this.mpExamRepo.find(),
        this.mmExamRepo.find(),
        this.npuExamRepo.find(),
      ]);
    } catch (err) {
      this.recordIngestionError(err);
    }

    const allHardware = [
      ...mpExams.map((e) =>
        this.classifyHardware(e.device_type, e.gpu_type, null),
      ),
      ...mmExams.map((e) =>
        this.classifyHardware(e.device_type, e.gpu_type, null),
      ),
      ...npuExams.map((e) =>
        this.classifyHardware('NPU', e.npu_type, null),
      ),
    ];

    const vendorsSeen = Array.from(
      new Set(allHardware.map((h) => h.vendor).filter((v) => v !== 'unknown')),
    );
    const nodesSeen = Array.from(
      new Set(
        allHardware
          .map((h) => h.node)
          .filter((n): n is string => !!n),
      ),
    );

    return {
      benchmarks: {
        mlperf: this.summarizeStatuses(mpExams.map((e) => e.status)),
        mmlu: this.summarizeStatuses(mmExams.map((e) => e.status)),
        npu_eval: this.summarizeStatuses(npuExams.map((e) => e.status)),
      },
      hardware: {
        gpu_available: allHardware.some((h) => h.type === 'gpu'),
        npu_available: allHardware.some((h) => h.type === 'npu'),
        nodes_seen: nodesSeen,
        vendors_seen: vendorsSeen,
      },
      ingestion: {
        errors: this.ingestionErrorCount,
        last_error: this.lastIngestionError,
      },
      generated_at: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private async findUnifiedRun(
    benchmark: 'mlperf' | 'mmlu',
    id: number,
  ): Promise<NormalizedRun | null> {
    if (benchmark === 'mlperf') {
      const mp = await this.mpExamRepo.findOne({
        where: { id },
        relations: ['results'],
      });
      if (mp) return this.normalizeMpExam(mp);

      const npu = await this.npuExamRepo.findOne({
        where: { id, benchmark: 'mlperf' },
        relations: ['results'],
      });
      if (npu) return this.normalizeNpuExam(npu);

      return null;
    }

    // mmlu
    const mm = await this.mmExamRepo.findOne({
      where: { id },
      relations: ['results'],
    });
    if (mm) return this.normalizeMmExam(mm);

    const npu = await this.npuExamRepo.findOne({
      where: { id, benchmark: 'mmlu' },
      relations: ['results'],
    });
    if (npu) return this.normalizeNpuExam(npu);

    return null;
  }

  private normalizeMpExam(exam: MpExam): NormalizedRun {
    const latest = this.latestResult(
      (exam.results || []) as MpExamResult[],
    );

    const tt100t = latest?.result_tt100t ?? null;
    const tps = latest?.result_perf_tps ?? null;
    const sps = latest?.result_perf_sps ?? null;

    return {
      id: exam.id,
      benchmark: 'mlperf',
      name: exam.name,
      model: exam.model,
      hardware: this.classifyHardware(
        exam.device_type,
        exam.gpu_type,
        null,
      ),
      status: this.coerceStatus(exam.status),
      started_at: exam.started_at ?? null,
      completed_at: exam.end_at ?? null,
      metrics: {
        tt100t_seconds: tt100t,
        tps,
        accuracy_pct: null,
        throughput: sps,
      },
      artifacts: this.mlperfArtifacts(exam.id, exam.retry_num),
      precision: exam.precision ?? null,
      scenario: exam.scenario ?? null,
      batch_size: exam.batch_size ?? null,
      dataset: exam.dataset ?? null,
      data_number: exam.data_number ?? null,
      max_output_tokens: null,
      source_table: 'mp_exam',
    };
  }

  private normalizeMmExam(exam: MmExam): NormalizedRun {
    const latest = this.latestResult(
      (exam.results || []) as MmExamResult[],
    );

    const accuracy =
      latest?.result_acc_total != null ? latest.result_acc_total : null;

    return {
      id: exam.id,
      benchmark: 'mmlu',
      name: exam.name,
      model: exam.model,
      hardware: this.classifyHardware(
        exam.device_type,
        exam.gpu_type,
        null,
      ),
      status: this.coerceStatus(exam.status),
      started_at: exam.started_at ?? null,
      completed_at: exam.end_at ?? null,
      metrics: {
        tt100t_seconds: null,
        tps: null,
        accuracy_pct: accuracy,
        throughput: null,
      },
      artifacts: [],
      precision: exam.precision ?? null,
      scenario: null,
      batch_size: exam.batch_size ?? null,
      dataset: exam.dataset ?? null,
      data_number: exam.data_number ?? null,
      max_output_tokens: null,
      source_table: 'mm_exam',
    };
  }

  private normalizeNpuExam(exam: NpuExam): NormalizedRun {
    const latest = this.latestResult(
      (exam.results || []) as NpuExamResult[],
    );
    const benchmark = (exam.benchmark === 'mmlu' ? 'mmlu' : 'mlperf') as
      | 'mlperf'
      | 'mmlu';

    return {
      id: exam.id,
      benchmark,
      name: exam.name,
      model: exam.model,
      hardware: this.classifyHardware('NPU', exam.npu_type, null),
      status: this.coerceStatus(exam.status),
      started_at: exam.started_at ?? null,
      completed_at: exam.end_at ?? null,
      metrics: {
        tt100t_seconds: latest?.result_tt100t ?? null,
        tps: latest?.result_tps ?? null,
        accuracy_pct: latest?.result_accuracy ?? null,
        throughput: latest?.result_sps ?? null,
      },
      artifacts: [],
    };
  }

  private latestResult<T extends { result_number: number }>(
    results: T[],
  ): T | null {
    if (!results || results.length === 0) return null;
    return results.reduce((acc, cur) =>
      cur.result_number > acc.result_number ? cur : acc,
    );
  }

  // Hardware classification:
  //   GPU vendors → nvidia (L40, A40, A6000, H100, ...).
  //   NPU vendors → furiosa for RNGD, rebellions for Atom+ / ATOM+.
  private classifyHardware(
    deviceType: string | null | undefined,
    deviceModel: string | null | undefined,
    node: string | null,
  ): NormalizedHardware {
    const model = (deviceModel || '').trim();
    const dt = (deviceType || '').toUpperCase();

    if (dt === 'NPU') {
      const vendor = this.classifyNpuVendor(model);
      return {
        type: 'npu',
        vendor,
        model: model || 'Unknown',
        node,
      };
    }

    // Default to GPU
    return {
      type: 'gpu',
      vendor: model ? 'nvidia' : 'unknown',
      model: model || 'Unknown',
      node,
    };
  }

  private classifyNpuVendor(model: string): HardwareVendor {
    const upper = model.toUpperCase();
    if (upper.includes('RNGD')) return 'furiosa';
    if (upper.includes('ATOM')) return 'rebellions';
    return 'unknown';
  }

  private coerceStatus(raw: string | null | undefined): StatusEnum {
    if (!raw) return StatusEnum.UNDEFINED;
    const match = Object.values(StatusEnum).find(
      (v) => v.toLowerCase() === raw.toLowerCase(),
    );
    return (match as StatusEnum) || StatusEnum.UNDEFINED;
  }

  private summarizeStatuses(statuses: string[]): BenchmarkDiagnostic {
    const out: BenchmarkDiagnostic = {
      total: statuses.length,
      completed: 0,
      running: 0,
      failed: 0,
      idle: 0,
    };
    for (const s of statuses) {
      const status = this.coerceStatus(s);
      if (status === StatusEnum.COMPLETED) out.completed++;
      else if (status === StatusEnum.RUNNING || status === StatusEnum.PREPARING)
        out.running++;
      else if (status === StatusEnum.ERROR) out.failed++;
      else out.idle++;
    }
    return out;
  }

  private mlperfArtifacts(examId: number, retryCount: number): string[] {
    if (!retryCount || retryCount <= 0) return [];
    const arts: string[] = [];
    for (let i = 1; i <= retryCount; i++) {
      arts.push(`/api/files/mlperf/${examId}/${i}/exam_result.zip`);
    }
    return arts;
  }

  private delta(a: number | null, b: number | null): number | null {
    if (a == null || b == null) return null;
    return a - b;
  }

  private recordIngestionError(err: unknown) {
    this.ingestionErrorCount++;
    const msg = err instanceof Error ? err.message : String(err);
    this.lastIngestionError = msg;
    this.logger.warn(`Comparison ingestion error: ${msg}`);
  }

  // Test-only helper exposed via DI in unit tests.
  // Not used by HTTP layer.
  /** @internal */
  async _findRunsByIds(
    benchmark: 'mlperf' | 'mmlu',
    ids: number[],
  ): Promise<NormalizedRun[]> {
    if (ids.length === 0) return [];
    if (benchmark === 'mlperf') {
      const mps = await this.mpExamRepo.find({
        where: { id: In(ids) },
        relations: ['results'],
      });
      return mps.map((e) => this.normalizeMpExam(e));
    }
    const mms = await this.mmExamRepo.find({
      where: { id: In(ids) },
      relations: ['results'],
    });
    return mms.map((e) => this.normalizeMmExam(e));
  }
}
