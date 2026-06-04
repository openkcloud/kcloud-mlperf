import type { ComparisonRunRow } from '@/api/domains/comparison';
import { deviceUsdPerHr } from '@/constants/device-cost.constants';

// ----------------------------------------------------------------------
// Shared per-device aggregation for the home insights (scatter + leaderboard).
// Joins the best MLPerf throughput/TT100T and the best MMLU-Pro accuracy that
// exist for each (vendor / hardware-model) so a device can be placed on one
// decision surface (Artificial Analysis "speed vs quality" pattern).
// ----------------------------------------------------------------------

export const TT100T_TARGET = 1.1;

// #7: the project's standing rule is "always Llama-3.1-8B-Instruct". Home
// insights (leaderboard + scatter + roofline) must rank ONE canonical model so a
// 0.5B model can never top an 8B board. `normalizeModelFamily` strips the vendor
// namespace and trailing precision suffix, so the canonical family is the bare
// base name; `isCanonicalModel` is the single source of truth for the filter.
export const CANONICAL_MODEL_FAMILY = 'Llama-3.1-8B-Instruct';

export const isCanonicalModel = (model: string | null | undefined): boolean =>
  normalizeModelFamily(model).toLowerCase() === CANONICAL_MODEL_FAMILY.toLowerCase();

// #7: keep only canonical-model runs for the home decision surfaces.
export const filterCanonicalRuns = (runs: ComparisonRunRow[]): ComparisonRunRow[] =>
  runs.filter(r => isCanonicalModel(r.model));

// Light-theme vendor colors. #28: the raw brand hues (#76B900 ~2.2:1,
// #CA8A04 ~2.8:1) fail WCAG AA (4.5:1) on white cards. These darkened tokens
// restore AA contrast on light surfaces while staying recognizably on-brand.
export const VENDOR_COLOR: Record<string, string> = {
  nvidia: '#4d7a00', // 5.12:1 on white — AA (was #5a8c00 4.05:1 / brand #76B900 2.2:1)
  furiosa: '#7C3AED', // ~5.2:1 on white — already AA
  rebellions: '#a85400', // 5.34:1 on white (was #b85d00 4.56:1 / brand #CA8A04 2.8:1)
};

// Dark-surface-safe variants. The base VENDOR_COLOR values are tuned for the
// light theme (white cards); on the dark cards (#0F172A / #1E293B) #76B900 drops
// to ~2.2:1 and #CA8A04 to ~2.8:1, both failing WCAG AA. These lighter tokens
// restore >=4.5:1 contrast on dark without washing out the brand hues.
export const VENDOR_COLOR_DARK: Record<string, string> = {
  nvidia: '#84DC3D', // ~10.4:1 on #0F172A (lime-400, vs #76B900's 2.2:1)
  furiosa: '#A78BFA', // ~6.6:1, lightened from #7C3AED
  rebellions: '#F59E0B', // ~6.8:1 amber, replaces the muddy #CA8A04 (2.8:1)
};

export const vendorColor = (v: string | undefined, mode: 'light' | 'dark' = 'dark'): string =>
  (mode === 'dark' ? VENDOR_COLOR_DARK : VENDOR_COLOR)[v ?? ''] ??
  (mode === 'dark' ? '#94A3B8' : '#64748B');

// Status chip foreground. The chip backgrounds are translucent tints that read
// fine on both themes, but the solid dark-600 foregrounds (#15803D etc.) drop
// below ~2.4:1 on the dark cards. Dark mode uses the *-400 family for >=4.5:1.
export type StatusKind = 'success' | 'error' | 'warning' | 'info' | 'neutral';
const STATUS_FG_LIGHT: Record<StatusKind, string> = {
  success: '#15803D',
  error: '#B91C1C',
  warning: '#92400E',
  info: '#1D4ED8',
  neutral: '#475569',
};
const STATUS_FG_DARK: Record<StatusKind, string> = {
  success: '#4ADE80',
  error: '#F87171',
  warning: '#FBBF24',
  info: '#60A5FA',
  neutral: '#94A3B8',
};
export const statusColor = (kind: StatusKind, mode: 'light' | 'dark' = 'dark'): string =>
  (mode === 'dark' ? STATUS_FG_DARK : STATUS_FG_LIGHT)[kind];

export type DeviceAgg = {
  key: string;
  vendor: string;
  hwModel: string;
  label: string; // "nvidia / A30"
  tps: number | null; // best MLPerf throughput
  tt100t: number | null; // best (lowest) TT100T seconds
  accuracy: number | null; // best MMLU-Pro accuracy %
  model: string | null; // representative LLM
  bestRunId: number | null;
  efficiency: number | null; // normalized 0-100 composite (filled by withEfficiency)
  // R12: modeled $/1M-tokens = (deviceUsdPerHr/3600)/tps * 1e6. Lower is better.
  // Null when tps or the (modeled, external) hourly rate is unknown.
  costPerMTok: number | null;
  // Round-2 statistical rigor: variance carried from the best run per metric.
  tt100tStdev: number | null;
  tt100tSamples: number | null;
  tpsStdev: number | null;
  paretoOptimal: boolean;
};

const isPos = (n: number | null | undefined): n is number => n != null && n > 0;

/**
 * #10: collapse fragmented hardware-model identities to ONE canonical key per
 * physical device. The data carries the same Rebellions part as 'ATOM', 'ATOM+',
 * 'Atom+', 'REBELLIONS-Atom+', etc., which would otherwise split into separate
 * leaderboard rows and roofline groups. Mirrors the model-family normalization:
 * SKU prefixes are dropped and known parts map to a single canonical hwModel.
 */
export function normalizeHwModel(hwModel: string | null | undefined): string {
  if (!hwModel) return 'unknown';
  const raw = String(hwModel).trim();
  const upper = raw.toUpperCase();
  // Atom / Atom+ (with or without the REBELLIONS- prefix, '+' or no '+').
  if (upper.includes('ATOM') || upper.includes('REBELLIONS')) return 'Atom+';
  if (upper.includes('RNGD') || upper.includes('FURIOSA')) return 'RNGD';
  if (upper.includes('L40')) return 'L40';
  if (upper.includes('A40')) return 'A40';
  if (upper.includes('A30')) return 'A30';
  return raw;
}

/**
 * #8: restrict aggregated devices to the hardware that exists in the LIVE
 * cluster registry. `currentModels` is the set of canonical hwModels currently
 * advertised by /api/devices (e.g. {A30, RNGD, Atom+}); off-cluster historical
 * rows (L40/A40) are dropped. A null/empty set is a no-op (show everything),
 * so the home page degrades gracefully if the registry query has not resolved.
 */
export function filterToCurrentCluster(
  devices: DeviceAgg[],
  currentModels: ReadonlySet<string> | null | undefined,
): DeviceAgg[] {
  if (!currentModels || currentModels.size === 0) return devices;
  return devices.filter(d => currentModels.has(d.hwModel));
}

/** Collapse the run list into one row per (vendor / canonical hardware model). */
export function aggregateByDevice(runs: ComparisonRunRow[]): DeviceAgg[] {
  const byKey = new Map<string, DeviceAgg>();
  for (const r of runs) {
    const vendor = r.hardware?.vendor ?? 'unknown';
    const hwModel = normalizeHwModel(r.hardware?.model);
    const key = `${vendor}/${hwModel}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        key, vendor, hwModel, label: `${vendor} / ${hwModel}`,
        tps: null, tt100t: null, accuracy: null, model: null,
        bestRunId: null, efficiency: null, costPerMTok: null,
        tt100tStdev: null, tt100tSamples: null, tpsStdev: null,
        paretoOptimal: false,
      };
      byKey.set(key, agg);
    }
    const tps = r.metrics?.tps;
    const tt = r.metrics?.tt100t_seconds;
    const acc = r.metrics?.accuracy_pct;
    if (isPos(tps) && (agg.tps == null || tps > agg.tps)) {
      agg.tps = tps;
      agg.tpsStdev = r.metrics?.tps_stdev ?? null;
      agg.model = r.model ?? agg.model;
      agg.bestRunId = r.id ?? agg.bestRunId;
    }
    if (isPos(tt) && (agg.tt100t == null || tt < agg.tt100t)) {
      agg.tt100t = tt;
      agg.tt100tStdev = r.metrics?.tt100t_stdev ?? null;
      agg.tt100tSamples = r.metrics?.tt100t_samples ?? null;
    }
    if (acc != null && acc >= 0 && (agg.accuracy == null || acc > agg.accuracy)) {
      agg.accuracy = acc;
    }
  }
  // R12: derive modeled $/1M-tokens once per device from its best throughput.
  for (const agg of byKey.values()) {
    agg.costPerMTok = costPerMTok(agg.hwModel, agg.tps);
  }
  return Array.from(byKey.values());
}

/** #19: cap modeled $/Mtok so a near-zero tps outlier can't blow up the y-axis. */
export const COST_PER_MTOK_CLAMP = 10_000;

/**
 * R12: modeled cost per 1,000,000 output tokens, in USD. Derived purely from
 * the (external, MODELED) device $/hr assumption and measured throughput:
 *   ($/hr ÷ 3600 s/hr) ÷ (tok/s) × 1e6 tok  →  $ / Mtok.
 * Lower is better. Returns null when throughput or the rate is unavailable.
 * #19: the result is clamped to COST_PER_MTOK_CLAMP so a tps≪1 outlier (which
 * yields $billions/Mtok) cannot rescale the cost axis and hide normal devices.
 */
export function costPerMTok(
  hwModel: string | null | undefined,
  tps: number | null | undefined,
): number | null {
  if (!isPos(tps)) return null;
  const usdPerHr = deviceUsdPerHr(hwModel);
  if (usdPerHr == null) return null;
  const raw = (usdPerHr / 3600 / (tps as number)) * 1_000_000;
  return Math.min(raw, COST_PER_MTOK_CLAMP);
}

/**
 * Normalized 0-100 "Efficiency" composite (HF normalize pattern): mean of the
 * available normalized axes — throughput (vs best), inverse-TT100T (vs best),
 * accuracy (raw %, already 0-100). Only axes with data are averaged so a device
 * missing one benchmark still scores fairly on what it has.
 */
export function withEfficiency(devices: DeviceAgg[]): DeviceAgg[] {
  const maxTps = Math.max(0, ...devices.map(d => d.tps ?? 0));
  const bestTt = Math.min(...devices.filter(d => d.tt100t != null).map(d => d.tt100t as number), Infinity);
  for (const d of devices) {
    const axes: number[] = [];
    if (d.tps != null && maxTps > 0) axes.push((d.tps / maxTps) * 100);
    if (d.tt100t != null && Number.isFinite(bestTt) && d.tt100t > 0) axes.push((bestTt / d.tt100t) * 100);
    if (d.accuracy != null) axes.push(Math.max(0, Math.min(100, d.accuracy)));
    d.efficiency = axes.length ? axes.reduce((a, b) => a + b, 0) / axes.length : null;
  }
  return devices;
}

// An axis on the decision surface: how to read a metric off a device and which
// direction is "better" ('higher' = up is better, 'lower' = down is better).
export type ParetoAxis = {
  get: (d: DeviceAgg) => number | null;
  better: 'higher' | 'lower';
};

const TPS_AXIS: ParetoAxis = { get: d => d.tps, better: 'higher' };
const ACCURACY_AXIS: ParetoAxis = { get: d => d.accuracy, better: 'higher' };
const COST_AXIS: ParetoAxis = { get: d => d.costPerMTok, better: 'lower' };

/** True when `a` is at least as good as `b` on `axis` (respecting direction). */
const atLeastAsGood = (axis: ParetoAxis, a: number, b: number): boolean =>
  axis.better === 'higher' ? a >= b : a <= b;
/** True when `a` is strictly better than `b` on `axis`. */
const strictlyBetter = (axis: ParetoAxis, a: number, b: number): boolean =>
  axis.better === 'higher' ? a > b : a < b;

/**
 * Generic Pareto frontier over two arbitrary axes. A device is Pareto-optimal
 * when no other device is at-least-as-good on BOTH axes and strictly better on
 * at least one. Only devices with both axis values present are considered;
 * `paretoOptimal` is reset to false on devices that cannot be placed.
 */
export function markParetoBy(devices: DeviceAgg[], xAxis: ParetoAxis, yAxis: ParetoAxis): DeviceAgg[] {
  for (const d of devices) d.paretoOptimal = false;
  const pts = devices
    .map(d => ({ d, x: xAxis.get(d), y: yAxis.get(d) }))
    .filter((p): p is { d: DeviceAgg; x: number; y: number } => p.x != null && p.y != null);
  for (const p of pts) {
    const dominated = pts.some(
      o => o.d !== p.d &&
        atLeastAsGood(xAxis, o.x, p.x) &&
        atLeastAsGood(yAxis, o.y, p.y) &&
        (strictlyBetter(xAxis, o.x, p.x) || strictlyBetter(yAxis, o.y, p.y)),
    );
    p.d.paretoOptimal = !dominated;
  }
  return devices;
}

/**
 * Pareto frontier on (throughput ↑, accuracy ↑): a device is optimal if no other
 * device beats it on both axes. Needs both metrics present to be considered.
 * Thin wrapper over `markParetoBy` preserving the historical accuracy behavior.
 */
export function markPareto(devices: DeviceAgg[]): DeviceAgg[] {
  return markParetoBy(devices, TPS_AXIS, ACCURACY_AXIS);
}

export const PARETO_AXES = { tps: TPS_AXIS, accuracy: ACCURACY_AXIS, cost: COST_AXIS };

/** Speedup of `d` vs the slowest device on TT100T (e.g. "1.8× vs A30"). */
export function speedupVsSlowest(
  d: DeviceAgg,
  devices: DeviceAgg[],
): { factor: number; baselineLabel: string } | null {
  const withTt = devices.filter(x => x.tt100t != null);
  if (withTt.length < 2 || d.tt100t == null) return null;
  const slowest = withTt.reduce((a, b) => ((a.tt100t as number) > (b.tt100t as number) ? a : b));
  if (slowest.key === d.key || slowest.tt100t == null) return null;
  const factor = (slowest.tt100t as number) / (d.tt100t as number);
  if (factor <= 1.01) return null;
  return { factor, baselineLabel: slowest.hwModel };
}

// ----------------------------------------------------------------------
// Round-2 statistical rigor (research: Student-t for small-N means, Welch
// difference test for tie-vs-lead — NOT individual-CI overlap).
// ----------------------------------------------------------------------

// Two-sided 95% Student-t critical values by degrees of freedom (hardcoded).
const T95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131, 20: 2.086, 25: 2.06, 30: 2.042,
};

function tStar(df: number): number {
  if (df <= 0) return NaN;
  if (T95[df]) return T95[df];
  if (df >= 30) return 1.96;
  const keys = Object.keys(T95).map(Number).sort((a, b) => a - b);
  let v = 1.96;
  for (const k of keys) if (k <= df) v = T95[k];
  return v;
}

export type DiffVerdict = {
  label: 'LEAD' | 'TIE' | 'INCONCLUSIVE';
  delta: number; // a.tt100t - b.tt100t (seconds)
  ciLow: number;
  ciHigh: number;
  leaderLabel?: string;
};

/**
 * Welch (unequal-variance) difference test on TT100T (lower is better) from
 * mean/stdev/N. CI on the difference vs 0 decides the verdict; an overlapping
 * interval at tiny N is reported INCONCLUSIVE, not TIE.
 */
function welchCore(
  aMean: number, aSd: number, aN: number, aLabel: string,
  bMean: number, bSd: number, bN: number, bLabel: string,
): DiffVerdict {
  // #9: guard non-finite means / zero N (a device with no valid runs). Without
  // this, NaN means or N=0 propagate to "Δ NaN, 95% CI [NaN, NaN]" in the UI.
  if (
    !Number.isFinite(aMean) || !Number.isFinite(bMean) ||
    aN <= 0 || bN <= 0
  ) {
    return { label: 'INCONCLUSIVE', delta: 0, ciLow: 0, ciHigh: 0 };
  }
  const delta = aMean - bMean;
  const seDiff = Math.sqrt((aSd * aSd) / aN + (bSd * bSd) / bN);
  if (!Number.isFinite(seDiff) || seDiff === 0) {
    // No (finite) variance available — cannot establish significance.
    return { label: 'INCONCLUSIVE', delta, ciLow: delta, ciHigh: delta };
  }
  const num = ((aSd * aSd) / aN + (bSd * bSd) / bN) ** 2;
  const den =
    (aN > 1 ? ((aSd * aSd) / aN) ** 2 / (aN - 1) : 0) +
    (bN > 1 ? ((bSd * bSd) / bN) ** 2 / (bN - 1) : 0);
  const df = den > 0 ? Math.max(1, Math.floor(num / den)) : 1;
  const margin = tStar(df) * seDiff;
  const ciLow = delta - margin;
  const ciHigh = delta + margin;
  const minN = Math.min(aN, bN);
  let label: DiffVerdict['label'];
  // A significance claim needs >=3 observations on BOTH sides; with fewer (esp.
  // a single run with no variance) we never emit LEAD — only INCONCLUSIVE.
  if (minN < 3) label = 'INCONCLUSIVE';
  else if (ciLow <= 0 && ciHigh >= 0) label = 'TIE';
  else label = 'LEAD';
  const leaderLabel = label === 'LEAD' ? (delta < 0 ? aLabel : bLabel) : undefined;
  return { label, delta, ciLow, ciHigh, leaderLabel };
}

// ----------------------------------------------------------------------
// Cross-device, SAME-MODEL comparison — the real "which hardware is faster for
// THIS model?" question. Vendors namespace the same weights differently
// (furiosa-ai/Llama-3.1-8B-Instruct vs meta-llama/Llama-3.1-8B-Instruct vs
// Llama-3.1-8B-Instruct), so normalize to a model family first. Variance is
// POOLED across all of a device's runs for the family (between-run spread, real
// N) — picking a single "best" run would discard the variance and force
// INCONCLUSIVE. The pair shown is fastest-NPU vs fastest-GPU (the project's
// question); if only one accelerator type is present, the two fastest devices.
// ----------------------------------------------------------------------

export function normalizeModelFamily(model: string | null | undefined): string {
  if (!model) return 'unknown';
  // Drop the "vendor/" namespace AND a trailing precision suffix so that
  // furiosa-ai/Llama-3.1-8B-Instruct and nvidia's Llama-3.1-8B-Instruct-FP8
  // collapse to the same base family; precision is keyed separately.
  const base = String(model).split('/').pop() ?? String(model);
  return base.replace(/-(fp8|bf16|bfloat16|fp16)$/i, '').trim();
}

/** Coarse precision class so only same-precision runs are pooled together. */
export function precisionClass(
  precision: string | null | undefined,
  model: string | null | undefined,
): string {
  const p = (precision ?? '').toLowerCase();
  const m = (model ?? '').toLowerCase();
  if (/fp8/.test(p) || /fp8/.test(m)) return 'fp8';
  if (/bf16|bfloat/.test(p)) return 'bf16';
  if (/fp16/.test(p)) return 'fp16';
  if (p === 'auto') return /fp8/.test(m) ? 'fp8' : 'bf16';
  return p || 'other';
}

const deviceType = (vendor: string): 'GPU' | 'NPU' => (vendor === 'nvidia' ? 'GPU' : 'NPU');

export type DeviceTtStat = {
  label: string;
  type: 'GPU' | 'NPU';
  mean: number;
  stdev: number;
  n: number; // number of RUNS pooled (each run's TT100T is itself a retry-mean)
  scenarios: string[]; // distinct MLPerf scenarios seen in the pool
};

export type CrossDeviceVerdict = {
  family: string;
  precision: string;
  a: DeviceTtStat; // the NPU side
  b: DeviceTtStat; // the GPU side
  verdict: DiffVerdict;
  // The data is observational: this is a between-RUN comparison, scenario is NOT
  // part of the cell key, and the NPU path measures single-stream server-side
  // while the GPU path measures offline/batched client-side. So the verdict is
  // EXPLORATORY, not a controlled experiment. `mixedScenario` is true when either
  // side pooled more than one MLPerf scenario.
  mixedScenario: boolean;
};

function meanStdev(xs: number[]): { mean: number; stdev: number; n: number } {
  const v = xs.filter(x => Number.isFinite(x) && x > 0);
  // #9: return a finite (0,0,0) for an empty pool, not NaN. n=0 still signals
  // "no valid runs" to callers (welchCore short-circuits on n<=0), but nothing
  // downstream can ever stringify a NaN mean/CI.
  if (v.length === 0) return { mean: 0, stdev: 0, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (v.length === 1) return { mean, stdev: 0, n: 1 };
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1);
  return { mean, stdev: Math.sqrt(variance), n: v.length };
}

/**
 * EXPLORATORY GPU↔NPU comparison for the home page. Within the richest cell keyed
 * by (model base + precision class), pool each device's per-run TT100T means
 * (between-run spread, N = runs) and Welch-compare the highest-N NPU device vs the
 * highest-N GPU device. This is an observational signal, NOT a controlled result:
 * scenario/dataset/date are not matched, and the NPU path measures single-stream
 * server-side while the GPU path measures offline/batched client-side. Callers
 * MUST present it as exploratory (see `mixedScenario` + the UI caveat). Returns
 * null if no same-model+precision GPU-vs-NPU pair exists.
 */
export function topCrossDeviceComparison(
  runs: ComparisonRunRow[],
): CrossDeviceVerdict | null {
  // cellKey -> deviceKey -> pooled tt100t means (+ scenarios seen)
  const cells = new Map<
    string,
    Map<string, { vendor: string; hwModel: string; tts: number[]; scenarios: Set<string> }>
  >();
  for (const r of runs) {
    const tt = r.metrics?.tt100t_seconds;
    if (tt == null || tt <= 0) continue;
    // #7: the cross-device verdict must compare the canonical model only — never
    // rank a 0.5B run against the 8B board.
    if (!isCanonicalModel(r.model)) continue;
    const family = normalizeModelFamily(r.model);
    const prec = precisionClass(r.precision, r.model);
    const cellKey = `${family}|${prec}`;
    const vendor = r.hardware?.vendor ?? 'unknown';
    const hwModel = normalizeHwModel(r.hardware?.model); // #10: one key per device
    const dk = `${vendor}/${hwModel}`;
    let dm = cells.get(cellKey);
    if (!dm) { dm = new Map(); cells.set(cellKey, dm); }
    let cell = dm.get(dk);
    if (!cell) { cell = { vendor, hwModel, tts: [], scenarios: new Set() }; dm.set(dk, cell); }
    cell.tts.push(tt);
    if (r.scenario) cell.scenarios.add(String(r.scenario));
  }

  type Pick = { family: string; precision: string; npu: DeviceTtStat; gpu: DeviceTtStat; score: number };
  let best: Pick | null = null;
  for (const [cellKey, dm] of cells) {
    const stats: DeviceTtStat[] = [];
    for (const cell of dm.values()) {
      const s = meanStdev(cell.tts);
      if (s.n >= 1) stats.push({ label: cell.hwModel, type: deviceType(cell.vendor), mean: s.mean, stdev: s.stdev, n: s.n, scenarios: [...cell.scenarios] });
    }
    const npus = stats.filter(s => s.type === 'NPU');
    const gpus = stats.filter(s => s.type === 'GPU');
    if (!npus.length || !gpus.length) continue;
    // Highest-N device of each type = most statistically reliable.
    const npu = npus.reduce((x, y) => (y.n > x.n ? y : x));
    const gpu = gpus.reduce((x, y) => (y.n > x.n ? y : x));
    const score = Math.min(npu.n, gpu.n); // balanced statistical power
    const [family, precision] = cellKey.split('|');
    if (!best || score > best.score) best = { family, precision, npu, gpu, score };
  }
  if (!best) return null;
  const verdict = welchCore(
    best.npu.mean, best.npu.stdev, best.npu.n, best.npu.label,
    best.gpu.mean, best.gpu.stdev, best.gpu.n, best.gpu.label,
  );
  const mixedScenario =
    best.npu.scenarios.length > 1 || best.gpu.scenarios.length > 1;
  return { family: best.family, precision: best.precision, a: best.npu, b: best.gpu, verdict, mixedScenario };
}
