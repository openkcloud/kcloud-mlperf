import { StatusEnum } from '@/enums/status.enum';

export type MmExamCreateBody = {
  name: string;
  description: string;
  model: string;
  precision: string;
  framework: string;
  subject: string;
  dataset: string;
  data_number: number;
  batch_size: number;
  gpu_util: number;
  max_tokens?: number;
  device_type?: string; // 'GPU' | 'NPU'
  gpu_type: string;
  gpu_num: number;
  cpu_core: number;
  ram_capacity: number;
  retry_num: number;
  started_at: string; // timestamps
  status?: StatusEnum;
  n_train?: number;
  error_log?: string;
};

// ----------------------------------------------------------------------

export type MmExamResultList = MmExamCreateBody & {
  id: number;
  status: StatusEnum;
  end_at: string;
  created_at: string;
  modified_at: string;
  currentRepeatCount?: string;
};

// ----------------------------------------------------------------------

export type MmExamResult = {
  id: number;
  exam_id: number;
  result_number: number;
  result_acc_total: number;
  result_acc_physics: number;
  result_acc_chemistry: number;
  result_acc_law: number;
  result_acc_engineering: number;
  result_acc_other: number;
  result_acc_economics: number;
  result_acc_health: number;
  result_acc_psychology: number;
  result_acc_business: number;
  result_acc_biology: number;
  result_acc_philosophy: number;
  result_acc_cs: number;
  result_acc_history: number;
  result_acc_math?: number;
  created_at: string;
};

export type MmExamResultResponse = MmExamResultList & {
  results: Array<MmExamResult>;
};
