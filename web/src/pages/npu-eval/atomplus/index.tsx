import { Box, Paper, Typography, Alert, AlertTitle, Chip, Divider, Link, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, CircularProgress, Button } from '@mui/material';
import { CheckCircle as CheckCircleIcon, Memory as MemoryIcon, Extension as ExtensionIcon, Science as ScienceIcon, Storage as StorageIcon, CompareArrows as CompareIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { DevicesApi } from '@/api/domains/devices.domains';
import { ComparisonApi } from '@/api/domains/comparison';
import { DevicesQueryKeys } from '@/contexts/QueryContext/query.keys';
import { Tt100tBadge } from '@/components/Tt100tBadge';
import type { ComparisonRunRow } from '@/api/domains/comparison';

// ----------------------------------------------------------------------

const READINESS_ITEMS = [
  {
    Icon: ExtensionIcon,
    title: 'rbln-npu-operator v0.3.3 deployed',
    detail:
      'helm release rbln-system/rbln-npu-operator deployed. rbln-device-plugin DaemonSet running on node5; rebellions.ai/ATOM advertised as allocatable (count: 2). Host driver (kernel module rebellions 2.0.1) bypasses the in-cluster driver pod.',
  },
  {
    Icon: ScienceIcon,
    title: 'vllm-rbln + optimum-rbln runtime ready',
    detail:
      'node5 host has vllm 0.10.2, vllm_rbln 0.9.3.post2, optimum-rbln 0.9.3.post1, transformers 4.57.1, torch 2.8.0 (verified via pip3 list). Container image jungwooshim/etri-llm-rbln-smoke:v1 packages the same wheels for in-cluster Job execution.',
  },
  {
    Icon: StorageIcon,
    title: 'TT100T smoke benchmark PASSING',
    detail:
      'Qwen/Qwen2.5-0.5B-Instruct, 100 output tokens, mean 0.727s (target <1.1s), throughput ~137 tok/s, no invalid runs. See reports/atomplus_tt100t_analysis.md.',
  },
] as const;

// ----------------------------------------------------------------------

const statusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case 'completed': return 'success';
    case 'running': return 'info';
    case 'pending': return 'warning';
    case 'error': return 'error';
    case 'stopped': return 'warning';
    default: return 'default';
  }
};

// ----------------------------------------------------------------------

const HardwareIdentityCard = () => {
  const { data: deviceData } = useQuery({
    queryKey: DevicesQueryKeys.list(),
    queryFn: DevicesApi.list,
  });

  const rebellionsDevices = (Array.isArray(deviceData) ? deviceData : []).filter(
    (d: { vendor?: string }) => d.vendor?.toLowerCase() === 'rebellions'
  );

  return (
    <Paper
      sx={{
        p: 2,
        mb: 3,
        border: '1px solid rgba(234,179,8,0.25)',
        bgcolor: 'rgba(234,179,8,0.03)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#CA8A04' }}>Hardware Identity</Typography>
          <Typography variant="body2">Vendor: Rebellions &nbsp;|&nbsp; Model: Atom+ &nbsp;|&nbsp; Node: node5</Typography>
          {rebellionsDevices.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {rebellionsDevices.length} device{rebellionsDevices.length !== 1 ? 's' : ''} in /api/devices &nbsp;|&nbsp; Device ID: RBLN-CA22 &nbsp;|&nbsp; NPU Count: 2
            </Typography>
          )}
          {rebellionsDevices.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              Device ID: RBLN-CA22 &nbsp;|&nbsp; NPU Count: 2 &nbsp;|&nbsp; Discovery: rbln-smi
            </Typography>
          )}
        </Box>
        <Chip label="Rebellions Atom+" sx={{ bgcolor: 'rgba(234,179,8,0.12)', color: '#CA8A04', fontWeight: 700, border: '1px solid rgba(234,179,8,0.3)' }} />
      </Box>
    </Paper>
  );
};

// ----------------------------------------------------------------------

const ReadinessSummary = () => (
  <Alert
    severity="success"
    icon={<CheckCircleIcon />}
    sx={{
      mb: 3,
      border: '1px solid rgba(22,163,74,0.4)',
      bgcolor: 'rgba(240,253,244,0.8)',
      '& .MuiAlert-icon': { color: '#15803D' },
    }}
  >
    <AlertTitle sx={{ fontWeight: 700, color: '#14532D', fontSize: '1rem' }}>
      Atom+ ready — runtime, scheduler, and TT100T benchmark all green
    </AlertTitle>
    <Typography variant="body2" sx={{ color: '#166534', mb: 2 }}>
      As of RUN_ID 20260429-071649-46d82f8, node5 Rebellions Atom+ is end-to-end operational: cluster scheduling
      works, the vllm-rbln runtime is in place, and the first measured TT100T smoke benchmark cleared the &lt;1.1s
      target.
    </Typography>

    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {READINESS_ITEMS.map(({ Icon, title, detail }, idx) => (
        <Box key={title} sx={{ display: 'flex', gap: 1.5 }}>
          <Box
            sx={{
              mt: 0.25,
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: 'rgba(22,163,74,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Typography sx={{ fontWeight: 800, fontSize: '0.75rem', color: '#14532D' }}>{idx + 1}</Typography>
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
              <Icon sx={{ fontSize: 16, color: '#15803D' }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: '#14532D' }}>
                {title}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: '#166534', lineHeight: 1.5 }}>
              {detail}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>

    <Divider sx={{ my: 2, borderColor: 'rgba(22,163,74,0.3)' }} />

    <Typography variant="caption" sx={{ color: '#166534' }}>
      Cluster gap fix report:{' '}
      <Link
        href="/docs/node5_atomplus_runbook.md"
        target="_blank"
        rel="noopener noreferrer"
        sx={{ color: '#15803D', fontWeight: 600 }}
      >
        node5 Atom+ runbook
      </Link>
      {' '}— rerun + rollback recipes are recorded in reports/atomplus_cluster_gap_fix_report.md.
    </Typography>
  </Alert>
);

// ----------------------------------------------------------------------

const RunTable = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['comparison', 'list', 'atomplus-runs'],
    queryFn: () => ComparisonApi.list({ hardware: 'all' }),
    refetchInterval: 10_000,
  });

  const atomRuns: ComparisonRunRow[] = (data?.runs ?? []).filter(
    (r) => r.hardware.vendor === 'rebellions'
  );

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>Failed to load Atom+ runs. Please refresh.</Alert>
    );
  }

  if (atomRuns.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center', border: '1px dashed rgba(148,163,184,0.4)', bgcolor: 'rgba(248,250,252,0.8)' }}>
        <MemoryIcon sx={{ fontSize: 48, color: '#CBD5E1', mb: 1.5 }} />
        <Typography variant="h6" fontWeight={600} sx={{ color: '#475569', mb: 0.75 }}>
          No Atom+ runs yet
        </Typography>
        <Typography variant="body2" sx={{ color: '#94A3B8', maxWidth: 480, mx: 'auto' }}>
          Completed and in-progress Atom+ benchmark runs will appear here once submitted.
        </Typography>
      </Paper>
    );
  }

  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>ID</TableCell>
            <TableCell>Name</TableCell>
            <TableCell>Benchmark</TableCell>
            <TableCell>Model</TableCell>
            <TableCell>Precision</TableCell>
            <TableCell>NPU</TableCell>
            <TableCell>Dataset</TableCell>
            <TableCell>TT100T (&lt;1.1s)</TableCell>
            <TableCell>TPS</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Completed</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {atomRuns.map((run) => (
            <TableRow key={run.id} hover>
              <TableCell>{run.id}</TableCell>
              <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {run.name}
              </TableCell>
              <TableCell>
                <Chip label={run.benchmark.toUpperCase()} size="small" variant="outlined" />
              </TableCell>
              <TableCell sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {run.model}
              </TableCell>
              <TableCell>{(run as ComparisonRunRow & { precision?: string }).precision ?? '—'}</TableCell>
              <TableCell>{run.hardware.model}</TableCell>
              <TableCell>
                <Chip
                  label={(run as ComparisonRunRow & { data_number?: number }).data_number === 0 ? 'Full' : ((run as ComparisonRunRow & { data_number?: number }).data_number?.toLocaleString() ?? '—')}
                  size="small"
                  variant="outlined"
                />
              </TableCell>
              <TableCell>
                <Tt100tBadge value={run.metrics.tt100t_seconds ?? null} />
              </TableCell>
              <TableCell>
                {run.metrics.tps != null ? run.metrics.tps.toFixed(1) : '—'}
              </TableCell>
              <TableCell>
                <Chip
                  label={run.status}
                  size="small"
                  color={statusColor(run.status) as any}
                />
              </TableCell>
              <TableCell>
                {run.completed_at ? dayjs(run.completed_at).format('MM/DD HH:mm') : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

// ----------------------------------------------------------------------

const ComparisonEntryCard = () => {
  const navigate = useNavigate();
  return (
    <Box sx={{ mt: 0.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      <Button
        variant="outlined"
        size="small"
        sx={{ color: '#CA8A04', borderColor: '#CA8A04' }}
        onClick={() => navigate('/npu-eval/atomplus/device-comparison')}
      >
        <CompareIcon sx={{ mr: 0.5, fontSize: 18 }} />
        Atom+ vs GPU Comparison
      </Button>
    </Box>
  );
};

// ----------------------------------------------------------------------

const LiveBenchDashboard = () => (
  <Paper sx={{ p: 2, mt: 3 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
      <Typography variant="h6">Live Bench Dashboard (node5 — Atom+)</Typography>
      <Typography variant="caption">
        <a
          href="/dashboard/npu-realtime"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#3aa3ff', textDecoration: 'none' }}
        >
          open in new tab ↗
        </a>
      </Typography>
    </Box>
    <Box
      component="iframe"
      src="/dashboard/npu-realtime"
      title="node5 Atom+ realtime dashboard"
      sx={{ width: '100%', height: 700, border: 0, borderRadius: 1, bgcolor: '#0e1117', display: 'block' }}
    />
  </Paper>
);

// ----------------------------------------------------------------------

const AtomPlusPage = () => (
  <Box>
    <Box sx={{ mb: 3 }}>
      <Typography variant="h5" fontWeight={700} sx={{ color: '#0F172A' }}>
        Rebellions Atom+ NPU Eval
      </Typography>
      <ComparisonEntryCard />
      <Typography variant="body2" sx={{ color: '#64748B', mt: 0.5 }}>
        node5 &mdash; RBLN-CA22 &times; 2 &mdash; Ready, scheduler-allocatable, TT100T PASS
      </Typography>
    </Box>

    <HardwareIdentityCard />
    <ReadinessSummary />
    <RunTable />
    <LiveBenchDashboard />
  </Box>
);

export default AtomPlusPage;
