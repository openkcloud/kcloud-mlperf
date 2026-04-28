import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GpuSweepCell } from './gpu-sweep-cell.entity';

export enum GpuSweepMode {
  FULL = 'full',
  CALIBRATION = 'calibration',
}

export enum GpuSweepStatus {
  PENDING = 'Pending',
  RUNNING = 'Running',
  PAUSED = 'Paused',
  DRAINED = 'Drained',
  COMPLETED = 'Completed',
  ERROR = 'Error',
}

@Entity('gpu_sweep')
export class GpuSweep {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({
    type: 'enum',
    enum: GpuSweepMode,
    default: GpuSweepMode.FULL,
  })
  mode: GpuSweepMode;

  @Column({
    type: 'enum',
    enum: GpuSweepStatus,
    default: GpuSweepStatus.PENDING,
  })
  status: GpuSweepStatus;

  @Column({ type: 'int', default: 0 })
  total_cells: number;

  @Column({ type: 'int', default: 0 })
  completed_cells: number;

  @Column({ type: 'jsonb', nullable: true, default: null })
  matrix_config: Record<string, unknown> | null;

  @Column({ type: 'float8', nullable: true, default: null })
  variance_pct: number | null;

  @Column({ type: 'boolean', nullable: true, default: null })
  passed: boolean | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  started_at: string | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  completed_at: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  modified_at: Date;

  @OneToMany(() => GpuSweepCell, (cell) => cell.sweep, { cascade: true })
  cells: GpuSweepCell[];
}
