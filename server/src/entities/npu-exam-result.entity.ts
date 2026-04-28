import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NpuExam } from './npu-exam.entity';

@Entity()
export class NpuExamResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: false })
  exam_id: number;

  @Column({ type: 'int' })
  result_number: number;

  // Time to first token (seconds)
  @Column({ type: 'float8', nullable: true, default: null })
  result_ttft: number | null;

  // Time to generate first 100 tokens (seconds) — primary KPI
  @Column({ type: 'float8', nullable: true, default: null })
  result_tt100t: number | null;

  // Tokens per second
  @Column({ type: 'float8', nullable: true, default: null })
  result_tps: number | null;

  // Best tokens per second across runs
  @Column({ type: 'float8', nullable: true, default: null })
  result_tps_best: number | null;

  // Samples per second (MLPerf)
  @Column({ type: 'float8', nullable: true, default: null })
  result_sps: number | null;

  // Latency (seconds)
  @Column({ type: 'float8', nullable: true, default: null })
  result_latency: number | null;

  // Time per output token (seconds)
  @Column({ type: 'float8', nullable: true, default: null })
  result_tpot: number | null;

  // MMLU accuracy (percentage)
  @Column({ type: 'float8', nullable: true, default: null })
  result_accuracy: number | null;

  // NPU memory peak usage (GB)
  @Column({ type: 'float', nullable: true })
  result_npu_mem_peak: number | null;

  // NPU utilization (percentage)
  @Column({ type: 'float', nullable: true })
  result_npu_util: number | null;

  // NPU power consumption (Watts)
  @Column({ type: 'float', nullable: true })
  result_npu_power: number | null;

  // Validity flag
  @Column({ type: 'varchar', nullable: true, default: null })
  result_valid: string | null;

  // Test created time
  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @ManyToOne(() => NpuExam, (exam) => exam.results, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exam_id' })
  exam: NpuExam;
}
