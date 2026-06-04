/**
 * WS-T03 — Fairness fuzz test (deterministic seed, no external dependencies)
 *
 * Generates 100 random (precision, dataset, model, vendor, latency_context)
 * tuples using a seeded PRNG (no fast-check dependency required) and asserts:
 *  1. Determinism: same input → same output across two calls.
 *  2. incompatibility_reasons[] contains only the canonical 8 reason codes.
 *  3. fairness_assessment.precision_class ∈ {matched, mismatched, unknown}.
 *  4. fairness_assessment.latency_context ∈ {matched, mismatched, unknown}.
 *  5. fairness_assessment.tokenizer_match ∈ {verified, unverified, mismatch, unknown}.
 *  6. assessFairness and computeIncompatibilityReasons never disagree on reason codes.
 *
 * regression_invariant: runs on every PR (jest unit suite).
 */

import {
  computeIncompatibilityReasons,
  type NormalizedRun,
} from './comparison.service';
import { assessFairness } from './fairness-assessment';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';
import { StatusEnum } from '../enums/status.enum';

// ── Canonical 8 incompatibility reason codes ─────────────────────────────────
// scenario_mismatch (C4) added: MLPerf Server-vs-Offline is a non-comparable
// measurement mode and must gate the comparison dialog.
const CANONICAL_REASON_CODES = new Set([
  'model_mismatch',
  'precision_mismatch',
  'dataset_mismatch',
  'data_number_mismatch',
  'max_output_tokens_mismatch',
  'tokenizer_unverified',
  'latency_context_mismatch',
  'scenario_mismatch',
]);

const VALID_PRECISION_CLASSES = new Set(['matched', 'mismatched', 'unknown']);
const VALID_LATENCY_CLASSES = new Set(['matched', 'mismatched', 'unknown']);
const VALID_TOKENIZER_MATCHES = new Set([
  'verified',
  'unverified',
  'mismatch',
  'unknown',
]);

// ── Seeded deterministic PRNG (mulberry32) ───────────────────────────────────
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Value pools ──────────────────────────────────────────────────────────────
const PRECISIONS = ['FP8', 'BF16', 'INT4', 'FP16', null];
const DATASETS = [
  'cnn_eval',
  'cnn_eval.json',
  'cnn-dailymail',
  'open-orca',
  'mmlu',
  null,
];
const MODELS = [
  'meta-llama/Llama-3.1-8B-Instruct',
  'mistralai/Mistral-7B-v0.3',
  'furiosa-ai/Llama-3.1-8B-Instruct-FP8',
  'meta-llama/Llama-3.1-70B-Instruct',
];
const VENDORS = ['nvidia', 'furiosa', 'rebellions', 'unknown'];
const HW_TYPES = ['gpu', 'npu'] as const;
const HW_MODELS: Record<string, string[]> = {
  nvidia: ['NVIDIA-L40', 'NVIDIA-A40', 'NVIDIA-A100'],
  furiosa: ['RNGD'],
  rebellions: ['Atom+'],
  unknown: ['unknown-hw'],
};
const LATENCY_CONTEXTS = [
  LatencyMeasurementContext.CLIENT_WALL_CLOCK,
  LatencyMeasurementContext.SERVER_TOKEN_STREAM,
  LatencyMeasurementContext.UNKNOWN,
];
const DATA_NUMBERS = [13368, 1000, 500, null];
const MAX_OUTPUT_TOKENS = [128, 256, 512, null];
const SOURCE_TABLES = ['mp_exam', 'mm_exam', 'npu_exam'] as const;

// ── Generator ────────────────────────────────────────────────────────────────
function generateRun(rng: () => number, id: number): NormalizedRun {
  const vendor = pick(rng, VENDORS);
  const hwModels = HW_MODELS[vendor] ?? ['unknown-hw'];
  const hwModel = pick(rng, hwModels);
  const hwType: 'gpu' | 'npu' = vendor === 'nvidia' ? 'gpu' : 'npu';

  return {
    id,
    benchmark: pick(rng, ['mlperf', 'mmlu']),
    name: `fuzz-run-${id}`,
    model: pick(rng, MODELS),
    hardware: {
      type: hwType,
      vendor,
      model: hwModel,
      canonical: hwModel,
      node: `node${Math.floor(rng() * 6) + 1}`,
    },
    status: StatusEnum.COMPLETED,
    started_at: null,
    completed_at: null,
    elapsed_seconds: null,
    metrics: {
      tt100t_seconds: rng() * 5,
      tps: Math.floor(rng() * 200),
      accuracy_pct: null,
      throughput: null,
    },
    artifacts: [],
    precision: pick(rng, PRECISIONS),
    scenario: pick(rng, ['Offline', 'Server', null]),
    batch_size: pick(rng, [1, 2, 4, null]),
    dataset: pick(rng, DATASETS),
    data_number: pick(rng, DATA_NUMBERS),
    max_output_tokens: pick(rng, MAX_OUTPUT_TOKENS),
    source_table: pick(rng, SOURCE_TABLES),
    failure_reason: null,
    config_fingerprint: `fp-fuzz-${id}`,
    drift_flag: rng() > 0.8,
    is_canonical: true,
    precision_mismatch: false,
    latency_measurement_context: pick(rng, LATENCY_CONTEXTS),
  };
}

// ── Fuzz corpus ──────────────────────────────────────────────────────────────
const SEED = 0xdeadbeef;
const NUM_TUPLES = 100;

function buildCorpus(): Array<[NormalizedRun, NormalizedRun]> {
  const rng = mulberry32(SEED);
  const corpus: Array<[NormalizedRun, NormalizedRun]> = [];
  for (let i = 0; i < NUM_TUPLES; i++) {
    const a = generateRun(rng, i * 2);
    const b = generateRun(rng, i * 2 + 1);
    corpus.push([a, b]);
  }
  return corpus;
}

// Build once at module load (deterministic)
const CORPUS = buildCorpus();

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('WS-T03 — Fairness fuzz (100 deterministic tuples)', () => {
  it('corpus has exactly 100 pairs', () => {
    expect(CORPUS).toHaveLength(NUM_TUPLES);
  });

  describe.each(CORPUS.map(([a, b], i) => ({ a, b, i })))(
    'pair $i',
    ({ a, b }) => {
      it('computeIncompatibilityReasons is deterministic', () => {
        const r1 = computeIncompatibilityReasons(a, b);
        const r2 = computeIncompatibilityReasons(a, b);
        expect(r1).toEqual(r2);
      });

      it('assessFairness is deterministic (ignoring computed_at)', () => {
        const f1 = assessFairness(a, b);
        const f2 = assessFairness(a, b);
        // computed_at is a live timestamp — exclude from determinism check
        const { computed_at: _t1, ...rest1 } = f1;
        const { computed_at: _t2, ...rest2 } = f2;
        expect(rest1).toEqual(rest2);
      });

      it('incompatibility_reasons[] contains only canonical codes', () => {
        const reasons = computeIncompatibilityReasons(a, b);
        for (const code of reasons) {
          expect(CANONICAL_REASON_CODES.has(code)).toBe(true);
        }
      });

      it('precision_class is a valid value', () => {
        const { precision_class } = assessFairness(a, b);
        expect(VALID_PRECISION_CLASSES.has(precision_class)).toBe(true);
      });

      it('latency_context is a valid value', () => {
        const { latency_context } = assessFairness(a, b);
        expect(VALID_LATENCY_CLASSES.has(latency_context)).toBe(true);
      });

      it('tokenizer_match is a valid value', () => {
        const { tokenizer_match } = assessFairness(a, b);
        expect(VALID_TOKENIZER_MATCHES.has(tokenizer_match)).toBe(true);
      });

      it('assessFairness.incompatibility_reasons agrees with computeIncompatibilityReasons', () => {
        const directReasons = computeIncompatibilityReasons(a, b);
        const { incompatibility_reasons } = assessFairness(a, b);
        expect(incompatibility_reasons).toEqual(directReasons);
      });
    },
  );
});
