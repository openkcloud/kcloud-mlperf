import {
  IsInt,
  IsNumber,
  IsNumberString,
  IsString,
  Length,
  Max,
  Min,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { StatusEnum } from '../../enums/status.enum';

export class CreateMmExamDto {
  // Required
  @IsString()
  @Length(1, 100)
  name: string;

  // Optional
  @IsString()
  @Length(0, 500)
  description: string;

  // Required
  @IsString()
  @Length(1, 100)
  model: string;

  // Required
  @IsString()
  @Length(1, 10)
  precision: string;

  // Required
  @IsString()
  @Length(1, 100)
  framework: string;

  // Required
  @IsString()
  @Length(1, 500)
  subject: string;

  // Required
  @IsString()
  @Length(1, 100)
  dataset: string;

  // Required. data_number=0 means "full dataset" — the worker forwards "0"
  // and its argparse interprets that as no per-subject sample cap.
  @IsInt()
  @Min(0)
  data_number: number;

  // Required
  @IsInt()
  @Min(0)
  batch_size: number;

  // gpu_util maps to vLLM `gpu_memory_utilization`, a FRACTION in (0, 1].
  // @Max(1) rejects percent-style values (e.g. 80) that otherwise reach the
  // worker and make vLLM abort with "GPU memory utilization must be less than
  // 1.0" → Job BackoffLimitExceeded → exam Error (see historical mm 155–158).
  @IsNumber()
  @Min(0)
  @Max(1)
  gpu_util: number;

  // Optional - defaults to GPU
  @IsOptional()
  @IsString()
  @Length(1, 10)
  device_type: string;

  // Required
  @IsString()
  @Length(1, 100)
  gpu_type: string;

  // Required
  @IsInt()
  @Min(0)
  gpu_num: number;

  // Required
  @IsInt()
  @Min(0)
  cpu_core: number;

  // Required
  @IsInt()
  @Min(0)
  ram_capacity: number;

  // m-bk3: n_train is the few-shot example count; cap at 100 to bound the
  // prompt construction (a huge value balloons every prompt's token budget).
  @IsInt()
  @Min(1)
  @Max(100)
  n_train: number;

  // Required — B-validation #6: retry_num drives totalRepeatCount; 0 makes the
  // operator loop run zero iterations and hang waiting for a result that never
  // arrives. Must be at least 1.
  // m-bk3: cap at 100 so a huge retry_num can't spin the run loop unboundedly.
  @IsInt()
  @Min(1)
  @Max(100)
  retry_num: number;

  // Optional — generation length / eval output limit (default 128).
  @IsOptional()
  @IsInt()
  @Min(16)
  max_tokens?: number;

  // Required
  @IsString()
  @IsNotEmpty()
  started_at: string;

  // Optional
  @IsOptional()
  status: StatusEnum;

  // Optional
  @IsOptional()
  @IsString()
  end_at: string;

  @IsOptional()
  @IsString()
  error_log: string;

  // Optional — reproducibility seed (WS-D03). Stored as string for bigint safety.
  @IsOptional()
  @IsNumberString()
  seed?: number | string;
}
