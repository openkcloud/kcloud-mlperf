import { getMetadataArgsStorage } from 'typeorm';
import {
  captureReproducibilityMetadata,
  ReproducibilityMetadata,
  __resetCaptureWarnedForTests,
} from './reproducibility.metadata';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { NpuExam } from '../entities/npu-exam.entity';

const REPRODUCIBILITY_COLUMNS = [
  'platform_commit_sha',
  'image_digest',
  'k8s_pod_name',
  'k8s_node_name',
  'seed',
  'runtime_versions',
  'result_schema_version',
] as const;

function entityColumnNames(target: any): string[] {
  return getMetadataArgsStorage()
    .columns.filter((c) => c.target === target)
    .map((c) => c.propertyName);
}

describe('Exam entities — reproducibility metadata columns (US-003)', () => {
  test.each(REPRODUCIBILITY_COLUMNS)('MpExam declares column %s', (col) => {
    expect(entityColumnNames(MpExam)).toContain(col);
  });
  test.each(REPRODUCIBILITY_COLUMNS)('MmExam declares column %s', (col) => {
    expect(entityColumnNames(MmExam)).toContain(col);
  });
  test.each(REPRODUCIBILITY_COLUMNS)('NpuExam declares column %s', (col) => {
    expect(entityColumnNames(NpuExam)).toContain(col);
  });
});

describe('captureReproducibilityMetadata (US-003)', () => {
  // Snapshot then restore process.env so tests are isolated.
  const ORIGINAL_ENV = { ...process.env };
  const KEYS = [
    'POD_NAME',
    'NODE_NAME',
    'IMAGE_DIGEST',
    'GIT_COMMIT_SHA',
    'RUNTIME_VERSIONS_JSON',
    'RESULT_SCHEMA_VERSION',
  ] as const;

  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
    __resetCaptureWarnedForTests();
  });
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns a fully populated ReproducibilityMetadata object when all env vars are set', () => {
    process.env.POD_NAME = 'etri-llm-backend-7d9f-xyz';
    process.env.NODE_NAME = 'node1';
    process.env.IMAGE_DIGEST =
      'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd12';
    process.env.GIT_COMMIT_SHA = 'a1b2c3d4e5f6';
    process.env.RUNTIME_VERSIONS_JSON =
      '{"node":"22.5","cuda":"12.4","vllm":"0.6.3"}';
    process.env.RESULT_SCHEMA_VERSION = 'v3';

    const meta: ReproducibilityMetadata = captureReproducibilityMetadata();

    expect(meta.k8s_pod_name).toBe('etri-llm-backend-7d9f-xyz');
    expect(meta.k8s_node_name).toBe('node1');
    expect(meta.image_digest).toBe(process.env.IMAGE_DIGEST);
    expect(meta.platform_commit_sha).toBe('a1b2c3d4e5f6');
    expect(meta.runtime_versions).toBe(process.env.RUNTIME_VERSIONS_JSON);
    expect(meta.result_schema_version).toBe('v3');
  });

  it('returns nulls and warns at most once when no env vars are set', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const meta1 = captureReproducibilityMetadata();
      const meta2 = captureReproducibilityMetadata();

      expect(meta1.k8s_pod_name).toBeNull();
      expect(meta1.k8s_node_name).toBeNull();
      expect(meta1.image_digest).toBeNull();
      expect(meta1.platform_commit_sha).toBeNull();
      expect(meta1.runtime_versions).toBeNull();
      expect(meta1.result_schema_version).toBeNull();
      expect(meta2).toEqual(meta1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('rejects malformed git SHA (not 7-40 hex chars) — stores null', () => {
    process.env.GIT_COMMIT_SHA = 'not-a-sha-zzzzzz';
    const meta = captureReproducibilityMetadata();
    expect(meta.platform_commit_sha).toBeNull();
  });

  it('accepts a 40-char git SHA', () => {
    const sha = 'a'.repeat(40);
    process.env.GIT_COMMIT_SHA = sha;
    const meta = captureReproducibilityMetadata();
    expect(meta.platform_commit_sha).toBe(sha);
  });

  it('accepts a 7-char short git SHA', () => {
    process.env.GIT_COMMIT_SHA = '1234abc';
    const meta = captureReproducibilityMetadata();
    expect(meta.platform_commit_sha).toBe('1234abc');
  });
});
