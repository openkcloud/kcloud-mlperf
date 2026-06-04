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
  useTheme,
} from '@mui/material';
import { Fingerprint as FingerprintIcon } from '@mui/icons-material';

import type { ComparisonRunRow } from '@/api/domains/comparison';
import type { FairnessAssessment } from '@/api/types/fairness-assessment';
import { Tt100tBadge } from '@/components/Tt100tBadge';
import { statusColor } from '@/components/home/deviceAggregates';

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

function fmtVal(v: string | number | null | undefined): string {
  if (v == null) return '—';
  return String(v);
}

// Per-metric display metadata. `lowerIsBetter` drives delta COLORING so an
// improvement is always green regardless of the raw sign (TT100T/TTFT are
// latencies — a faster, i.e. NEGATIVE, delta is the good one).
const METRIC_META: Record<string, { label: string; unit?: string; lowerIsBetter?: boolean }> = {
  tt100t_seconds: { label: 'TT100T', unit: 's', lowerIsBetter: true },
  ttft_seconds: { label: 'TTFT (server)', unit: 's', lowerIsBetter: true },
  tps: { label: 'Throughput', unit: 'tok/s' },
  throughput: { label: 'Throughput', unit: 'samples/s' },
  accuracy_pct: { label: 'Accuracy', unit: '%' },
  // BB-3 latency percentiles (lower better) + R8 power/efficiency.
  p50_latency_s: { label: 'p50 latency', unit: 's', lowerIsBetter: true },
  p90_latency_s: { label: 'p90 latency', unit: 's', lowerIsBetter: true },
  p99_latency_s: { label: 'p99 latency', unit: 's', lowerIsBetter: true },
  avg_power_w: { label: 'Avg power', unit: 'W', lowerIsBetter: true },
  tokens_per_watt: { label: 'Efficiency', unit: 'tok/s/W' },
};

// `positive` here means "B is an IMPROVEMENT over A" (→ green), not "B is larger".
function metricDelta(
  a: number | null,
  b: number | null,
  lowerIsBetter = false,
): { text: string; positive: boolean | null } {
  if (a == null || b == null) return { text: '—', positive: null };
  const diff = b - a;
  const pct = a !== 0 ? (diff / Math.abs(a)) * 100 : null;
  const sign = diff >= 0 ? '+' : '';
  const pctStr = pct != null ? ` (${sign}${pct.toFixed(1)}%)` : '';
  const improvement = diff === 0 ? null : lowerIsBetter ? diff < 0 : diff > 0;
  return {
    text: `${sign}${diff.toFixed(3)}${pctStr}`,
    positive: improvement,
  };
}

// ----------------------------------------------------------------------

type RunHeaderProps = {
  label: string;
  run: ComparisonRunRow;
  accentColor: string;
};

const RunHeader = ({ label, run, accentColor }: RunHeaderProps) => {
  const { palette } = useTheme();
  const mode = palette.mode;
  const statusFg =
    run.status === 'completed'
      ? statusColor('success', mode)
      : run.status === 'failed'
      ? statusColor('error', mode)
      : statusColor('neutral', mode);
  return (
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
            color: statusFg,
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
              color: statusColor('warning', mode),
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
};

// ----------------------------------------------------------------------

type ControlledVarsTableProps = {
  runA: ComparisonRunRow;
  runB: ComparisonRunRow;
  accentA: string;
  accentB: string;
  labelA: string;
  labelB: string;
};

const CONTROLLED_VAR_ROWS: Array<{ label: string; key: keyof ComparisonRunRow | 'hardware_model' }> = [
  { label: 'Model', key: 'model' },
  { label: 'Precision', key: 'precision' },
  { label: 'Dataset', key: 'dataset' },
  { label: 'Batch size', key: 'batch_size' },
  { label: 'Data number', key: 'data_number' },
  { label: 'Scenario', key: 'scenario' },
  { label: 'Max output tokens', key: 'max_output_tokens' },
  { label: 'Hardware', key: 'hardware_model' },
];

function getControlledVarValue(run: ComparisonRunRow, key: string): string {
  if (key === 'hardware_model') {
    return `${run.hardware.vendor} ${run.hardware.model}`;
  }
  return fmtVal((run as unknown as Record<string, unknown>)[key] as string | number | null | undefined);
}

const ControlledVarsTable = ({ runA, runB, accentA, accentB, labelA, labelB }: ControlledVarsTableProps) => {
  const { palette } = useTheme();
  const mode = palette.mode;
  return (
    <Box sx={{ mb: 2 }} data-testid="controlled-vars-table">
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Controlled Variables
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: '30%' }}>Variable</TableCell>
              <TableCell sx={{ fontWeight: 700, color: accentA }}>{labelA}</TableCell>
              <TableCell sx={{ fontWeight: 700, color: accentB }}>{labelB}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Match</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {CONTROLLED_VAR_ROWS.map(({ label, key }) => {
              const vA = getControlledVarValue(runA, key);
              const vB = getControlledVarValue(runB, key);
              const matches = vA === vB || (vA === '—' && vB === '—');
              return (
                <TableRow key={key} hover>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>{label}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{vA}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{vB}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={matches ? 'match' : 'differ'}
                      sx={{
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        bgcolor: matches ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                        color: matches ? statusColor('success', mode) : statusColor('error', mode),
                      }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

// ----------------------------------------------------------------------

type FairnessSectionProps = {
  fairnessAssessment?: FairnessAssessment;
  incompatibilityReasons: string[];
};

function fairnessChipColor(value: string, mode: 'light' | 'dark'): { bg: string; color: string } {
  if (value === 'matched' || value === 'verified' || value === 'true') {
    return { bg: 'rgba(22,163,74,0.1)', color: statusColor('success', mode) };
  }
  if (value === 'mismatched' || value === 'mismatch' || value === 'false') {
    return { bg: 'rgba(220,38,38,0.1)', color: statusColor('error', mode) };
  }
  return { bg: 'rgba(148,163,184,0.1)', color: statusColor('neutral', mode) };
}

const FairnessSection = ({ fairnessAssessment, incompatibilityReasons }: FairnessSectionProps) => {
  const { palette } = useTheme();
  const mode = palette.mode;
  const hasIncompatibilities = incompatibilityReasons.length > 0;

  return (
    <Box sx={{ mb: 2 }} data-testid="fairness-section">
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Fairness Assessment
      </Typography>

      {hasIncompatibilities && (
        <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="fairness-incompatible-banner">
          <Typography variant="body2" fontWeight={700}>
            These runs are NOT directly comparable. See fairness flags below.
          </Typography>
        </Alert>
      )}

      {hasIncompatibilities && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          {incompatibilityReasons.map((reason) => (
            <Chip
              key={reason}
              label={INCOMPATIBLE_REASONS[reason] ?? reason}
              size="small"
              data-testid="incompatibility-reason-chip"
              sx={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                bgcolor: 'rgba(220,38,38,0.1)',
                color: statusColor('error', mode),
                border: '1px solid rgba(220,38,38,0.25)',
                height: 'auto',
                '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 },
              }}
            />
          ))}
        </Stack>
      )}

      {fairnessAssessment && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Signal</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(
                [
                  { label: 'Precision class', value: fairnessAssessment.precision_class },
                  { label: 'Latency context', value: fairnessAssessment.latency_context },
                  { label: 'Tokenizer match', value: fairnessAssessment.tokenizer_match },
                  { label: 'Vendor match', value: String(fairnessAssessment.vendor_match) },
                ] as const
              ).map(({ label, value }) => {
                const chipColors = fairnessChipColor(value, mode);
                return (
                  <TableRow key={label} hover>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>{label}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={value}
                        sx={{
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          bgcolor: chipColors.bg,
                          color: chipColors.color,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {!hasIncompatibilities && !fairnessAssessment && (
        <Typography variant="body2" color="text.secondary">
          No fairness data available for this pair.
        </Typography>
      )}
    </Box>
  );
};

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
  /** Full list of incompatibility reason keys from the pair endpoint (WS-B05). */
  incompatibilityReasons?: string[];
  /** Rich fairness struct from the pair endpoint (WS-B05). */
  fairnessAssessment?: FairnessAssessment;
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
  incompatibilityReasons = [],
  fairnessAssessment,
  accentA = '#4F46E5',
  accentB = '#0EA5E9',
  labelA = 'Run A',
  labelB = 'Run B',
}: ComparisonDetailDialogProps) => {
  const { palette } = useTheme();
  const mode = palette.mode;
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

        {/* Controlled Variables table — shown when both runs are available */}
        {!isLoading && !error && runA && runB && (
          <ControlledVarsTable
            runA={runA}
            runB={runB}
            accentA={accentA}
            accentB={accentB}
            labelA={labelA}
            labelB={labelB}
          />
        )}

        {/* Fairness section — only shown when new-style data (incompatibilityReasons array) is present */}
        {!isLoading && !error && runA && runB && incompatibilityReasons.length > 0 && (
          <FairnessSection
            fairnessAssessment={fairnessAssessment}
            incompatibilityReasons={incompatibilityReasons}
          />
        )}

        {/* Fairness section with only fairnessAssessment (no incompatibilityReasons) */}
        {!isLoading && !error && runA && runB && incompatibilityReasons.length === 0 && fairnessAssessment && (
          <FairnessSection
            fairnessAssessment={fairnessAssessment}
            incompatibilityReasons={[]}
          />
        )}

        {/* Legacy single incompatibility block (backward compat — used when only incompatibleReason prop is set) */}
        {incompatibleMessage && incompatibilityReasons.length === 0 && (
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
        {!isLoading && !error && !incompatibleMessage && metrics && Object.keys(metrics).length > 0 && (
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
                  const meta = METRIC_META[key];
                  const delta = metricDelta(val.a, val.b, meta?.lowerIsBetter ?? false);
                  return (
                    <TableRow key={key} hover>
                      <TableCell sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>
                        {meta?.label ?? key}{meta?.unit ? ` (${meta.unit})` : ''}
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
                                ? statusColor('success', mode)
                                : statusColor('error', mode),
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
