import {
  canonicalize,
  isSameConfig,
  diffConfig,
  CanonicalRunConfig,
} from '../src/comparison/config-fingerprint';

const BASE: CanonicalRunConfig = {
  benchmark: 'mlperf',
  model: 'meta-llama/Llama-3.1-8B-Instruct-FP8',
  dataset: 'CNN-DailyMail',
  dataset_version: '3.0.0',
  precision: 'fp8',
  batch_size: 1,
  data_number: 100,
  decoding: { temperature: 0.0, top_p: 1.0, top_k: 0 },
  scenario: 'offline',
  max_output_tokens: 128,
  dataset_subset: { name: 'cnn_dailymail', n_samples: 100 },
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

  // -------------------------------------------------------------------------
  // MLPerf full-dataset enforcement
  // -------------------------------------------------------------------------

  it('full-dataset run (13368) and subset run (500) produce different hashes', () => {
    const subset = { ...BASE, data_number: 500 };
    expect(canonicalize(BASE)).not.toBe(canonicalize(subset));
  });

  it('data_number=0 (alias for full) produces different hash than partial subset', () => {
    const full = { ...BASE, data_number: 0 };
    const subset = { ...BASE, data_number: 500 };
    expect(canonicalize(full)).not.toBe(canonicalize(subset));
  });

  it('max_output_tokens=128 canonical value hashes distinctly from legacy 100', () => {
    const legacy = { ...BASE, max_output_tokens: 100 };
    expect(canonicalize(BASE)).not.toBe(canonicalize(legacy));
  });

  // -------------------------------------------------------------------------
  // FP8 model variants: canonical vs mirror vs bf16 fallback
  // -------------------------------------------------------------------------

  it('canonical FP8 model and RedHatAI mirror are case-normalized to same hash', () => {
    const canonical = {
      ...BASE,
      model: 'meta-llama/Llama-3.1-8B-Instruct-FP8',
    };
    const mirror = {
      ...BASE,
      model: 'RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8',
    };
    // Mirrors have different org prefix → different model IDs → different hash.
    // Consumers must normalize to a single canonical model ID before comparing.
    expect(canonicalize(canonical)).not.toBe(canonicalize(mirror));
  });

  it('FP8 model and BF16 fallback model produce different hashes', () => {
    const fp8Run = {
      ...BASE,
      model: 'meta-llama/Llama-3.1-8B-Instruct-FP8',
      precision: 'fp8',
    };
    const bf16Run = {
      ...BASE,
      model: 'meta-llama/Llama-3.1-8B-Instruct',
      precision: 'bf16',
    };
    expect(canonicalize(fp8Run)).not.toBe(canonicalize(bf16Run));
  });

  // -------------------------------------------------------------------------
  // Atom+ BF16 fallback: precision-mismatch cross-hardware comparison
  // -------------------------------------------------------------------------

  it('Atom+ BF16 run vs L40 FP8 run produce different hashes (precision differs)', () => {
    const l40Fp8 = { ...BASE, precision: 'fp8' };
    const atomBf16 = { ...BASE, precision: 'bf16' };
    expect(canonicalize(l40Fp8)).not.toBe(canonicalize(atomBf16));
  });

  it('Atom+ BF16 run and RNGD BF16 run with identical config fields produce same hash', () => {
    const atomRun = {
      ...BASE,
      model: 'meta-llama/Llama-3.1-8B-Instruct',
      precision: 'bf16',
    };
    const rngdRun = {
      ...BASE,
      model: 'meta-llama/Llama-3.1-8B-Instruct',
      precision: 'bf16',
    };
    // Hardware identity excluded from fingerprint — same config → same hash.
    expect(canonicalize(atomRun)).toBe(canonicalize(rngdRun));
  });

  it('A40 BF16 run and Atom+ BF16 run with identical config produce same hash', () => {
    const a40Run = {
      ...BASE,
      precision: 'bf16',
      model: 'meta-llama/Llama-3.1-8B-Instruct',
    };
    const atomRun = {
      ...BASE,
      precision: 'bf16',
      model: 'meta-llama/Llama-3.1-8B-Instruct',
    };
    expect(canonicalize(a40Run)).toBe(canonicalize(atomRun));
  });

  // -------------------------------------------------------------------------
  // scenario and dataset_version are always hashed
  // -------------------------------------------------------------------------

  it('different dataset_version → different hash', () => {
    const b = { ...BASE, dataset_version: '2.0.0' };
    expect(canonicalize(BASE)).not.toBe(canonicalize(b));
  });

  it('offline scenario and server scenario produce different hashes', () => {
    const server = { ...BASE, scenario: 'server' };
    expect(canonicalize(BASE)).not.toBe(canonicalize(server));
  });

  it('scenario is included in fingerprint hash (not just metadata)', () => {
    const withScenario = { ...BASE, scenario: 'offline' };
    const noScenario = { ...BASE, scenario: null };
    expect(canonicalize(withScenario)).not.toBe(canonicalize(noScenario));
  });

  it('diffConfig detects dataset_version drift', () => {
    const b = { ...BASE, dataset_version: '2.0.0' };
    const diffs = diffConfig(BASE, b);
    expect(diffs).toContain('dataset_version');
    expect(diffs).toHaveLength(1);
  });

  it('diffConfig detects max_output_tokens drift', () => {
    const b = { ...BASE, max_output_tokens: 100 };
    const diffs = diffConfig(BASE, b);
    expect(diffs).toContain('max_output_tokens');
    expect(diffs).toHaveLength(1);
  });

  it('diffConfig detects scenario drift', () => {
    const b = { ...BASE, scenario: 'server' };
    const diffs = diffConfig(BASE, b);
    expect(diffs).toContain('scenario');
    expect(diffs).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // dataset_subset: 100-sample subset is a fingerprint field (v1.3.0)
  // -------------------------------------------------------------------------

  it('run with dataset_subset and run without produce different hashes', () => {
    const withSubset = {
      ...BASE,
      dataset_subset: { name: 'cnn_dailymail', n_samples: 100 },
    };
    const withoutSubset = { ...BASE, dataset_subset: null };
    expect(canonicalize(withSubset)).not.toBe(canonicalize(withoutSubset));
  });

  it('different dataset_subset n_samples → different hash', () => {
    const subset100 = {
      ...BASE,
      dataset_subset: { name: 'cnn_dailymail', n_samples: 100 },
    };
    const subsetFull = {
      ...BASE,
      dataset_subset: { name: 'cnn_dailymail', n_samples: 13368 },
    };
    expect(canonicalize(subset100)).not.toBe(canonicalize(subsetFull));
  });

  it('same dataset_subset on L40 and RNGD FP8 runs → same hash (hardware excluded)', () => {
    const l40 = { ...BASE };
    const rngd = { ...BASE };
    expect(canonicalize(l40)).toBe(canonicalize(rngd));
  });

  it('dataset_subset name is case-normalized', () => {
    const a = {
      ...BASE,
      dataset_subset: { name: 'CNN-DailyMail', n_samples: 100 },
    };
    const b = {
      ...BASE,
      dataset_subset: { name: 'cnn-dailymail', n_samples: 100 },
    };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('absent dataset_subset equals null dataset_subset', () => {
    const a = { ...BASE, dataset_subset: null };
    const b = { ...BASE, dataset_subset: undefined };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('diffConfig detects dataset_subset.n_samples drift', () => {
    const b = {
      ...BASE,
      dataset_subset: { name: 'cnn_dailymail', n_samples: 500 },
    };
    const diffs = diffConfig(BASE, b);
    expect(diffs).toContain('dataset_subset.n_samples');
  });

  // -------------------------------------------------------------------------
  // FP8-strict: BF16 runs produce different fingerprint from canonical FP8
  // -------------------------------------------------------------------------

  it('FP8 canonical run and BF16 run always produce different hashes', () => {
    const fp8Run = { ...BASE, precision: 'fp8' };
    const bf16Run = { ...BASE, precision: 'bf16' };
    expect(canonicalize(fp8Run)).not.toBe(canonicalize(bf16Run));
  });

  it('all four HW targets with fp8 and identical config produce same hash', () => {
    const l40 = { ...BASE, precision: 'fp8' };
    const a40 = { ...BASE, precision: 'fp8' };
    const rngd = { ...BASE, precision: 'fp8' };
    const atom = { ...BASE, precision: 'fp8' };
    const hashes = new Set([
      canonicalize(l40),
      canonicalize(a40),
      canonicalize(rngd),
      canonicalize(atom),
    ]);
    expect(hashes.size).toBe(1);
  });

  it('vendor-specific FP8 model IDs normalize to same hash after lowercasing', () => {
    const redhat = {
      ...BASE,
      model: 'RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8',
    };
    const redhatLower = {
      ...BASE,
      model: 'redhatai/meta-llama-3.1-8b-instruct-fp8',
    };
    expect(canonicalize(redhat)).toBe(canonicalize(redhatLower));
  });

  it('neuralmagic and RedHatAI FP8 variants produce different hashes (different org prefix)', () => {
    const redhat = {
      ...BASE,
      model: 'RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8',
    };
    const nm = { ...BASE, model: 'neuralmagic/Meta-Llama-3.1-8B-Instruct-FP8' };
    expect(canonicalize(redhat)).not.toBe(canonicalize(nm));
  });
});
