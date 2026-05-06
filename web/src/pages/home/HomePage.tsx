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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  Memory as MemoryIcon,
  Speed as SpeedIcon,
  CheckCircle as CheckIcon,
  Bolt as BoltIcon,
  TrendingDown as TrendingDownIcon,
} from '@mui/icons-material';

import { ComparisonApi, type ComparisonRunRow } from '@/api/domains/comparison';
import { DevicesApi } from '@/api/domains/devices.domains';

// ----------------------------------------------------------------------

const TT100T_TARGET = 1.1;

const VENDOR_COLOR: Record<string, string> = {
  nvidia: '#76B900',
  furiosa: '#7C3AED',
  rebellions: '#CA8A04',
};

const fmtSec = (s: number | null | undefined): string =>
  s == null ? '—' : `${s.toFixed(3)} s`;

const fmtTps = (n: number | null | undefined): string =>
  n == null ? '—' : `${n.toFixed(1)} tok/s`;

const verdictOf = (s: number | null | undefined): 'PASS' | 'FAIL' | 'UNKNOWN' => {
  if (s == null) return 'UNKNOWN';
  return s < TT100T_TARGET ? 'PASS' : 'FAIL';
};

// ----------------------------------------------------------------------

const HeroBanner = () => (
  <Paper
    sx={{
      p: 3,
      mb: 3,
      background: 'linear-gradient(135deg, #1E3A8A 0%, #4338CA 50%, #7C3AED 100%)',
      color: '#FFF',
    }}
  >
    <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} spacing={2}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="h4" fontWeight={700}>
          ETRI LLM Benchmarking Cluster
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
          NVIDIA L40 / A40 (node2,3) &nbsp;·&nbsp; FuriosaAI RNGD (node4) &nbsp;·&nbsp; Rebellions Atom+ (node5)
        </Typography>
      </Box>
      <Stack direction="row" spacing={1.5}>
        <Chip
          icon={<CheckIcon sx={{ color: '#FFF !important' }} />}
          label="3 vendors live"
          sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#FFF', fontWeight: 600 }}
        />
        <Chip
          icon={<BoltIcon sx={{ color: '#FFF !important' }} />}
          label="TT100T target < 1.1 s"
          sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#FFF', fontWeight: 600 }}
        />
      </Stack>
    </Stack>
  </Paper>
);

// ----------------------------------------------------------------------

const VendorCluster = () => {
  const { data: devices } = useQuery({
    queryKey: ['home', 'devices'],
    queryFn: DevicesApi.list,
    staleTime: 30_000,
  });

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

  return (
    <Paper sx={{ p: 2.5, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <MemoryIcon sx={{ color: '#1E40AF' }} />
        <Typography variant="h6" fontWeight={700}>
          Cluster Inventory
        </Typography>
      </Box>
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
          const statusFg =
            statusLabel === 'ready' ? '#15803D' : statusLabel === 'partial' ? '#92400E' : '#475569';
          return (
            <Box
              key={g.vendor}
              sx={{
                p: 2,
                borderRadius: 1.5,
                border: `1px solid ${VENDOR_COLOR[g.vendor]}33`,
                background: `linear-gradient(135deg, ${VENDOR_COLOR[g.vendor]}0d 0%, transparent 100%)`,
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ color: VENDOR_COLOR[g.vendor] }}>
                  {g.label}
                </Typography>
                <Chip
                  size="small"
                  label={statusLabel}
                  sx={{ bgcolor: statusBg, color: statusFg, fontWeight: 600, textTransform: 'uppercase', fontSize: '0.65rem' }}
                />
              </Stack>
              <Typography variant="h5" fontWeight={700} sx={{ color: '#0F172A' }}>
                {g.count}
                <Typography component="span" variant="caption" sx={{ color: '#64748B', ml: 1 }}>
                  device{g.count === 1 ? '' : 's'}
                </Typography>
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5 }}>
                {g.models || '—'}
              </Typography>
              <Typography variant="caption" sx={{ color: '#94A3B8', display: 'block' }}>
                node: {g.nodes || '—'}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
};

// ----------------------------------------------------------------------

const Tt100tLeaderboard = () => {
  const { data: runs, isError } = useQuery({
    queryKey: ['home', 'comparison-list'],
    queryFn: () => ComparisonApi.list({}),
    staleTime: 30_000,
  });

  // ComparisonApi.list returns { runs, total, diagnostic? }. Be tolerant of any
  // legacy shapes that might surface during a partial deploy.
  const all: ComparisonRunRow[] = Array.isArray(runs)
    ? (runs as unknown as ComparisonRunRow[])
    : ((runs as { runs?: ComparisonRunRow[] } | undefined)?.runs ?? []);
  const withTt = all.filter(r => r.metrics?.tt100t_seconds != null && (r.metrics.tt100t_seconds as number) > 0);
  // One representative row per vendor+model — best (lowest) tt100t
  const byKey = new Map<string, ComparisonRunRow>();
  for (const r of withTt) {
    const key = `${r.hardware?.vendor}/${r.hardware?.model}/${r.model}`;
    const cur = byKey.get(key);
    if (!cur || (r.metrics.tt100t_seconds as number) < (cur.metrics.tt100t_seconds as number)) {
      byKey.set(key, r);
    }
  }
  const ranked = Array.from(byKey.values()).sort(
    (a, b) => (a.metrics.tt100t_seconds as number) - (b.metrics.tt100t_seconds as number),
  );
  const top = ranked.slice(0, 6);

  return (
    <Paper sx={{ p: 2.5, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <SpeedIcon sx={{ color: '#0E7490' }} />
        <Typography variant="h6" fontWeight={700}>
          TT100T Leaderboard (cross-vendor, lowest is best)
        </Typography>
      </Box>
      {isError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          /api/comparison/list could not be reached. Showing empty leaderboard.
        </Alert>
      )}
      {top.length === 0 ? (
        <Alert severity="info">No measured TT100T runs yet. Start a benchmark to populate the leaderboard.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Hardware</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Model</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>TT100T mean</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Throughput</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}>Verdict</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Run</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {top.map((r, i) => {
              const v = verdictOf(r.metrics.tt100t_seconds);
              const vendor = r.hardware?.vendor;
              const vendorColor = VENDOR_COLOR[vendor as string] ?? '#64748B';
              return (
                <TableRow key={`${r.id}-${vendor}`} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={`${vendor} / ${r.hardware?.model}`}
                      sx={{ bgcolor: `${vendorColor}1F`, color: vendorColor, fontWeight: 700 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" fontFamily="monospace">
                      {r.model}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                    {fmtSec(r.metrics.tt100t_seconds)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {fmtTps(r.metrics.tps)}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'center' }}>
                    <Chip
                      size="small"
                      label={v}
                      sx={{
                        bgcolor:
                          v === 'PASS'
                            ? 'rgba(22,163,74,0.15)'
                            : v === 'FAIL'
                              ? 'rgba(220,38,38,0.15)'
                              : 'rgba(148,163,184,0.15)',
                        color: v === 'PASS' ? '#15803D' : v === 'FAIL' ? '#B91C1C' : '#475569',
                        fontWeight: 700,
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', color: '#64748B' }}>#{r.id}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button component={Link} to="/ml-perf/device-comparison" variant="outlined" size="small">
          MLPerf cross-device
        </Button>
        <Button component={Link} to="/mmlu/device-comparison" variant="outlined" size="small">
          MMLU cross-device
        </Button>
        <Button component={Link} to="/npu-eval/device-comparison" variant="outlined" size="small">
          NPU cross-device
        </Button>
      </Stack>
    </Paper>
  );
};

// ----------------------------------------------------------------------

const RecentActivity = () => {
  const { data: runs } = useQuery({
    queryKey: ['home', 'comparison-list-recent'],
    queryFn: () => ComparisonApi.list({}),
    staleTime: 30_000,
  });

  const all: ComparisonRunRow[] = Array.isArray(runs)
    ? (runs as unknown as ComparisonRunRow[])
    : ((runs as { runs?: ComparisonRunRow[] } | undefined)?.runs ?? []);
  const recent = [...all]
    .filter(r => r.started_at)
    .sort((a, b) => Date.parse(b.started_at as string) - Date.parse(a.started_at as string))
    .slice(0, 8);

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
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Started</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Hardware</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Benchmark</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>TT100T</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {recent.map(r => {
              const vendor = r.hardware?.vendor;
              const vendorColor = VENDOR_COLOR[vendor as string] ?? '#64748B';
              const status = r.status;
              const statusBg =
                status === 'Running'
                  ? 'rgba(34,197,94,0.16)'
                  : status === 'Completed'
                    ? 'rgba(59,130,246,0.16)'
                    : status === 'Error' || status === 'Failed'
                      ? 'rgba(239,68,68,0.16)'
                      : 'rgba(148,163,184,0.16)';
              const statusFg =
                status === 'Running'
                  ? '#15803D'
                  : status === 'Completed'
                    ? '#1D4ED8'
                    : status === 'Error' || status === 'Failed'
                      ? '#B91C1C'
                      : '#475569';
              return (
                <TableRow key={`${r.id}-${vendor}-${r.benchmark}`} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>#{r.id}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', color: '#64748B' }}>
                    {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={`${vendor} / ${r.hardware?.model}`}
                      sx={{ bgcolor: `${vendorColor}1F`, color: vendorColor, fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell sx={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700 }}>
                    {r.benchmark}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={status} sx={{ bgcolor: statusBg, color: statusFg, fontWeight: 600 }} />
                  </TableCell>
                  <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {fmtSec(r.metrics?.tt100t_seconds)}
                  </TableCell>
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
    <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
      Quick Links
    </Typography>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap">
      <Button component={Link} to="/ml-perf" variant="contained" color="primary">
        MLPerf
      </Button>
      <Button component={Link} to="/mmlu" variant="contained" color="info">
        MMLU
      </Button>
      <Button component={Link} to="/npu-eval/rngd" variant="outlined">
        RNGD eval
      </Button>
      <Button component={Link} to="/npu-eval/atomplus" variant="outlined">
        Atom+ eval
      </Button>
      <Divider orientation="vertical" flexItem />
      <Button component={Link} to="/dashboard/gpu-realtime" variant="text">
        GPU realtime
      </Button>
      <Button component={Link} to="/dashboard/npu-realtime" variant="text">
        NPU realtime
      </Button>
    </Stack>
  </Paper>
);

// ----------------------------------------------------------------------

const HomePage = () => (
  <Box>
    <HeroBanner />
    <VendorCluster />
    <Tt100tLeaderboard />
    <QuickActions />
    <RecentActivity />
  </Box>
);

export default HomePage;
