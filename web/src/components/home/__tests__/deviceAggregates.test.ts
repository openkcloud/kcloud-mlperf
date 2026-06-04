import { describe, it, expect } from 'vitest';
import type { ComparisonRunRow } from '@/api/domains/comparison';
import {
  normalizeModelFamily,
  precisionClass,
  topCrossDeviceComparison,
  vendorColor,
  VENDOR_COLOR,
  VENDOR_COLOR_DARK,
  costPerMTok,
  markParetoBy,
  markPareto,
  PARETO_AXES,
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
  it('returns WCAG-safe dark variants in dark mode and base brand colors in light mode', () => {
    // dark mode → the high-contrast tokens (the muddy #76B900/#CA8A04 fail AA on dark)
    expect(vendorColor('nvidia', 'dark')).toBe(VENDOR_COLOR_DARK.nvidia);
    expect(vendorColor('nvidia', 'dark')).toBe('#84DC3D');
    expect(vendorColor('rebellions', 'dark')).toBe('#F59E0B');
    // light mode → the original brand colors (tuned for white cards)
    expect(vendorColor('nvidia', 'light')).toBe(VENDOR_COLOR.nvidia);
    expect(vendorColor('nvidia', 'light')).toBe('#76B900');
    expect(vendorColor('furiosa', 'light')).toBe('#7C3AED');
    // default mode is dark (the app's predominant surface)
    expect(vendorColor('furiosa')).toBe(VENDOR_COLOR_DARK.furiosa);
    // unknown vendor → neutral fallback, mode-appropriate
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
});
