import type { Dayjs } from 'dayjs';

type SelectValue = {
  label: string;
  value: string;
};

export type MpExamFormInput = {
  name?: string;
  description: string;
  model: SelectValue;
  mode: SelectValue;
  dataset: SelectValue;
  precision: SelectValue;
  dataNumber: number;
  scenario: SelectValue;
  framework: SelectValue;
  targetQps: number;
  batchSize: number;
  numOfWorkers: number;
  minDuration: number;
  tensorParallelSize: number;
  gpuType: SelectValue;
  gpuNumber: SelectValue;
  cpuCore: { value: number; label: string };
  ramSize: number;
  repetitionCount: number;
  time: Dayjs;
};
