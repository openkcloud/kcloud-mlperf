import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateMpExamResultDto {
  @IsNumber()
  @Min(0)
  exam_id: number;

  @IsNumber()
  @Min(0)
  result_number: number;

  @IsNumber()
  @IsOptional()
  result_acc_rg_1: number | null;

  @IsNumber()
  @IsOptional()
  result_acc_rg_2: number | null;

  @IsNumber()
  @IsOptional()
  result_acc_rg_l: number | null;

  @IsNumber()
  @IsOptional()
  result_acc_rg_lsum: number | null;

  @IsNumber()
  @IsOptional()
  result_perf_sps: number | null;

  @IsNumber()
  @IsOptional()
  result_perf_sps_best: number | null;

  @IsNumber()
  @IsOptional()
  result_perf_tps: number | null;

  @IsNumber()
  @IsOptional()
  result_perf_tps_best: number | null;

  @IsNumber()
  @IsOptional()
  result_perf_valid: string | null;

  @IsNumber()
  @IsOptional()
  result_perf_latency: number | null;

  @IsNumber()
  @IsOptional()
  result_perf_serv_ttft: number | null;

  @IsNumber()
  @IsOptional()
  result_perf_serv_tpot: number | null;

  @IsNumber()
  @IsOptional()
  @Min(0)
  result_vram_peak: number | null;

  @IsNumber()
  @IsOptional()
  @Min(0)
  result_gpu_util: number | null;

  @IsNumber()
  @IsOptional()
  @Min(0)
  result_tt100t: number | null;
}
