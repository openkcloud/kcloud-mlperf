import { memo } from 'react';

import { Paper } from '@mui/material';
import { BarChart, type BarChartProps } from '@mui/x-charts/BarChart';

// ETRI brand-inspired color palette for charts
const CHART_COLORS = [
  '#4F46E5', // indigo
  '#0EA5E9', // sky
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
];

export const BarGraph = memo((props: BarChartProps) => {
  const { sx, children, series, xAxis, yAxis, dataset, ...rest } = props;

  // Sanitize dataset: replace NaN/undefined/null numeric values with 0
  const sanitizedDataset = dataset?.map(item => {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      sanitized[key] = typeof value === 'number' && !Number.isFinite(value) ? 0 : value;
    }
    return sanitized;
  });

  // Auto-inject colors into series
  const styledSeries = series?.map((s, i) => ({
    ...s,
    color: s.color || CHART_COLORS[i % CHART_COLORS.length],
  }));

  // Ensure xAxis has scaleType: 'band' when using dataKey (required for categorical data)
  const styledXAxis = xAxis?.map(axis => {
    if ('dataKey' in axis && !('scaleType' in axis)) {
      return { scaleType: 'band' as const, ...axis };
    }
    return axis;
  });

  // Ensure yAxis has scaleType: 'band' for horizontal layout
  const styledYAxis = yAxis?.map(axis => {
    if ('dataKey' in axis && !('scaleType' in axis)) {
      return { scaleType: 'band' as const, ...axis };
    }
    return axis;
  });

  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid #E2E8F0',
        borderRadius: '0.75rem',
        p: 2,
        mb: 2.5,
        background: 'linear-gradient(180deg, #FFFFFF 0%, #FAFBFF 100%)',
        width: '100%',
      }}
    >
      <BarChart
        height={400}
        dataset={sanitizedDataset}
        series={styledSeries}
        xAxis={styledXAxis}
        yAxis={styledYAxis}
        borderRadius={6}
        margin={{ left: 80, right: 30, top: 60, bottom: 40 }}
        sx={{
          width: '100%',
          '& .MuiChartsLabel-root.MuiChartsLegend-label': {
            fontSize: '0.875rem',
            fontWeight: 600,
            fill: '#334155',
          },
          '& .MuiChartsAxis-tickLabel': {
            fontSize: '0.75rem',
            fill: '#64748B',
          },
          '& .MuiChartsAxis-label': {
            fontSize: '0.8125rem',
            fontWeight: 500,
            fill: '#475569',
          },
          '& .MuiChartsAxis-line': {
            stroke: '#E2E8F0',
          },
          '& .MuiChartsAxis-tick': {
            stroke: '#CBD5E1',
          },
          ...sx,
        }}
        {...rest}
      >
        {children}
      </BarChart>
    </Paper>
  );
});
