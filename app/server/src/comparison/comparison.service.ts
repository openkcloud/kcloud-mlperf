import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { canonicalize, CanonicalRunConfig } from './config-fingerprint';
import { assessFairness, FairnessAssessment } from './fairness-assessment';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';
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
export type CanonicalHardwareLabel =
  | 'L40'
  | 'A40'
  | 'A30'
  | 'RNGD'
  | 'Atom+'
  | string;

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
  precision_mismatch: boolean;
}

export interface NormalizedMetrics {
  tt100t_seconds: number | null;
  tps: number | null;
  accuracy_pct: number | null;
  throughput: number | null;
  // Round-2 statistical rigor: run-to-run variation across the measured result
  // rows (retry_num runs). `samples` is the number of measured runs used; stdev
  // is the sample standard deviation. Null when only one (or zero) run exists.
  tps_stdev?: number | null;
  tt100t_stdev?: number | null;
  // Per-metric measured-run counts (a run can have a different number of valid
  // TPS rows vs TT100T rows; a shared `samples` would misreport one of them).
  tt100t_samples?: number | null;
  tps_samples?: number | null;
  // R9: time-to-first-token in seconds. Null for MMLU (no TTFT measurement).
  // MLPerf: parsed from "Mean First Token latency (ns)" → divided by 1e9.
  // NPU: stored in seconds by npu-eval.service.ts → no conversion needed.
  ttft_seconds?: number | null;
  ttft_stdev?: number | null;
  ttft_samples?: number | null;
  // BB-3: latency percentiles in seconds (from the representative/latest
  // result row). Null for MMLU and for runs whose logs lacked percentiles.
  p50_latency_s?: number | null;
  p90_latency_s?: number | null;
  p99_latency_s?: number | null;
  // R8 (perf/Watt): mean device power over the run window (Watts) — mean of
  // available result rows. Null when telemetry was unavailable.
  avg_power_w?: number | null;
  // R8 derived: tokens-per-watt = tps / avg_power_w. Null if either is
  // missing or avg_power_w is 0.
  tokens_per_watt?: number | null;
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
  // W7/W10 contract: BF16 fallback on MLPerf where FP8 is canonical (A40, RNGD-bf16, Atom+).
  precision_mismatch: boolean;
  // US-005: how the latency for this run was measured. Defaults to UNKNOWN
  // when neither the result row nor a sensible per-source default applies.
  latency_measurement_context: LatencyMeasurementContext;
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
    ttft_seconds: number | null;
    // BB-3 / R8 additions.
    p50_latency_s: number | null;
    p90_latency_s: number | null;
    p99_latency_s: number | null;
    avg_power_w: number | null;
    tokens_per_watt: number | null;
  };
  /**
   * Each entry names a confounder axis on which `a` and `b` disagree, e.g.
   * `'precision_mismatch'` or `'data_number_mismatch'`. Empty array means the
   * runs are matched on every controlled variable this platform tracks.
   * The frontend MUST surface a non-empty list as a warning before showing
   * the delta to a researcher (US-002 fairness gate).
   */
  incompatibility_reasons: string[];
  /**
   * WS-B05 — canonical fairness verdict. The `incompatibility_reasons[]`
   * field above is preserved for backward compatibility, but
   * `fairness_assessment` is the richer struct also persisted on every
   * result write into the `fairness_assessment` jsonb column (US-0.5).
   */
  fairness_assessment: FairnessAssessment;
}

// Top-level normalization helpers shared between `computeIncompatibilityReasons`
// (top-level export) and the class's `classifyComparability` (instance method).
// Keeping a single source of truth prevents the helper and the candidate
// classifier from disagreeing on what counts as "same dataset" or "same
// model" — earlier inline duplication caused `cnn_eval.json` vs
// `cnn-dailymail` to falsely register as a dataset_mismatch in the API
// response while the candidate page still treated them as identical.
export function normalizeStrLower(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).trim().toLowerCase();
}

export function normalizeBaseModel(model: string | null | undefined): string {
  if (!model) return '';
  // Strip org/vendor prefixes ("meta-llama/Llama-3.1-8B-Instruct" →
  // "llama-3.1-8b-instruct") and the vendor "-fp8" suffix added by
  // furiosa-ai. The PRD's `tokenizer_unverified` reason still fires for
  // cross-vendor pairs so quantized variants don't get falsely equated.
  const bare = model.trim().split('/').pop() ?? '';
  return bare.toLowerCase().replace(/-fp8$/i, '');
}

export function normalizeDatasetLabel(
  dataset: string | null | undefined,
): string {
  if (!dataset) return '';
  const s = dataset.trim().toLowerCase();
  if (s === 'cnn_eval.json' || s === 'cnn_dailymail' || s === 'cnn-dailymail') {
    return 'cnn-dailymail';
  }
  return s;
}

/**
 * Pure helper: compares two NormalizedRuns and returns one string per axis
 * on which they disagree. Designed for fairness gating in pair() and the
 * frontend ComparisonDetailDialog (US-002).
 *
 * The returned reason codes are stable strings the UI can switch on:
 *   - 'model_mismatch'         models differ after normalization
 *   - 'precision_mismatch'     precision strings differ (case-insensitive)
 *   - 'dataset_mismatch'       datasets differ after normalization
 *   - 'data_number_mismatch'   sample counts differ
 *   - 'max_output_tokens_mismatch'  decoding length cap differs
 *   - 'tokenizer_unverified'   cross-vendor pair, tokenizer parity not
 *                              independently verified by the platform
 *   - 'latency_context_mismatch' (US-005) measurement contexts differ
 */
export function computeIncompatibilityReasons(
  a: NormalizedRun,
  b: NormalizedRun,
): string[] {
  const reasons: string[] = [];

  if (normalizeBaseModel(a.model) !== normalizeBaseModel(b.model))
    reasons.push('model_mismatch');
  if (normalizeStrLower(a.precision) !== normalizeStrLower(b.precision))
    reasons.push('precision_mismatch');
  if (normalizeDatasetLabel(a.dataset) !== normalizeDatasetLabel(b.dataset))
    reasons.push('dataset_mismatch');
  if ((a.data_number ?? null) !== (b.data_number ?? null))
    reasons.push('data_number_mismatch');
  if ((a.max_output_tokens ?? null) !== (b.max_output_tokens ?? null))
    reasons.push('max_output_tokens_mismatch');

  // Cross-vendor pairs cannot have tokenizer parity asserted by the platform
  // (no tokenizer SHA is captured today — see audit gap US-003). Always flag.
  if (
    a.hardware.vendor !== 'unknown' &&
    b.hardware.vendor !== 'unknown' &&
    a.hardware.vendor !== b.hardware.vendor
  ) {
    reasons.push('tokenizer_unverified');
  }

  // US-005: cross-context latency comparisons (client-side wall clock vs
  // server-side token-stream timing) are not scientifically equivalent.
  // Skip the flag when either side is UNKNOWN (e.g., MMLU rows have no
  // latency to measure).
  const ctxA = a.latency_measurement_context;
  const ctxB = b.latency_measurement_context;
  if (
    ctxA &&
    ctxB &&
    ctxA !== LatencyMeasurementContext.UNKNOWN &&
    ctxB !== LatencyMeasurementContext.UNKNOWN &&
    ctxA !== ctxB
  ) {
    reasons.push('latency_context_mismatch');
  }

  // C4: MLPerf Server vs Offline are non-comparable measurement modes (Server =
  // Poisson arrivals under a latency SLA; Offline = max-throughput batch). The
  // candidate classifier already demotes a scenario-mismatched run to "related",
  // but this gate (which the dialog's metric-table + fairness verdict consume)
  // ignored scenario, so server-vs-offline rendered a delta table with an
  // "all matched" fairness verdict and no warning. Flag it when BOTH runs are
  // mlperf and their (case-insensitive) scenarios differ; skip when either is
  // null/empty (MMLU rows carry no scenario). Guarded against double-adding.
  if (a.benchmark === 'mlperf' && b.benchmark === 'mlperf') {
    const scenA = normalizeStrLower(a.scenario);
    const scenB = normalizeStrLower(b.scenario);
    if (
      scenA &&
      scenB &&
      scenA !== scenB &&
      !reasons.includes('scenario_mismatch')
    ) {
      reasons.push('scenario_mismatch');
    }
  }

  return reasons;
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
      precision_mismatch: run.precision_mismatch,
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
    idA: number | string,
    idB: number | string,
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
      incompatibility_reasons: computeIncompatibilityReasons(a, b),
      fairness_assessment: assessFairness(a, b),
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
        ttft_seconds: this.delta(
          a.metrics.ttft_seconds ?? null,
          b.metrics.ttft_seconds ?? null,
        ),
        p50_latency_s: this.delta(
          a.metrics.p50_latency_s ?? null,
          b.metrics.p50_latency_s ?? null,
        ),
        p90_latency_s: this.delta(
          a.metrics.p90_latency_s ?? null,
          b.metrics.p90_latency_s ?? null,
        ),
        p99_latency_s: this.delta(
          a.metrics.p99_latency_s ?? null,
          b.metrics.p99_latency_s ?? null,
        ),
        avg_power_w: this.delta(
          a.metrics.avg_power_w ?? null,
          b.metrics.avg_power_w ?? null,
        ),
        tokens_per_watt: this.delta(
          a.metrics.tokens_per_watt ?? null,
          b.metrics.tokens_per_watt ?? null,
        ),
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
        this.classifyHardware(e.device_type, e.gpu_type, e.k8s_node_name ?? null),
      ),
      ...mmExams.map((e) =>
        this.classifyHardware(e.device_type, e.gpu_type, e.k8s_node_name ?? null),
      ),
      ...npuExams.map((e) =>
        this.classifyHardware('NPU', e.npu_type, e.k8s_node_name ?? null),
      ),
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

  // C1 fix: a run reference may arrive either as a bare numeric id (legacy,
  // ambiguous on cross-table id collisions) or as a namespaced
  // `${kind}:${id}` token (e.g. "npu:178", "mp:178", "mm:153") that pins the
  // exact source table. Per-table autoincrement ids collide across
  // mp_exam/mm_exam/npu_exam (75 live mp↔npu collisions incl. every canonical
  // NPU run), so a bare id silently let mp_exam shadow npu_exam and returned an
  // L40 GPU run with a false vendor_match for a picked RNGD NPU run. The
  // candidate carries its source table, so the frontend now namespaces the id;
  // a bare numeric id still falls back to the original mp→npu / mm→npu
  // precedence for backward compatibility.
  private parseRunRef(ref: number | string): {
    kind: 'mp' | 'mm' | 'npu' | null;
    id: number;
  } | null {
    if (typeof ref === 'number') {
      return Number.isFinite(ref) ? { kind: null, id: ref } : null;
    }
    const raw = String(ref).trim();
    const colon = raw.indexOf(':');
    if (colon === -1) {
      const id = Number.parseInt(raw, 10);
      return Number.isFinite(id) ? { kind: null, id } : null;
    }
    const prefix = raw.slice(0, colon).toLowerCase();
    const id = Number.parseInt(raw.slice(colon + 1), 10);
    if (!Number.isFinite(id)) return null;
    // Map both the short kind tokens and the full source_table names so either
    // form ("npu" or "npu_exam") resolves correctly.
    if (prefix === 'mp' || prefix === 'mp_exam') return { kind: 'mp', id };
    if (prefix === 'mm' || prefix === 'mm_exam') return { kind: 'mm', id };
    if (prefix === 'npu' || prefix === 'npu_exam') return { kind: 'npu', id };
    // Unknown prefix → treat as ambiguous bare id (best-effort precedence).
    return { kind: null, id };
  }

  private async findUnifiedRun(
    benchmark: 'mlperf' | 'mmlu',
    ref: number | string,
  ): Promise<NormalizedRun | null> {
    const parsed = this.parseRunRef(ref);
    if (!parsed) return null;
    const { kind, id } = parsed;

    // Namespaced reference: resolve from the pinned table only — no
    // cross-table fallback that could re-introduce the shadowing bug.
    if (kind === 'mp') {
      const mp = await this.mpExamRepo.findOne({
        where: { id },
        relations: ['results'],
      });
      return mp ? this.normalizeMpExam(mp) : null;
    }
    if (kind === 'mm') {
      const mm = await this.mmExamRepo.findOne({
        where: { id },
        relations: ['results'],
      });
      return mm ? this.normalizeMmExam(mm) : null;
    }
    if (kind === 'npu') {
      const npu = await this.npuExamRepo.findOne({
        where: { id, benchmark },
        relations: ['results'],
      });
      return npu ? this.normalizeNpuExam(npu) : null;
    }

    // Bare numeric id (legacy): preserve the original per-benchmark precedence.
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

    // mp_exam.result_tt100t is written by the GPU MLPerf k8s job in milliseconds
    // (e.g. `'tt100t': '1584.17'` for an L40 row meaning 1.584 s). The NPU path
    // (npu_exam_result) already stores seconds (npu-eval.service.ts:522 divides
    // by 1000 explicitly). Without this conversion the /comparison page renders
    // GPU rows as ~1500 s next to NPU rows as ~1.3 s — a 1000× scale break.
    const rows = exam.results || [];
    const tpsStats = this.stats(rows.map((r) => r.result_perf_tps));
    const ttStats = this.stats(
      rows.map((r) => (r.result_tt100t != null ? r.result_tt100t / 1000 : null)),
    );
    // R9: result_perf_serv_ttft is parsed from "Mean First Token latency (ns)"
    // — stored as raw nanoseconds. Divide by 1e9 to normalise to seconds, same
    // scale as tt100t_seconds.
    const ttftStats = this.stats(
      rows.map((r) =>
        r.result_perf_serv_ttft != null ? r.result_perf_serv_ttft / 1_000_000_000 : null,
      ),
    );
    const tt100t =
      ttStats.mean ??
      (latest?.result_tt100t != null ? latest.result_tt100t / 1000 : null);
    const tps = tpsStats.mean ?? latest?.result_perf_tps ?? null;
    const sps = latest?.result_perf_sps ?? null;
    // R8/BB-3: percentiles from the representative (latest) row; mean power
    // across the rows that captured it; tokens_per_watt derived from tps/power.
    const mpAvgPower = this.meanOf(rows.map((r) => r.avg_power_w));
    const mpTokensPerWatt = this.tokensPerWatt(tps, mpAvgPower);
    // v37 Fix #20: surface MLPerf rouge1 via result_acc (preferred) or fall
    // back to result_acc_rg_1 if a legacy row still has the rouge column but
    // not the new `result_acc` mirror.
    const mlperfAccuracy =
      (latest as { result_acc?: number | null } | null)?.result_acc ??
      latest?.result_acc_rg_1 ??
      null;

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
        accuracy_pct: mlperfAccuracy,
        throughput: sps,
        tps_stdev: tpsStats.stdev,
        tt100t_stdev: ttStats.stdev,
        tt100t_samples: ttStats.n || null,
        tps_samples: tpsStats.n || null,
        ttft_seconds: ttftStats.mean,
        ttft_stdev: ttftStats.stdev,
        ttft_samples: ttftStats.n || null,
        p50_latency_s: latest?.result_perf_p50_latency_s ?? null,
        p90_latency_s: latest?.result_perf_p90_latency_s ?? null,
        p99_latency_s: latest?.result_perf_p99_latency_s ?? null,
        avg_power_w: mpAvgPower,
        tokens_per_watt: mpTokensPerWatt,
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
      is_canonical: this.isCanonicalRun(
        'mlperf',
        exam.data_number ?? null,
        null,
      ),
      precision_mismatch: this.isPrecisionMismatch(
        'mlperf',
        this.canonicalizeHardwareLabel(exam.gpu_type ?? ''),
        exam.precision ?? null,
      ),
      latency_measurement_context:
        latest?.latency_measurement_context ??
        LatencyMeasurementContext.CLIENT_WALL_CLOCK,
    };
  }

  private normalizeMmExam(exam: MmExam): NormalizedRun {
    const latest = this.latestResult(exam.results || []);

    // C2 fix: mm_exam.result_acc_total is parsed from the worker line
    // "Average accuracy: 0.4929" (mm-exam-result.service.ts:194-198) as a
    // FRACTION in [0,1], whereas the NPU path stores result_accuracy already as
    // a PERCENT in [0,100] (mmlu-scoring.ts computes (100*correct)/total). Both
    // land in the same metrics.accuracy_pct field, so without normalisation the
    // candidate picker / home efficiency surfaces compared "0.5%" (GPU) against
    // "45.0%" (NPU) — a 100x scale break. Normalise the fraction to a percent
    // here so accuracy_pct ∈ [0,100] everywhere.
    const accuracy =
      latest?.result_acc_total != null
        ? this.toAccuracyPercent(latest.result_acc_total)
        : null;

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
        ttft_seconds: null,
        ttft_stdev: null,
        ttft_samples: null,
        p50_latency_s: null,
        p90_latency_s: null,
        p99_latency_s: null,
        avg_power_w: null,
        tokens_per_watt: null,
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
      precision_mismatch: false, // MMLU never has precision mismatch
      latency_measurement_context:
        latest?.latency_measurement_context ??
        LatencyMeasurementContext.UNKNOWN,
    };
  }

  private normalizeNpuExam(exam: NpuExam): NormalizedRun {
    const latest = this.latestResult(exam.results || []);
    const benchmark = exam.benchmark === 'mmlu' ? 'mmlu' : 'mlperf';
    const npuRows = exam.results || [];
    const npuTpsStats = this.stats(npuRows.map((r) => r.result_tps));
    const npuTtStats = this.stats(npuRows.map((r) => r.result_tt100t));
    // R9: result_ttft is already in seconds (npu-eval.service.ts divides by 1000
    // at capture time). No further conversion needed.
    const npuTtftStats = this.stats(npuRows.map((r) => r.result_ttft));
    // R8/BB-3: power is mean of the rows that captured it; tps for the derived
    // tokens_per_watt mirrors the metrics.tps used below.
    const npuTps = npuTpsStats.mean ?? latest?.result_tps ?? null;
    const npuAvgPower = this.meanOf(npuRows.map((r) => r.avg_power_w));
    const npuTokensPerWatt = this.tokensPerWatt(npuTps, npuAvgPower);

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
        tt100t_seconds: npuTtStats.mean ?? latest?.result_tt100t ?? null,
        tps: npuTps,
        // C2 guard: NPU stores result_accuracy already as a percent in
        // [0,100]; clamp defensively so a malformed row can never escape the
        // invariant that accuracy_pct ∈ [0,100] across both paths.
        // m-di2: additionally suppress full-dataset MMLU runs that report
        // accuracy===0 (scoring artifact) so they don't poison aggregates.
        accuracy_pct: this.npuMmluAccuracyPct(
          latest?.result_accuracy ?? null,
          exam.data_number ?? null,
          benchmark,
        ),
        throughput: latest?.result_sps ?? null,
        tps_stdev: npuTpsStats.stdev,
        tt100t_stdev: npuTtStats.stdev,
        tt100t_samples: npuTtStats.n || null,
        tps_samples: npuTpsStats.n || null,
        ttft_seconds: npuTtftStats.mean,
        ttft_stdev: npuTtftStats.stdev,
        ttft_samples: npuTtftStats.n || null,
        p50_latency_s: latest?.result_perf_p50_latency_s ?? null,
        p90_latency_s: latest?.result_perf_p90_latency_s ?? null,
        p99_latency_s: latest?.result_perf_p99_latency_s ?? null,
        avg_power_w: npuAvgPower,
        tokens_per_watt: npuTokensPerWatt,
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
      is_canonical: this.isCanonicalRun(
        benchmark,
        exam.data_number ?? null,
        exam.max_output_tokens ?? null,
      ),
      precision_mismatch: this.isPrecisionMismatch(
        benchmark,
        this.canonicalizeHardwareLabel(exam.npu_type ?? ''),
        exam.precision ?? null,
      ),
      latency_measurement_context:
        latest?.latency_measurement_context ??
        LatencyMeasurementContext.SERVER_TOKEN_STREAM,
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

  /**
   * Sample mean + sample standard deviation over the finite positive values
   * (e.g. tps or tt100t across the measured result rows). Used for round-2
   * statistical-rigor reporting (mean +/- stdev, n = samples).
   */
  private stats(values: Array<number | null | undefined>): {
    mean: number | null;
    stdev: number | null;
    n: number;
  } {
    const xs = values.filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
    );
    if (xs.length === 0) return { mean: null, stdev: null, n: 0 };
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    if (xs.length === 1) return { mean, stdev: 0, n: 1 };
    const variance =
      xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
    return { mean, stdev: Math.sqrt(variance), n: xs.length };
  }

  // R8/BB-3: mean of the finite values among the provided result-row fields.
  // Used for avg_power_w (mean across the rows that captured power). Null when
  // none are present.
  private meanOf(values: Array<number | null | undefined>): number | null {
    const xs = values.filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    if (xs.length === 0) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  // R8 derived: tokens-per-watt. Null if tps or power is missing or power<=0.
  private tokensPerWatt(
    tps: number | null,
    power: number | null,
  ): number | null {
    if (tps == null || power == null || power <= 0) return null;
    return tps / power;
  }

  // C2: convert an mm_exam accuracy FRACTION (0..1) into a PERCENT (0..100).
  // result_acc_total is parsed verbatim from "Average accuracy: 0.4929" so it
  // is always a fraction; ×100 yields the canonical accuracy_pct unit shared
  // with the NPU path. Clamped to [0,100] so a malformed (>1) row can't blow
  // the invariant. Null/non-finite passes through as null.
  private toAccuracyPercent(fraction: number | null | undefined): number | null {
    if (fraction == null || !Number.isFinite(fraction)) return null;
    return this.clampAccuracyPercent(fraction * 100) as number;
  }

  // C2 guard: assert an already-percent accuracy stays within [0,100]. Valid
  // values pass through untouched; out-of-range inputs are clamped so the
  // accuracy_pct ∈ [0,100] invariant holds for every source path.
  private clampAccuracyPercent(
    pct: number | null | undefined,
  ): number | null {
    if (pct == null || !Number.isFinite(pct)) return null;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return pct;
  }

  /**
   * m-di2: Defensive normalization for NPU MMLU accuracy.
   *
   * A full-dataset MMLU run (data_number=0 sentinel OR data_number>=13368)
   * that reports result_accuracy===0 is almost certainly a scoring artifact
   * (e.g. RNGD id9 dn=0 → 0%) rather than a real zero-accuracy result —
   * the same device returns 21–70% on every subset run. Treating 0 as a
   * valid headline number poisons leaderboard aggregates (min/max/mean) and
   * the Efficiency Frontier y-axis.
   *
   * When the artifact condition is detected, return null (unscored) instead
   * of 0 so the run is excluded from aggregates. No DB row is modified.
   * Subset runs (dn 1..13367) and non-zero accuracy values are unaffected.
   */
  private npuMmluAccuracyPct(
    rawAccuracy: number | null | undefined,
    dataNumber: number | null | undefined,
    benchmark: 'mlperf' | 'mmlu',
  ): number | null {
    const clamped = this.clampAccuracyPercent(rawAccuracy);
    if (benchmark !== 'mmlu') return clamped;
    if (clamped !== 0) return clamped;

    // Accuracy is exactly 0 on an MMLU run — check if it is a full/large
    // dataset run (the artifact pattern). data_number=0 is the sentinel for
    // "full dataset (13368 samples)"; data_number>=13368 is the explicit count.
    const dn = dataNumber ?? null;
    const isFullDataset = dn === 0 || (dn != null && dn >= 13368);
    if (isFullDataset) {
      return null; // unscored — suppress from aggregates (no DB change)
    }
    return clamped;
  }

  private canonicalizeHardwareLabel(raw: string): CanonicalHardwareLabel {
    const upper = raw.toUpperCase().trim();
    if (upper.includes('L40')) return 'L40';
    if (upper.includes('A40')) return 'A40';
    // m-di1: normalize the current-cluster A30 GPU (raw 'NVIDIA-A30') to 'A30'
    // so raw API consumers (CSV/JSON export, comparison table) match the
    // frontend's normalizeHwModel; checked after A40 so 'A40' isn't shadowed.
    if (upper.includes('A30')) return 'A30';
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
      normalizeStrLower(source.precision) ===
      normalizeStrLower(candidate.precision);
    const sameScenario =
      normalizeStrLower(source.scenario) ===
      normalizeStrLower(candidate.scenario);
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

  // Class delegates to the top-level helper so callers in classifyComparability
  // and the exported computeIncompatibilityReasons share one source of truth.
  private normalizeModel(model: string | null | undefined): string {
    return normalizeBaseModel(model);
  }

  // W7/W10 contract: data_number=0 means full dataset (canonical). 1..13367 = subset (not canonical).
  // data_number >= 13368 is also canonical (explicit full count).
  // For MLPerf, max_output_tokens must be 128 or null to be canonical (W10 alignment).
  private isCanonicalRun(
    benchmark: 'mlperf' | 'mmlu',
    dataNbr: number | null,
    maxOutputTokens?: number | null,
  ): boolean {
    if (benchmark === 'mmlu') return true; // MMLU always uses full dataset
    const n = dataNbr ?? 0;
    const fullDataset = n === 0 || n >= 13368;
    if (!fullDataset) return false;
    // max_output_tokens=0 is NOT canonical (means unset/unknown, not the standard 128)
    const tok = maxOutputTokens ?? null;
    return tok === null || tok === 128;
  }

  // W10 contract: precision_mismatch=true when hardware uses BF16 fallback on MLPerf
  // where FP8 is the canonical precision (A40, RNGD-bf16, Atom+).
  private isPrecisionMismatch(
    benchmark: 'mlperf' | 'mmlu',
    hardware: CanonicalHardwareLabel,
    precision: string | null,
  ): boolean {
    if (benchmark !== 'mlperf') return false;
    // Hardware that should run FP8 but falls back to BF16
    const fp8CapableHardware = new Set(['A40', 'RNGD', 'Atom+']);
    if (!fp8CapableHardware.has(hardware)) return false;
    const p = (precision ?? '').toUpperCase();
    return p === 'BF16' || p === 'BFLOAT16';
  }

  // Class delegates to the top-level helper (single source of truth).
  private normalizeDataset(dataset: string | null | undefined): string {
    return normalizeDatasetLabel(dataset);
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
