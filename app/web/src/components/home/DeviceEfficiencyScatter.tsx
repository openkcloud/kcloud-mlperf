import { useMemo, useState } from 'react';
import {
  Paper,
  Box,
  Typography,
  Chip,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
} from '@mui/material';
import { ScatterChart } from '@mui/x-charts/ScatterChart';
import { ShowChart as ShowChartIcon } from '@mui/icons-material';

import type { ComparisonRunRow } from '@/api/domains/comparison';
import {
  aggregateByDevice,
  filterCanonicalRuns,
  filterToCurrentCluster,
  markParetoBy,
  normalizeAccuracyPct,
  PARETO_AXES,
  vendorColor,
  type DeviceAgg,
} from './deviceAggregates';

// ----------------------------------------------------------------------
// Speed-vs-Quality / Speed-vs-Cost decision surface (Artificial Analysis / HF
// scatter pattern). X = throughput (tok/s, higher better). Y is selectable
// (R11): MMLU-Pro accuracy (%, higher better) or modeled cost ($/Mtok, lower
// better). Pareto-optimal devices (not beaten on both chosen axes) are
// emphasized so the GPU-vs-NPU efficiency tradeoff is obvious.
// ----------------------------------------------------------------------

type Props = {
  runs: ComparisonRunRow[];
  /** #8: canonical hwModels in the live registry; null/empty = show all. */
  currentModels?: ReadonlySet<string> | null;
};

type YMetric = 'accuracy' | 'cost';

const Y_CONFIG: Record<
  YMetric,
  {
    axis: typeof PARETO_AXES.accuracy;
    label: string; // axis title
    toggle: string; // toggle button text
    better: string; // direction note
    yAxisProps: { min: number; max?: number };
    fmt: (v: number) => string;
  }
> = {
  accuracy: {
    axis: PARETO_AXES.accuracy,
    label: 'MMLU-Pro accuracy (%) →',
    toggle: 'Accuracy (%)',
    better: 'higher is better',
    yAxisProps: { min: 0, max: 100 },
    fmt: v => `${v.toFixed(1)}% acc`,
  },
  cost: {
    axis: PARETO_AXES.cost,
    label: '$ / 1M tokens (modeled) ↓',
    toggle: 'Cost ($/Mtok, lower better)',
    better: 'lower is better',
    yAxisProps: { min: 0 },
    fmt: v => `$${v.toFixed(2)} /Mtok`,
  },
};

export const DeviceEfficiencyScatter = ({ runs, currentModels }: Props) => {
  const mode = useTheme().palette.mode;
  const [yMetric, setYMetric] = useState<YMetric>('accuracy');
  const cfg = Y_CONFIG[yMetric];

  const devices = useMemo(
    () =>
      markParetoBy(
        // #7/#8: canonical-model runs only, scoped to current-cluster hardware.
        filterToCurrentCluster(aggregateByDevice(filterCanonicalRuns(runs)), currentModels),
        PARETO_AXES.tps,
        cfg.axis,
      ),
    [runs, currentModels, cfg.axis],
  );
  // C2 frontend defense: for the accuracy axis, defensively normalize a 0-1
  // fraction to a 0-100 percent before plotting, even though aggregateByDevice
  // already normalizes — the chart must never render a 0.5%-style fraction on an
  // axis labeled "MMLU-Pro accuracy (%)". Cost passes through unchanged.
  const readAxis = (d: DeviceAgg): number | null => {
    const raw = cfg.axis.get(d);
    if (raw == null) return null;
    return yMetric === 'accuracy' ? normalizeAccuracyPct(raw) : raw;
  };

  const plottable = devices.filter(d => d.tps != null && readAxis(d) != null);

  const series = plottable.map((d: DeviceAgg) => {
    const yVal = readAxis(d) as number;
    return {
      label: `${d.hwModel}${d.paretoOptimal ? ' ★' : ''}`,
      data: [{ x: d.tps as number, y: yVal, id: d.key }],
      color: vendorColor(d.vendor, mode),
      markerSize: d.paretoOptimal ? 11 : 7,
      highlightScope: { highlight: 'item' as const },
      valueFormatter: (v: { x: number; y: number } | null) =>
        v ? `${d.label}: ${v.x.toFixed(1)} tok/s · ${cfg.fmt(v.y)}` : '',
    };
  });

  return (
    <Paper sx={{ p: 2.5, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <ShowChartIcon sx={{ color: '#0E7490' }} />
        <Typography variant="h6" fontWeight={700}>
          Efficiency Frontier — Speed vs {yMetric === 'accuracy' ? 'Accuracy' : 'Cost'}
        </Typography>
        <Chip size="small" label="★ Pareto-optimal" sx={{ ml: 1, bgcolor: 'rgba(14,116,144,0.12)', color: '#0E7490', fontWeight: 700 }} />
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={yMetric}
          onChange={(_, val) => { if (val) setYMetric(val as YMetric); }}
          aria-label="Scatter Y axis metric"
        >
          <ToggleButton value="accuracy">{Y_CONFIG.accuracy.toggle}</ToggleButton>
          <ToggleButton value="cost">{Y_CONFIG.cost.toggle}</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        Throughput (x, higher is better) vs {yMetric === 'accuracy' ? 'MMLU-Pro accuracy' : 'modeled $ / 1M tokens'} (y,{' '}
        {cfg.better}) per device. ★ marks devices no other device beats on both axes.
        {yMetric === 'cost' && ' Cost uses MODELED external $/hr assumptions, not measured cluster billing. Values are clamped at $10,000/Mtok so a near-zero-throughput outlier cannot rescale the axis.'}
      </Typography>

      {plottable.length === 0 ? (
        <Alert severity="info">
          {yMetric === 'accuracy'
            ? 'Need at least one device with both a throughput (MLPerf) and an accuracy (MMLU-Pro) result. Run both benchmarks on a device to place it on the frontier.'
            : 'Need at least one device with a throughput (MLPerf) result and a known modeled $/hr rate to place it on the cost frontier.'}
        </Alert>
      ) : (
        <ScatterChart
          height={340}
          aria-label={`Efficiency frontier scatter: throughput (tok/s) versus ${yMetric === 'accuracy' ? 'MMLU-Pro accuracy (%)' : 'modeled cost ($ per 1M tokens)'} per device, with Pareto-optimal devices marked`}
          grid={{ horizontal: true, vertical: true }}
          series={series}
          xAxis={[{ label: 'Throughput (tok/s) →', min: 0 }]}
          yAxis={[{ label: cfg.label, ...cfg.yAxisProps }]}
          slotProps={{ legend: { direction: 'horizontal', position: { vertical: 'bottom', horizontal: 'center' } } }}
          sx={{ '& .MuiChartsAxis-label': { fontWeight: 600 } }}
        />
      )}
    </Paper>
  );
};

export default DeviceEfficiencyScatter;
