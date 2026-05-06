import {
  canonicalize,
  isSameConfig,
  diffConfig,
  CanonicalRunConfig,
} from '../src/comparison/config-fingerprint';

const BASE: CanonicalRunConfig = {
  benchmark: 'mlperf',
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  dataset: 'CNN-DailyMail',
  dataset_version: '3.0.0',
  precision: 'fp8',
  batch_size: 1,
  data_number: 13368,
  decoding: { temperature: 0.0, top_p: 1.0, top_k: 0 },
  scenario: 'offline',
  max_output_tokens: 100,
};

describe('config-fingerprint', () => {
  // -------------------------------------------------------------------------
  // Identical configs → same hash
  // -------------------------------------------------------------------------

  it('identical configs produce the same hash', () => {
    const a = { ...BASE };
    const b = { ...BASE };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('deep-copied identical configs produce the same hash', () => {
    const a = JSON.parse(JSON.stringify(BASE)) as CanonicalRunConfig;
    const b = JSON.parse(JSON.stringify(BASE)) as CanonicalRunConfig;
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('isSameConfig returns true for identical configs', () => {
    expect(isSameConfig(BASE, { ...BASE })).toBe(true);
  });

  it('hash is a 64-char hex string (SHA-256)', () => {
    const hash = canonicalize(BASE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  // -------------------------------------------------------------------------
  // One field changed → different hash
  // -------------------------------------------------------------------------

  it('different benchmark → different hash', () => {
    const b = { ...BASE, benchmark: 'mmlu' as const };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different model → different hash', () => {
    const b = { ...BASE, model: 'meta-llama/Llama-3.1-70B-Instruct' };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different dataset → different hash', () => {
    const b = { ...BASE, dataset: 'TIGER-Lab/MMLU-Pro' };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different precision → different hash', () => {
    const b = { ...BASE, precision: 'bf16' };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different batch_size → different hash', () => {
    const b = { ...BASE, batch_size: 4 };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different data_number → different hash', () => {
    const b = { ...BASE, data_number: 500 };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different scenario → different hash', () => {
    const b = { ...BASE, scenario: 'server' };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different max_output_tokens → different hash', () => {
    const b = { ...BASE, max_output_tokens: 200 };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different decoding.temperature → different hash', () => {
    const b = { ...BASE, decoding: { ...BASE.decoding, temperature: 0.7 } };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different decoding.top_p → different hash', () => {
    const b = { ...BASE, decoding: { ...BASE.decoding, top_p: 0.9 } };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('different decoding.top_k → different hash', () => {
    const b = { ...BASE, decoding: { ...BASE.decoding, top_k: 50 } };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('isSameConfig returns false when precision differs', () => {
    const b = { ...BASE, precision: 'bf16' };
    expect(isSameConfig(BASE, b)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Optional / null fields normalized
  // -------------------------------------------------------------------------

  it('null scenario equals empty scenario (both normalize to empty)', () => {
    const a = { ...BASE, scenario: null };
    const b = { ...BASE, scenario: undefined };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('null max_output_tokens equals missing max_output_tokens', () => {
    const a = { ...BASE, max_output_tokens: null };
    const b = { ...BASE, max_output_tokens: undefined };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('null dataset_version equals undefined dataset_version', () => {
    const a = { ...BASE, dataset_version: null };
    const b = { ...BASE, dataset_version: undefined };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('absent top_p and null top_p produce the same hash', () => {
    const a = { ...BASE, decoding: { temperature: 0.0 } };
    const b = {
      ...BASE,
      decoding: { temperature: 0.0, top_p: null, top_k: null },
    };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('model name is case/whitespace-normalized', () => {
    const a = { ...BASE, model: 'Meta-Llama/llama-3.1-8b-instruct' };
    const b = { ...BASE, model: 'meta-llama/Llama-3.1-8B-Instruct' };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('dataset name is case-normalized', () => {
    const a = { ...BASE, dataset: 'cnn-dailymail' };
    const b = { ...BASE, dataset: 'CNN-DailyMail' };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  // -------------------------------------------------------------------------
  // Hardware-agnostic: same config on different hardware → same hash
  // -------------------------------------------------------------------------

  it('L40 fp8 run and RNGD bf16 run with same config fields → same hash (hardware not in fingerprint)', () => {
    // Hardware identity is stored as metadata but excluded from the hash.
    // Two runs with the same config on different devices map to the same fingerprint.
    const l40Run = { ...BASE, precision: 'bf16' };
    const rngdRun = { ...BASE, precision: 'bf16' };
    expect(canonicalize(l40Run)).toBe(canonicalize(rngdRun));
  });

  // -------------------------------------------------------------------------
  // diffConfig
  // -------------------------------------------------------------------------

  it('diffConfig returns empty array for identical configs', () => {
    expect(diffConfig(BASE, { ...BASE })).toHaveLength(0);
  });

  it('diffConfig identifies changed precision field', () => {
    const b = { ...BASE, precision: 'bf16' };
    const diffs = diffConfig(BASE, b);
    expect(diffs).toContain('precision');
    expect(diffs).toHaveLength(1);
  });

  it('diffConfig identifies multiple changed fields', () => {
    const b = { ...BASE, precision: 'bf16', batch_size: 4, scenario: 'server' };
    const diffs = diffConfig(BASE, b);
    expect(diffs).toContain('precision');
    expect(diffs).toContain('batch_size');
    expect(diffs).toContain('scenario');
  });

  it('diffConfig identifies nested decoding.temperature change', () => {
    const b = { ...BASE, decoding: { ...BASE.decoding, temperature: 0.5 } };
    const diffs = diffConfig(BASE, b);
    expect(diffs).toContain('decoding.temperature');
  });

  // -------------------------------------------------------------------------
  // MMLU canonical config
  // -------------------------------------------------------------------------

  it('MMLU canonical config fingerprint is stable', () => {
    const mmlu: CanonicalRunConfig = {
      benchmark: 'mmlu',
      model: 'meta-llama/Llama-3.1-8B-Instruct',
      dataset: 'TIGER-Lab/MMLU-Pro',
      dataset_version: 'main',
      precision: 'bf16',
      batch_size: 1,
      data_number: 0,
      decoding: { temperature: 0.0 },
      scenario: null,
      max_output_tokens: null,
    };
    const hash = canonicalize(mmlu);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalize(mmlu)).toBe(hash);
  });

  it('MMLU and MLPerf canonical configs produce different hashes', () => {
    const mmlu: CanonicalRunConfig = {
      benchmark: 'mmlu',
      model: 'meta-llama/Llama-3.1-8B-Instruct',
      dataset: 'TIGER-Lab/MMLU-Pro',
      dataset_version: 'main',
      precision: 'bf16',
      batch_size: 1,
      data_number: 0,
      decoding: { temperature: 0.0 },
    };
    expect(canonicalize(BASE)).not.toBe(canonicalize(mmlu));
  });
});
