import { scoreMmluAnswer, scoreMmluRun } from './mmlu-scoring';

describe('scoreMmluAnswer (US-004)', () => {
  it.each([
    ['The answer is A.', 'A', 1],
    ['The answer is A.', 'B', 0],
    ['Let me think... B', 'A', 0],
    ['Let me think... B', 'B', 1],
    ['I cannot answer', 'A', 0],
    ['(A)', 'A', 1],
    ['answer: a', 'A', 1],
    ['Answer: D', 'D', 1],
    ['', 'A', 0],
    ['nothing relevant here', 'A', 0],
    ['I think it is C, no wait, D', 'C', 1],
    ['BBBBB', 'B', 1],
    // MMLU-Pro is 10-option (A–J), not classic MMLU's 4-option (A–D).
    // E–J must extract and score correctly.
    [' E\nExplanation: ...', 'E', 1],
    [' F\nSkill 1: ...', 'F', 1],
    ['G', 'G', 1],
    ['The answer is H.', 'H', 1],
    ['I', 'I', 1], // bare "I" with no trailing prose is a real option answer
    ['J) because ...', 'J', 1],
    [' D\nExplanation: The correct option is D.', 'D', 1], // real furiosa-llm format
    ['I cannot answer', 'I', 0], // refusal: leading "I " is prose, not answer I
  ] as const)(
    'scoreMmluAnswer(%j, %j) === %i',
    (completion, expected, want) => {
      expect(scoreMmluAnswer(completion, expected)).toBe(want);
    },
  );

  it('handles uppercase normalization (lowercase a vs uppercase A)', () => {
    expect(scoreMmluAnswer('a', 'A')).toBe(1);
    expect(scoreMmluAnswer('A', 'A')).toBe(1);
  });

  it('returns 0 on null/undefined completions', () => {
    expect(scoreMmluAnswer(null as any, 'A')).toBe(0);
    expect(scoreMmluAnswer(undefined as any, 'A')).toBe(0);
  });
});

describe('scoreMmluRun aggregator (US-004)', () => {
  it('returns 100 * correct/total as accuracy_pct', () => {
    const completions = [
      'The answer is A',
      'The answer is B',
      'The answer is C',
      'The answer is D',
    ];
    const expected: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    expect(scoreMmluRun(completions, expected).accuracy_pct).toBe(100);
  });

  it('returns 75.0 for 3 correct + 1 wrong (4 samples)', () => {
    const completions = [
      'The answer is A',
      'The answer is B',
      'wrong answer X', // no letter
      'The answer is D',
    ];
    const expected: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    expect(scoreMmluRun(completions, expected).accuracy_pct).toBe(75);
  });

  it('returns 0 for empty array (no samples to score)', () => {
    expect(scoreMmluRun([], []).accuracy_pct).toBe(0);
  });

  it('returns counts (correct, total) alongside accuracy_pct', () => {
    const result = scoreMmluRun(['A', 'B'], ['A', 'C']);
    expect(result).toMatchObject({
      correct: 1,
      total: 2,
      accuracy_pct: 50,
    });
  });

  it('throws if completions and expected arrays differ in length (caller bug)', () => {
    expect(() => scoreMmluRun(['A'], ['A', 'B'])).toThrow(/length mismatch/i);
  });
});
