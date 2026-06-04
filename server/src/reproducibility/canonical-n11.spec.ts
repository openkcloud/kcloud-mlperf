/**
 * US-0.5: assert all 11 canonical reproducibility columns exist on
 * MpExam, MmExam, NpuExam entities. The 6 existing (added by
 * 1715000100000-add-reproducibility-metadata) plus 5 new ones from
 * 1715000300000-canonical-reproducibility-n11.
 */
import { getMetadataArgsStorage } from 'typeorm';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { NpuExam } from '../entities/npu-exam.entity';

const CANONICAL_N11 = [
  'platform_commit_sha',
  'image_digest',
  'k8s_pod_name',
  'k8s_node_name',
  'runtime_versions',
  'result_schema_version',
  'tokenizer_sha',
  'model_sha',
  'dataset_sha',
  'seed_value',
  'fairness_assessment',
] as const;

function entityColumnNames(target: any): string[] {
  return getMetadataArgsStorage()
    .columns.filter((c) => c.target === target)
    .map((c) => c.propertyName);
}

describe('Canonical N=11 reproducibility columns (US-0.5)', () => {
  test.each(CANONICAL_N11)('MpExam declares column %s', (col) => {
    expect(entityColumnNames(MpExam)).toContain(col);
  });
  test.each(CANONICAL_N11)('MmExam declares column %s', (col) => {
    expect(entityColumnNames(MmExam)).toContain(col);
  });
  test.each(CANONICAL_N11)('NpuExam declares column %s', (col) => {
    expect(entityColumnNames(NpuExam)).toContain(col);
  });

  test('total canonical column count is exactly 11 per entity', () => {
    expect(CANONICAL_N11.length).toBe(11);
  });
});
