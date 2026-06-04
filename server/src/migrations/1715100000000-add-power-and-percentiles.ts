import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap R8 (perf/Watt) + BB-3 (latency percentiles).
 *
 * Adds nullable float8 columns to mp_exam_result and npu_exam_result:
 *   - result_perf_p50_latency_s  p50 latency (seconds)
 *   - result_perf_p90_latency_s  p90 latency (seconds)
 *   - result_perf_p99_latency_s  p99 latency (seconds)
 *   - avg_power_w                mean device power over the run window (Watts)
 *
 * Every column is nullable with no default: legacy rows stay valid, and a
 * run that lacks the source data (non-server MLPerf scenarios with no
 * percentile lines, or Prometheus unavailable at completion) simply leaves
 * the column NULL. Additive only — no existing column is touched.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS / DROP COLUMN IF EXISTS so re-running
 * against a partially migrated cluster is safe. Timestamp 1715100000000 sits
 * after failure-reason (1715000400000) so it applies last.
 */
const TABLES = ['mp_exam_result', 'npu_exam_result'] as const;

const COLUMNS = [
  'result_perf_p50_latency_s',
  'result_perf_p90_latency_s',
  'result_perf_p99_latency_s',
  'avg_power_w',
] as const;

export class AddPowerAndPercentiles1715100000000
  implements MigrationInterface
{
  name = 'AddPowerAndPercentiles1715100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      for (const col of COLUMNS) {
        await queryRunner.query(
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} float8 NULL;`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      for (const col of COLUMNS) {
        await queryRunner.query(
          `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col};`,
        );
      }
    }
  }
}
