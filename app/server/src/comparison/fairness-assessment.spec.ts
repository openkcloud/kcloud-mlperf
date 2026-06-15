import { assessFairness, FairnessAssessment } from './fairness-assessment';
import { type NormalizedRun } from './comparison.service';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';
import { StatusEnum } from '../enums/status.enum';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const baseRun = (over: Partial<NormalizedRun> = {}): NormalizedRun => ({
  id: 1,
  benchmark: 'mlperf',
  name: 'r1',
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  hardware: {
    type: 'gpu',
    vendor: 'nvidia',
    model: 'NVIDIA-L40',
    canonical: 'L40',
    node: 'node2',
  },
  status: StatusEnum.COMPLETED,
  started_at: null,
  completed_at: null,
  elapsed_seconds: null,
  metrics: {
    tt100t_seconds: 1.5,
    tps: 70,
    accuracy_pct: null,
    throughput: null,
  },
  artifacts: [],
  precision: 'FP8',
  scenario: 'Offline',
  batch_size: 1,
  dataset: 'cnn_eval',
  data_number: 13368,
  max_output_tokens: 128,
  source_table: 'mp_exam',
  failure_reason: null,
  config_fingerprint: 'fp-1',
  drift_flag: false,
  is_canonical: true,
  precision_mismatch: false,
  latency_measurement_context: LatencyMeasurementContext.CLIENT_WALL_CLOCK,
  ...over,
});

describe('assessFairness (WS-B05)', () => {
  it('returns all "matched" fields for two identical runs', () => {
    const a = baseRun();
    const b = baseRun({ id: 2 });
    const result = assessFairness(a, b);

    expect(result.precision_class).toBe('matched');
    expect(result.latency_context).toBe('matched');
    expect(result.tokenizer_match).toBe('verified');
    expect(result.vendor_match).toBe(true);
    expect(result.incompatibility_reasons).toEqual([]);
    expect(result.computed_at).toMatch(ISO_RE);
  });

  it('flags precision mismatch in both precision_class and incompatibility_reasons', () => {
    const a = baseRun({ precision: 'FP8' });
    const b = baseRun({ id: 2, precision: 'BF16' });
    const result = assessFairness(a, b);

    expect(result.precision_class).toBe('mismatched');
    expect(result.incompatibility_reasons).toContain('precision_mismatch');
    // Same vendor → tokenizer still verified
    expect(result.tokenizer_match).toBe('verified');
    expect(result.vendor_match).toBe(true);
  });

  it('flags cross-vendor pair with tokenizer_match="unverified" and vendor_match=false', () => {
    const a = baseRun({
      hardware: {
        type: 'gpu',
        vendor: 'nvidia',
        model: 'NVIDIA-L40',
        canonical: 'L40',
        node: 'node2',
      },
    });
    const b = baseRun({
      id: 2,
      hardware: {
        type: 'npu',
        vendor: 'furiosa',
        model: 'RNGD',
        canonical: 'RNGD',
        node: 'node4',
      },
      latency_measurement_context:
        LatencyMeasurementContext.SERVER_TOKEN_STREAM,
    });
    const result = assessFairness(a, b);

    expect(result.tokenizer_match).toBe('unverified');
    expect(result.vendor_match).toBe(false);
    expect(result.incompatibility_reasons).toContain('tokenizer_unverified');
    expect(result.latency_context).toBe('mismatched');
    expect(result.incompatibility_reasons).toContain(
      'latency_context_mismatch',
    );
  });

  it('sets precision_class="unknown" when either side has null precision', () => {
    const a = baseRun({ precision: null });
    const b = baseRun({ id: 2, precision: 'FP8' });
    const result = assessFairness(a, b);
    expect(result.precision_class).toBe('unknown');
  });

  it('sets latency_context="unknown" when either side is UNKNOWN', () => {
    const a = baseRun({
      latency_measurement_context: LatencyMeasurementContext.UNKNOWN,
    });
    const b = baseRun({
      id: 2,
      latency_measurement_context: LatencyMeasurementContext.CLIENT_WALL_CLOCK,
    });
    const result = assessFairness(a, b);
    expect(result.latency_context).toBe('unknown');
  });

  it('all-mismatch case: cross-vendor + precision + dataset + data_number + max_output_tokens + latency context', () => {
    const a = baseRun({
      precision: 'FP8',
      dataset: 'cnn_eval',
      data_number: 13368,
      max_output_tokens: 128,
      latency_measurement_context: LatencyMeasurementContext.CLIENT_WALL_CLOCK,
    });
    const b = baseRun({
      id: 2,
      hardware: {
        type: 'npu',
        vendor: 'rebellions',
        model: 'Atom+',
        canonical: 'Atom+',
        node: 'node5',
      },
      precision: 'INT4',
      dataset: 'open-orca',
      data_number: 1000,
      max_output_tokens: 512,
      latency_measurement_context:
        LatencyMeasurementContext.SERVER_TOKEN_STREAM,
    });

    const result: FairnessAssessment = assessFairness(a, b);
    expect(result.precision_class).toBe('mismatched');
    expect(result.latency_context).toBe('mismatched');
    expect(result.tokenizer_match).toBe('unverified');
    expect(result.vendor_match).toBe(false);
    expect(result.incompatibility_reasons).toEqual(
      expect.arrayContaining([
        'precision_mismatch',
        'dataset_mismatch',
        'data_number_mismatch',
        'max_output_tokens_mismatch',
        'tokenizer_unverified',
        'latency_context_mismatch',
      ]),
    );
  });

  it('computed_at is a fresh ISO8601 timestamp on every call', () => {
    const a = baseRun();
    const b = baseRun({ id: 2 });
    const before = Date.now();
    const result = assessFairness(a, b);
    const after = Date.now();
    const ts = Date.parse(result.computed_at);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
