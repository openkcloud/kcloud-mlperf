import type { Dayjs } from 'dayjs';

type SelectValue = {
  label: string;
  value: string | number;
};

export type MlExamFormInput = {
  name?: string;
  description: string;
  model: SelectValue;
  dataset: SelectValue;
  precision: SelectValue;
  dataNumber: number;
  framework: SelectValue;
  batchSize: number;
  subjects: string;
  gpuUtil: number;
  maxTokens: number;
  gpuType: SelectValue;
  gpuNumber: SelectValue;
  cpuCore: SelectValue;
  ramSize: number;
  repetitionCount: number;
  time: Dayjs;
};
