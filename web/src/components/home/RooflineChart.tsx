import { useMemo } from 'react';
import { Paper, Box, Typography, Chip, Alert, useTheme } from '@mui/material';
import { Insights as InsightsIcon } from '@mui/icons-material';
import { LineChart } from '@mui/x-charts/LineChart';

import type { ComparisonRunRow } from '@/api/domains/comparison';
import {
  filterCanonicalRuns,
  filterToCurrentCluster,
  normalizeHwModel,
  vendorColor,
  precisionClass,
  type DeviceAgg,
} from './deviceAggregates';
import {
  deviceSpec,
  decodeIntensity,
  ridgePoint,
  memoryRoofTflops,
  achievedTflops,
  memBwCeilingTps,
  effectiveBytesPerWeight,
  type DeviceSpec,
} from '@/constants/device-specs.constants';

// ----------------------------------------------------------------------
// BB-4 — Roofline model: "why decode is memory-bound".
//
// Classic log-log roofline. For every device that has BOTH a verified spec and a
// MEASURED single-stream decode throughput we draw:
//   - its MEMORY roof   P(I) = I * memBW(TB/s)   (sloped line, log-log => 45°)
//   - its COMPUTE roof  P = peak BF16/FP16 TFLOP/s (dashed horizontal line;
//     FP8 peak is ~2× higher but omitted for clarity)
//   - a CEILING marker ON the memory roof at (I, memoryRoofTflops(I)) showing
//     where the device would sit at 100% bandwidth utilization
//   - a MEASURED marker BELOW the ceiling at (I, achievedTflops(ssTps))
//
// C3 (CRITICAL) — the operating point is the BATCH-1 SINGLE-STREAM decode rate,
// derived from the device's TT100T (time to the first 100 output tokens):
//     ssTps = 100 / tt100t_seconds   (≈ tok/s, single stream)
// NOT `agg.tps` (the leaderboard BEST throughput, which is a batched
// OFFLINE/SERVER aggregate). The roofline model assumes batch-1 — weights are
// streamed once per token — so a batched tps necessarily blows past the batch-1
// memory ceiling (>100% BW), which is physically impossible.
//
// The earlier single-stream fix was INCOMPLETE: points still exceeded the
// ceiling (A30 115% BW, Atom+ 495% BW). The four root causes, all fixed here:
//   (a) operating-point precision was decoupled from the best-TT run — a separate
//       per-model precision map (set by a DIFFERENT run) drove the ceiling. NOW
//       the operating point carries the precision + measurement context of the
//       SAME run that supplied its best (lowest) TT100T (see `pickOperatingPoint`).
//   (b) an A30 fp8 run on Ampere (which has NO FP8 path) measured an fp8 op-point
//       against an fp8 ceiling. NOW `effectiveBytesPerWeight` reconciles the run's
//       precision against device capability — Ampere falls back to the bf16/fp16
//       ceiling (2 bytes/weight).
//   (c) CLIENT_WALL_CLOCK offline runs were treated as single-stream. NOW only
//       runs whose `latency_measurement_context` is a genuine single-stream decode
//       (SERVER_TOKEN_STREAM) are admitted; offline/CLIENT_WALL_CLOCK and UNKNOWN
//       are excluded, falling back to the next qualifying run, or the point drops.
//   (d) utilPct was rendered with NO clamp, so raw >100% reached the legend. NOW
//       the filled operating point is NEVER drawn above its hollow ceiling: it is
//       clamped to the roof and annotated "above modeled BW — check measurement".
//
// Decode sits ~100× to the LEFT of every device's ridge point (memory roof meets
// compute roof), firmly in the memory-bound regime. The device with the most
// memory bandwidth (RNGD, 1.5 TB/s HBM3) leads because bandwidth determines the
// ceiling, not peak TFLOP/s.
//
// #7/#8: only canonical-model (Llama-3.1-8B-Instruct) runs on current-cluster
// hardware are placed, so off-cluster L40/A40 and non-canonical models drop out.
// ----------------------------------------------------------------------

type Props = {
  runs: ComparisonRunRow[];
  /** #8: canonical hwModels in the live registry; null/empty = show all. */
  currentModels?: ReadonlySet<string> | null;
};

// Shared intensity sample points for drawing the roofs (log scale, 0.25 .. 1024).
const ROOF_X = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

// C3(c): single-stream decode is measured server-side off the token stream.
// CLIENT_WALL_CLOCK is an offline/batched wall-clock measurement and is NOT a
// batch-1 decode rate; UNKNOWN is unannotated legacy data. Only SERVER_TOKEN_STREAM
// is admitted as a genuine single-stream operating point for roofline placement.
const SINGLE_STREAM_CONTEXT = 'SERVER_TOKEN_STREAM';

type PlacedDevice = {
  agg: DeviceAgg;
  spec: DeviceSpec;
  intensity: number;    // decode arithmetic intensity for the device's EFFECTIVE precision
  ssTps: number;        // C3: batch-1 single-stream decode rate = 100 / tt100t
  achieved: number;     // achieved TFLOP/s from the single-stream decode rate
  roofAtI: number;      // memory-roof TFLOP/s at this intensity (the ceiling point)
  ceilTps: number;      // tok/s at 100% bandwidth for the effective precision
  utilPct: number;      // bandwidth utilization % = achieved / roofAtI * 100 (RAW, unclamped)
  utilPctClamped: number; // C3(d): never exceeds 100 — what we actually plot/annotate
  plottedAchieved: number; // achieved TFLOP/s after clamping the point to the roof
  exceedsCeiling: boolean; // raw utilPct > 100 → measurement/precision anomaly
  precisionLabel: string;  // M6: precision actually plotted (after reconciliation)
  reconciledFromFp8: boolean; // device has no FP8 path → ceiling forced to bf16/fp16
  bestRunId: number | null; // the run that supplied this operating point
  ridge: number;        // ridge-point intensity
  color: string;
};

// The roofline only consumes a few fields off a run; `latency_measurement_context`
// is emitted by the backend at the top level of every NormalizedRun but is not yet
// in the shared `ComparisonRunRow` frontend type (owned elsewhere). Read it through
// this narrow accessor type rather than widening the shared contract here.
type RunWithContext = ComparisonRunRow & { latency_measurement_context?: string | null };

/**
 * C3: batch-1 single-stream decode rate (≈ tok/s) implied by TT100T (the
 * wall-clock time to the first 100 output tokens): 100 tokens / tt100t seconds.
 * Returns null when TT100T is missing or non-positive.
 */
export function singleStreamTps(tt100tSeconds: number | null | undefined): number | null {
  if (tt100tSeconds == null || !Number.isFinite(tt100tSeconds) || tt100tSeconds <= 0) return null;
  return 100 / tt100tSeconds;
}

/**
 * C3(c): a run qualifies as a single-stream decode for roofline placement only
 * when its measurement context is SERVER_TOKEN_STREAM. CLIENT_WALL_CLOCK (offline,
 * batched wall-clock) and UNKNOWN (unannotated) are excluded.
 */
export function isSingleStreamContext(ctx: string | null | undefined): boolean {
  return (ctx ?? '').toUpperCase() === SINGLE_STREAM_CONTEXT;
}

/** Per-device operating point chosen from a SINGLE run (carries its precision + context). */
export type OperatingPoint = {
  vendor: string;
  hwModel: string;
  runId: number | null;
  tt100t: number;
  precisionClass: string; // precision of THIS run (pre-reconciliation)
};

/**
 * C3(a): for each (vendor / canonical hwModel) device, pick the operating point
 * from the SINGLE run that supplies the best (lowest) TT100T among runs that are
 * genuine single-stream decodes (SERVER_TOKEN_STREAM). The chosen run's precision
 * is carried alongside its TT100T so the ceiling is computed from the SAME run —
 * never decoupled via a separate per-model precision map. Runs whose context is
 * not single-stream are skipped (C3(c)); a device with no qualifying run is
 * dropped from the roofline rather than placed on offline/batched data.
 */
export function pickOperatingPoints(runs: ComparisonRunRow[]): Map<string, OperatingPoint> {
  const byKey = new Map<string, OperatingPoint>();
  for (const r of runs as RunWithContext[]) {
    const tt = r.metrics?.tt100t_seconds;
    if (tt == null || !Number.isFinite(tt) || tt <= 0) continue;
    // C3(c): only genuine single-stream decodes are eligible.
    if (!isSingleStreamContext(r.latency_measurement_context)) continue;
    const vendor = r.hardware?.vendor ?? 'unknown';
    const hwModel = normalizeHwModel(r.hardware?.model);
    const key = `${vendor}/${hwModel}`;
    const prev = byKey.get(key);
    if (!prev || tt < prev.tt100t) {
      byKey.set(key, {
        vendor,
        hwModel,
        runId: r.id ?? null,
        tt100t: tt,
        // C3(a): precision is read off THIS run (the one supplying best TT100T).
        precisionClass: precisionClass(r.precision, r.model),
      });
    }
  }
  return byKey;
}

export const RooflineChart = ({ runs, currentModels }: Props) => {
  const mode = useTheme().palette.mode;

  const placed = useMemo<PlacedDevice[]>(() => {
    // #7: canonical-model runs only (drop Qwen-0.5B etc.).
    const canonicalRuns = filterCanonicalRuns(runs);
    // C3(a)+(c): per-device operating point from the SAME single run that has the
    // best single-stream TT100T (carries that run's precision + measurement context).
    const opPoints = pickOperatingPoints(canonicalRuns);

    const out: PlacedDevice[] = [];
    for (const [key, op] of opPoints) {
      const spec = deviceSpec(op.hwModel);
      if (!spec) continue;
      const ssTps = singleStreamTps(op.tt100t);
      if (ssTps == null) continue;

      // C3(b): reconcile the run's precision against the DEVICE's FP8 capability.
      // Ampere (A30/A40, fp8Tflops === null) has no FP8 path, so an fp8-tagged run
      // is physically streamed at bf16/fp16 → the ceiling uses 2 bytes/weight.
      const { bytesPerWeight, reconciledFromFp8 } = effectiveBytesPerWeight(
        spec,
        op.precisionClass,
      );
      const intensity = decodeIntensity(bytesPerWeight);
      const achieved = achievedTflops(ssTps);
      const roofAtI = memoryRoofTflops(intensity, spec.memBwGBs);
      const ceilTps = memBwCeilingTps(spec.memBwGBs, bytesPerWeight);

      // Raw (auditable) utilization, then C3(d): clamp so a filled point is NEVER
      // drawn above its hollow ceiling. A raw >100% reading is a measurement /
      // precision-context anomaly, surfaced via the annotation, not rendered raw.
      const utilPct = roofAtI > 0 && Number.isFinite(achieved) ? (achieved / roofAtI) * 100 : 0;
      const exceedsCeiling = utilPct > 100;
      const utilPctClamped = Math.min(100, Math.max(0, utilPct));
      const plottedAchieved = exceedsCeiling ? roofAtI : achieved;

      // M6: the precision label reflects the precision actually PLOTTED — i.e. the
      // effective bytes-per-weight after device reconciliation, not the raw tag.
      const precisionLabel = bytesPerWeight === 1 ? 'fp8' : 'bf16/fp16';

      out.push({
        agg: synthAgg(key, op),
        spec,
        intensity,
        ssTps,
        achieved,
        roofAtI,
        ceilTps,
        utilPct,
        utilPctClamped,
        plottedAchieved,
        exceedsCeiling,
        precisionLabel,
        reconciledFromFp8,
        bestRunId: op.runId,
        ridge: ridgePoint(spec.fp16Tflops, spec.memBwGBs),
        color: vendorColor(op.vendor, mode),
      });
    }

    // #8: scope to current-cluster hardware (off-cluster L40/A40 drop out). We
    // filter on the synthesized aggregates (hwModel/vendor) so the existing
    // registry semantics are preserved.
    const scoped = filterToCurrentCluster(out.map(p => p.agg), currentModels);
    const allowed = new Set(scoped.map(a => a.key));
    return out
      .filter(p => allowed.has(p.agg.key))
      .sort((a, b) => b.spec.memBwGBs - a.spec.memBwGBs);
  }, [runs, currentModels, mode]);

  const hasAtomPlus = placed.some(d => d.spec.confidence === 'partial');
  const hasExceeding = placed.some(d => d.exceedsCeiling);
  const hasReconciled = placed.some(d => d.reconciledFromFp8);

  const series = useMemo(() => {
    const out: Array<Record<string, unknown>> = [];
    for (const d of placed) {
      const memBwTBs = d.spec.memBwGBs / 1000;
      const peakBwLabel = `${memBwTBs.toFixed(2)} TB/s`;
      // Memory roof (sloped), clamped at the compute ceiling.
      out.push({
        label: `${d.agg.hwModel} mem roof (${peakBwLabel})`,
        data: ROOF_X.map(x =>
          Math.min(memoryRoofTflops(x, d.spec.memBwGBs), d.spec.fp16Tflops),
        ),
        color: d.color,
        showMark: false,
        curve: 'linear' as const,
        valueFormatter: (v: number | null) => (v == null ? '' : `${v.toFixed(3)} TFLOP/s`),
      });
      // Compute roof (dashed horizontal at BF16/FP16 peak).
      out.push({
        label: `${d.agg.hwModel} compute roof (${d.spec.fp16Tflops} TFLOP/s${d.spec.confidence === 'partial' ? '*' : ''})`,
        data: ROOF_X.map(() => d.spec.fp16Tflops),
        color: d.color,
        showMark: false,
        curve: 'linear' as const,
        valueFormatter: (v: number | null) =>
          v == null ? '' : `${v.toFixed(0)} TFLOP/s peak BF16/FP16 (FP8 peak ~2×)`,
      });
      // Bandwidth ceiling marker — ON the memory roof (hollow circle). The peak
      // BW is surfaced in the tooltip so the ceiling is auditable (S4).
      out.push({
        label: `${d.agg.hwModel} BW ceiling (${d.ceilTps.toFixed(0)} tok/s @ 100% ${d.precisionLabel})`,
        data: ROOF_X.map(x => (x === d.intensity ? d.roofAtI : null)),
        color: d.color,
        showMark: true,
        connectNulls: false,
        curve: 'linear' as const,
        valueFormatter: (v: number | null) =>
          v == null
            ? ''
            : `${d.agg.hwModel} ceiling: ${d.ceilTps.toFixed(0)} tok/s → ${v.toFixed(3)} TFLOP/s (100% BW · peak ${peakBwLabel} · ${d.precisionLabel})`,
      });
      // C3: single-stream (batch-1) operating point — BELOW the ceiling. Derived
      // from TT100T of the SAME single-stream run; clamped to the roof so it is
      // never drawn above its own hollow ceiling (C3(d)). The legend reports the
      // clamped utilization and flags any point that exceeded the modeled BW.
      const exceedNote = d.exceedsCeiling ? ' — above modeled BW, check measurement' : '';
      out.push({
        label: `${d.agg.hwModel} single-stream: ${d.ssTps.toFixed(0)} tok/s (${d.utilPctClamped.toFixed(0)}% BW${d.exceedsCeiling ? ', clamped' : ''})`,
        data: ROOF_X.map(x => (x === d.intensity ? d.plottedAchieved : null)),
        color: d.color,
        showMark: true,
        connectNulls: false,
        curve: 'linear' as const,
        valueFormatter: (v: number | null) =>
          v == null
            ? ''
            : `${d.agg.hwModel}: ${d.ssTps.toFixed(0)} tok/s single-stream (TT100T-derived, ${d.precisionLabel}) → ${d.utilPctClamped.toFixed(0)}% of BW ceiling (peak ${peakBwLabel})${exceedNote}`,
      });
    }
    return out;
  }, [placed]);

  return (
    <Paper sx={{ p: 2.5, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <InsightsIcon sx={{ color: '#0E7490' }} />
        <Typography variant="h6" fontWeight={700}>
          Roofline — why decode is memory-bound
        </Typography>
        <Chip
          size="small"
          label="single-stream · batch-1 · 8B dense"
          sx={{ ml: 1, bgcolor: 'rgba(14,116,144,0.12)', color: '#0E7490', fontWeight: 700 }}
        />
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        Log-log roofline (Llama-3.1-8B, dense). Per output token:{' '}
        <b>FLOPs = 2·N = 16 GFLOP</b>,{' '}
        <b>bytes = N·bytes/weight</b> (all weights streamed from HBM), so decode arithmetic
        intensity is only ~1.0 FLOP/byte (FP16) / ~2.0 (FP8) — far left of every device's ridge
        point (~125–215). Each device's <b>operating point</b> is its{' '}
        <b>single-stream (batch-1) decode rate derived from TT100T</b> (100 tok ÷ TT100T s) on a{' '}
        <b>server-side token-stream run</b>, which sits <b>below its memory-bandwidth ceiling</b>{' '}
        (the hollow marker on the memory roof), ~100× to the left of the ridge and far below the{' '}
        <b>compute roof</b> — batch-1 decode is bandwidth-bound, so{' '}
        <b>memory bandwidth wins</b> (RNGD 1.5 TB/s HBM3 leads), not peak TFLOP/s.
      </Typography>

      {placed.length === 0 ? (
        <Alert severity="info">
          Need at least one device with a verified hardware spec and a single-stream
          (server-token-stream) TT100T measurement to draw the roofline. Offline / batched
          (client-wall-clock) runs are excluded because they are not batch-1 decode rates.
          Run an MLPerf benchmark that captures server-side latency to place a device.
        </Alert>
      ) : (
        <>
          {hasExceeding && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              One or more operating points exceeded their modeled bandwidth ceiling and were
              clamped to the roof. A &gt;100% reading means the measurement is not a true batch-1
              single-stream decode or the precision/measurement context is mismatched — treat the
              clamped point as suspect and re-measure (see the legend &quot;clamped&quot; tag).
            </Alert>
          )}
          <LineChart
            height={380}
            aria-label="Roofline model: arithmetic intensity vs performance (TFLOP/s) per device, with memory and compute roofs and the single-stream batch-1 decode operating point"
            series={series as never}
            grid={{ horizontal: true, vertical: true }}
            xAxis={[
              {
                scaleType: 'log',
                data: ROOF_X,
                label: 'Arithmetic intensity I (FLOP/byte) →',
                min: 0.25,
                max: 1024,
                valueFormatter: (v: number) => `${v}`,
              },
            ]}
            yAxis={[{ scaleType: 'log', label: 'Performance (TFLOP/s) →', min: 0.001, max: 1024 }]}
            slotProps={{
              legend: {
                direction: 'horizontal',
                position: { vertical: 'bottom', horizontal: 'center' },
              },
            }}
            sx={{ '& .MuiChartsAxis-label': { fontWeight: 600 } }}
          />
          <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 1 }}>
            Assumptions: 8B dense weights, 2·N FLOP/token, weights-streamed bytes/token, batch-1
            (no KV-cache reuse across the batch). Compute roofs use dense BF16/FP16 datasheet peaks;
            FP8 peak is ~2× higher but omitted here for clarity. Hollow markers = 100% bandwidth
            utilization ceiling (on the memory roof, computed at each device&apos;s effective
            precision); filled markers = the single-stream (batch-1) decode rate derived from TT100T
            (100 tok ÷ TT100T s), which sits below the ceiling. Peak HBM bandwidth per device is
            shown in each marker&apos;s tooltip.
            {hasReconciled &&
              ' Ampere parts (A30/A40) have no FP8 path, so an fp8-tagged run is placed against the BF16/FP16 ceiling it actually streams at.'}
            {hasAtomPlus &&
              ' * Atom+ BF16/FP16 peak is an unverified estimate (Rebellions does not publish it).'}
          </Typography>
        </>
      )}
    </Paper>
  );
};

/**
 * Build the minimal DeviceAgg the roofline needs from an operating point + spec.
 * We do NOT depend on `aggregateByDevice` internals (that module is evolving in
 * parallel): the roofline only needs key/vendor/hwModel/label and the chosen
 * run id, all carried from the SAME single-stream run that set the operating point.
 */
function synthAgg(key: string, op: OperatingPoint): DeviceAgg {
  return {
    key,
    vendor: op.vendor,
    hwModel: op.hwModel,
    label: `${op.vendor} / ${op.hwModel}`,
    tps: null,
    tt100t: op.tt100t,
    accuracy: null,
    model: null,
    bestRunId: op.runId,
    efficiency: null,
    costPerMTok: null,
    tt100tStdev: null,
    tt100tSamples: null,
    tpsStdev: null,
    paretoOptimal: false,
  };
}

export default RooflineChart;
