import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Fingerprint as FingerprintIcon } from '@mui/icons-material';

import type { ComparisonRunRow } from '@/api/domains/comparison';
import { Tt100tBadge } from '@/components/Tt100tBadge';

// ----------------------------------------------------------------------

const INCOMPATIBLE_REASONS: Record<string, string> = {
  different_model: 'Different model — runs must use the same model to be comparable',
  different_max_tokens: 'Different max_tokens setting',
  different_dataset: 'Different dataset',
  different_mode: 'Different benchmark mode (accuracy vs performance)',
  different_precision: 'Different precision (e.g. fp16 vs fp8)',
  run_failed: 'One or both runs failed — only completed runs can be compared',
  missing_metric: 'Required metrics are missing from one or both runs',
};

function fmtNum(v: number | null | undefined, decimals = 3): string {
  return v == null ? '—' : v.toFixed(decimals);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function metricDelta(a: number | null, b: number | null): { text: string; positive: boolean | null } {
  if (a == null || b == null) return { text: '—', positive: null };
  const diff = b - a;
  const pct = a !== 0 ? (diff / Math.abs(a)) * 100 : null;
  const sign = diff >= 0 ? '+' : '';
  const pctStr = pct != null ? ` (${sign}${pct.toFixed(1)}%)` : '';
  return {
    text: `${sign}${diff.toFixed(3)}${pctStr}`,
    positive: diff > 0,
  };
}

// ----------------------------------------------------------------------

type RunHeaderProps = {
  label: string;
  run: ComparisonRunRow;
  accentColor: string;
};

const RunHeader = ({ label, run, accentColor }: RunHeaderProps) => (
  <Paper
    variant="outlined"
    sx={{ flex: 1, p: 2, borderTop: `3px solid ${accentColor}`, minWidth: 0 }}
  >
    <Typography variant="subtitle2" fontWeight={700} gutterBottom noWrap>
      {label}: {run.name}
    </Typography>
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
      <Chip label={run.hardware.model} size="small" variant="outlined" />
      <Chip label={run.benchmark.toUpperCase()} size="small" variant="outlined" />
      <Chip
        label={run.status}
        size="small"
        sx={{
          fontWeight: 700,
          bgcolor:
            run.status === 'completed'
              ? 'rgba(22,163,74,0.12)'
              : run.status === 'failed'
              ? 'rgba(220,38,38,0.12)'
              : 'rgba(148,163,184,0.12)',
          color:
            run.status === 'completed'
              ? '#15803D'
              : run.status === 'failed'
              ? '#B91C1C'
              : '#475569',
        }}
      />
      <Tt100tBadge value={run.metrics.tt100t_seconds} size="small" />
    </Stack>
    <Typography variant="caption" color="text.secondary" display="block">
      Started: {fmtDate(run.started_at)}
    </Typography>
    <Typography variant="caption" color="text.secondary" display="block">
      Completed: {fmtDate(run.completed_at)}
    </Typography>
    {run.drift_flag && run.drift_fields && run.drift_fields.length > 0 && (
      <Tooltip title={`Config drift: ${run.drift_fields.join(', ')}`} arrow>
        <Chip
          size="small"
          label="config drift"
          sx={{
            mt: 0.75,
            fontSize: '0.6875rem',
            fontWeight: 700,
            bgcolor: 'rgba(249,115,22,0.12)',
            color: '#C2410C',
            border: '1px solid rgba(249,115,22,0.3)',
            cursor: 'default',
          }}
        />
      </Tooltip>
    )}
    {run.artifacts?.length > 0 && (
      <Tooltip
        title={
          <Box>
            <Typography variant="caption" fontWeight={700} display="block" mb={0.5}>
              Artifacts
            </Typography>
            {run.artifacts.map((a) => (
              <Typography key={a} variant="caption" display="block" fontFamily="monospace">
                {a}
              </Typography>
            ))}
          </Box>
        }
        arrow
      >
        <Chip
          icon={<FingerprintIcon sx={{ fontSize: '0.875rem !important' }} />}
          size="small"
          label={`${run.artifacts.length} artifact${run.artifacts.length !== 1 ? 's' : ''}`}
          sx={{ mt: 0.75, fontSize: '0.6875rem', cursor: 'default' }}
          variant="outlined"
        />
      </Tooltip>
    )}
  </Paper>
);

// ----------------------------------------------------------------------

export type ComparisonDetailDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  runA: ComparisonRunRow | null;
  runB: ComparisonRunRow | null;
  metrics: Record<string, { a: number | null; b: number | null }> | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Incompatibility reason key or freeform string — blocks dialog content if set */
  incompatibleReason?: string | null;
  accentA?: string;
  accentB?: string;
  labelA?: string;
  labelB?: string;
};

export const ComparisonDetailDialog = ({
  open,
  onClose,
  title,
  runA,
  runB,
  metrics,
  isLoading = false,
  error = null,
  onRetry,
  incompatibleReason = null,
  accentA = '#4F46E5',
  accentB = '#0EA5E9',
  labelA = 'Run A',
  labelB = 'Run B',
}: ComparisonDetailDialogProps) => {
  const incompatibleMessage = incompatibleReason
    ? (INCOMPATIBLE_REASONS[incompatibleReason] ?? incompatibleReason)
    : null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth data-testid="comparison-detail-dialog">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {/* Run headers */}
        {runA && runB && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <RunHeader label={labelA} run={runA} accentColor={accentA} />
            <RunHeader label={labelB} run={runB} accentColor={accentB} />
          </Stack>
        )}

        {/* Incompatibility block */}
        {incompatibleMessage && (
          <Alert severity="warning" sx={{ mb: 2 }} data-testid="incompatible-alert">
            <Typography variant="body2" fontWeight={700}>
              Runs cannot be meaningfully compared
            </Typography>
            <Typography variant="body2">{incompatibleMessage}</Typography>
          </Alert>
        )}

        {/* Loading */}
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }} data-testid="compare-loading">
            <CircularProgress size={32} />
          </Box>
        )}

        {/* Error */}
        {!isLoading && error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              onRetry ? (
                <Button color="inherit" size="small" onClick={onRetry}>
                  Retry
                </Button>
              ) : undefined
            }
            data-testid="compare-error"
          >
            {error}
          </Alert>
        )}

        {/* Metrics table */}
        {!isLoading && !error && !incompatibleMessage && metrics && (
          <TableContainer component={Paper} variant="outlined" data-testid="metrics-table">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Metric</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: accentA }}>{labelA}</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: accentB }}>{labelB}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Delta (B − A)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(metrics).map(([key, val]) => {
                  const delta = metricDelta(val.a, val.b);
                  return (
                    <TableRow key={key} hover>
                      <TableCell sx={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                        {key}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{fmtNum(val.a)}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{fmtNum(val.b)}</TableCell>
                      <TableCell>
                        <Typography
                          variant="caption"
                          fontFamily="monospace"
                          fontWeight={700}
                          sx={{
                            color:
                              delta.positive === null
                                ? 'text.disabled'
                                : delta.positive
                                ? '#15803D'
                                : '#B91C1C',
                          }}
                        >
                          {delta.text}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Empty metrics */}
        {!isLoading && !error && !incompatibleMessage && metrics && Object.keys(metrics).length === 0 && (
          <Alert severity="info" data-testid="no-metrics-alert">
            No metrics were returned for this pair. The runs may still be processing.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
