import { formatSeed } from './seed-format';

describe('formatSeed (WS-D03)', () => {
  describe('null cases — no seed provided', () => {
    it('returns null when rawSeed is undefined', () => {
      expect(formatSeed(undefined, false)).toBeNull();
      expect(formatSeed(undefined, true)).toBeNull();
    });

    it('returns null when rawSeed is null (cast)', () => {
      expect(formatSeed(null as any, false)).toBeNull();
      expect(formatSeed(null as any, true)).toBeNull();
    });

    it('returns null when rawSeed is empty string', () => {
      expect(formatSeed('', false)).toBeNull();
      expect(formatSeed('', true)).toBeNull();
    });
  });

  describe('deterministic mode (BENCHMARK_DETERMINISTIC=1)', () => {
    it('returns seed as plain string for numeric seed', () => {
      expect(formatSeed(42, true)).toBe('42');
    });

    it('returns seed as-is for string seed', () => {
      expect(formatSeed('12345', true)).toBe('12345');
    });

    it('handles bigint-safe stringified seed (large number string)', () => {
      const bigSeed = '9007199254740993'; // beyond Number.MAX_SAFE_INTEGER
      expect(formatSeed(bigSeed, true)).toBe('9007199254740993');
    });

    it('returns seed string without any suffix', () => {
      const result = formatSeed(100, true);
      expect(result).not.toContain('advisory_only');
      expect(result).toBe('100');
    });
  });

  describe('non-deterministic mode (advisory_only tag)', () => {
    it('appends advisory_only suffix for numeric seed', () => {
      expect(formatSeed(42, false)).toBe('42 advisory_only');
    });

    it('appends advisory_only suffix for string seed', () => {
      expect(formatSeed('12345', false)).toBe('12345 advisory_only');
    });

    it('handles bigint-safe stringified seed with advisory_only', () => {
      const bigSeed = '9007199254740993';
      expect(formatSeed(bigSeed, false)).toBe('9007199254740993 advisory_only');
    });

    it('always contains advisory_only when non-deterministic', () => {
      const result = formatSeed(1, false);
      expect(result).toContain('advisory_only');
    });
  });

  describe('edge cases', () => {
    it('handles seed value of 0 (falsy but valid seed)', () => {
      // 0 is a valid seed — should NOT return null
      expect(formatSeed(0, true)).toBe('0');
      expect(formatSeed(0, false)).toBe('0 advisory_only');
    });

    it('handles string "0"', () => {
      expect(formatSeed('0', true)).toBe('0');
      expect(formatSeed('0', false)).toBe('0 advisory_only');
    });

    it('handles negative seed values', () => {
      expect(formatSeed(-1, true)).toBe('-1');
      expect(formatSeed(-1, false)).toBe('-1 advisory_only');
    });
  });
});
