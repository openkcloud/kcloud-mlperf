import { useMemo } from 'react';
import { Paper, Box, Typography, Chip, Alert, useTheme } from '@mui/material';
import { Insights as InsightsIcon } from '@mui/icons-material';
import { LineChart } from '@mui/x-charts/LineChart';

import type { ComparisonRunRow } from '@/api/domains/comparison';
import {
  aggregateByDevice,
  filterCanonicalRuns,
  filterToCurrentCluster,
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
  type DeviceSpec,
} from '@/constants/device-specs.constants';

// ----------------------------------------------------------------------
// BB-4 — Roofline model: "why decode is memory-bound".
//
// Classic log-log roofline. For every device that has BOTH a verified spec and a
// MEASURED decode throughput we draw:
//   - its MEMORY roof   P(I) = I * memBW(TB/s)   (sloped line, log-log => 45°)
//   - its COMPUTE roof  P = peak BF16/FP16 TFLOP/s (dashed horizontal line;
//     FP8 peak is ~2× higher but omitted for clarity)
//   - a CEILING marker ON the memory roof at (I, memoryRoofTflops(I)) showing
//     where the device would sit at 100% bandwidth utilization
//   - a MEASURED marker BELOW the ceiling at (I, achievedTflops(ssTps))
//
// #1 (CRITICAL): the operating point is the BATCH-1 SINGLE-STREAM decode rate,
// derived from the device's TT100T (time to the first 100 output tokens):
//     ssTps = 100 / tt100t_seconds   (≈ tok/s, single stream)
// NOT `agg.tps` (the leaderboard BEST throughput, which is a batched
// OFFLINE/SERVER aggregate). The roofline model assumes batch-1 — weights are
// streamed once per token — so a batched tps necessarily blows past the batch-1
// memory ceiling (>100% BW), which is physically impossible and was the original
// defect. Driving achieved/utilization from ssTps puts every point UNDER its
// bandwidth ceiling (e.g. A30 100/2.36 ≈ 42 tok/s vs ~58 tok/s ceiling ≈ 72%).
//
// Decode sits ~100× to the LEFT of every device's ridge point (memory roof meets
// compute roof), firmly in the memory-bound regime. The device with the most
// memory bandwidth (RNGD, 1.5 TB/s HBM3) leads because bandwidth determines the
// ceiling, not peak TFLOP/s.
//
// FIX-#2: precision is resolved via the shared `precisionClass(r.precision,
// r.model)` helper so that precision='auto' + model='...-FP8' correctly yields
// intensity ~2.0 rather than defaulting to FP16.
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

type PlacedDevice = {
  agg: DeviceAgg;
  spec: DeviceSpec;
  intensity: number;    // decode arithmetic intensity for this device's precision
  ssTps: number;        // #1: batch-1 single-stream decode rate = 100 / tt100t
  achieved: number;     // achieved TFLOP/s from the single-stream decode rate
  roofAtI: number;      // memory-roof TFLOP/s at this intensity (the ceiling point)
  utilPct: number;      // bandwidth utilization % = achieved / roofAtI * 100
  ridge: number;        // ridge-point intensity
  color: string;
};

/**
 * #1: batch-1 single-stream decode rate (≈ tok/s) implied by TT100T (the
 * wall-clock time to the first 100 output tokens): 100 tokens / tt100t seconds.
 * Returns null when TT100T is missing or non-positive.
 */
export function singleStreamTps(tt100tSeconds: number | null | undefined): number | null {
  if (tt100tSeconds == null || !Number.isFinite(tt100tSeconds) || tt100tSeconds <= 0) return null;
  return 100 / tt100tSeconds;
}

export const RooflineChart = ({ runs, currentModels }: Props) => {
  const mode = useTheme().palette.mode;

  const placed = useMemo<PlacedDevice[]>(() => {
    // #7: canonical-model runs only (drop Qwen-0.5B etc.).
    const canonicalRuns = filterCanonicalRuns(runs);
    // FIX-#2: resolve precision via precisionClass so 'auto'+'...-FP8' -> 'fp8'.
    // Keyed by canonical hwModel so it matches the aggregate keys below.
    const precClassByModel = new Map<string, string>();
    for (const r of canonicalRuns) {
      const cls = precisionClass(r.precision, r.model);
      if (cls && cls !== 'other') {
        const spec = deviceSpec(r.hardware?.model);
        const hw = spec?.hwModel ?? r.hardware?.model ?? 'unknown';
        if (!precClassByModel.has(hw)) precClassByModel.set(hw, cls);
      }
    }
    // #8: scope to current-cluster hardware (off-cluster L40/A40 drop out).
    return filterToCurrentCluster(aggregateByDevice(canonicalRuns), currentModels)
      .map((agg): PlacedDevice | null => {
        const spec = deviceSpec(agg.hwModel);
        // #1: drive the operating point from the single-stream decode rate
        // (batch-1, from TT100T), NOT the batched leaderboard best `agg.tps`.
        const ssTps = singleStreamTps(agg.tt100t);
        if (!spec || ssTps == null) return null;
        const bytesPerWeight = precClassByModel.get(spec.hwModel) === 'fp8' ? 1 : 2;
        const intensity = decodeIntensity(bytesPerWeight);
        const achieved = achievedTflops(ssTps);
        const roofAtI = memoryRoofTflops(intensity, spec.memBwGBs);
        return {
          agg,
          spec,
          intensity,
          ssTps,
          achieved,
          roofAtI,
          // #2: never render Infinity/NaN — guard the denominator and numerator.
          utilPct: roofAtI > 0 && Number.isFinite(achieved) ? (achieved / roofAtI) * 100 : 0,
          ridge: ridgePoint(spec.fp16Tflops, spec.memBwGBs),
          color: vendorColor(agg.vendor, mode),
        };
      })
      .filter((d): d is PlacedDevice => d != null)
      .sort((a, b) => b.spec.memBwGBs - a.spec.memBwGBs);
  }, [runs, currentModels, mode]);

  const hasAtomPlus = placed.some(d => d.spec.confidence === 'partial');

  const series = useMemo(() => {
    const out: Array<Record<string, unknown>> = [];
    for (const d of placed) {
      const memBwTBs = d.spec.memBwGBs / 1000;
      // Memory roof (sloped), clamped at the compute ceiling.
      out.push({
        label: `${d.agg.hwModel} mem roof (${memBwTBs.toFixed(2)} TB/s)`,
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
        // Dashed line so compute roof is visually distinct from the sloped memory roof.
        // x-charts passes unknown style props through to the SVG path via `sx`-like props.
        valueFormatter: (v: number | null) =>
          v == null ? '' : `${v.toFixed(0)} TFLOP/s peak BF16/FP16 (FP8 peak ~2×)`,
      });
      // Bandwidth ceiling marker — ON the memory roof (hollow circle).
      const ceilTps = memBwCeilingTps(d.spec.memBwGBs, d.intensity === 2.0 ? 1 : 2);
      out.push({
        label: `${d.agg.hwModel} BW ceiling (${ceilTps.toFixed(0)} tok/s @ 100%)`,
        data: ROOF_X.map(x => (x === d.intensity ? d.roofAtI : null)),
        color: d.color,
        showMark: true,
        connectNulls: false,
        curve: 'linear' as const,
        valueFormatter: (v: number | null) =>
          v == null
            ? ''
            : `${d.agg.hwModel} ceiling: ${ceilTps.toFixed(0)} tok/s → ${v.toFixed(3)} TFLOP/s (100% BW)`,
      });
      // #1: single-stream (batch-1) operating point — BELOW the ceiling. The
      // rate is derived from TT100T (100 tok / tt100t s), NOT the batched
      // leaderboard `agg.tps`, so it sits under the batch-1 memory ceiling.
      out.push({
        label: `${d.agg.hwModel} single-stream: ${d.ssTps.toFixed(0)} tok/s (${d.utilPct.toFixed(0)}% BW)`,
        data: ROOF_X.map(x => (x === d.intensity ? d.achieved : null)),
        color: d.color,
        showMark: true,
        connectNulls: false,
        curve: 'linear' as const,
        valueFormatter: (v: number | null) =>
          v == null
            ? ''
            : `${d.agg.hwModel}: ${d.ssTps.toFixed(0)} tok/s single-stream (TT100T-derived) → ${v.toFixed(3)} TFLOP/s · ${d.utilPct.toFixed(0)}% of BW ceiling`,
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
        <b>single-stream (batch-1) decode rate derived from TT100T</b> (100 tok ÷ TT100T s), which
        sits <b>below its memory-bandwidth ceiling</b> (the hollow marker on the memory roof),
        ~100× to the left of the ridge and far below the{' '}
        <b>compute roof</b> — batch-1 decode is bandwidth-bound, so{' '}
        <b>memory bandwidth wins</b> (RNGD 1.5 TB/s HBM3 leads), not peak TFLOP/s.
      </Typography>

      {placed.length === 0 ? (
        <Alert severity="info">
          Need at least one device with both a verified hardware spec and a measured throughput
          (MLPerf tok/s) to draw the roofline. Run an MLPerf benchmark to place a device.
        </Alert>
      ) : (
        <>
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
            utilization ceiling (on the memory roof); filled markers = the single-stream (batch-1)
            decode rate derived from TT100T (100 tok ÷ TT100T s), which sits below the ceiling.
            {hasAtomPlus &&
              ' * Atom+ BF16/FP16 peak is an unverified estimate (Rebellions does not publish it).'}
          </Typography>
        </>
      )}
    </Paper>
  );
};

export default RooflineChart;
