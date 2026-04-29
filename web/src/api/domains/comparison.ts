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
