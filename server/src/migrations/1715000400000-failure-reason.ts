import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WS-C01 + WS-C04 (mega-plan v2.2) — adds failure capture columns to all
 * three result tables:
 *   failure_reason   ENUM, NOT NULL, default UNKNOWN_NO_LOGS
 *   last_stderr_200  TEXT, NULL  (last 200 lines from Job-watcher)
 *   diagnostic_dump  JSONB, NULL (DescribePod + events + DaemonSet status,
 *                                 populated only when failure_reason ∈ UNKNOWN_*)
 *
 * Migration timestamp: 1715000400000 — slot reserved in mega-plan v2.2 §0
 * migration ledger; sits one slot after canonical-reproducibility-n11
 * (1715000300000) so deploys apply in order.
 *
 * Idempotent: enum CREATE TYPE guarded with DO/IF NOT EXISTS, columns added
 * with ADD COLUMN IF NOT EXISTS so re-running against a partially migrated
 * cluster is safe.
 */
const TABLES = ['mp_exam_result', 'mm_exam_result', 'npu_exam_result'] as const;

export class FailureReason1715000400000 implements MigrationInterface {
  name = 'FailureReason1715000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'failure_reason_enum'
        ) THEN
          CREATE TYPE failure_reason_enum AS ENUM (
            'POD_OOM',
            'POD_IMAGE_PULL',
            'DEVICE_PLUGIN_MISSING',
            'MODEL_LOAD_FAIL',
            'PRECISION_MISMATCH',
            'INFERENCE_TIMEOUT',
            'UNKNOWN_WITH_LOGS',
            'UNKNOWN_NO_LOGS'
          );
        END IF;
      END
      $$;
    `);

    for (const table of TABLES) {
      await queryRunner.query(
        `ALTER TABLE ${table}
         ADD COLUMN IF NOT EXISTS failure_reason failure_reason_enum
         NOT NULL DEFAULT 'UNKNOWN_NO_LOGS';`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table}
         ADD COLUMN IF NOT EXISTS last_stderr_200 text NULL DEFAULT NULL;`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table}
         ADD COLUMN IF NOT EXISTS diagnostic_dump jsonb NULL DEFAULT NULL;`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS diagnostic_dump;`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS last_stderr_200;`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS failure_reason;`,
      );
    }
    await queryRunner.query(`DROP TYPE IF EXISTS failure_reason_enum;`);
  }
}
