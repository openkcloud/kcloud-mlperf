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
import { MpExam } from './mp-exam.entity';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';
import { FailureReason } from '../enums/failure-reason.enum';

@Entity()
@Unique('uniq_mp_exam_result_exam_id_result_number', [
  'exam_id',
  'result_number',
])
@Index('idx_mp_exam_result_exam_id', ['exam_id'])
export class MpExamResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: false })
  exam_id: number;

  @Column({ type: 'int' })
  result_number: number;

  @Column({ type: 'float8', nullable: true, default: null })
  result_acc_rg_1: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_acc_rg_2: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_acc_rg_l: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_acc_rg_lsum: number | null;

  // v37 Fix #20: canonical "accuracy" surface for MLPerf rows. Populated from
  // the parsed rouge1 value out of mlperf_log_summary.txt so the comparison
  // page can render `metrics.accuracy_pct` for B1 (it currently shows null
  // because `accuracy_pct` was hardcoded null for mlperf rows). The Job-watcher
  // / cron path now writes both `result_acc_rg_1` and `result_acc` so legacy
  // consumers of the rouge-1 column continue to work.
  @Column({ type: 'float8', nullable: true, default: null })
  result_acc: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_sps: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_sps_best: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_tps: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_tps_best: number | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  result_perf_valid: string | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_latency: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_serv_ttft: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_serv_tpot: number | null;

  // BB-3: latency percentiles in SECONDS. Parsed from the MLPerf LoadGen
  // summary "50.00/90.00/99.00 percentile latency (ns)" lines divided by 1e9.
  // Null when the summary lacks them (e.g. non-server scenarios).
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

  @Column({ type: 'float', nullable: true })
  result_vram_peak: number | null;

  @Column({ type: 'float', nullable: true })
  result_gpu_util: number | null;

  @Column({ type: 'float', nullable: true })
  result_tt100t: number | null;

  // US-005: how the latency was measured. GPU MLPerf rows are client-side
  // wall-clock; tagging this lets the comparison page warn on cross-context
  // pairs.
  @Column({
    type: 'enum',
    enum: LatencyMeasurementContext,
    default: LatencyMeasurementContext.CLIENT_WALL_CLOCK,
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

  @ManyToOne(() => MpExam, (exam) => exam.results, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exam_id' })
  exam: MpExam;
}
