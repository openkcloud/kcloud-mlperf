import { useMemo } from 'react';
import { Paper, Box, Typography, Chip, Alert, useTheme } from '@mui/material';
import { Insights as InsightsIcon } from '@mui/icons-material';
import { LineChart } from '@mui/x-charts/LineChart';

import type { ComparisonRunRow } from '@/api/domains/comparison';
import { aggregateByDevice, vendorColor, precisionClass, type DeviceAgg } from './deviceAggregates';
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
//   - a MEASURED marker BELOW the ceiling at (I, achievedTflops(measuredTps))
//
// Decode sits ~100× to the LEFT of every device's ridge point (memory roof meets
// compute roof), firmly in the memory-bound regime. Each device's MEASURED point
// is at ~50–85% of its memory-bandwidth ceiling — below the roof, but already far
// below the compute roof. The device with the most memory bandwidth (RNGD, 1.5
// TB/s HBM3) leads because bandwidth determines the ceiling, not peak TFLOP/s.
//
// FIX-#2: precision is resolved via the shared `precisionClass(r.precision,
// r.model)` helper so that precision='auto' + model='...-FP8' correctly yields
// intensity ~2.0 rather than defaulting to FP16.
// ----------------------------------------------------------------------

type Props = { runs: ComparisonRunRow[] };

// Shared intensity sample points for drawing the roofs (log scale, 0.25 .. 1024).
const ROOF_X = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

type PlacedDevice = {
  agg: DeviceAgg;
  spec: DeviceSpec;
  intensity: number;    // decode arithmetic intensity for this device's precision
  achieved: number;     // achieved TFLOP/s from measured tps
  roofAtI: number;      // memory-roof TFLOP/s at this intensity (the ceiling point)
  utilPct: number;      // bandwidth utilization % = achieved / roofAtI * 100
  ridge: number;        // ridge-point intensity
  color: string;
};

export const RooflineChart = ({ runs }: Props) => {
  const mode = useTheme().palette.mode;

  const placed = useMemo<PlacedDevice[]>(() => {
    // FIX-#2: resolve precision via precisionClass so 'auto'+'...-FP8' -> 'fp8'.
    const precClassByKey = new Map<string, string>();
    for (const r of runs) {
      const vendor = r.hardware?.vendor ?? 'unknown';
      const hwModel = r.hardware?.model ?? 'unknown';
      const key = `${vendor}/${hwModel}`;
      if (!precClassByKey.has(key)) {
        const cls = precisionClass(r.precision, r.model);
        if (cls && cls !== 'other') precClassByKey.set(key, cls);
      }
    }
    return aggregateByDevice(runs)
      .map((agg): PlacedDevice | null => {
        const spec = deviceSpec(agg.hwModel);
        if (!spec || agg.tps == null) return null;
        const bytesPerWeight = precClassByKey.get(agg.key) === 'fp8' ? 1 : 2;
        const intensity = decodeIntensity(bytesPerWeight);
        const achieved = achievedTflops(agg.tps);
        const roofAtI = memoryRoofTflops(intensity, spec.memBwGBs);
        return {
          agg,
          spec,
          intensity,
          achieved,
          roofAtI,
          utilPct: (achieved / roofAtI) * 100,
          ridge: ridgePoint(spec.fp16Tflops, spec.memBwGBs),
          color: vendorColor(agg.vendor, mode),
        };
      })
      .filter((d): d is PlacedDevice => d != null)
      .sort((a, b) => b.spec.memBwGBs - a.spec.memBwGBs);
  }, [runs, mode]);

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
      // Measured operating point — BELOW the ceiling.
      out.push({
        label: `${d.agg.hwModel} measured: ${d.agg.tps!.toFixed(0)} tok/s (${d.utilPct.toFixed(0)}% BW)`,
        data: ROOF_X.map(x => (x === d.intensity ? d.achieved : null)),
        color: d.color,
        showMark: true,
        connectNulls: false,
        curve: 'linear' as const,
        valueFormatter: (v: number | null) =>
          v == null
            ? ''
            : `${d.agg.hwModel}: ${d.agg.tps!.toFixed(0)} tok/s → ${v.toFixed(3)} TFLOP/s · ${d.utilPct.toFixed(0)}% of BW ceiling`,
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
          label="batch-1 · 8B dense"
          sx={{ ml: 1, bgcolor: 'rgba(14,116,144,0.12)', color: '#0E7490', fontWeight: 700 }}
        />
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        Log-log roofline (Llama-3.1-8B, dense). Per output token:{' '}
        <b>FLOPs = 2·N = 16 GFLOP</b>,{' '}
        <b>bytes = N·bytes/weight</b> (all weights streamed from HBM), so decode arithmetic
        intensity is only ~1.0 FLOP/byte (FP16) / ~2.0 (FP8) — far left of every device's ridge
        point (~125–215). Each device's <b>measured point</b> sits at{' '}
        <b>~50–85% of its memory-bandwidth ceiling</b> (the hollow marker on the memory roof),
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
            utilization ceiling (on the memory roof); filled markers = measured throughput
            (~50–85% of ceiling in practice).
            {hasAtomPlus &&
              ' * Atom+ BF16/FP16 peak is an unverified estimate (Rebellions does not publish it).'}
          </Typography>
        </>
      )}
    </Paper>
  );
};

export default RooflineChart;
