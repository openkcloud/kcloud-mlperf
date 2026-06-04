import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Stack,
  Button,
  Divider,
  Alert,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  LinearProgress,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Collapse,
  List,
  ListItem,
  ListItemText,
  IconButton,
  useTheme,
} from '@mui/material';
import {
  Memory as MemoryIcon,
  Speed as SpeedIcon,
  CheckCircle as CheckIcon,
  Bolt as BoltIcon,
  TrendingDown as TrendingDownIcon,
  InfoOutlined as InfoIcon,
  RocketLaunch as RocketIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { formatAge } from '@/helpers/format-age.helper';
import type { CrossDeviceVerdict } from '@/components/home/deviceAggregates';

import { ComparisonApi, type ComparisonRunRow } from '@/api/domains/comparison';
import { DevicesApi } from '@/api/domains/devices.domains';
import type { DeviceEntry } from '@/api/types/devices.types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ColumnMenu, type ColumnOption } from '@/components/common/ColumnMenu';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { DeviceEfficiencyScatter } from '@/components/home/DeviceEfficiencyScatter';
import { RooflineChart } from '@/components/home/RooflineChart';
import {
  TT100T_TARGET,
  vendorColor,
  statusColor,
  aggregateByDevice,
  withEfficiency,
  markPareto,
  speedupVsSlowest,
  topCrossDeviceComparison,
  filterCanonicalRuns,
  filterToCurrentCluster,
  normalizeHwModel,
} from '@/components/home/deviceAggregates';

// ----------------------------------------------------------------------

const fmtSec = (s: number | null | undefined): string =>
  s == null ? '—' : `${s.toFixed(3)} s`;
const fmtTps = (n: number | null | undefined): string =>
  n == null ? '—' : `${n.toFixed(1)} tok/s`;
const fmtCost = (n: number | null | undefined): string =>
  n == null ? '—' : `$${n.toFixed(2)}`;
const verdictOf = (s: number | null | undefined): 'PASS' | 'FAIL' | 'UNKNOWN' => {
  if (s == null) return 'UNKNOWN';
  return s < TT100T_TARGET ? 'PASS' : 'FAIL';
};

const toRows = (runs: unknown): ComparisonRunRow[] =>
  Array.isArray(runs)
    ? (runs as ComparisonRunRow[])
    : ((runs as { runs?: ComparisonRunRow[] } | undefined)?.runs ?? []);

const TT100T_HELP =
  'TT100T = wall-clock time to generate the first 100 output tokens. Lower is better; the cluster target is < 1.1 s.';

// ----------------------------------------------------------------------
// #8: the live cluster registry is the single source of truth for which
// hardware is "current". One devices query (shared between the inventory card
// and the insight filters) and one derivation of the current canonical hwModel
// set keep the leaderboard / scatter / roofline scoped to {A30, RNGD, Atom+}.
// ----------------------------------------------------------------------

const useDevicesQuery = () =>
  useQuery({
    queryKey: ['home', 'devices'],
    queryFn: DevicesApi.list,
    staleTime: 30_000,
  });

/**
 * Set of canonical hwModels currently advertised by /api/devices. Returns null
 * until the registry resolves (or if it is empty) so the insight filters degrade
 * to "show everything" rather than blanking out while devices load.
 */
const deriveCurrentModels = (devices: DeviceEntry[] | undefined): ReadonlySet<string> | null => {
  if (!Array.isArray(devices) || devices.length === 0) return null;
  const models = new Set<string>();
  for (const d of devices) models.add(normalizeHwModel(d.model));
  return models.size ? models : null;
};

/**
 * #8: keep only runs whose (normalized) hardware model is in the live cluster, so
 * the cross-device verdict never compares against off-cluster L40/A40 hardware.
 * A null set (registry not yet resolved) is a no-op so the verdict still renders.
 */
const filterRunsToCurrentCluster = (
  runs: ComparisonRunRow[],
  currentModels: ReadonlySet<string> | null,
): ComparisonRunRow[] => {
  if (!currentModels || currentModels.size === 0) return runs;
  return runs.filter(r => currentModels.has(normalizeHwModel(r.hardware?.model)));
};

// ----------------------------------------------------------------------

// The hero leads with the verdict — the GPU-vs-NPU answer a viewer should grasp
// in two seconds — instead of a vendor roster (Artificial Analysis pattern).
const heroHeadline = (cd: CrossDeviceVerdict | null): { lead: string; sub: string } => {
  if (!cd) {
    return {
      lead: 'ETRI LLM Benchmarking Cluster',
      sub: 'GPU vs NPU inference benchmarking — run a comparison to surface the verdict.',
    };
  }
  const { family, precision, a, b, verdict: vd } = cd;
  const head = `${family} · ${precision} · TT100T`;
  if (vd.label === 'LEAD') {
    const leader = vd.leaderLabel === a.label ? a : b;
    const loser = leader === a ? b : a;
    const factor = loser.mean > 0 && leader.mean > 0 ? loser.mean / leader.mean : null;
    return {
      lead: `${leader.label} (${leader.type})${factor ? ` ~${factor.toFixed(2)}× faster` : ' faster'} than ${loser.label} (${loser.type})`,
      sub: `${head} · Δ ${Math.abs(vd.delta).toFixed(3)}s, 95% CI(run) [${vd.ciLow.toFixed(2)}, ${vd.ciHigh.toFixed(2)}] — exploratory`,
    };
  }
  if (vd.label === 'TIE') {
    return { lead: `${a.label} (${a.type}) vs ${b.label} (${b.type}): statistical tie`, sub: `${head} — exploratory` };
  }
  return { lead: `${a.label} (${a.type}) vs ${b.label} (${b.type}): inconclusive`, sub: `${head} — needs more runs` };
};

const HeroBanner = ({
  crossDevice,
  dataUpdatedAt,
  onRefresh,
}: {
  crossDevice: CrossDeviceVerdict | null;
  dataUpdatedAt?: number;
  onRefresh: () => void;
}) => {
  const { lead, sub } = heroHeadline(crossDevice);
  return (
  <Paper
    sx={{
      p: 3,
      mb: 3,
      background: 'linear-gradient(135deg, #1E3A8A 0%, #4338CA 50%, #7C3AED 100%)',
      color: '#FFF',
    }}
  >
    <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} spacing={2}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography component="h1" variant="h4" fontWeight={700} sx={{ letterSpacing: '-0.02em' }}>
          {lead}
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
          {sub}
        </Typography>
        <Typography variant="caption" sx={{ mt: 0.75, display: 'block', opacity: 0.6 }}>
          NVIDIA A30 (jw2, jw3) · FuriosaAI RNGD (node4) · Rebellions Atom+ (node5, June 4)
        </Typography>
      </Box>
      <Stack spacing={1} alignItems={{ xs: 'flex-start', md: 'flex-end' }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {dataUpdatedAt ? (
            <Chip
              size="small"
              label={`Updated ${formatAge(dataUpdatedAt)}`}
              sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#FFF', fontWeight: 600, fontSize: '0.6875rem' }}
            />
          ) : null}
          <Tooltip title="Refresh data" arrow>
            <IconButton size="small" onClick={onRefresh} aria-label="Refresh leaderboard data" sx={{ color: 'rgba(255,255,255,0.85)', '&:hover': { color: '#fff' } }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Stack direction="row" spacing={1.5}>
        <Chip
          icon={<CheckIcon sx={{ color: '#FFF !important' }} />}
          label="3 vendors live"
          sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#FFF', fontWeight: 600 }}
        />
        <Tooltip title={TT100T_HELP} arrow>
          <Chip
            icon={<BoltIcon sx={{ color: '#FFF !important' }} />}
            label="TT100T target < 1.1 s"
            sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#FFF', fontWeight: 600, cursor: 'help' }}
          />
        </Tooltip>
        </Stack>
      </Stack>
    </Stack>
  </Paper>
  );
};

// ----------------------------------------------------------------------

const VendorCluster = ({
  devicesQuery,
}: {
  devicesQuery: ReturnType<typeof useDevicesQuery>;
}) => {
  const { data: devices } = devicesQuery;
  const list = Array.isArray(devices) ? devices : [];
  const groups = ['nvidia', 'furiosa', 'rebellions'].map(v => {
    const entries = list.filter(d => d.vendor === v);
    return {
      vendor: v,
      label: v === 'nvidia' ? 'NVIDIA GPU' : v === 'furiosa' ? 'FuriosaAI RNGD' : 'Rebellions Atom+',
      count: entries.length,
      readyCount: entries.filter(e => e.state === 'ready').length,
      models: Array.from(new Set(entries.map(e => e.model))).join(', '),
      nodes: Array.from(new Set(entries.map(e => e.node))).join(', '),
    };
  });

  const mode = useTheme().palette.mode;

  return (
    <Paper sx={{ p: 2.5, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <MemoryIcon sx={{ color: '#1E40AF' }} />
        <Typography variant="h6" fontWeight={700}>
          Cluster Inventory
        </Typography>
      </Box>
      <QueryBoundary query={devicesQuery}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
        {groups.map(g => {
          const allReady = g.count > 0 && g.readyCount === g.count;
          const someReady = g.readyCount > 0 && g.readyCount < g.count;
          const statusLabel = g.count === 0 ? 'unknown' : allReady ? 'ready' : someReady ? 'partial' : 'not ready';
          const statusBg =
            statusLabel === 'ready'
              ? 'rgba(22,163,74,0.12)'
              : statusLabel === 'partial'
                ? 'rgba(234,179,8,0.16)'
                : 'rgba(148,163,184,0.16)';
          const statusFg = statusColor(
            statusLabel === 'ready' ? 'success' : statusLabel === 'partial' ? 'warning' : 'neutral',
            mode,
          );
          return (
            <Box
              key={g.vendor}
              sx={{
                p: 2,
                borderRadius: 1.5,
                border: `1px solid ${vendorColor(g.vendor, mode)}33`,
                background: `linear-gradient(135deg, ${vendorColor(g.vendor, mode)}0d 0%, transparent 100%)`,
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ color: vendorColor(g.vendor, mode) }}>
                  {g.label}
                </Typography>
                <Chip
                  size="small"
                  label={statusLabel}
                  sx={{ bgcolor: statusBg, color: statusFg, fontWeight: 600, textTransform: 'uppercase', fontSize: '0.65rem' }}
                />
              </Stack>
              <Typography variant="h5" fontWeight={700}>
                {g.count}
                <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                  device{g.count === 1 ? '' : 's'}
                </Typography>
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                {g.models || '—'}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
                node: {g.nodes || '—'}
              </Typography>
            </Box>
          );
        })}
      </Box>
      </QueryBoundary>
    </Paper>
  );
};

// ----------------------------------------------------------------------

const VENDORS = [
  { key: 'nvidia', label: 'NVIDIA' },
  { key: 'furiosa', label: 'Furiosa' },
  { key: 'rebellions', label: 'Rebellions' },
] as const;

// Optional (toggleable) leaderboard columns. Hardware/Model/TT100T are always
// visible (R10); these can be hidden via the column menu.
const LEADERBOARD_COLUMNS: ColumnOption[] = [
  { key: 'throughput', label: 'Throughput' },
  { key: 'efficiency', label: 'Efficiency' },
  { key: 'cost', label: 'Cost ($/Mtok)' },
  { key: 'verdict', label: 'Verdict' },
];
const LEADERBOARD_COLUMN_DEFAULTS: Record<string, boolean> = {
  throughput: true,
  efficiency: true,
  cost: false, // modeled/estimated — off by default to avoid implying it's measured
  verdict: true,
};

const Tt100tLeaderboard = ({
  runs,
  loading,
  currentModels,
}: {
  runs: ComparisonRunRow[];
  loading?: boolean;
  currentModels?: ReadonlySet<string> | null;
}) => {
  const [vendorFilter, setVendorFilter] = useState<string[]>([]); // [] = all
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState<'raw' | 'norm'>('raw');
  const [methodOpen, setMethodOpen] = useState(false);
  const { isVisible, toggle } = useColumnVisibility('home.leaderboard', LEADERBOARD_COLUMN_DEFAULTS);
  const mode = useTheme().palette.mode;

  const devices = useMemo(() => {
    // #7 canonical-model runs only + #8 current-cluster scoping, BEFORE efficiency
    // normalization so the 0-100 axes are relative to the shown devices only.
    const scoped = filterToCurrentCluster(aggregateByDevice(filterCanonicalRuns(runs)), currentModels);
    const aggs = markPareto(withEfficiency(scoped));
    return aggs
      .filter(d => d.tt100t != null)
      // #26: stable sort — break TT100T ties on hwModel so the order is
      // deterministic instead of depending on insertion order.
      .sort(
        (a, b) =>
          (a.tt100t as number) - (b.tt100t as number) ||
          a.hwModel.localeCompare(b.hwModel),
      );
  }, [runs, currentModels]);

  const filtered = vendorFilter.length
    ? devices.filter(d => vendorFilter.includes(d.vendor))
    : devices;
  const shown = showAll ? filtered : filtered.slice(0, 6);

  // Real GPU↔NPU question: for the model running on the most devices, is the
  // fastest hardware significantly faster than the next? (same model, cross hw —
  // model names are vendor-namespace-normalized so A30 vs RNGD actually compares).
  // #8: scope the verdict to current-cluster hardware only.
  const crossDevice = useMemo(
    () => topCrossDeviceComparison(filterRunsToCurrentCluster(runs, currentModels ?? null)),
    [runs, currentModels],
  );
  const norm = viewMode === 'norm';
  const maxTps = Math.max(0, ...devices.map(d => d.tps ?? 0));
  // #3: bestTt is Infinity when no device has a TT100T; callers must guard with
  // Number.isFinite (Math.min(...[], Infinity) === Infinity → "Infinity" score).
  const ttValues = devices.filter(d => d.tt100t != null).map(d => d.tt100t as number);
  const bestTt = ttValues.length ? Math.min(...ttValues) : Infinity;

  return (
    <Paper sx={{ p: 2.5, mb: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1.5} sx={{ mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SpeedIcon sx={{ color: '#0E7490' }} />
          <Typography variant="h6" fontWeight={700}>
            TT100T Leaderboard
          </Typography>
          <Tooltip title={`${TT100T_HELP} The Efficiency score is a normalized 0–100 blend of throughput, speed (1/TT100T) and accuracy.`} arrow>
            <InfoIcon fontSize="small" sx={{ color: 'text.disabled', cursor: 'help' }} />
          </Tooltip>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          {VENDORS.map(v => {
            const active = vendorFilter.includes(v.key);
            return (
              <Chip
                key={v.key}
                label={v.label}
                size="small"
                onClick={() =>
                  setVendorFilter(prev =>
                    prev.includes(v.key) ? prev.filter(x => x !== v.key) : [...prev, v.key],
                  )
                }
                aria-pressed={active}
                aria-label={`Filter by ${v.label}`}
                variant={active ? 'filled' : 'outlined'}
                sx={{
                  fontWeight: 700,
                  borderColor: vendorColor(v.key, mode),
                  bgcolor: active ? `${vendorColor(v.key, mode)}22` : 'transparent',
                  color: active ? vendorColor(v.key, mode) : 'text.secondary',
                }}
              />
            );
          })}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_, val) => { if (val) setViewMode(val as 'raw' | 'norm'); }}
            aria-label="Metric display mode"
          >
            <ToggleButton value="raw">Raw</ToggleButton>
            <ToggleButton value="norm">Normalized</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={showAll ? 'all' : 'top'}
            onChange={(_, val) => { if (val) setShowAll(val === 'all'); }}
          >
            <ToggleButton value="top">Top 6</ToggleButton>
            <ToggleButton value="all">All ({filtered.length})</ToggleButton>
          </ToggleButtonGroup>
          <ColumnMenu columns={LEADERBOARD_COLUMNS} isVisible={isVisible} onToggle={toggle} />
        </Stack>
      </Stack>

      {crossDevice && (() => {
        const { family, precision, a, b, verdict: vd } = crossDevice;
        const tag = (s: typeof a) => `${s.label} (${s.type})`;
        const leader = vd.leaderLabel === a.label ? a : b;
        const loser = leader === a ? b : a;
        const head = `${family} · ${precision}`;
        const caveat = [
          'Exploratory / observational signal — NOT a controlled experiment.',
          `N is benchmark RUNS (between-run spread), not per-sample: ${a.n} ${a.label} vs ${b.n} ${b.label} runs.`,
          'The NPU path measures single-stream (server-side) while the GPU path measures offline/batched (client-side) — measurement contexts differ, which alone can shift TT100T.',
          'Likely bias: single-stream (NPU) tends to report LOWER TT100T than offline/batched (GPU), so the measurement context probably flatters the NPU side — treat any NPU lead as an upper bound.',
          crossDevice.mixedScenario ? 'Pool spans more than one MLPerf scenario.' : 'One scenario per side.',
          'Cell auto-selected = the model+precision with the most cross-type runs; runs span multiple dates.',
          'For a strict apples-to-apples figure, use a controlled single-stream probe (both client-side).',
        ];
        return (
          <Box sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                size="small"
                color={vd.label === 'LEAD' ? 'success' : vd.label === 'TIE' ? 'default' : 'warning'}
                variant="outlined"
                sx={{ fontWeight: 600 }}
                label={
                  vd.label === 'LEAD'
                    ? `Exploratory — ${head}: ${tag(leader)} faster than ${tag(loser)} (Δ ${Math.abs(vd.delta).toFixed(3)}s, 95% CI(run) [${vd.ciLow.toFixed(2)}, ${vd.ciHigh.toFixed(2)}])`
                    : vd.label === 'TIE'
                      ? `Exploratory — ${head}: ${tag(a)} vs ${tag(b)} — statistical tie`
                      : `Exploratory — ${head}: ${tag(a)} vs ${tag(b)} — inconclusive`
                }
              />
              <Button
                size="small"
                variant="text"
                startIcon={<InfoIcon fontSize="small" />}
                onClick={() => setMethodOpen(o => !o)}
                aria-expanded={methodOpen}
                sx={{ color: 'text.secondary', minWidth: 0, py: 0 }}
              >
                {methodOpen ? 'Hide methodology' : 'Show methodology'}
              </Button>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                Welch t-test on TT100T · between-run (N={a.n} vs {b.n} runs) · observational
              </Typography>
            </Box>
            <Collapse in={methodOpen} unmountOnExit>
              <Alert
                severity="info"
                icon={<InfoIcon fontSize="small" />}
                sx={{ mt: 1, '& .MuiAlert-message': { width: '100%' } }}
              >
                <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 0.25 }}>
                  How to read this verdict
                </Typography>
                <List dense disablePadding sx={{ listStyleType: 'disc', pl: 2.5 }}>
                  {caveat.map((c, i) => (
                    <ListItem key={i} disableGutters sx={{ display: 'list-item', py: 0.05, px: 0 }}>
                      <ListItemText
                        primary={c}
                        primaryTypographyProps={{ variant: 'caption', sx: { color: 'text.secondary' } }}
                      />
                    </ListItem>
                  ))}
                </List>
              </Alert>
            </Collapse>
          </Box>
        );
      })()}

      {loading ? (
        <Box aria-busy="true" aria-label="Loading leaderboard">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="rectangular" height={34} sx={{ borderRadius: 1, mb: 0.75 }} />
          ))}
        </Box>
      ) : shown.length === 0 ? (
        <Alert severity="info">
          No measured TT100T runs match this filter yet. Start a benchmark (MLPerf or MMLU) to populate the leaderboard.
        </Alert>
      ) : (
        <>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
          ★ = Pareto-optimal: not beaten on both speed and accuracy.
        </Typography>
        <TableContainer sx={{ overflowX: 'auto', maxHeight: '60vh' }}>
        <Table size="small" stickyHeader aria-label="Cross-vendor TT100T leaderboard">
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700 }}>#</TableCell>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700 }}>Hardware</TableCell>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700 }}>Model</TableCell>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700, minWidth: 160 }}>{norm ? 'Speed score (0–100)' : 'TT100T (lower is better)'}</TableCell>
              {isVisible('throughput') && (
                <TableCell component="th" scope="col" sx={{ fontWeight: 700, textAlign: 'right' }}>{norm ? 'Throughput (0–100)' : 'Throughput'}</TableCell>
              )}
              {isVisible('efficiency') && (
                <TableCell component="th" scope="col" sx={{ fontWeight: 700, minWidth: 130 }}>Efficiency</TableCell>
              )}
              {isVisible('cost') && (
                <TableCell component="th" scope="col" sx={{ fontWeight: 700, textAlign: 'right' }}>Cost ($/Mtok)</TableCell>
              )}
              {isVisible('verdict') && (
                <TableCell component="th" scope="col" sx={{ fontWeight: 700, textAlign: 'center' }}>Verdict</TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((d, i) => {
              const v = verdictOf(d.tt100t);
              const vc = vendorColor(d.vendor, mode);
              // #27: only pool finite TT100Ts for the slowest, and guard d.tt100t
              // null so LinearProgress never receives a NaN value.
              const ttShown = shown.map(x => x.tt100t).filter((t): t is number => t != null);
              const slowestTt = ttShown.length ? Math.max(...ttShown) : 0;
              const barPct =
                slowestTt > 0 && d.tt100t != null ? ((d.tt100t as number) / slowestTt) * 100 : 0;
              const speedup = speedupVsSlowest(d, devices);
              return (
                <TableRow key={d.key} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Chip size="small" label={`${d.vendor} / ${d.hwModel}`} sx={{ bgcolor: `${vc}1F`, color: vc, fontWeight: 700 }} />
                      {d.paretoOptimal && (
                        <Tooltip title="Pareto-optimal: not beaten on both speed and accuracy" arrow>
                          <Chip
                            size="small"
                            label="★"
                            aria-label="Pareto-optimal: not beaten on both speed and accuracy"
                            sx={{ bgcolor: 'rgba(14,116,144,0.12)', color: '#0E7490', fontWeight: 800, height: 20 }}
                          />
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" fontFamily="monospace">{d.model ?? '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ minWidth: 64 }}>
                        <Typography variant="caption" fontFamily="monospace" fontWeight={700} component="div">
                          {norm
                            ? (Number.isFinite(bestTt) && bestTt > 0 && d.tt100t
                                ? Math.round((bestTt / (d.tt100t as number)) * 100)
                                : '—')
                            : fmtSec(d.tt100t)}
                        </Typography>
                        {!norm && d.tt100tSamples != null && d.tt100tSamples > 1 && d.tt100tStdev != null && d.tt100tStdev > 0 && (
                          <Typography variant="caption" component="div" sx={{ color: 'text.disabled', fontSize: '0.62rem', lineHeight: 1.1 }}>
                            ± {d.tt100tStdev.toFixed(3)}s · N={d.tt100tSamples}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 48 }}>
                        <LinearProgress
                          variant="determinate"
                          value={barPct}
                          sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover',
                            '& .MuiLinearProgress-bar': { bgcolor: vc, borderRadius: 3 } }}
                        />
                      </Box>
                      {speedup && (
                        <Tooltip title={`${speedup.factor.toFixed(2)}× faster TT100T than ${speedup.baselineLabel}`} arrow>
                          <Chip size="small" label={`${speedup.factor.toFixed(1)}×`} sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: 'rgba(22,163,74,0.14)', color: statusColor('success', mode) }} />
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  {isVisible('throughput') && (
                    <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      {norm
                        ? (d.tps != null && maxTps > 0 ? Math.round((d.tps / maxTps) * 100) : '—')
                        : fmtTps(d.tps)}
                    </TableCell>
                  )}
                  {isVisible('efficiency') && (
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="caption" fontWeight={700} sx={{ minWidth: 28 }}>
                          {d.efficiency != null ? Math.round(d.efficiency) : '—'}
                        </Typography>
                        <Box sx={{ flex: 1, minWidth: 40 }}>
                          <LinearProgress
                            variant="determinate"
                            value={d.efficiency ?? 0}
                            sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover',
                              '& .MuiLinearProgress-bar': { bgcolor: '#0E7490', borderRadius: 3 } }}
                          />
                        </Box>
                      </Stack>
                    </TableCell>
                  )}
                  {isVisible('cost') && (
                    <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      <Tooltip title="Modeled $ / 1M output tokens from external $/hr assumptions (not measured billing). Lower is better." arrow>
                        <Box component="span" sx={{ cursor: 'help', color: 'text.secondary' }}>{fmtCost(d.costPerMTok)}</Box>
                      </Tooltip>
                    </TableCell>
                  )}
                  {isVisible('verdict') && (
                    <TableCell sx={{ textAlign: 'center' }}>
                      <Chip
                        size="small"
                        label={v}
                        sx={{
                          bgcolor: v === 'PASS' ? 'rgba(22,163,74,0.15)' : v === 'FAIL' ? 'rgba(220,38,38,0.15)' : 'rgba(148,163,184,0.15)',
                          color: statusColor(v === 'PASS' ? 'success' : v === 'FAIL' ? 'error' : 'neutral', mode),
                          fontWeight: 700,
                        }}
                      />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </TableContainer>
        </>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
        <Button component={Link} to="/ml-perf/device-comparison" variant="outlined" size="small">MLPerf cross-device</Button>
        <Button component={Link} to="/mmlu/device-comparison" variant="outlined" size="small">MMLU cross-device</Button>
        <Button component={Link} to="/npu-eval/device-comparison" variant="outlined" size="small">NPU cross-device</Button>
      </Stack>
    </Paper>
  );
};

// ----------------------------------------------------------------------

const RecentActivity = ({ runs }: { runs: ComparisonRunRow[] }) => {
  const recent = [...runs]
    .filter(r => r.started_at)
    .sort((a, b) => Date.parse(b.started_at as string) - Date.parse(a.started_at as string))
    .slice(0, 8);
  const mode = useTheme().palette.mode;

  return (
    <Paper sx={{ p: 2.5, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <TrendingDownIcon sx={{ color: '#7C3AED' }} />
        <Typography variant="h6" fontWeight={700}>
          Recent Activity
        </Typography>
      </Box>
      {recent.length === 0 ? (
        <Alert severity="info">No runs recorded yet.</Alert>
      ) : (
        <Table size="small" aria-label="Recent benchmark runs">
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700 }}>ID</TableCell>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700 }}>Started</TableCell>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700 }}>Hardware</TableCell>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700 }}>Benchmark</TableCell>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700 }}>Status</TableCell>
              <TableCell component="th" scope="col" sx={{ fontWeight: 700, textAlign: 'right' }}>TT100T</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {recent.map(r => {
              const vendor = r.hardware?.vendor;
              const vc = vendorColor(vendor, mode);
              const status = r.status;
              const statusBg =
                status === 'Running' ? 'rgba(34,197,94,0.16)'
                  : status === 'Completed' ? 'rgba(59,130,246,0.16)'
                    : status === 'Error' || status === 'Failed' ? 'rgba(239,68,68,0.16)'
                      : 'rgba(148,163,184,0.16)';
              const statusFg = statusColor(
                status === 'Running' ? 'success'
                  : status === 'Completed' ? 'info'
                    : status === 'Error' || status === 'Failed' ? 'error'
                      : 'neutral',
                mode,
              );
              return (
                <TableRow key={`${r.id}-${vendor}-${r.benchmark}`} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>#{r.id}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                    {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={`${vendor} / ${r.hardware?.model}`} sx={{ bgcolor: `${vc}1F`, color: vc, fontWeight: 600 }} />
                  </TableCell>
                  <TableCell sx={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700 }}>{r.benchmark}</TableCell>
                  <TableCell>
                    <Chip size="small" label={status} sx={{ bgcolor: statusBg, color: statusFg, fontWeight: 600 }} />
                  </TableCell>
                  <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtSec(r.metrics?.tt100t_seconds)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
};

// ----------------------------------------------------------------------

const QuickActions = () => (
  <Paper sx={{ p: 2.5, mb: 3 }}>
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
      <Typography variant="h6" fontWeight={700}>Quick Links</Typography>
      <Chip size="small" icon={<RocketIcon sx={{ fontSize: 16 }} />} label="New here? Start with MLPerf or MMLU" sx={{ bgcolor: 'rgba(124,58,237,0.10)', color: '#7C3AED', fontWeight: 600 }} />
    </Stack>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
      <Button component={Link} to="/ml-perf" variant="contained" color="primary">MLPerf</Button>
      <Button component={Link} to="/mmlu" variant="contained" color="info">MMLU</Button>
      <Button component={Link} to="/npu-eval/rngd" variant="outlined">RNGD eval</Button>
      <Button component={Link} to="/npu-eval/atomplus" variant="outlined">Atom+ eval</Button>
      <Divider orientation="vertical" flexItem />
      <Button component={Link} to="/dashboard/gpu-realtime" variant="text">GPU realtime</Button>
      <Button component={Link} to="/dashboard/npu-realtime" variant="text">NPU realtime</Button>
    </Stack>
  </Paper>
);

// ----------------------------------------------------------------------

// Empty-state hero: when no runs exist yet, give the user three obvious next
// steps instead of a wall of "no data" alerts (QW-6).
const OnboardingBanner = () => {
  const cta = (to: string, title: string, caption: string, color: 'primary' | 'info' | 'secondary') => (
    <Button
      component={Link}
      to={to}
      variant="contained"
      size="large"
      color={color}
      sx={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', textTransform: 'none', py: 1.5 }}
    >
      <Typography component="span" fontWeight={700} sx={{ fontSize: '0.95rem' }}>{title}</Typography>
      <Typography component="span" sx={{ fontSize: '0.7rem', opacity: 0.85, fontWeight: 400 }}>{caption}</Typography>
    </Button>
  );
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" fontWeight={700}>No benchmarks yet — run your first comparison</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        Pick a benchmark to populate the leaderboard and the efficiency frontier.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        {cta('/ml-perf', 'Start MLPerf', 'throughput & TT100T', 'primary')}
        {cta('/mmlu', 'Start MMLU-Pro', 'accuracy', 'info')}
        {cta('/npu-eval/rngd', 'Start NPU Eval', 'vendor-native run', 'secondary')}
      </Stack>
      <Alert severity="info" icon={<InfoIcon fontSize="small" />}>
        Tip: the efficiency scatter needs <b>both</b> an MLPerf and an MMLU result per device.
      </Alert>
    </Paper>
  );
};

// ----------------------------------------------------------------------

const HomePage = () => {
  const leaderboardQuery = useQuery({
    queryKey: ['home', 'comparison-list'],
    queryFn: () => ComparisonApi.list({}),
    staleTime: 30_000,
  });
  // #8: one shared devices query feeds both the inventory card and the
  // current-cluster scoping for the leaderboard / scatter / roofline / verdict.
  const devicesQuery = useDevicesQuery();
  const currentModels = useMemo(() => deriveCurrentModels(devicesQuery.data), [devicesQuery.data]);

  const runs = toRows(leaderboardQuery.data);
  // #8: the hero verdict compares current-cluster hardware only.
  const crossDevice = useMemo(
    () => topCrossDeviceComparison(filterRunsToCurrentCluster(runs, currentModels)),
    [runs, currentModels],
  );
  const isEmpty = runs.length === 0 && !leaderboardQuery.isLoading && !leaderboardQuery.isError;

  return (
    <Box>
      <HeroBanner
        crossDevice={crossDevice}
        dataUpdatedAt={leaderboardQuery.dataUpdatedAt}
        onRefresh={() => leaderboardQuery.refetch()}
      />
      <VendorCluster devicesQuery={devicesQuery} />
      {leaderboardQuery.isError && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Could not reach <code>/api/comparison/list</code> — leaderboard and frontier are showing what is cached.
          Check the backend NodePort 30980 if this persists.
        </Alert>
      )}
      {isEmpty ? (
        <OnboardingBanner />
      ) : (
        <>
          <DeviceEfficiencyScatter runs={runs} currentModels={currentModels} />
          <RooflineChart runs={runs} currentModels={currentModels} />
          <Tt100tLeaderboard runs={runs} loading={leaderboardQuery.isLoading} currentModels={currentModels} />
          <RecentActivity runs={runs} />
        </>
      )}
      <QuickActions />
    </Box>
  );
};

export default HomePage;
