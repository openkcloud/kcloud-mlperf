import { StatusEnum } from '@/enums/status.enum';

export type NpuExamCreateBody = {
  name: string;
  description: string;
  benchmark: string; // 'mlperf' | 'mmlu'
  model: string;
  precision: string;
  framework: string;
  batch_size: number;
  dataset: string;
  data_number: number;
  npu_type: string;
  npu_num: number;
  cpu_core: number;
  ram_capacity: number;
  retry_num: number;
  max_output_tokens: number;
  started_at: string;
  status?: StatusEnum;
  error_log?: string;
};

// ----------------------------------------------------------------------

export type NpuExamDetails = Omit<NpuExamCreateBody, 'status' | 'error_log'> & {
  id: number;
  status: StatusEnum;
  end_at: string;
  created_at: string;
  modified_at: string;
  error_log: string | null;
};

// ----------------------------------------------------------------------

export type NpuExamResultItem = {
  id: number;
  exam_id: number;
  result_number: number;
  result_ttft: number | null;
  result_tt100t: number | null;
  result_tps: number | null;
  result_tps_best: number | null;
  result_sps: number | null;
  result_latency: number | null;
  result_tpot: number | null;
  result_accuracy: number | null;
  result_npu_mem_peak: number | null;
  result_npu_util: number | null;
  result_npu_power: number | null;
  result_valid: string | null;
  created_at: string;
};

// ----------------------------------------------------------------------

export type NpuExamResultResponse = NpuExamDetails & {
  results: Array<NpuExamResultItem>;
};

// ----------------------------------------------------------------------

export type NpuInfo = {
  npu_model: string;
  npu_count: number;
  memory_gb: number;
  compute_tflops: number;
};

export type NpuListResponse = {
  npus: NpuInfo[];
};
