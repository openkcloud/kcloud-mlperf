import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { MmExam } from './mm-exam.entity';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';
import { FailureReason } from '../enums/failure-reason.enum';

@Entity()
@Unique('uniq_mm_exam_result_exam_id_result_number', [
  'exam_id',
  'result_number',
])
@Index('idx_mm_exam_result_exam_id', ['exam_id'])
export class MmExamResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: false })
  exam_id: number;

  @Column({ type: 'int' })
  result_number: number;

  @Column({ type: 'float8' })
  result_acc_total: number;

  @Column({ type: 'float8' })
  result_acc_physics: number;

  @Column({ type: 'float8' })
  result_acc_chemistry: number;

  @Column({ type: 'float8' })
  result_acc_law: number;

  @Column({ type: 'float8' })
  result_acc_engineering: number;

  @Column({ type: 'float8' })
  result_acc_other: number;

  @Column({ type: 'float8' })
  result_acc_economics: number;

  @Column({ type: 'float8' })
  result_acc_health: number;

  @Column({ type: 'float8' })
  result_acc_psychology: number;

  @Column({ type: 'float8' })
  result_acc_business: number;

  @Column({ type: 'float8' })
  result_acc_biology: number;

  @Column({ type: 'float8' })
  result_acc_philosophy: number;

  @Column({ type: 'float8' })
  result_acc_cs: number;

  @Column({ type: 'float8' })
  result_acc_math: number;

  @Column({ type: 'float8' })
  result_acc_history: number;

  // US-005: latency measurement context. MMLU paths typically don't measure
  // latency, so default to UNKNOWN; comparison helper skips mismatch flag
  // when either side is UNKNOWN.
  @Column({
    type: 'enum',
    enum: LatencyMeasurementContext,
    default: LatencyMeasurementContext.UNKNOWN,
    nullable: false,
  })
  latency_measurement_context: LatencyMeasurementContext;

  // WS-C01: classified failure reason. Defaults to UNKNOWN_NO_LOGS so a pod
  // that dies before producing any logs still has a row. v37 (Fix #4):
  // relaxed to nullable so successful runs can clear the bogus default —
  // ensureFailureReasonNullable() runs an idempotent ALTER on boot.
  @Column({
    type: 'enum',
    enum: FailureReason,
    default: FailureReason.UNKNOWN_NO_LOGS,
    nullable: true,
  })
  failure_reason: FailureReason | null;

  // WS-C01: last 200 lines of stderr captured by the Job-watcher (best-effort
  // via kubectl logs / Loki). Nullable because successful runs leave it empty.
  @Column({ type: 'text', nullable: true, default: null })
  last_stderr_200: string | null;

  // WS-C04: auto-attached diagnostics (DescribePod + last 100 events +
  // DaemonSet status) populated only when failure_reason ∈ {UNKNOWN_*}.
  @Column({ type: 'jsonb', nullable: true, default: null })
  diagnostic_dump: Record<string, unknown> | null;

  // Test created time: timestamp value
  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @ManyToOne(() => MmExam, (exam) => exam.results, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exam_id' })
  exam: MmExam;
}
