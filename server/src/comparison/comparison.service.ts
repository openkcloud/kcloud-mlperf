import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { canonicalize, CanonicalRunConfig } from './config-fingerprint';
import { MpExam } from '../entities/mp-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { StatusEnum } from '../enums/status.enum';
import {
  CandidateRun,
  CandidatesEmptyEnvelope,
  CandidatesResponse,
  ComparabilityClass,
} from './comparison.types';

// ----------------------------------------------------------------------
// Types — public contract for the unified comparison API.
// ----------------------------------------------------------------------

export type BenchmarkFilter = 'mlperf' | 'mmlu' | 'all';
export type HardwareFilter = 'gpu' | 'npu' | 'all';

export type HardwareType = 'gpu' | 'npu';
export type HardwareVendor = 'nvidia' | 'furiosa' | 'rebellions' | 'unknown';

/** Canonical hardware label shown in the UI. */
export type CanonicalHardwareLabel = 'L40' | 'A40' | 'RNGD' | 'Atom+' | string;

export interface NormalizedHardware {
  type: HardwareType;
  vendor: HardwareVendor;
  model: string;
  /** Canonical label normalised from gpu_type / npu_type */
  canonical: CanonicalHardwareLabel;
  node: string | null;
}

/** Flat row shape consumed by the comparison frontend table and export endpoints. */
export interface ComparisonRunRow {
  id: number;
  vendor: HardwareVendor;
  hardware: CanonicalHardwareLabel;
  benchmark: 'mlperf-inference' | 'mmlu-pro';
  model: string;
  tt100t_seconds: number | null;
  elapsed_seconds: number | null;
  status: 'completed' | 'failed' | 'running' | 'pending';
  failure_reason: string | null;
  config_fingerprint: string;
  drift_flag: boolean;
  is_canonical: boolean;
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
  elapsed_seconds: number | null;
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
  failure_reason: string | null;
  config_fingerprint: string;
  drift_flag: boolean;
  // W7 contract: subset runs (data_number 1..13367) are excluded from canonical comparison.
  // data_number=0 means full dataset (13368 samples), which is canonical.
  is_canonical: boolean;
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
    limit?: number;
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

    this.applyDriftFlags(allNormalized);

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
      if (
        filters.hardware !== 'all' &&
        run.hardware.type !== filters.hardware
      ) {
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

    const runs =
      filters.limit && filters.limit > 0
        ? filtered.slice(0, filters.limit)
        : filtered;

    return {
      empty: false,
      total: filtered.length,
      runs,
    };
  }

  // ---------------------------------------------------------------------
  // Export helpers — used by GET /api/comparison/export.csv|json
  // ---------------------------------------------------------------------

  async exportRows(filters: {
    benchmark: BenchmarkFilter;
    hardware: HardwareFilter;
    node: string | null;
    limit?: number;
  }): Promise<ComparisonRunRow[]> {
    const result = await this.list(filters);
    if (result.empty) return [];
    return result.runs.map((r) => this.toRunRow(r));
  }

  toRunRow(run: NormalizedRun): ComparisonRunRow {
    return {
      id: run.id,
      vendor: run.hardware.vendor,
      hardware: run.hardware.canonical,
      benchmark: run.benchmark === 'mlperf' ? 'mlperf-inference' : 'mmlu-pro',
      model: run.model,
      tt100t_seconds: run.metrics.tt100t_seconds,
      elapsed_seconds: run.elapsed_seconds,
      status: this.mapRunStatus(run.status),
      failure_reason: run.failure_reason,
      config_fingerprint: run.config_fingerprint,
      drift_flag: run.drift_flag,
      is_canonical: run.is_canonical,
    };
  }

  rowsToCsv(rows: ComparisonRunRow[]): string {
    const headers: (keyof ComparisonRunRow)[] = [
      'id',
      'vendor',
      'hardware',
      'benchmark',
      'model',
      'tt100t_seconds',
      'elapsed_seconds',
      'status',
      'failure_reason',
      'config_fingerprint',
      'drift_flag',
      'is_canonical',
    ];
    const escape = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
    ];
    return lines.join('\n');
  }

  private mapRunStatus(
    status: StatusEnum,
  ): 'completed' | 'failed' | 'running' | 'pending' {
    switch (status) {
      case StatusEnum.COMPLETED:
        return 'completed';
      case StatusEnum.ERROR:
        return 'failed';
      case StatusEnum.RUNNING:
      case StatusEnum.PREPARING:
        return 'running';
      default:
        return 'pending';
    }
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
      ...npuExams.map((e) => this.classifyHardware('NPU', e.npu_type, null)),
    ];

    const vendorsSeen = Array.from(
      new Set(allHardware.map((h) => h.vendor).filter((v) => v !== 'unknown')),
    );
    const nodesSeen = Array.from(
      new Set(allHardware.map((h) => h.node).filter((n): n is string => !!n)),
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
    const latest = this.latestResult(exam.results || []);

    const tt100t = latest?.result_tt100t ?? null;
    const tps = latest?.result_perf_tps ?? null;
    const sps = latest?.result_perf_sps ?? null;

    const cfg: CanonicalRunConfig = {
      benchmark: 'mlperf',
      model: exam.model,
      dataset: exam.dataset ?? '',
      precision: exam.precision ?? '',
      batch_size: exam.batch_size ?? 0,
      data_number: exam.data_number ?? 0,
      decoding: { temperature: 0 },
      scenario: exam.scenario ?? null,
      max_output_tokens: null,
    };

    return {
      id: exam.id,
      benchmark: 'mlperf',
      name: exam.name,
      model: exam.model,
      hardware: this.classifyHardware(exam.device_type, exam.gpu_type, null),
      status: this.coerceStatus(exam.status),
      started_at: exam.started_at ?? null,
      completed_at: exam.end_at ?? null,
      elapsed_seconds: this.calcElapsed(exam.started_at, exam.end_at),
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
      failure_reason: exam.error_log || null,
      config_fingerprint: canonicalize(cfg),
      drift_flag: false,
      is_canonical: this.isCanonicalRun('mlperf', exam.data_number ?? null),
    };
  }

  private normalizeMmExam(exam: MmExam): NormalizedRun {
    const latest = this.latestResult(exam.results || []);

    const accuracy =
      latest?.result_acc_total != null ? latest.result_acc_total : null;

    const cfg: CanonicalRunConfig = {
      benchmark: 'mmlu',
      model: exam.model,
      dataset: exam.dataset ?? '',
      precision: exam.precision ?? '',
      batch_size: exam.batch_size ?? 0,
      data_number: exam.data_number ?? 0,
      decoding: { temperature: 0 },
      scenario: null,
      max_output_tokens: null,
    };

    return {
      id: exam.id,
      benchmark: 'mmlu',
      name: exam.name,
      model: exam.model,
      hardware: this.classifyHardware(exam.device_type, exam.gpu_type, null),
      status: this.coerceStatus(exam.status),
      started_at: exam.started_at ?? null,
      completed_at: exam.end_at ?? null,
      elapsed_seconds: this.calcElapsed(exam.started_at, exam.end_at),
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
      failure_reason: exam.error_log || null,
      config_fingerprint: canonicalize(cfg),
      drift_flag: false,
      is_canonical: this.isCanonicalRun('mmlu', exam.data_number ?? null),
    };
  }

  private normalizeNpuExam(exam: NpuExam): NormalizedRun {
    const latest = this.latestResult(exam.results || []);
    const benchmark = exam.benchmark === 'mmlu' ? 'mmlu' : 'mlperf';

    const cfg: CanonicalRunConfig = {
      benchmark,
      model: exam.model,
      dataset: exam.dataset ?? '',
      precision: exam.precision ?? '',
      batch_size: exam.batch_size ?? 0,
      data_number: exam.data_number ?? 0,
      decoding: { temperature: 0 },
      scenario: null,
      max_output_tokens: exam.max_output_tokens ?? null,
    };

    return {
      id: exam.id,
      benchmark,
      name: exam.name,
      model: exam.model,
      hardware: this.classifyHardware('NPU', exam.npu_type, null),
      status: this.coerceStatus(exam.status),
      started_at: exam.started_at ?? null,
      completed_at: exam.end_at ?? null,
      elapsed_seconds: this.calcElapsed(exam.started_at, exam.end_at),
      metrics: {
        tt100t_seconds: latest?.result_tt100t ?? null,
        tps: latest?.result_tps ?? null,
        accuracy_pct: latest?.result_accuracy ?? null,
        throughput: latest?.result_sps ?? null,
      },
      artifacts: [],
      precision: exam.precision ?? null,
      scenario: null,
      batch_size: exam.batch_size ?? null,
      dataset: exam.dataset ?? null,
      data_number: exam.data_number ?? null,
      max_output_tokens: exam.max_output_tokens ?? null,
      source_table: 'npu_exam',
      failure_reason: exam.error_log || null,
      config_fingerprint: canonicalize(cfg),
      drift_flag: false,
      is_canonical: this.isCanonicalRun(benchmark, exam.data_number ?? null),
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

  private canonicalizeHardwareLabel(raw: string): CanonicalHardwareLabel {
    const upper = raw.toUpperCase().trim();
    if (upper.includes('L40')) return 'L40';
    if (upper.includes('A40')) return 'A40';
    if (upper.includes('RNGD')) return 'RNGD';
    if (upper.includes('ATOM+') || upper === 'ATOM+') return 'Atom+';
    if (upper.includes('ATOM')) return 'Atom+';
    return raw.trim() || 'Unknown';
  }

  private calcElapsed(
    startedAt: string | null | undefined,
    endAt: string | null | undefined,
  ): number | null {
    if (!startedAt || !endAt) return null;
    const start = Date.parse(startedAt);
    const end = Date.parse(endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    return Math.round((end - start) / 1000);
  }

  private applyDriftFlags(runs: NormalizedRun[]): void {
    const groups = new Map<string, NormalizedRun[]>();
    for (const run of runs) {
      const key = `${run.benchmark}|${run.model.trim().toLowerCase()}|${run.hardware.canonical}`;
      const grp = groups.get(key);
      if (grp) grp.push(run);
      else groups.set(key, [run]);
    }
    for (const grp of groups.values()) {
      const fingerprints = new Set(grp.map((r) => r.config_fingerprint));
      if (fingerprints.size > 1) {
        for (const r of grp) r.drift_flag = true;
      }
    }
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
        canonical: this.canonicalizeHardwareLabel(model),
        node,
      };
    }

    // Default to GPU
    return {
      type: 'gpu',
      vendor: model ? 'nvidia' : 'unknown',
      model: model || 'Unknown',
      canonical: this.canonicalizeHardwareLabel(model),
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

  // ---------------------------------------------------------------------
  // GET /api/comparison/candidates
  // ---------------------------------------------------------------------

  async findCandidates(
    runId: number,
    opts?: {
      benchmark?: BenchmarkFilter;
      hardware?: HardwareFilter;
      tt100tComparable?: boolean;
    },
  ): Promise<CandidatesResponse | CandidatesEmptyEnvelope> {
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
        source: { run_id: runId, benchmark: null, model: null, hardware: null },
        totals: {
          siblings_considered: 0,
          strict: 0,
          hardware_optimized: 0,
          related: 0,
        },
      };
    }

    const all: NormalizedRun[] = [
      ...mpExams.map((e) => this.normalizeMpExam(e)),
      ...mmExams.map((e) => this.normalizeMmExam(e)),
      ...npuExams.map((e) => this.normalizeNpuExam(e)),
    ];

    const source = this.findSourceRun(all, runId);
    if (!source) {
      return {
        empty: true,
        reason: 'source_run_not_found',
        message: `No run found with id=${runId} across mp_exam, mm_exam, or npu_exam.`,
        source: { run_id: runId, benchmark: null, model: null, hardware: null },
        totals: {
          siblings_considered: 0,
          strict: 0,
          hardware_optimized: 0,
          related: 0,
        },
      };
    }

    const benchmarkFilter = opts?.benchmark ?? 'all';
    const hardwareFilter = opts?.hardware ?? 'all';
    // tt100tComparable defaults true: cross-model TT100T comparison is the primary
    // cross-vendor use case (Atom+ vs RNGD vs GPU). Callers can opt out via false.
    const allowTt100tCrossModel = opts?.tt100tComparable !== false;

    const sourceHasTt100t =
      source.metrics.tt100t_seconds !== null &&
      source.metrics.tt100t_seconds !== undefined;
    const siblings = all.filter((r) => {
      if (r.id === source.id && r.source_table === source.source_table) {
        return false;
      }
      if (benchmarkFilter !== 'all' && r.benchmark !== benchmarkFilter) {
        return false;
      }
      if (hardwareFilter !== 'all' && r.hardware.type !== hardwareFilter) {
        return false;
      }
      const sameModel =
        this.normalizeModel(r.model) === this.normalizeModel(source.model);
      const sameDataset =
        this.normalizeDataset(r.dataset) ===
        this.normalizeDataset(source.dataset);
      const candidateHasTt100t =
        r.metrics.tt100t_seconds !== null &&
        r.metrics.tt100t_seconds !== undefined;
      const sameBenchmark = r.benchmark === source.benchmark;
      if (sameModel && sameBenchmark) return true;
      if (sameModel) return true;
      // Cross-HW same dataset: enables GPU↔NPU hardware-optimized grouping
      if (
        sameBenchmark &&
        sameDataset &&
        r.hardware.type !== source.hardware.type
      )
        return true;
      // Cross-model TT100T: include when both have tt100t and caller hasn't opted out.
      if (allowTt100tCrossModel && sourceHasTt100t && candidateHasTt100t)
        return true;
      return false;
    });

    const classified: CandidateRun[] = siblings.map((r) =>
      this.classifyComparability(source, r),
    );

    const strict = classified.filter((c) => c.comparability_class === 'strict');
    const hardwareOptimized = classified.filter(
      (c) => c.comparability_class === 'hardware-optimized',
    );
    const related = classified.filter(
      (c) => c.comparability_class === 'related',
    );

    const sortByScoreThenStarted = (a: CandidateRun, b: CandidateRun) => {
      if (b.comparability_score !== a.comparability_score) {
        return b.comparability_score - a.comparability_score;
      }
      const aTs = a.started_at ? Date.parse(a.started_at) : 0;
      const bTs = b.started_at ? Date.parse(b.started_at) : 0;
      return bTs - aTs;
    };
    strict.sort(sortByScoreThenStarted);
    hardwareOptimized.sort(sortByScoreThenStarted);
    related.sort(sortByScoreThenStarted);

    if (classified.length === 0) {
      return {
        empty: true,
        reason: 'no_siblings_found',
        message: `Run #${runId} (${source.benchmark}/${source.model}) has no comparable siblings on this cluster.`,
        source: {
          run_id: runId,
          benchmark: source.benchmark,
          model: source.model,
          hardware: source.hardware.model,
        },
        totals: {
          siblings_considered: 0,
          strict: 0,
          hardware_optimized: 0,
          related: 0,
        },
      };
    }

    return {
      empty: false,
      source: this.toCandidateRow(source, source),
      totals: {
        siblings_considered: classified.length,
        strict: strict.length,
        hardware_optimized: hardwareOptimized.length,
        related: related.length,
      },
      candidates: {
        strict,
        hardware_optimized: hardwareOptimized,
        related,
      },
    };
  }

  private findSourceRun(
    all: NormalizedRun[],
    runId: number,
  ): NormalizedRun | null {
    // Disambiguate by id within each source table — ids may collide across
    // mp_exam/mm_exam/npu_exam sequences. Prefer mp first, then npu (mlperf),
    // then mm, then npu (mmlu).
    const candidates = all.filter((r) => r.id === runId);
    if (candidates.length === 0) return null;
    const order: Array<NormalizedRun['source_table']> = [
      'mp_exam',
      'mm_exam',
      'npu_exam',
    ];
    for (const tbl of order) {
      const hit = candidates.find((c) => c.source_table === tbl);
      if (hit) return hit;
    }
    return candidates[0];
  }

  private classifyComparability(
    source: NormalizedRun,
    candidate: NormalizedRun,
  ): CandidateRun {
    const sameBenchmark = source.benchmark === candidate.benchmark;
    const sameModel =
      this.normalizeModel(source.model) ===
      this.normalizeModel(candidate.model);
    const sameDataset =
      this.normalizeDataset(source.dataset) ===
      this.normalizeDataset(candidate.dataset);
    const samePrecision =
      this.normalizeStr(source.precision) ===
      this.normalizeStr(candidate.precision);
    const sameScenario =
      this.normalizeStr(source.scenario) ===
      this.normalizeStr(candidate.scenario);
    const sameBatch = source.batch_size === candidate.batch_size;
    const sameDataNumber = source.data_number === candidate.data_number;
    const sameMaxOutput =
      source.max_output_tokens === candidate.max_output_tokens;
    const differentHardwareType =
      source.hardware.type !== candidate.hardware.type;

    let cls: ComparabilityClass = 'related';
    const reasons: string[] = [];

    if (
      sameBenchmark &&
      sameModel &&
      sameDataset &&
      samePrecision &&
      sameScenario &&
      sameBatch &&
      sameDataNumber &&
      sameMaxOutput
    ) {
      cls = 'strict';
      reasons.push(
        'identical benchmark/model/dataset/precision/scenario/batch_size/data_number/max_output_tokens',
      );
    } else if (
      sameBenchmark &&
      sameModel &&
      sameDataset &&
      differentHardwareType
    ) {
      cls = 'hardware-optimized';
      const precisionNote = samePrecision
        ? `same precision (${source.precision ?? '∅'})`
        : `precision differs (${source.precision ?? '∅'} vs ${candidate.precision ?? '∅'})`;
      reasons.push(
        `same benchmark/model/dataset; ${precisionNote}; ${source.hardware.type.toUpperCase()} vs ${candidate.hardware.type.toUpperCase()} hardware`,
      );
    } else {
      cls = 'related';
      const diffs: string[] = [];
      if (!sameDataset)
        diffs.push(`dataset (${source.dataset} vs ${candidate.dataset})`);
      if (!samePrecision)
        diffs.push(
          `precision (${source.precision ?? '∅'} vs ${candidate.precision ?? '∅'})`,
        );
      if (!sameScenario)
        diffs.push(`scenario (${source.scenario} vs ${candidate.scenario})`);
      if (!sameBatch)
        diffs.push(
          `batch_size (${source.batch_size} vs ${candidate.batch_size})`,
        );
      if (!sameDataNumber)
        diffs.push(
          `data_number (${source.data_number} vs ${candidate.data_number})`,
        );
      if (!sameMaxOutput)
        diffs.push(
          `max_output_tokens (${source.max_output_tokens} vs ${candidate.max_output_tokens})`,
        );
      reasons.push(
        `same benchmark/model; differs on ${diffs.join(', ') || 'other settings'}`,
      );
    }

    const score =
      (sameBenchmark ? 1 : 0) +
      (sameModel ? 2 : 0) +
      (sameDataset ? 1 : 0) +
      (samePrecision ? 1 : 0) +
      (sameScenario ? 1 : 0) +
      (sameBatch ? 1 : 0) +
      (sameDataNumber ? 1 : 0) +
      (sameMaxOutput ? 1 : 0);

    const row: CandidateRun = {
      ...candidate,
      comparability_class: cls,
      comparability_reason: reasons.join('; '),
      comparability_score: score,
    };
    return row;
  }

  private toCandidateRow(
    source: NormalizedRun,
    run: NormalizedRun,
  ): CandidateRun {
    if (run === source) {
      return {
        ...run,
        comparability_class: 'strict',
        comparability_reason: 'source run',
        comparability_score: Number.MAX_SAFE_INTEGER,
      };
    }
    return this.classifyComparability(source, run);
  }

  private normalizeModel(model: string | null | undefined): string {
    if (!model) return '';
    // Strip org/vendor prefixes: "meta-llama/Llama-3.1-8B-Instruct" → "llama-3.1-8b-instruct"
    // Also strip vendor-specific suffixes like "-fp8" added by furiosa-ai.
    const bare = model.trim().split('/').pop() ?? '';
    return bare.toLowerCase().replace(/-fp8$/i, '');
  }

  // W7 contract: data_number=0 means full dataset (canonical). 1..13367 = subset (not canonical).
  // data_number >= 13368 is also canonical (explicit full count).
  private isCanonicalRun(benchmark: 'mlperf' | 'mmlu', dataNbr: number | null): boolean {
    if (benchmark === 'mmlu') return true; // MMLU always uses full dataset
    const n = dataNbr ?? 0;
    return n === 0 || n >= 13368;
  }

  private normalizeDataset(dataset: string | null | undefined): string {
    if (!dataset) return '';
    const s = dataset.trim().toLowerCase();
    // Canonicalize CNN-DailyMail variants: cnn_eval.json, cnn-dailymail, cnn_dailymail → cnn-dailymail
    if (
      s === 'cnn_eval.json' ||
      s === 'cnn_dailymail' ||
      s === 'cnn-dailymail'
    ) {
      return 'cnn-dailymail';
    }
    return s;
  }

  private normalizeStr(s: string | null | undefined): string {
    if (s == null) return '';
    return String(s).trim().toLowerCase();
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
