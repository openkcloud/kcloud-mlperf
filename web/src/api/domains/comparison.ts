import { httpClient } from '@/libs/http-client';
import type { FairnessAssessment } from '@/api/types/fairness-assessment';

// ----------------------------------------------------------------------

export type ComparisonDiagnosticReason =
  | 'no_runs_exist'
  | 'all_runs_filtered'
  | 'ingestion_failed'
  | 'hardware_not_ready';

export type ComparisonHardware = {
  type: 'gpu' | 'npu';
  vendor: 'nvidia' | 'furiosa' | 'rebellions';
  model: 'L40' | 'A40' | 'RNGD' | 'Atom+' | string;
  canonical?: string;
  node?: string | null;
};

export type ComparisonMetrics = {
  tt100t_seconds?: number | null;
  tps?: number | null;
  accuracy_pct?: number | null;
  throughput?: number | null;
  // Round-2 statistical rigor: run-to-run variation across measured result rows.
  tps_stdev?: number | null;
  tt100t_stdev?: number | null;
  tt100t_samples?: number | null;
  tps_samples?: number | null;
  // R9: time-to-first-token in seconds. Null for MMLU.
  ttft_seconds?: number | null;
  ttft_stdev?: number | null;
  ttft_samples?: number | null;
  // BB-3: latency percentiles in seconds (MLPerf server log / NPU per-sample).
  p50_latency_s?: number | null;
  p90_latency_s?: number | null;
  p99_latency_s?: number | null;
  // R8: mean device power over the run window (W, captured at completion;
  // future runs only — Prometheus retention can't backfill) + derived perf/W.
  avg_power_w?: number | null;
  tokens_per_watt?: number | null;
};

export type ComparisonRunRow = {
  id: number;
  benchmark: 'mlperf' | 'mmlu' | string;
  name: string;
  model: string;
  hardware: ComparisonHardware;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  elapsed_seconds?: number | null;
  metrics: ComparisonMetrics;
  artifacts: string[];
  precision?: string | null;
  scenario?: string | null;
  batch_size?: number | null;
  dataset?: string | null;
  data_number?: number | null;
  max_output_tokens?: number | null;
  source_table?: string;
  drift_flag?: boolean;
  drift_fields?: string[];
  failure_reason?: string | null;
  /** True when this run used the full canonical dataset (data_number = max). False for subset/smoke runs. */
  is_canonical?: boolean;
};

export type ComparisonListParams = {
  benchmark?: 'mlperf' | 'mmlu' | 'all';
  hardware?: 'gpu' | 'npu' | 'all';
  node?: string;
};

// Backend returns either a success envelope or a diagnostic (empty) envelope.
// Success: { empty: false, total: N, runs: [...] }
// Empty:   { empty: true, reason: ..., message: ..., total_runs: N, filtered_runs: N, filters_applied: {...} }
type BackendListSuccess = {
  empty: false;
  total: number;
  runs: ComparisonRunRow[];
};

type BackendListEmpty = {
  empty: true;
  reason: ComparisonDiagnosticReason;
  message: string;
  total_runs: number;
  filtered_runs: number;
};

type BackendListRaw = BackendListSuccess | BackendListEmpty;

// Normalised shape consumed by the frontend pages.
export type ComparisonListResponse = {
  runs: ComparisonRunRow[];
  total: number;
  /** Present when the backend returned an empty/diagnostic envelope. */
  diagnostic?: {
    reason: ComparisonDiagnosticReason;
    message: string;
  };
};

export type ComparisonDiagnostic = {
  reason: ComparisonDiagnosticReason;
  message: string;
  counts: {
    completed: number;
    running: number;
    failed: number;
  };
  hardware_available: boolean;
  ingestion_errors: string[];
};

// Backend pair response shape: { benchmark, a: NormalizedRun, b: NormalizedRun, delta: {...} }
// We expose it as metrics: Record<string, {a, b}> for the dialog.
export type ComparisonPairResponse = {
  idA: number;
  idB: number;
  benchmark: string;
  runA: ComparisonRunRow;
  runB: ComparisonRunRow;
  metrics: Record<string, { a: number | null; b: number | null }>;
  /** Legacy array of incompatibility reason keys — present when runs differ on key config. */
  incompatibility_reasons: string[];
  /** Rich fairness struct introduced in WS-B05. May be absent on older backends. */
  fairness_assessment?: FairnessAssessment;
};

// Valid benchmark values for the pair endpoint (backend rejects 'all').
export type PairBenchmark = 'mlperf' | 'mmlu';

// ----------------------------------------------------------------------

// ----------------------------------------------------------------------

export type CandidateCategory = 'strict' | 'hardware_optimized' | 'related';

export type ComparisonCandidate = {
  run: ComparisonRunRow;
  category: CandidateCategory;
  comparability_reason: string;
};

export type CandidatesResponse = {
  candidates: ComparisonCandidate[];
  diagnostic?: ComparisonDiagnostic;
};

export type CandidatesParams = {
  benchmark?: string;
};

// ----------------------------------------------------------------------

export const CandidatesApi = {
  getCandidates: async (runId: number | string, opts?: CandidatesParams): Promise<CandidatesResponse> => {
    // Backend route is GET /api/comparison/candidates?runId=&benchmark=&hardware=
    // (NOT a path-segment runId). Pass runId as a query parameter alongside opts.
    const { data } = await httpClient.get<CandidatesResponse>('/comparison/candidates', {
      params: { runId, ...opts }
    });

    // Defensive normalization: the backend currently returns
    //   data.candidates = { strict: [...], hardware_optimized: [...], related: [...] }
    // (each entry is a flat run row carrying comparability_class on it).
    // The picker UI expects a flat ComparisonCandidate[] with a `category`
    // field per item — without this re-shape, picker calls
    // `candidates.filter(...)` on an object and throws
    // "i.filter is not a function" when a user clicks a row.
    const raw: unknown = (data as unknown as { candidates?: unknown }).candidates;
    if (raw && !Array.isArray(raw) && typeof raw === 'object') {
      const flat: ComparisonCandidate[] = [];
      const groups = raw as Record<string, ComparisonRunRow[] | undefined>;
      for (const cat of ['strict', 'hardware_optimized', 'related'] as const) {
        const runs = groups[cat];
        if (!Array.isArray(runs)) continue;
        for (const run of runs) {
          flat.push({
            run,
            category: cat,
            comparability_reason:
              (run as ComparisonRunRow & { comparability_reason?: string }).comparability_reason ??
              ''
          });
        }
      }
      return { ...data, candidates: flat } as CandidatesResponse;
    }

    return data;
  }
} as const;

// Flat export shape from W6 backend (export.csv / export.json endpoints).
// The list endpoint still returns ComparisonRunRow (nested shape).
export type HardwareVendor = 'nvidia' | 'furiosa' | 'rebellions' | 'unknown';

export type FlatComparisonRunRow = {
  id: number;
  vendor: HardwareVendor;
  hardware: string;
  benchmark: 'mlperf-inference' | 'mmlu-pro' | string;
  model: string;
  tt100t_seconds: number | null;
  elapsed_seconds: number | null;
  status: 'completed' | 'failed' | 'running' | 'pending';
  failure_reason: string | null;
  config_fingerprint: string;
  drift_flag: boolean;
};

// ----------------------------------------------------------------------

export const ComparisonApi = {
  list: async (params?: ComparisonListParams): Promise<ComparisonListResponse> => {
    const { data } = await httpClient.get<BackendListRaw>('/comparison/list', { params });
    if (data.empty) {
      return {
        runs: [],
        total: 0,
        diagnostic: { reason: data.reason, message: data.message },
      };
    }
    return { runs: data.runs, total: data.total };
  },

  // benchmark must be 'mlperf' or 'mmlu' — backend rejects 'all'.
  // Returns metrics as Record<metricName, {a, b}> mapped from the backend delta shape.
  compare: async (
    benchmark: PairBenchmark | string,
    idA: number | string,
    idB: number | string
  ): Promise<ComparisonPairResponse> => {
    // Coerce cross-benchmark or unknown benchmark to 'mlperf' (safest default).
    const safeBenchmark: PairBenchmark =
      benchmark === 'mmlu' ? 'mmlu' : 'mlperf';
    const { data } = await httpClient.get<{
      benchmark: string;
      a: ComparisonRunRow;
      b: ComparisonRunRow;
      delta: Record<string, number | null>;
      incompatibility_reasons?: string[];
      fairness_assessment?: FairnessAssessment;
    }>(`/comparison/${safeBenchmark}/${idA}/${idB}`);
    // Map delta {field: number} → metrics {field: {a: valA, b: valB}}
    const METRIC_KEYS: Array<keyof ComparisonMetrics> = [
      'tt100t_seconds', 'tps', 'accuracy_pct', 'throughput', 'ttft_seconds',
      'p50_latency_s', 'p90_latency_s', 'p99_latency_s', 'avg_power_w', 'tokens_per_watt'
    ];
    const metrics: Record<string, { a: number | null; b: number | null }> = {};
    for (const key of METRIC_KEYS) {
      const valA = data.a.metrics?.[key] ?? null;
      const valB = data.b.metrics?.[key] ?? null;
      if (valA !== null || valB !== null) {
        metrics[key] = { a: valA as number | null, b: valB as number | null };
      }
    }
    return {
      idA: data.a.id,
      idB: data.b.id,
      benchmark: data.benchmark,
      runA: data.a,
      runB: data.b,
      metrics,
      incompatibility_reasons: data.incompatibility_reasons ?? [],
      fairness_assessment: data.fairness_assessment,
    };
  },

  diagnostics: async (params?: ComparisonListParams): Promise<ComparisonDiagnostic> => {
    const { data } = await httpClient.get<ComparisonDiagnostic>('/comparison/diagnostics', {
      params
    });
    return data;
  },

  exportUrl: (params?: ComparisonListParams & { format?: 'csv' | 'json'; limit?: number }): string => {
    const { format = 'csv', ...rest } = params ?? {};
    const base = `/api/comparison/export.${format}`;
    const qs = new URLSearchParams(
      Object.entries(rest).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
    ).toString();
    return qs ? `${base}?${qs}` : base;
  }
} as const;
