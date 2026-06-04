import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { NpuExam } from './npu-exam.entity';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';
import { FailureReason } from '../enums/failure-reason.enum';

@Entity()
@Unique('uniq_npu_exam_result_exam_id_result_number', [
  'exam_id',
  'result_number',
])
@Index('idx_npu_exam_result_exam_id', ['exam_id'])
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

  // BB-3: latency percentiles in SECONDS, computed from the sorted per-sample
  // latencies of the run (nearest-rank). Null when no per-sample latencies
  // were collected.
  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_p50_latency_s: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_p90_latency_s: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_p99_latency_s: number | null;

  // R8 (perf/Watt): mean device power (Watts) over the run window, captured
  // best-effort from Prometheus at completion. Null when telemetry was
  // unavailable. Cannot be backfilled (Prometheus retention).
  @Column({ type: 'float8', nullable: true, default: null })
  avg_power_w: number | null;

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

  // US-005: NPU eval measures latency at the SSE token-stream layer; tag
  // every NPU result so cross-context pairs surface a warning.
  @Column({
    type: 'enum',
    enum: LatencyMeasurementContext,
    default: LatencyMeasurementContext.SERVER_TOKEN_STREAM,
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

  // Test created time
  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @ManyToOne(() => NpuExam, (exam) => exam.results, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exam_id' })
  exam: NpuExam;
}
