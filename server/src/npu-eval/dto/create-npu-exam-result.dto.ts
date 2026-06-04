import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateNpuExamResultDto {
  @IsInt()
  examId: number;

  @IsInt()
  @Min(1)
  resultNumber: number;

  @IsOptional()
  @IsNumber()
  ttft: number | null;

  @IsOptional()
  @IsNumber()
  tt100t: number | null;

  @IsOptional()
  @IsNumber()
  tps: number | null;

  @IsOptional()
  @IsNumber()
  tpsBest: number | null;

  @IsOptional()
  @IsNumber()
  sps: number | null;

  @IsOptional()
  @IsNumber()
  latency: number | null;

  @IsOptional()
  @IsNumber()
  tpot: number | null;

  @IsOptional()
  @IsNumber()
  accuracy: number | null;

  @IsOptional()
  @IsNumber()
  npuMemPeak: number | null;

  @IsOptional()
  @IsNumber()
  npuUtil: number | null;

  @IsOptional()
  @IsNumber()
  npuPower: number | null;

  // BB-3: latency percentiles (seconds), computed from per-sample latencies.
  @IsOptional()
  @IsNumber()
  p50LatencyS?: number | null;

  @IsOptional()
  @IsNumber()
  p90LatencyS?: number | null;

  @IsOptional()
  @IsNumber()
  p99LatencyS?: number | null;

  // R8: mean device power (Watts) over the run window.
  @IsOptional()
  @IsNumber()
  avgPowerW?: number | null;

  @IsOptional()
  @IsString()
  valid: string | null;
}
