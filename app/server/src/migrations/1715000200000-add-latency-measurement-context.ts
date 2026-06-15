import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds latency_measurement_context column (US-005) to all three result tables
 * with sensible per-table defaults so existing rows are tagged correctly:
 *   - mp_exam_result   → CLIENT_WALL_CLOCK (MLPerf jobs measure client-side)
 *   - mm_exam_result   → UNKNOWN           (MMLU rows usually have no latency)
 *   - npu_exam_result  → SERVER_TOKEN_STREAM (NPU eval times SSE token frames)
 *
 * Why nullable=false with a default: the comparison helper only flags a
 * mismatch when both sides are non-UNKNOWN, so legacy rows that haven't been
 * audited yet won't trigger false alarms.
 *
 * Postgres: creating an enum type then adding the column is the canonical
 * pattern. We guard with IF NOT EXISTS / DO blocks so the migration is
 * idempotent against partial runs.
 */
export class AddLatencyMeasurementContext1715000200000
  implements MigrationInterface
{
  name = 'AddLatencyMeasurementContext1715000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'latency_measurement_context_enum'
        ) THEN
          CREATE TYPE latency_measurement_context_enum AS ENUM (
            'CLIENT_WALL_CLOCK', 'SERVER_TOKEN_STREAM', 'UNKNOWN'
          );
        END IF;
      END
      $$;
    `);
    await queryRunner.query(
      `ALTER TABLE mp_exam_result
       ADD COLUMN IF NOT EXISTS latency_measurement_context latency_measurement_context_enum
       NOT NULL DEFAULT 'CLIENT_WALL_CLOCK';`,
    );
    await queryRunner.query(
      `ALTER TABLE mm_exam_result
       ADD COLUMN IF NOT EXISTS latency_measurement_context latency_measurement_context_enum
       NOT NULL DEFAULT 'UNKNOWN';`,
    );
    await queryRunner.query(
      `ALTER TABLE npu_exam_result
       ADD COLUMN IF NOT EXISTS latency_measurement_context latency_measurement_context_enum
       NOT NULL DEFAULT 'SERVER_TOKEN_STREAM';`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE npu_exam_result DROP COLUMN IF EXISTS latency_measurement_context;`,
    );
    await queryRunner.query(
      `ALTER TABLE mm_exam_result DROP COLUMN IF EXISTS latency_measurement_context;`,
    );
    await queryRunner.query(
      `ALTER TABLE mp_exam_result DROP COLUMN IF EXISTS latency_measurement_context;`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS latency_measurement_context_enum;`,
    );
  }
}
