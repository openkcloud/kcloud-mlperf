import { describe, it, expect } from 'vitest';
import type { ComparisonRunRow } from '@/api/domains/comparison';
import {
  normalizeModelFamily,
  normalizeHwModel,
  isCanonicalModel,
  filterCanonicalRuns,
  filterToCurrentCluster,
  precisionClass,
  topCrossDeviceComparison,
  aggregateByDevice,
  vendorColor,
  VENDOR_COLOR,
  VENDOR_COLOR_DARK,
  costPerMTok,
  COST_PER_MTOK_CLAMP,
  markParetoBy,
  markPareto,
  PARETO_AXES,
  CANONICAL_MODEL_FAMILY,
  isMetricQualified,
  normalizeAccuracyPct,
  median,
  isMixedContext,
  latencyContext,
  MIN_METRIC_SAMPLES,
  MAX_METRIC_CV,
  type DeviceAgg,
} from '../deviceAggregates';
import { deviceUsdPerHr } from '@/constants/device-cost.constants';

// ----------------------------------------------------------------------

let nextId = 1;
const run = (over: Partial<ComparisonRunRow> & {
  vendor?: string;
  hwModel?: string;
  tt?: number;
}): ComparisonRunRow => {
  const { vendor = 'nvidia', hwModel = 'NVIDIA-L40', tt = 1.5, ...rest } = over;
  return {
    id: nextId++,
    benchmark: 'mlperf',
    name: 'r',
    model: 'Llama-3.1-8B-Instruct',
    hardware: { vendor, model: hwModel } as ComparisonRunRow['hardware'],
    status: 'Completed',
    started_at: null,
    completed_at: null,
    elapsed_seconds: null,
    metrics: { tt100t_seconds: tt },
    precision: 'fp8',
    scenario: 'offline',
    ...rest,
  } as ComparisonRunRow;
};

const npuRun = (tt: number, over: Partial<ComparisonRunRow> = {}) =>
  run({ vendor: 'furiosa', hwModel: 'RNGD', tt, model: 'furiosa-ai/Llama-3.1-8B-Instruct', scenario: undefined, ...over });
const gpuRun = (tt: number, over: Partial<ComparisonRunRow> = {}) =>
  run({ vendor: 'nvidia', hwModel: 'NVIDIA-L40', tt, ...over });

// ----------------------------------------------------------------------

describe('normalizeModelFamily', () => {
  it('strips a vendor namespace and a trailing precision suffix', () => {
    expect(normalizeModelFamily('furiosa-ai/Llama-3.1-8B-Instruct')).toBe('Llama-3.1-8B-Instruct');
    expect(normalizeModelFamily('meta-llama/Llama-3.1-8B-Instruct')).toBe('Llama-3.1-8B-Instruct');
    expect(normalizeModelFamily('Llama-3.1-8B-Instruct-FP8')).toBe('Llama-3.1-8B-Instruct');
    expect(normalizeModelFamily('nvidia/Llama-3.1-8B-Instruct-bf16')).toBe('Llama-3.1-8B-Instruct');
    expect(normalizeModelFamily(null)).toBe('unknown');
  });
});

describe('vendorColor', () => {
  // WCAG 2.x relative luminance + contrast ratio over sRGB. We assert the
  // *requirement* (AA = 4.5:1 on the real surface) rather than pinning a hex,
  // so re-tuning a token can never silently regress contrast (#28).
  const luminance = (hex: string): number => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const contrast = (fg: string, bg: string): number => {
    const a = luminance(fg);
    const b = luminance(bg);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  };
  const AA = 4.5;
  const VENDORS = ['nvidia', 'furiosa', 'rebellions'] as const;

  it('maps to the configured vendor tokens by mode (default = dark)', () => {
    expect(vendorColor('nvidia', 'dark')).toBe(VENDOR_COLOR_DARK.nvidia);
    expect(vendorColor('nvidia', 'light')).toBe(VENDOR_COLOR.nvidia);
    expect(vendorColor('furiosa')).toBe(VENDOR_COLOR_DARK.furiosa);
  });

  it('every vendor token meets WCAG AA (4.5:1) on its target surface', () => {
    // light tokens on white cards (#ffffff)
    for (const v of VENDORS) {
      expect(contrast(VENDOR_COLOR[v], '#ffffff')).toBeGreaterThanOrEqual(AA);
    }
    // dark tokens on the dark card surface (#0F172A)
    for (const v of VENDORS) {
      expect(contrast(VENDOR_COLOR_DARK[v], '#0F172A')).toBeGreaterThanOrEqual(AA);
    }
  });

  it('falls back to a neutral, mode-appropriate token for unknown vendors', () => {
    expect(vendorColor('mystery', 'dark')).toBe('#94A3B8');
    expect(vendorColor(undefined, 'light')).toBe('#64748B');
  });
});

describe('precisionClass', () => {
  it('classifies from precision or model name, and resolves auto', () => {
    expect(precisionClass('FP8', 'Llama')).toBe('fp8');
    expect(precisionClass('bfloat16', 'Llama')).toBe('bf16');
    expect(precisionClass('fp16', 'Llama')).toBe('fp16');
    expect(precisionClass('auto', 'Llama-3.1-8B-Instruct-FP8')).toBe('fp8');
    expect(precisionClass('auto', 'Llama-3.1-8B-Instruct')).toBe('bf16');
    expect(precisionClass('', 'Llama-3.1-8B-Instruct-fp8')).toBe('fp8');
  });
});

describe('costPerMTok (R12)', () => {
  it('derives ($/hr ÷ 3600 ÷ tps) × 1e6, lower at higher throughput', () => {
    const rate = deviceUsdPerHr('A30')!;
    expect(rate).toBeGreaterThan(0);
    const expected = (rate / 3600 / 50) * 1_000_000;
    expect(costPerMTok('A30', 50)).toBeCloseTo(expected, 9);
    // Doubling throughput halves cost-per-token.
    expect(costPerMTok('A30', 100)!).toBeCloseTo(expected / 2, 9);
  });

  it('matches SKU variants via the heuristic (NVIDIA-L40, FURIOSA-RNGD, REBELLIONS-Atom+)', () => {
    expect(costPerMTok('NVIDIA-L40', 40)).toBeCloseTo(costPerMTok('L40', 40)!, 9);
    expect(costPerMTok('FURIOSA-RNGD', 80)).toBeCloseTo(costPerMTok('RNGD', 80)!, 9);
    expect(costPerMTok('REBELLIONS-Atom+', 60)).toBeCloseTo(costPerMTok('Atom+', 60)!, 9);
  });

  it('returns null when throughput or the modeled rate is unknown', () => {
    expect(costPerMTok('A30', null)).toBeNull();
    expect(costPerMTok('A30', 0)).toBeNull();
    expect(costPerMTok('Unknown-Device', 50)).toBeNull();
    expect(costPerMTok(null, 50)).toBeNull();
  });
});

describe('markParetoBy / markPareto (R11 generic frontier)', () => {
  const dev = (over: Partial<DeviceAgg>): DeviceAgg => ({
    key: over.key ?? 'k', vendor: 'nvidia', hwModel: 'X', label: 'x',
    tps: null, tt100t: null, accuracy: null, model: null, bestRunId: null,
    efficiency: null, costPerMTok: null, tt100tStdev: null, tt100tSamples: null,
    tpsStdev: null, paretoOptimal: false, ...over,
  });

  it('accuracy axis (higher better): dominated device is not optimal', () => {
    const a = dev({ key: 'a', tps: 100, accuracy: 90 }); // dominates b
    const b = dev({ key: 'b', tps: 80, accuracy: 80 });
    const c = dev({ key: 'c', tps: 60, accuracy: 95 }); // not beaten on accuracy
    markPareto([a, b, c]);
    expect(a.paretoOptimal).toBe(true);
    expect(b.paretoOptimal).toBe(false);
    expect(c.paretoOptimal).toBe(true);
  });

  it('cost axis (lower better): cheaper-at-equal-or-higher-speed dominates', () => {
    // Lower cost is better. d2 is faster AND cheaper -> dominates d1.
    const d1 = dev({ key: 'd1', tps: 50, costPerMTok: 5 });
    const d2 = dev({ key: 'd2', tps: 100, costPerMTok: 3 });
    markParetoBy([d1, d2], PARETO_AXES.tps, PARETO_AXES.cost);
    expect(d2.paretoOptimal).toBe(true);
    expect(d1.paretoOptimal).toBe(false);
  });

  it('ignores devices missing either chosen axis value', () => {
    const full = dev({ key: 'f', tps: 100, accuracy: 90 });
    const noAcc = dev({ key: 'n', tps: 200, accuracy: null });
    markPareto([full, noAcc]);
    expect(full.paretoOptimal).toBe(true); // not dominated — the faster device has no accuracy
    expect(noAcc.paretoOptimal).toBe(false); // unplaceable
  });
});

describe('topCrossDeviceComparison', () => {
  it('returns null when there is no GPU-vs-NPU pair at the same model+precision', () => {
    expect(topCrossDeviceComparison([gpuRun(1.5), gpuRun(1.6), gpuRun(1.7)])).toBeNull();
  });

  it('M4: a single-run device never yields LEAD (INCONCLUSIVE, even with a clear gap)', () => {
    const runs = [
      npuRun(0.5), // n=1, no variance
      gpuRun(1.4), gpuRun(1.5), gpuRun(1.6), gpuRun(1.5), gpuRun(1.5), // n=5, has variance
    ];
    const v = topCrossDeviceComparison(runs);
    expect(v).not.toBeNull();
    expect(v!.a.n).toBe(1); // NPU side pooled 1 run
    expect(v!.verdict.label).toBe('INCONCLUSIVE'); // NOT 'LEAD'
  });

  it('reports a significant LEAD when both sides have n>=3 and intervals separate', () => {
    const runs = [
      npuRun(1.20), npuRun(1.25), npuRun(1.22), npuRun(1.24),
      gpuRun(1.50), gpuRun(1.55), gpuRun(1.52), gpuRun(1.53),
    ];
    const v = topCrossDeviceComparison(runs)!;
    expect(v.verdict.label).toBe('LEAD');
    expect(v.verdict.leaderLabel).toBe('RNGD'); // NPU is faster
    expect(v.verdict.ciHigh).toBeLessThan(0); // CI of (npu - gpu) excludes 0, npu lower
    expect(v.a.type).toBe('NPU');
    expect(v.b.type).toBe('GPU');
  });

  it('reports TIE when both sides overlap with n>=3', () => {
    const runs = [
      npuRun(1.50), npuRun(1.52), npuRun(1.48),
      gpuRun(1.51), gpuRun(1.49), gpuRun(1.50),
    ];
    const v = topCrossDeviceComparison(runs)!;
    expect(v.verdict.label).toBe('TIE');
  });

  it('flags mixedScenario when a side pools more than one MLPerf scenario', () => {
    const runs = [
      npuRun(1.20), npuRun(1.22), npuRun(1.24),
      gpuRun(1.50, { scenario: 'offline' }), gpuRun(1.55, { scenario: 'server' }), gpuRun(1.52, { scenario: 'offline' }),
    ];
    const v = topCrossDeviceComparison(runs)!;
    expect(v.mixedScenario).toBe(true);
  });

  it('does not pool across different precisions into one cell', () => {
    const runs = [
      npuRun(1.20, { precision: 'FP8' }), npuRun(1.22, { precision: 'FP8' }), npuRun(1.24, { precision: 'FP8' }),
      gpuRun(1.50, { precision: 'bfloat16' }), gpuRun(1.55, { precision: 'bfloat16' }), gpuRun(1.52, { precision: 'bfloat16' }),
    ];
    // NPU is fp8, GPU is bf16 -> no same-precision cross-type cell -> null.
    expect(topCrossDeviceComparison(runs)).toBeNull();
  });

  // #7: the verdict must ignore non-canonical models (e.g. a 0.5B run).
  it('ignores non-canonical models when forming the GPU-vs-NPU pair', () => {
    const runs = [
      // A faster NPU vs GPU pair, but on a NON-canonical 0.5B model -> excluded.
      npuRun(0.40, { model: 'Qwen/Qwen2.5-0.5B-Instruct' }),
      npuRun(0.41, { model: 'Qwen/Qwen2.5-0.5B-Instruct' }),
      npuRun(0.42, { model: 'Qwen/Qwen2.5-0.5B-Instruct' }),
      gpuRun(0.90, { model: 'Qwen/Qwen2.5-0.5B-Instruct' }),
      gpuRun(0.91, { model: 'Qwen/Qwen2.5-0.5B-Instruct' }),
      gpuRun(0.92, { model: 'Qwen/Qwen2.5-0.5B-Instruct' }),
    ];
    expect(topCrossDeviceComparison(runs)).toBeNull();
  });
});

// ----------------------------------------------------------------------
// #7: canonical-model filter
// ----------------------------------------------------------------------

describe('canonical model filter (#7)', () => {
  it('CANONICAL_MODEL_FAMILY is the project standing model', () => {
    expect(CANONICAL_MODEL_FAMILY).toBe('Llama-3.1-8B-Instruct');
  });

  it('isCanonicalModel matches Llama-3.1-8B across vendor namespaces and precision suffixes', () => {
    expect(isCanonicalModel('meta-llama/Llama-3.1-8B-Instruct')).toBe(true);
    expect(isCanonicalModel('furiosa-ai/Llama-3.1-8B-Instruct')).toBe(true);
    expect(isCanonicalModel('Llama-3.1-8B-Instruct-FP8')).toBe(true);
    // Non-canonical models (smaller models) are rejected.
    expect(isCanonicalModel('Qwen/Qwen2.5-0.5B-Instruct')).toBe(false);
    expect(isCanonicalModel('meta-llama/Llama-3.1-70B-Instruct')).toBe(false);
    expect(isCanonicalModel(null)).toBe(false);
  });

  it('filterCanonicalRuns drops non-canonical runs (no 0.5B on the board)', () => {
    const runs = [
      run({ model: 'meta-llama/Llama-3.1-8B-Instruct' }),
      run({ model: 'Qwen/Qwen2.5-0.5B-Instruct', hwModel: 'Atom+', vendor: 'rebellions' }),
    ];
    const kept = filterCanonicalRuns(runs);
    expect(kept).toHaveLength(1);
    expect(kept[0].model).toBe('meta-llama/Llama-3.1-8B-Instruct');
  });
});

// ----------------------------------------------------------------------
// #10: hardware-model normalization + #8: current-cluster scoping
// ----------------------------------------------------------------------

describe('normalizeHwModel (#10)', () => {
  it('collapses ATOM / ATOM+ / Atom+ / REBELLIONS-Atom+ to one canonical key', () => {
    expect(normalizeHwModel('ATOM')).toBe('Atom+');
    expect(normalizeHwModel('ATOM+')).toBe('Atom+');
    expect(normalizeHwModel('Atom+')).toBe('Atom+');
    expect(normalizeHwModel('REBELLIONS-Atom+')).toBe('Atom+');
  });

  it('collapses SKU prefixes for GPUs/NPU', () => {
    expect(normalizeHwModel('NVIDIA-A30')).toBe('A30');
    expect(normalizeHwModel('FURIOSA-RNGD')).toBe('RNGD');
    expect(normalizeHwModel('NVIDIA-L40')).toBe('L40');
    expect(normalizeHwModel('A40-44GiB')).toBe('A40');
  });

  it('aggregateByDevice merges fragmented Rebellions identities into ONE row', () => {
    const runs = [
      run({ vendor: 'rebellions', hwModel: 'ATOM', tt: 0.8 }),
      run({ vendor: 'rebellions', hwModel: 'ATOM+', tt: 0.7 }),
      run({ vendor: 'rebellions', hwModel: 'Atom+', tt: 0.75 }),
    ];
    const aggs = aggregateByDevice(runs).filter(d => d.vendor === 'rebellions');
    expect(aggs).toHaveLength(1);
    expect(aggs[0].hwModel).toBe('Atom+');
    // H2: robust MEDIAN TT100T across the three merged runs (0.7, 0.75, 0.8).
    expect(aggs[0].tt100t).toBeCloseTo(0.75, 6);
  });

  it('returns unknown / passes through unknown models unchanged', () => {
    expect(normalizeHwModel(null)).toBe('unknown');
    expect(normalizeHwModel('TPUv5')).toBe('TPUv5');
  });
});

describe('filterToCurrentCluster (#8)', () => {
  const agg = (hwModel: string): DeviceAgg => ({
    key: `x/${hwModel}`, vendor: 'x', hwModel, label: hwModel,
    tps: 1, tt100t: 1, accuracy: null, model: null, bestRunId: null,
    efficiency: null, costPerMTok: null, tt100tStdev: null, tt100tSamples: null,
    tpsStdev: null, paretoOptimal: false,
  });

  it('drops off-cluster hardware (L40/A40) and keeps current ones', () => {
    const devices = [agg('A30'), agg('RNGD'), agg('Atom+'), agg('L40'), agg('A40')];
    const current = new Set(['A30', 'RNGD', 'Atom+']);
    const kept = filterToCurrentCluster(devices, current).map(d => d.hwModel);
    expect(kept).toEqual(['A30', 'RNGD', 'Atom+']);
  });

  it('is a no-op when the registry set is null/empty (graceful degrade)', () => {
    const devices = [agg('A30'), agg('L40')];
    expect(filterToCurrentCluster(devices, null)).toHaveLength(2);
    expect(filterToCurrentCluster(devices, new Set())).toHaveLength(2);
  });
});

// ----------------------------------------------------------------------
// #19: cost clamp
// ----------------------------------------------------------------------

describe('costPerMTok clamp (#19)', () => {
  it('clamps a near-zero-throughput outlier to COST_PER_MTOK_CLAMP', () => {
    // tps = 0.0001 would be billions of $/Mtok without the clamp.
    expect(costPerMTok('A30', 0.0001)).toBe(COST_PER_MTOK_CLAMP);
    expect(COST_PER_MTOK_CLAMP).toBe(10_000);
  });

  it('leaves normal values unclamped', () => {
    const rate = deviceUsdPerHr('A30')!;
    const expected = (rate / 3600 / 50) * 1_000_000;
    expect(expected).toBeLessThan(COST_PER_MTOK_CLAMP);
    expect(costPerMTok('A30', 50)).toBeCloseTo(expected, 9);
  });
});

// ----------------------------------------------------------------------
// #9: no NaN means / CI from empty pools
// ----------------------------------------------------------------------

describe('finite stats (#9)', () => {
  it('a device with no valid runs never produces a NaN verdict/CI', () => {
    // GPU has valid runs; NPU side has tt<=0 (invalid) -> filtered to n=0.
    const runs = [
      gpuRun(1.50), gpuRun(1.52), gpuRun(1.48),
      npuRun(0), npuRun(-1), // invalid -> no NPU stat -> no cross-type pair
    ];
    const v = topCrossDeviceComparison(runs);
    // No valid NPU side -> no pair at all.
    expect(v).toBeNull();
  });

  it('welch verdict bounds are finite for a real pair', () => {
    const runs = [
      npuRun(1.20), npuRun(1.25), npuRun(1.22),
      gpuRun(1.50), gpuRun(1.55), gpuRun(1.52),
    ];
    const v = topCrossDeviceComparison(runs)!;
    expect(Number.isFinite(v.verdict.delta)).toBe(true);
    expect(Number.isFinite(v.verdict.ciLow)).toBe(true);
    expect(Number.isFinite(v.verdict.ciHigh)).toBe(true);
  });
});

// ----------------------------------------------------------------------
// H2: throughput outlier / sample-count / CV gating + robust median.
// ----------------------------------------------------------------------

describe('isMetricQualified (H2)', () => {
  it('rejects a run whose sample count is below the minimum', () => {
    expect(MIN_METRIC_SAMPLES).toBe(3);
    expect(isMetricQualified(80, 1, 2)).toBe(false); // 2 samples < 3
    expect(isMetricQualified(80, 1, 1)).toBe(false);
    expect(isMetricQualified(80, 1, 3)).toBe(true); // exactly 3 qualifies
  });

  it('rejects a high-CV run (stdev/value > MAX_METRIC_CV)', () => {
    expect(MAX_METRIC_CV).toBe(0.5);
    // RNGD #98 shape: tps=187.41, stdev=148.72, samples=2 -> CV 79% AND n<3.
    expect(isMetricQualified(187.41, 148.72, 2)).toBe(false);
    // Even with enough samples, a CV above 0.5 disqualifies.
    expect(isMetricQualified(100, 60, 5)).toBe(false); // CV 0.6
    expect(isMetricQualified(100, 50, 5)).toBe(true); // CV exactly 0.5 ok
  });

  it('treats absent sample/stdev fields as a qualified single observation (graceful)', () => {
    expect(isMetricQualified(80, null, null)).toBe(true);
    expect(isMetricQualified(80, undefined, undefined)).toBe(true);
    // A non-positive value never qualifies.
    expect(isMetricQualified(0, null, 3)).toBe(false);
    expect(isMetricQualified(null, null, 5)).toBe(false);
  });
});

describe('median', () => {
  it('returns the middle of an odd list and the mean of the two middles for even', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([82.3, 81.7, 80.9])).toBeCloseTo(81.7, 6);
  });
});

describe('aggregateByDevice — H2 tps outlier gating', () => {
  // Build the live RNGD shape: one 2-sample CV-79% outlier (#98 @ 187.4) plus
  // a population of well-sampled ~80 tok/s runs.
  const rngd = (tps: number, over: Partial<ComparisonRunRow['metrics']> = {}) =>
    run({ vendor: 'furiosa', hwModel: 'RNGD', model: 'furiosa-ai/Llama-3.1-8B-Instruct',
      metrics: { tt100t_seconds: 1.25, tps, ...over } });

  it('excludes the single 2-sample CV-79% outlier from the device tps', () => {
    const runs = [
      rngd(187.41, { tps_samples: 2, tps_stdev: 148.72 }), // the #98 outlier
      rngd(81.73, { tps_samples: 5, tps_stdev: 2.0 }),
      rngd(80.96, { tps_samples: 5, tps_stdev: 1.5 }),
      rngd(80.84, { tps_samples: 5, tps_stdev: 1.8 }),
    ];
    const agg = aggregateByDevice(runs).find(d => d.hwModel === 'RNGD')!;
    // Median of the three qualifying runs (80.84, 80.96, 81.73) = 80.96 — the
    // 187.4 outlier is gone, not driving a 2.3x inflated headline.
    expect(agg.tps).toBeCloseTo(80.96, 2);
    expect(agg.tps).toBeLessThan(100);
    // The representative run id is one of the qualifying runs, never the outlier.
    expect(agg.bestRunId).not.toBeNull();
  });

  it('falls back to the best raw value when NO run qualifies (graceful, still appears)', () => {
    // Both runs are low-sample/high-CV -> neither qualifies; device still placed.
    const runs = [
      rngd(187.41, { tps_samples: 2, tps_stdev: 148.72 }),
      rngd(60.0, { tps_samples: 1, tps_stdev: null }),
    ];
    const agg = aggregateByDevice(runs).find(d => d.hwModel === 'RNGD')!;
    // Fallback uses the best (max) raw positive value so the row is not dropped.
    expect(agg.tps).toBeCloseTo(187.41, 2);
  });

  it('uses the robust median of qualifying runs rather than the raw max', () => {
    const runs = [
      rngd(70), rngd(72), rngd(95), // no sample/stdev fields -> all qualify
    ];
    const agg = aggregateByDevice(runs).find(d => d.hwModel === 'RNGD')!;
    // Median (72), not max (95).
    expect(agg.tps).toBeCloseTo(72, 6);
  });

  it('applies the same sample/CV discipline to tt100t', () => {
    // A spuriously-low tt100t with 2 samples + huge CV must not win.
    const runs = [
      run({ vendor: 'furiosa', hwModel: 'RNGD', model: 'furiosa-ai/Llama-3.1-8B-Instruct',
        metrics: { tt100t_seconds: 0.2, tt100t_samples: 2, tt100t_stdev: 0.3 } }), // CV 1.5, n<3
      run({ vendor: 'furiosa', hwModel: 'RNGD', model: 'furiosa-ai/Llama-3.1-8B-Instruct',
        metrics: { tt100t_seconds: 1.30, tt100t_samples: 5, tt100t_stdev: 0.05 } }),
      run({ vendor: 'furiosa', hwModel: 'RNGD', model: 'furiosa-ai/Llama-3.1-8B-Instruct',
        metrics: { tt100t_seconds: 1.32, tt100t_samples: 5, tt100t_stdev: 0.04 } }),
      run({ vendor: 'furiosa', hwModel: 'RNGD', model: 'furiosa-ai/Llama-3.1-8B-Instruct',
        metrics: { tt100t_seconds: 1.28, tt100t_samples: 5, tt100t_stdev: 0.06 } }),
    ];
    const agg = aggregateByDevice(runs).find(d => d.hwModel === 'RNGD')!;
    // Median of the three qualifying tt100t (1.28, 1.30, 1.32) = 1.30; the 0.2 outlier is rejected.
    expect(agg.tt100t).toBeCloseTo(1.30, 6);
  });
});

// ----------------------------------------------------------------------
// H1 + C2 frontend defense: MMLU-only, scale-normalized accuracy axis.
// ----------------------------------------------------------------------

describe('normalizeAccuracyPct (C2 frontend defense)', () => {
  it('scales a 0-1 fraction to a 0-100 percent', () => {
    expect(normalizeAccuracyPct(0.4929)).toBeCloseTo(49.29, 6);
    expect(normalizeAccuracyPct(0.5)).toBe(50);
    expect(normalizeAccuracyPct(1)).toBe(100); // boundary: 1 treated as a fraction
  });

  it('leaves a 0-100 percent unchanged', () => {
    expect(normalizeAccuracyPct(45)).toBe(45);
    expect(normalizeAccuracyPct(70)).toBe(70);
    expect(normalizeAccuracyPct(100)).toBe(100);
  });

  it('returns null for missing / negative / non-finite input', () => {
    expect(normalizeAccuracyPct(null)).toBeNull();
    expect(normalizeAccuracyPct(undefined)).toBeNull();
    expect(normalizeAccuracyPct(-0.1)).toBeNull();
    expect(normalizeAccuracyPct(NaN)).toBeNull();
  });
});

describe('aggregateByDevice — H1 MMLU-only accuracy axis', () => {
  it('ignores mlperf accuracy_pct (ROUGE) and uses MMLU rows only', () => {
    const runs = [
      // mlperf ROUGE-1 score of 23.39 must NOT land on the MMLU accuracy axis.
      run({ vendor: 'nvidia', hwModel: 'A30', benchmark: 'mlperf',
        metrics: { tt100t_seconds: 1.5, accuracy_pct: 23.39 } }),
      // Real MMLU runs, stored as 0-1 fractions (GPU mm_exam path).
      run({ vendor: 'nvidia', hwModel: 'A30', benchmark: 'mmlu',
        metrics: { tt100t_seconds: 1.5, accuracy_pct: 0.5 } }),
      run({ vendor: 'nvidia', hwModel: 'A30', benchmark: 'mmlu',
        metrics: { tt100t_seconds: 1.5, accuracy_pct: 0.4667 } }),
    ];
    const agg = aggregateByDevice(runs).find(d => d.hwModel === 'A30')!;
    // Best MMLU = 0.5 fraction, normalized to 50% — NOT the 23.39 ROUGE value.
    expect(agg.accuracy).toBeCloseTo(50, 6);
  });

  it('normalizes NPU MMLU already in 0-100 and GPU MMLU in 0-1 to one scale', () => {
    const runs = [
      run({ vendor: 'furiosa', hwModel: 'RNGD', benchmark: 'mmlu', model: 'furiosa-ai/Llama-3.1-8B-Instruct',
        metrics: { tt100t_seconds: 1.2, accuracy_pct: 45 } }), // already 0-100
      run({ vendor: 'furiosa', hwModel: 'RNGD', benchmark: 'mmlu', model: 'furiosa-ai/Llama-3.1-8B-Instruct',
        metrics: { tt100t_seconds: 1.2, accuracy_pct: 70 } }),
    ];
    const agg = aggregateByDevice(runs).find(d => d.hwModel === 'RNGD')!;
    expect(agg.accuracy).toBe(70); // max MMLU, unchanged (already a percent)
  });

  it('leaves accuracy null for a device with only mlperf rows (absent from accuracy frontier)', () => {
    const runs = [
      run({ vendor: 'rebellions', hwModel: 'Atom+', benchmark: 'mlperf', model: 'Llama-3.1-8B-Instruct',
        metrics: { tt100t_seconds: 1.0, accuracy_pct: 0 } }),
    ];
    const agg = aggregateByDevice(runs).find(d => d.hwModel === 'Atom+')!;
    // No MMLU run -> accuracy stays null (not pinned at the mlperf 0).
    expect(agg.accuracy).toBeNull();
  });
});

// ----------------------------------------------------------------------
// M7: measurement-context mismatch flag.
// ----------------------------------------------------------------------

describe('latencyContext / isMixedContext (M7)', () => {
  // The field is on the wire (NormalizedRun) but not on the typed
  // ComparisonRunRow, so attach it via an untyped cast for the test fixtures.
  const withCtx = (r: ComparisonRunRow, ctx: string): ComparisonRunRow =>
    ({ ...r, latency_measurement_context: ctx }) as ComparisonRunRow;

  it('reads latency_measurement_context off a run defensively', () => {
    const r = withCtx(run({}), 'SERVER_TOKEN_STREAM');
    expect(latencyContext(r)).toBe('SERVER_TOKEN_STREAM');
    expect(latencyContext(run({}))).toBeNull(); // absent -> null
  });

  it('flags a mismatch between NPU SERVER_TOKEN_STREAM and GPU CLIENT_WALL_CLOCK', () => {
    expect(isMixedContext(['SERVER_TOKEN_STREAM'], ['CLIENT_WALL_CLOCK'])).toBe(true);
  });

  it('flags when one side itself pooled more than one context', () => {
    expect(isMixedContext(['SERVER_TOKEN_STREAM', 'CLIENT_WALL_CLOCK'], ['CLIENT_WALL_CLOCK'])).toBe(true);
  });

  it('does NOT flag identical contexts on both sides', () => {
    expect(isMixedContext(['CLIENT_WALL_CLOCK'], ['CLIENT_WALL_CLOCK'])).toBe(false);
  });

  it('does NOT flag when context is absent on either side (legacy rows, no signal)', () => {
    expect(isMixedContext([], ['CLIENT_WALL_CLOCK'])).toBe(false);
    expect(isMixedContext([], [])).toBe(false);
  });

  it('surfaces mixedContext on the cross-device verdict for an NPU/GPU context split', () => {
    const runs = [
      withCtx(npuRun(1.20), 'SERVER_TOKEN_STREAM'),
      withCtx(npuRun(1.22), 'SERVER_TOKEN_STREAM'),
      withCtx(npuRun(1.24), 'SERVER_TOKEN_STREAM'),
      withCtx(gpuRun(1.50), 'CLIENT_WALL_CLOCK'),
      withCtx(gpuRun(1.55), 'CLIENT_WALL_CLOCK'),
      withCtx(gpuRun(1.52), 'CLIENT_WALL_CLOCK'),
    ];
    const v = topCrossDeviceComparison(runs)!;
    expect(v.mixedContext).toBe(true);
    // Scenario strings still match per side here, so mixedScenario stays false —
    // proving the context flag is an INDEPENDENT structural signal.
    expect(v.mixedScenario).toBe(false);
  });

  it('mixedContext is false when both sides share the same measurement context', () => {
    const runs = [
      withCtx(npuRun(1.20), 'SERVER_TOKEN_STREAM'),
      withCtx(npuRun(1.22), 'SERVER_TOKEN_STREAM'),
      withCtx(npuRun(1.24), 'SERVER_TOKEN_STREAM'),
      withCtx(gpuRun(1.50), 'SERVER_TOKEN_STREAM'),
      withCtx(gpuRun(1.55), 'SERVER_TOKEN_STREAM'),
      withCtx(gpuRun(1.52), 'SERVER_TOKEN_STREAM'),
    ];
    const v = topCrossDeviceComparison(runs)!;
    expect(v.mixedContext).toBe(false);
  });
});
