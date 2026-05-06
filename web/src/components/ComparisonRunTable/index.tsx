import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
  Paper
} from '@mui/material';
import { Download as DownloadIcon, WarningAmber as DriftIcon } from '@mui/icons-material';

import type { ComparisonRunRow, ComparisonListParams } from '@/api/domains/comparison';
import { ComparisonApi } from '@/api/domains/comparison';
import { Tt100tBadge } from '@/components/Tt100tBadge';

// ----------------------------------------------------------------------

const TT100T_GOAL = 1.1;

const VENDOR_COLOR: Record<string, string> = {
  nvidia: '#76B900',
  furiosa: '#7C3AED',
  rebellions: '#CA8A04',
};

type SortDir = 'asc' | 'desc';
type SortKey = 'tt100t' | 'elapsed' | 'status' | 'hardware' | 'model';

function fmtSec(s: number | null | undefined): string {
  return s == null ? '—' : `${s.toFixed(3)} s`;
}

function nullLast(a: number | null | undefined, b: number | null | undefined, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

function elapsedSec(row: ComparisonRunRow): number | null {
  if (!row.started_at || !row.completed_at) return null;
  const diff = (new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()) / 1000;
  return isFinite(diff) ? diff : null;
}

// ----------------------------------------------------------------------

type StatusBadgeProps = { status: string; failureReason?: string | null };

const StatusBadge = ({ status, failureReason }: StatusBadgeProps) => {
  const s = (status ?? '').toLowerCase();
  const isPass = s === 'completed' || s === 'passed' || s === 'success';
  const isFail = s === 'failed' || s === 'error';

  const chip = (
    <Chip
      size="small"
      label={status || 'unknown'}
      sx={{
        fontWeight: 700,
        fontSize: '0.6875rem',
        bgcolor: isPass
          ? 'rgba(22,163,74,0.15)'
          : isFail
          ? 'rgba(220,38,38,0.15)'
          : 'rgba(148,163,184,0.15)',
        color: isPass ? '#15803D' : isFail ? '#B91C1C' : '#475569',
      }}
    />
  );

  if (isFail && failureReason) {
    return (
      <Tooltip title={failureReason} arrow>
        {chip}
      </Tooltip>
    );
  }
  return chip;
};

// ----------------------------------------------------------------------

type DriftBadgeProps = { fields?: string[] };

const DriftBadge = ({ fields }: DriftBadgeProps) => (
  <Tooltip
    title={
      <Box>
        <Typography variant="caption" fontWeight={700}>
          Config drift detected
        </Typography>
        {fields && fields.length > 0 && (
          <Box component="ul" sx={{ m: 0, pl: 2, mt: 0.5 }}>
            {fields.map(f => (
              <li key={f}>
                <Typography variant="caption">{f}</Typography>
              </li>
            ))}
          </Box>
        )}
      </Box>
    }
    arrow
  >
    <Chip
      icon={<DriftIcon sx={{ fontSize: '0.875rem !important' }} />}
      size="small"
      label="config drift"
      sx={{
        fontWeight: 700,
        fontSize: '0.6875rem',
        bgcolor: 'rgba(249,115,22,0.15)',
        color: '#C2410C',
        border: '1px solid rgba(249,115,22,0.3)',
        cursor: 'default',
      }}
    />
  </Tooltip>
);

// ----------------------------------------------------------------------

type GoalLineRowProps = { colSpan: number };

const GoalLineRow = ({ colSpan }: GoalLineRowProps) => (
  <TableRow>
    <TableCell
      colSpan={colSpan}
      sx={{ p: 0, border: 0 }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 0.5,
          bgcolor: 'rgba(14,165,233,0.06)',
          borderTop: '2px dashed #0EA5E9',
          borderBottom: '1px solid rgba(14,165,233,0.2)',
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: '#0EA5E9',
            flexShrink: 0,
          }}
        />
        <Typography
          variant="caption"
          sx={{ color: '#0369A1', fontWeight: 700, letterSpacing: '0.02em' }}
        >
          TT100T goal line — {TT100T_GOAL} s
        </Typography>
      </Box>
    </TableCell>
  </TableRow>
);

// ----------------------------------------------------------------------

export type ComparisonRunTableProps = {
  runs: ComparisonRunRow[];
  isLoading?: boolean;
  /** Called when user clicks a row — used as "select run A" */
  onSelectRun?: (run: ComparisonRunRow) => void;
  selectedId?: number | null;
  /** Extra action cell per row (e.g. Pick button) */
  renderRowAction?: (run: ComparisonRunRow) => React.ReactNode;
  /** Filters forwarded to export URL */
  exportParams?: ComparisonListParams;
  /** Show benchmark column */
  showBenchmark?: boolean;
  /** Show vendor column */
  showVendor?: boolean;
  /** Number of skeleton rows to show while loading */
  skeletonRows?: number;
  /** Link shown in empty state */
  onClearFilters?: () => void;
};

const SKELETON_COLS = 7;

export const ComparisonRunTable = ({
  runs,
  isLoading = false,
  onSelectRun,
  selectedId,
  renderRowAction,
  exportParams,
  showBenchmark = false,
  showVendor = true,
  skeletonRows = 5,
  onClearFilters,
}: ComparisonRunTableProps) => {
  const [sortKey, setSortKey] = useState<SortKey>('tt100t');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = [...runs].sort((a, b) => {
    switch (sortKey) {
      case 'tt100t':
        return nullLast(a.metrics.tt100t_seconds, b.metrics.tt100t_seconds, sortDir);
      case 'elapsed':
        return nullLast(elapsedSec(a), elapsedSec(b), sortDir);
      case 'status':
        return sortDir === 'asc'
          ? (a.status ?? '').localeCompare(b.status ?? '')
          : (b.status ?? '').localeCompare(a.status ?? '');
      case 'hardware':
        return sortDir === 'asc'
          ? (a.hardware.model ?? '').localeCompare(b.hardware.model ?? '')
          : (b.hardware.model ?? '').localeCompare(a.hardware.model ?? '');
      case 'model':
        return sortDir === 'asc'
          ? (a.model ?? '').localeCompare(b.model ?? '')
          : (b.model ?? '').localeCompare(a.model ?? '');
      default:
        return 0;
    }
  });

  // Find goal-line insertion index (first row with tt100t >= TT100T_GOAL)
  const goalLineIdx = sortKey === 'tt100t' && sortDir === 'asc'
    ? sorted.findIndex(r => r.metrics.tt100t_seconds != null && r.metrics.tt100t_seconds >= TT100T_GOAL)
    : -1;

  const colCount =
    1 + // Hardware
    (showVendor ? 1 : 0) +
    (showBenchmark ? 1 : 0) +
    1 + // Model
    1 + // TT100T
    1 + // Elapsed
    1 + // Status
    (renderRowAction ? 1 : 0);

  const exportUrl = ComparisonApi.exportUrl(exportParams);

  if (isLoading) {
    return (
      <TableContainer component={Paper} sx={{ maxHeight: 520 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {Array.from({ length: SKELETON_COLS }).map((_, i) => (
                <TableCell key={i}>
                  <Skeleton width={60} />
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: SKELETON_COLS }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton variant={j === 0 ? 'rounded' : 'text'} width={j === 0 ? 80 : 60} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (runs.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 1 }}>
        No runs match your filters.
        {onClearFilters && (
          <>
            {' '}
            <Link component="button" onClick={onClearFilters} sx={{ verticalAlign: 'baseline' }}>
              Clear filters
            </Link>
          </>
        )}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Export toolbar */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <Button
          size="small"
          startIcon={<DownloadIcon />}
          component="a"
          href={exportUrl}
          download
          sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.8125rem' }}
        >
          Export CSV
        </Button>
      </Box>

      <TableContainer component={Paper} sx={{ maxHeight: 520 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>
                <TableSortLabel
                  active={sortKey === 'hardware'}
                  direction={sortKey === 'hardware' ? sortDir : 'asc'}
                  onClick={() => handleSort('hardware')}
                >
                  Hardware
                </TableSortLabel>
              </TableCell>
              {showVendor && <TableCell>Vendor</TableCell>}
              {showBenchmark && <TableCell>Benchmark</TableCell>}
              <TableCell>
                <TableSortLabel
                  active={sortKey === 'model'}
                  direction={sortKey === 'model' ? sortDir : 'asc'}
                  onClick={() => handleSort('model')}
                >
                  Model
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <Tooltip title="Time to 100 output tokens. Goal: <1.1s" arrow>
                  <TableSortLabel
                    active={sortKey === 'tt100t'}
                    direction={sortKey === 'tt100t' ? sortDir : 'asc'}
                    onClick={() => handleSort('tt100t')}
                  >
                    TT100T (s)
                  </TableSortLabel>
                </Tooltip>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortKey === 'elapsed'}
                  direction={sortKey === 'elapsed' ? sortDir : 'asc'}
                  onClick={() => handleSort('elapsed')}
                >
                  Elapsed (s)
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortKey === 'status'}
                  direction={sortKey === 'status' ? sortDir : 'asc'}
                  onClick={() => handleSort('status')}
                >
                  Status
                </TableSortLabel>
              </TableCell>
              {renderRowAction && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((run, idx) => {
              const isSelected = selectedId === run.id;
              const vendor = run.hardware?.vendor ?? '';
              const vendorColor = VENDOR_COLOR[vendor] ?? '#64748B';
              const elapsed = elapsedSec(run);
              const hasDrift = !!run.drift_flag;

              return [
                goalLineIdx === idx && <GoalLineRow key={`goal-${idx}`} colSpan={colCount} />,
                <TableRow
                  key={run.id}
                  hover
                  selected={isSelected}
                  onClick={onSelectRun ? () => onSelectRun(run) : undefined}
                  sx={{ cursor: onSelectRun ? 'pointer' : 'default' }}
                >
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                      <Chip
                        size="small"
                        label={run.hardware.model}
                        sx={{
                          bgcolor: `${vendorColor}1F`,
                          color: vendorColor,
                          fontWeight: 700,
                          fontSize: '0.6875rem',
                        }}
                      />
                      {hasDrift && <DriftBadge fields={run.drift_fields} />}
                    </Stack>
                  </TableCell>
                  {showVendor && (
                    <TableCell>
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 600, color: vendorColor, textTransform: 'capitalize' }}
                      >
                        {vendor}
                      </Typography>
                    </TableCell>
                  )}
                  {showBenchmark && (
                    <TableCell>
                      <Chip
                        size="small"
                        label={run.benchmark.toUpperCase()}
                        variant="outlined"
                        sx={{ fontSize: '0.6875rem' }}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Typography variant="caption" fontFamily="monospace">
                      {run.model}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography
                        variant="caption"
                        fontFamily="monospace"
                        fontWeight={700}
                        sx={{ color: '#0F172A' }}
                      >
                        {fmtSec(run.metrics.tt100t_seconds)}
                      </Typography>
                      <Tt100tBadge value={run.metrics.tt100t_seconds} size="small" />
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" fontFamily="monospace" sx={{ color: '#475569' }}>
                      {fmtSec(elapsed)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} failureReason={run.failure_reason} />
                  </TableCell>
                  {renderRowAction && <TableCell>{renderRowAction(run)}</TableCell>}
                </TableRow>,
              ];
            })}
            {goalLineIdx === sorted.length && (
              <GoalLineRow key="goal-end" colSpan={colCount} />
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};
