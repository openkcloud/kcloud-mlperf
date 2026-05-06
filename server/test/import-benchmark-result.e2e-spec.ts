import {
  sampleResult,
  computeElapsed,
  BenchmarkResult,
} from '../../scripts/import-benchmark-result';

describe('import-benchmark-result (unit)', () => {
  describe('computeElapsed', () => {
    it('computes positive elapsed seconds', () => {
      const start = '2026-04-29T07:00:00+09:00';
      const end = '2026-04-29T07:30:00+09:00';
      expect(computeElapsed(start, end)).toBeCloseTo(1800, 0);
    });

    it('returns 0 for invalid timestamps', () => {
      expect(computeElapsed('not-a-date', 'also-not')).toBe(0);
    });

    it('returns 0 when end is before start', () => {
      const start = '2026-04-29T08:00:00+09:00';
      const end = '2026-04-29T07:00:00+09:00';
      expect(computeElapsed(start, end)).toBe(0);
    });
  });

  describe('sampleResult', () => {
    let result: BenchmarkResult;

    beforeEach(() => {
      result = sampleResult();
    });

    it('returns a valid schema-conforming object', () => {
      expect(result.run_id).toBeDefined();
      expect(result.benchmark).toMatch(/^(mlperf|mmlu)$/);
      expect(result.status).toMatch(/^(completed|failed)$/);
      expect(result.vendor).toMatch(/^(nvidia|furiosa|rebellions|unknown)$/);
    });

    it('has non-null tt100t_seconds for completed mlperf run', () => {
      expect(result.tt100t_seconds).not.toBeNull();
      expect(typeof result.tt100t_seconds).toBe('number');
    });

    it('has positive elapsed_seconds', () => {
      expect(result.elapsed_seconds).toBeGreaterThan(0);
    });

    it('failure_reason is null on completed run', () => {
      expect(result.failure_reason).toBeNull();
    });

    it('raw_metrics contains expected mlperf fields', () => {
      const m = result.raw_metrics;
      expect('result_perf_tps' in m).toBe(true);
      expect('result_perf_sps' in m).toBe(true);
      expect('result_vram_peak' in m).toBe(true);
    });
  });

  describe('failed run schema', () => {
    it('produces a valid failed-run result', () => {
      const base = sampleResult();
      const failed: BenchmarkResult = {
        ...base,
        run_id: 'mlperf-99-1',
        status: 'failed',
        failure_reason:
          'BackoffLimitExceeded: job mlperf-99 exceeded backoff limit',
        tt100t_seconds: null,
        throughput_tokens_per_sec: null,
        completed_at: base.started_at,
        elapsed_seconds: 0,
      };

      expect(failed.status).toBe('failed');
      expect(failed.failure_reason).toContain('BackoffLimitExceeded');
      expect(failed.tt100t_seconds).toBeNull();
    });
  });

  describe('schema field coverage', () => {
    it('sample covers all required canonical fields', () => {
      const result = sampleResult();
      const required = [
        'run_id',
        'hardware',
        'vendor',
        'benchmark',
        'model',
        'precision',
        'started_at',
        'completed_at',
        'status',
        'failure_reason',
        'tt100t_seconds',
        'elapsed_seconds',
        'throughput_tokens_per_sec',
        'raw_metrics',
        'logs_path',
        'artifact_path',
        'config_fingerprint',
      ];
      for (const field of required) {
        expect(field in result).toBe(true);
      }
    });
  });
});
