import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
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

  @IsInt()
  @Min(0)
  batch_size: number;

  @IsString()
  @Length(1, 100)
  dataset: string;

  // B3: reject data_number <= 0 — run id 103 ("tt") with data_number=0
  // issued 8000+ HTTP-400 inference errors. 0 is NOT "use default".
  @IsInt()
  @Min(1)
  data_number: number;

  @IsString()
  @Length(1, 100)
  npu_type: string;

  @IsInt()
  @Min(1)
  npu_num: number;

  @IsInt()
  @Min(0)
  cpu_core: number;

  @IsInt()
  @Min(0)
  ram_capacity: number;

  @IsInt()
  @Min(0)
  retry_num: number;

  // B3: reject max_output_tokens <= 0 — generation must request at least
  // one token. 0 caused runs to issue continuous HTTP-400s.
  @IsInt()
  @Min(1)
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
