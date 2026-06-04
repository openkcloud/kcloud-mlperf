/**
 * WS-C01 — assert all 3 result entities declare the failure-capture columns:
 *   failure_reason (enum, NOT NULL, default UNKNOWN_NO_LOGS)
 *   last_stderr_200 (text, NULL)
 *   diagnostic_dump (jsonb, NULL — populated only on UNKNOWN_* by WS-C04)
 */
import { getMetadataArgsStorage } from 'typeorm';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { FailureReason } from '../enums/failure-reason.enum';

const FAILURE_COLUMNS = [
  'failure_reason',
  'last_stderr_200',
  'diagnostic_dump',
] as const;

function entityColumn(target: any, name: string) {
  return getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
}

describe('Result entities: failure capture columns (WS-C01)', () => {
  const entities: Array<[string, any]> = [
    ['MpExamResult', MpExamResult],
    ['MmExamResult', MmExamResult],
    ['NpuExamResult', NpuExamResult],
  ];

  describe.each(entities)('%s', (_name, target) => {
    test.each(FAILURE_COLUMNS)('declares %s column', (col) => {
      expect(entityColumn(target, col)).toBeDefined();
    });

    it('failure_reason is non-null enum with UNKNOWN_NO_LOGS default', () => {
      const col = entityColumn(target, 'failure_reason');
      expect(col).toBeDefined();
      expect(col!.options.type).toBe('enum');
      expect(col!.options.nullable).toBe(false);
      expect(col!.options.default).toBe(FailureReason.UNKNOWN_NO_LOGS);
    });

    it('last_stderr_200 is nullable text', () => {
      const col = entityColumn(target, 'last_stderr_200');
      expect(col).toBeDefined();
      expect(col!.options.type).toBe('text');
      expect(col!.options.nullable).toBe(true);
    });

    it('diagnostic_dump is nullable jsonb', () => {
      const col = entityColumn(target, 'diagnostic_dump');
      expect(col).toBeDefined();
      expect(col!.options.type).toBe('jsonb');
      expect(col!.options.nullable).toBe(true);
    });
  });
});
