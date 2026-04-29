import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GpuSweepMode } from '../entities/gpu-sweep.entity';
import { GpuSweepCellKind } from '../entities/gpu-sweep-cell.entity';

export class MatrixConfigDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  gpu_skus?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  benchmarks?: string[];

  @IsOptional()
  @IsArray()
  precisions?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  data_number_override?: number;
}

export class StartSweepDto {
  @IsOptional()
  @IsEnum(GpuSweepMode)
  mode?: GpuSweepMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => MatrixConfigDto)
  matrix?: MatrixConfigDto;

  @IsOptional()
  @IsString()
  name?: string;
}

export interface SweepCellSpec {
  cell_key: string;
  kind: GpuSweepCellKind;
  gpu_type: string;
  node: 'node2' | 'node3';
  gpu_index: 0 | 1;
  precision: 'bf16' | 'fp8';
  batch_size: number;
  data_number: number;
  tensor_parallel_size: number;
  scenario: 'offline' | 'server';
  retry_num: number;
}

export interface SweepTimelineEntry {
  cell_key: string;
  node: string;
  gpu_type: string;
  scheduled_offset_seconds: number;
  estimated_duration_seconds: number;
}

export interface SweepPreviewResponse {
  total_cells: number;
  cells: SweepCellSpec[];
  timeline: {
    node2: SweepTimelineEntry[];
    node3: SweepTimelineEntry[];
  };
  dedup_keys_excluded: string[];
}

export interface CalibrationRunResult {
  node: 'node2' | 'node3';
  exam_id: number;
  tt100t_seconds: number;
  tps: number;
}

export interface CalibrationResponse {
  sweep_id: number;
  canonical_cell: {
    gpu_type: string;
    precision: string;
    batch_size: number;
    data_number: number;
    tp: number;
  };
  runs: CalibrationRunResult[];
  variance_pct: number;
  passed: boolean;
  started_at: string;
  completed_at: string | null;
}

export type SweepDisabledReason =
  | 'feature_flag_off'
  | 'node_not_ready'
  | 'device_plugin_missing'
  | 'no_model_artifact'
  | 'missing_permission'
  | 'node_pending_join';

export interface SweepOptionFlag {
  key: string;
  label: string;
  enabled: boolean;
  disabled_reason: SweepDisabledReason | null;
}

export interface SweepNodeOption {
  name: string;
  state: 'active' | 'pending_join' | 'not_ready' | string;
  enabled: boolean;
  disabled_reason: SweepDisabledReason | null;
}

export interface SweepHardwareOption extends SweepOptionFlag {
  vendor: 'nvidia' | 'furiosa' | 'rebellions' | string;
  node: string | null;
}

export interface SweepModelOption extends SweepOptionFlag {
  precisions: string[];
}

export interface SweepOptionsResponse {
  enabled: boolean;
  feature_flag_reason: SweepDisabledReason | null;
  benchmarks: SweepOptionFlag[];
  hardware: SweepHardwareOption[];
  nodes: SweepNodeOption[];
  models: SweepModelOption[];
  precisions: SweepOptionFlag[];
  scenarios: SweepOptionFlag[];
  batch_sizes: number[];
  concurrencies: number[];
}

export interface SweepStatusResponse {
  enabled: boolean;
  paused?: boolean;
  reason?: 'quiet_window' | null;
  active_sweep: {
    id: number;
    name: string;
    mode: string;
    status: string;
    total_cells: number;
    completed_cells: number;
    started_at: string | null;
  } | null;
  node_state: {
    node2: {
      busy: boolean;
      last_dispatch_at: string | null;
      current_cell_key: string | null;
    };
    node3: {
      busy: boolean;
      last_dispatch_at: string | null;
      current_cell_key: string | null;
    };
  };
  quiet_window?: {
    active: boolean;
    start_hour: number;
    end_hour: number;
    tz: string;
  };
}
