import { MigrationInterface, QueryRunner } from 'typeorm';

// Train A migration: create-tables only, ZERO ALTER on mp_exam / mm_exam.
// Rollback drops the new tables (no data loss for existing exams).
export class GpuSweep1714276800000 implements MigrationInterface {
  name = 'GpuSweep1714276800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "gpu_sweep_mode_enum" AS ENUM ('full', 'calibration')
    `);
    await queryRunner.query(`
      CREATE TYPE "gpu_sweep_status_enum" AS ENUM (
        'Pending', 'Running', 'Paused', 'Drained', 'Completed', 'Error'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "gpu_sweep_cell_kind_enum" AS ENUM ('mlperf', 'mmlu')
    `);
    await queryRunner.query(`
      CREATE TYPE "gpu_sweep_cell_status_enum" AS ENUM (
        'Pending', 'Dispatched', 'Running', 'Completed',
        'Error', 'Stopped', 'OperatorRaceFailed'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "gpu_sweep" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar(100) NOT NULL,
        "mode" "gpu_sweep_mode_enum" NOT NULL DEFAULT 'full',
        "status" "gpu_sweep_status_enum" NOT NULL DEFAULT 'Pending',
        "total_cells" int NOT NULL DEFAULT 0,
        "completed_cells" int NOT NULL DEFAULT 0,
        "matrix_config" jsonb,
        "variance_pct" float8,
        "passed" boolean,
        "started_at" varchar,
        "completed_at" varchar,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "modified_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "gpu_sweep_cell" (
        "id" SERIAL PRIMARY KEY,
        "sweep_id" int NOT NULL,
        "cell_key" varchar(200) NOT NULL,
        "kind" "gpu_sweep_cell_kind_enum" NOT NULL,
        "exam_id" int,
        "gpu_type" varchar(100) NOT NULL,
        "node" varchar(20) NOT NULL,
        "precision" varchar(10) NOT NULL,
        "batch_size" int NOT NULL,
        "data_number" int NOT NULL,
        "tensor_parallel_size" int NOT NULL,
        "scenario" varchar(20) NOT NULL,
        "retry_num" int NOT NULL DEFAULT 3,
        "status" "gpu_sweep_cell_status_enum" NOT NULL DEFAULT 'Pending',
        "tt100t_seconds" float8,
        "tps" float8,
        "dispatched_at" varchar,
        "completed_at" varchar,
        "error_log" varchar,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "modified_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_gpu_sweep_cell_sweep" FOREIGN KEY ("sweep_id")
          REFERENCES "gpu_sweep"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_gpu_sweep_cell_sweep_kind_exam"
        ON "gpu_sweep_cell" ("sweep_id", "kind", "exam_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_gpu_sweep_cell_sweep_kind_exam"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "gpu_sweep_cell"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gpu_sweep"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "gpu_sweep_cell_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "gpu_sweep_cell_kind_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "gpu_sweep_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "gpu_sweep_mode_enum"`);
  }
}
