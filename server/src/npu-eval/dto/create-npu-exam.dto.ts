import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { StatusEnum } from '../../enums/status.enum';

export class CreateNpuExamDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsString()
  @Length(0, 500)
  description: string;

  // mlperf | mmlu
  @IsString()
  @Length(1, 20)
  benchmark: string;

  @IsString()
  @Length(1, 100)
  model: string;

  @IsString()
  @Length(1, 10)
  precision: string;

  @IsString()
  @Length(1, 100)
  framework: string;

  // B-validation #23: batch_size must be >= 1 (zero-sized batch is invalid).
  @IsInt()
  @Min(1)
  batch_size: number;

  @IsString()
  @Length(1, 100)
  dataset: string;

  // B-validation #23: data_number=0 is the valid "full dataset" sentinel for
  // NPU runs (the UI renders 0 as "Full" and the worker treats 0 as no cap).
  // Keep the lower bound at 0; reject only negatives.
  @IsInt()
  @Min(0)
  data_number: number;

  @IsString()
  @Length(1, 100)
  npu_type: string;

  // B-validation #23: at least one NPU device must be requested.
  // m-bk3: cap at 8 (max devices per node) to bound the job spec.
  @IsInt()
  @Min(1)
  @Max(8)
  npu_num: number;

  // B-validation #23: at least one CPU core must be requested.
  @IsInt()
  @Min(1)
  cpu_core: number;

  // B-validation #23: RAM capacity may be 0 (operator default), reject negatives.
  @IsInt()
  @Min(0)
  ram_capacity: number;

  // B-validation #6 + #23: retry_num drives totalRepeatCount; 0 makes the
  // operator loop run zero iterations and hang. Must be at least 1.
  // m-bk3: cap at 100 so a huge retry_num can't spin the run loop unboundedly.
  @IsInt()
  @Min(1)
  @Max(100)
  retry_num: number;

  // B-validation #23: max_output_tokens=0 is the valid "unlimited" sentinel for
  // NPU runs (the UI renders 0 as "Unlimited"). Keep the lower bound at 0;
  // reject only negatives.
  @IsInt()
  @Min(0)
  max_output_tokens: number;

  @IsString()
  @IsNotEmpty()
  started_at: string;

  @IsOptional()
  status: StatusEnum;

  @IsOptional()
  @IsString()
  error_log: string;

  @IsString()
  @IsOptional()
  end_at: string;

  // Optional — reproducibility seed (WS-D03). Stored as string for bigint safety.
  @IsOptional()
  @IsNumberString()
  seed?: number | string;
}
