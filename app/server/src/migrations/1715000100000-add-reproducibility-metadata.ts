import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds reproducibility metadata columns to mp_exam, mm_exam, npu_exam.
 * All columns are nullable so existing rows remain valid (backwards compat).
 *
 * Why: prior schema captured zero of {git_commit, image_digest, k8s_pod_name,
 * k8s_node_name, seed, runtime_versions, result_schema_version}. Without these
 * a published benchmark row cannot be re-executed bit-for-bit. The capture
 * helper at src/reproducibility/reproducibility.metadata.ts reads them from
 * env vars at create-time.
 *
 * Idempotent (uses ADD COLUMN IF NOT EXISTS / DROP COLUMN IF EXISTS).
 */
const TABLES = ['mp_exam', 'mm_exam', 'npu_exam'] as const;

const COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'platform_commit_sha', type: 'varchar(40)' },
  { name: 'image_digest', type: 'varchar(80)' },
  { name: 'k8s_pod_name', type: 'varchar(100)' },
  { name: 'k8s_node_name', type: 'varchar(100)' },
  { name: 'seed', type: 'bigint' },
  { name: 'runtime_versions', type: 'text' },
  { name: 'result_schema_version', type: 'varchar(16)' },
];

export class AddReproducibilityMetadata1715000100000
  implements MigrationInterface
{
  name = 'AddReproducibilityMetadata1715000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      for (const col of COLUMNS) {
        await queryRunner.query(
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col.name} ${col.type} NULL DEFAULT NULL;`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      for (const col of COLUMNS) {
        await queryRunner.query(
          `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col.name};`,
        );
      }
    }
  }
}
