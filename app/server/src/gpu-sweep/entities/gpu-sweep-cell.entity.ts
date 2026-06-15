import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GpuSweep } from './gpu-sweep.entity';

export enum GpuSweepCellKind {
  MLPERF = 'mlperf',
  MMLU = 'mmlu',
}

export enum GpuSweepCellStatus {
  PENDING = 'Pending',
  DISPATCHED = 'Dispatched',
  RUNNING = 'Running',
  COMPLETED = 'Completed',
  ERROR = 'Error',
  STOPPED = 'Stopped',
  RACE_FAILED = 'OperatorRaceFailed',
}

@Entity('gpu_sweep_cell')
@Index(['sweep', 'kind', 'exam_id'], { unique: false })
export class GpuSweepCell {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => GpuSweep, (sweep) => sweep.cells, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sweep_id' })
  sweep: GpuSweep;

  @Column({ type: 'int' })
  sweep_id: number;

  @Column({ type: 'varchar', length: 200 })
  cell_key: string;

  @Column({
    type: 'enum',
    enum: GpuSweepCellKind,
  })
  kind: GpuSweepCellKind;

  @Column({ type: 'int', nullable: true, default: null })
  exam_id: number | null;

  @Column({ type: 'varchar', length: 100 })
  gpu_type: string;

  @Column({ type: 'varchar', length: 20 })
  node: string;

  @Column({ type: 'varchar', length: 10 })
  precision: string;

  @Column({ type: 'int' })
  batch_size: number;

  @Column({ type: 'int' })
  data_number: number;

  @Column({ type: 'int' })
  tensor_parallel_size: number;

  @Column({ type: 'varchar', length: 20 })
  scenario: string;

  @Column({ type: 'int', default: 3 })
  retry_num: number;

  @Column({
    type: 'enum',
    enum: GpuSweepCellStatus,
    default: GpuSweepCellStatus.PENDING,
  })
  status: GpuSweepCellStatus;

  @Column({ type: 'float8', nullable: true, default: null })
  tt100t_seconds: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  tps: number | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  dispatched_at: string | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  completed_at: string | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  error_log: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  modified_at: Date;
}
