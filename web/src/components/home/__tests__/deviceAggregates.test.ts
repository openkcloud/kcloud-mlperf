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
    // best (lowest) TT100T wins.
    expect(aggs[0].tt100t).toBeCloseTo(0.7, 6);
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
