import { httpClient } from '@/libs/http-client';

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
  node?: string;
};

export type ComparisonMetrics = {
  tt100t_seconds?: number | null;
  tps?: number | null;
  accuracy_pct?: number | null;
  throughput?: number | null;
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
  metrics: ComparisonMetrics;
  artifacts: string[];
};

export type ComparisonListParams = {
  benchmark?: 'mlperf' | 'mmlu' | 'all';
  hardware?: 'gpu' | 'npu' | 'all';
  node?: string;
};

export type ComparisonListResponse = {
  runs: ComparisonRunRow[];
  total: number;
  diagnostic?: ComparisonDiagnostic;
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

export type ComparisonPairResponse = {
  idA: number;
  idB: number;
  benchmark: string;
  runA: ComparisonRunRow;
  runB: ComparisonRunRow;
  metrics: Record<string, { a: number | null; b: number | null }>;
};

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

// ----------------------------------------------------------------------

export const ComparisonApi = {
  list: async (params?: ComparisonListParams): Promise<ComparisonListResponse> => {
    const { data } = await httpClient.get<ComparisonListResponse>('/comparison/list', {
      params
    });
    return data;
  },

  compare: async (
    benchmark: string,
    idA: number | string,
    idB: number | string
  ): Promise<ComparisonPairResponse> => {
    const { data } = await httpClient.get<ComparisonPairResponse>(
      `/comparison/${benchmark}/${idA}/${idB}`
    );
    return data;
  },

  diagnostics: async (params?: ComparisonListParams): Promise<ComparisonDiagnostic> => {
    const { data } = await httpClient.get<ComparisonDiagnostic>('/comparison/diagnostics', {
      params
    });
    return data;
  }
} as const;
