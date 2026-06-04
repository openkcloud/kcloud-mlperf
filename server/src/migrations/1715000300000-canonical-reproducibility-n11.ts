import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the 5 NEW canonical reproducibility columns to mp_exam, mm_exam,
 * npu_exam (US-0.5; mega-plan v2.2). The total canonical N=11 set is:
 *   Existing 6 (added by 1715000100000-add-reproducibility-metadata):
 *     platform_commit_sha, image_digest, k8s_pod_name, k8s_node_name,
 *     runtime_versions, result_schema_version
 *   New 5 (this migration):
 *     tokenizer_sha, model_sha, dataset_sha, seed_value, fairness_assessment
 *
 * Note on `seed`: existing migration `1715000100000-add-reproducibility-metadata`
 * already adds a `seed bigint` column. We avoid re-adding it here. Instead,
 * we add `seed_value` as a NEW string column to capture the human-readable
 * seed (e.g., "deterministic:42" / "random:0xABC123") so callers can
 * distinguish DETERMINISTIC vs random-seeded runs (US-D03 BENCHMARK_DETERMINISTIC).
 *
 * `fairness_assessment` is a JSONB column populated by `assessFairness()`
 * (US-B05). Stores `{precision_class, latency_context, tokenizer_match,
 * vendor_match, incompatibility_reasons[], computed_at}`.
 *
 * Migration timestamp: 1715000300000 — see migration ledger in mega-plan
 * v2.2 §0. Avoids collision with 1715000200000-add-latency-measurement-context.
 *
 * Idempotent: uses ADD COLUMN IF NOT EXISTS / DROP COLUMN IF EXISTS.
 */
const TABLES = ['mp_exam', 'mm_exam', 'npu_exam'] as const;

const COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'tokenizer_sha', type: 'varchar(64)' },
  { name: 'model_sha', type: 'varchar(64)' },
  { name: 'dataset_sha', type: 'varchar(64)' },
  { name: 'seed_value', type: 'varchar(40)' },
  { name: 'fairness_assessment', type: 'jsonb' },
];

export class CanonicalReproducibilityN111715000300000
  implements MigrationInterface
{
  name = 'CanonicalReproducibilityN111715000300000';

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
