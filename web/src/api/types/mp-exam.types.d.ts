import type { MpExamModeEnum } from '@/enums/mp-exam-mode.enum.ts';
import { StatusEnum } from '@/enums/status.enum';
import type { TestScenarioEnum } from '@/enums/test-scenario.enum';

export type MpExamCreateBody = {
  name: string;
  description: string;
  model: string;
  precision: string;
  mode: MpExamModeEnum;
  framework: string;
  batch_size: number;
  min_duration: number;
  dataset: string;
  data_number: number;
  scenario: TestScenarioEnum;
  target_qps: number;
  num_workers: number;
  tensor_parallel_size: number;
  device_type?: string; // 'GPU' | 'NPU'
  gpu_type: string;
  gpu_num: number;
  cpu_core: number;
  ram_capacity: number;
  retry_num: number;
  started_at: string; // timestamps
  status?: StatusEnum;
  error_log?: string;
};

// ----------------------------------------------------------------------

export type MpExamDetails = Omit<MpExamCreateBody, 'status' | 'error_log'> & {
  id: number;
  status: StatusEnum;
  end_at: string;
  created_at: string;
  modified_at: string;
  error_log: string | null;
};

// ----------------------------------------------------------------------

export type MpExamResultList = {
  id: number;
  exam_id: number;
  result_number: number;
  result_acc_rg_1: number | null;
  result_acc_rg_2: number | null;
  result_acc_rg_l: number | null;
  result_acc_rg_lsum: number | null;
  result_perf_sps: number | null;
  result_perf_sps_best: number | null;
  result_perf_tps: number | null;
  result_perf_tps_best: number | null;
  result_perf_valid: string | null;
  result_perf_latency: number | null;
  result_perf_serv_ttft: number | null;
  result_perf_serv_tpot: number | null;
  result_vram_peak: number | null;
  result_gpu_util: number | null;
  result_tt100t: number | null;
  created_at: string;
};

// ----------------------------------------------------------------------

export type MpExamResultResponse = MpExamDetails & {
  results: Array<MpExamResultList>;
};
