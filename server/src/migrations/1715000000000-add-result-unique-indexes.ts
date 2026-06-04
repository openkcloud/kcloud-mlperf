import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds UNIQUE constraints on (exam_id, result_number) for all three result
 * tables (mp_exam_result, mm_exam_result, npu_exam_result) plus a non-unique
 * index on exam_id alone for query speed.
 *
 * Why: prior code path used findOne→update, leaving a race window where two
 * concurrent inserts could both pass the existence check and both INSERT,
 * silently creating duplicate result rows that polluted aggregates.
 *
 * The CREATE UNIQUE INDEX statements use IF NOT EXISTS to be idempotent so
 * `synchronize: true` deployments and repeated migration runs both work.
 */
export class AddResultUniqueIndexes1715000000000 implements MigrationInterface {
  name = 'AddResultUniqueIndexes1715000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_mp_exam_result_exam_id_result_number
       ON mp_exam_result (exam_id, result_number);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_mp_exam_result_exam_id
       ON mp_exam_result (exam_id);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_mm_exam_result_exam_id_result_number
       ON mm_exam_result (exam_id, result_number);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_mm_exam_result_exam_id
       ON mm_exam_result (exam_id);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_npu_exam_result_exam_id_result_number
       ON npu_exam_result (exam_id, result_number);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_npu_exam_result_exam_id
       ON npu_exam_result (exam_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_npu_exam_result_exam_id;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uniq_npu_exam_result_exam_id_result_number;`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mm_exam_result_exam_id;`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS uniq_mm_exam_result_exam_id_result_number;`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mp_exam_result_exam_id;`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS uniq_mp_exam_result_exam_id_result_number;`,
    );
  }
}
