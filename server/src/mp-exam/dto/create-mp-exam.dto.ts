import {
  IsDate,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { StatusEnum } from '../../enums/status.enum';

export class CreateMpExamDto {
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
  @Length(1, 20)
  mode: string;

  // Required
  @IsString()
  @Length(1, 100)
  framework: string;

  // Required
  @IsInt()
  @Min(0)
  batch_size: number;

  // Required
  @IsInt()
  @Min(0)
  min_duration: number;

  // Required
  @IsString()
  @Length(1, 100)
  dataset: string;

  // Required — B3: reject data_number <= 0 (0 = continuous HTTP-400 storm).
  @IsInt()
  @Min(1)
  data_number: number;

  // Required
  @IsString()
  @IsNotEmpty()
  scenario: string;

  // Required
  @IsNumber()
  @Min(0)
  target_qps: number;

  // Required
  @IsInt()
  @Min(0)
  num_workers: number;

  // Required
  @IsInt()
  @Min(0)
  tensor_parallel_size: number;

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

  // Required — B-validation #6: retry_num drives totalRepeatCount; 0 makes the
  // operator loop run zero iterations and hang waiting for a result that never
  // arrives. Must be at least 1.
  @IsInt()
  @Min(1)
  retry_num: number;

  // Optional — generation length (default 128). Wired through to operator job env.
  @IsOptional()
  @IsInt()
  @Min(16)
  max_output_tokens?: number;

  // Required
  @IsString()
  @IsNotEmpty()
  started_at: string;

  // Optional
  @IsOptional()
  status: StatusEnum;

  @IsOptional()
  @IsString()
  error_log: string;

  // Optional
  @IsString()
  @IsOptional()
  end_at: string;

  // Optional — reproducibility seed (WS-D03). Stored as string for bigint safety.
  @IsOptional()
  @IsNumberString()
  seed?: number | string;
}
