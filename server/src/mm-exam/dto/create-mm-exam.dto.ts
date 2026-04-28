import {
  IsInt,
  IsNumber,
  IsString,
  Length,
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

  // Required
  @IsInt()
  @Min(0)
  data_number: number;

  // Required
  @IsInt()
  @Min(0)
  batch_size: number;

  @IsNumber()
  @Min(0)
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

  @IsInt()
  @Min(1)
  n_train: number;

  // Required
  @IsInt()
  @Min(0)
  retry_num: number;

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
}
