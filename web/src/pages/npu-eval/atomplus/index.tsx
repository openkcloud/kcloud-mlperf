import { useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Alert,
  Pagination, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography
} from '@mui/material';
import { CompareArrows as CompareIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { NpuEvalApi } from '@/api/domains/npu-eval.domain';
import { ComparisonApi } from '@/api/domains/comparison';
import { NpuEvalQueryKeys } from '@/contexts/QueryContext/query.keys';
import { StatusEnum } from '@/enums/status.enum';
import { Tt100tBadge } from '@/components/Tt100tBadge';
import { HardwareIdentityCard, LiveBenchDashboard } from '@/components/benchmark-page';
import type { ComparisonRunRow } from '@/api/domains/comparison';

// ----------------------------------------------------------------------

const VENDOR_COLOR = '#A855F7'; // Rebellions purple — contract §11

// NPU realtime dashboard: absolute URL so iframe loads the SPA page correctly.
// No external Streamlit/Grafana is deployed for Atom+ — the in-app npu-realtime
// page embeds both RNGD and Atom+ device cards and is the canonical live view.
// deviation: height=900 per contract §17 rule 1 (same as RNGD default).
const NPU_REALTIME_URL =
  (import.meta.env.VITE__APP_NPU_REALTIME_URL as string | undefined) ||
  `${window.location.protocol}//${window.location.host}/dashboard/npu-realtime`;

const statusColor = (status: string) => {
  switch (status) {
    case StatusEnum.COMPLETED: return 'success';
    case StatusEnum.RUNNING: return 'info';
    case StatusEnum.PREPARING: return 'info';
    case StatusEnum.PENDING: return 'warning';
    case StatusEnum.ERROR: return 'error';
    case StatusEnum.STOPPED: return 'warning';
    default: return 'default';
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case StatusEnum.PENDING: return 'Pending...';
    case StatusEnum.PREPARING: return 'Preparing NPU...';
    case StatusEnum.RUNNING: return 'Running on NPU...';
    case StatusEnum.COMPLETED: return 'Completed';
    case StatusEnum.ERROR: return 'Error';
    case StatusEnum.STOPPED: return 'Stopped';
    case StatusEnum.IDLE: return 'Idle';
    default: return status;
  }
};

// ----------------------------------------------------------------------

const ActiveBenchmarkCard = ({ run }: { run: ComparisonRunRow }) => {
  const isActive = [StatusEnum.RUNNING, StatusEnum.PREPARING, StatusEnum.PENDING].includes(run.status as StatusEnum);
  const pct = run.status === StatusEnum.PENDING ? 5 : run.status === StatusEnum.PREPARING ? 12 : 0;

  return (
    <Paper key={run.id} sx={{ p: 2, mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box>
          <Typography fontWeight={700}>{run.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {run.benchmark.toUpperCase()} | {run.model} | {run.hardware.model}
          </Typography>
        </Box>
        <Chip
          label={statusLabel(run.status)}
          size="small"
          color={statusColor(run.status) as any}
          sx={isActive ? { animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.6 }, '100%': { opacity: 1 } } } : {}}
        />
      </Box>
      <Box sx={{ mt: 1.5, height: 6, bgcolor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{
          height: '100%', borderRadius: 3,
          bgcolor: '#F97316',
          width: `${pct}%`,
          transition: 'width 0.5s ease',
        }} />
      </Box>
    </Paper>
  );
};

// ----------------------------------------------------------------------

const AtomPlusNpuEvalPage = () => {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const limit = 10;

  const { data: npuListData } = useQuery({
    queryKey: NpuEvalQueryKeys.npuList(),
    queryFn: NpuEvalApi.npuList,
  });

  const atomInfo = npuListData?.npus?.find((n) => n.npu_model?.toLowerCase().includes('atom')) ?? npuListData?.npus?.[0];

  const { data: comparisonData, isLoading, error } = useQuery({
    queryKey: ['comparison', 'list', 'atomplus-runs', page],
    queryFn: () => ComparisonApi.list({ vendor: 'rebellions' } as any),
    refetchInterval: 5000,
  });

  const allRuns: ComparisonRunRow[] = (comparisonData?.runs ?? []).filter(
    (r) => r.hardware.vendor === 'rebellions'
  );

  const totalPages = Math.ceil(allRuns.length / limit);
  const pagedRuns = allRuns.slice((page - 1) * limit, page * limit);

  const activeRuns = allRuns.filter((r) =>
    [StatusEnum.RUNNING, StatusEnum.PREPARING, StatusEnum.PENDING].includes(r.status as StatusEnum)
  );

  return (
    <Box>
      <HardwareIdentityCard
        vendor="Rebellions"
        model="Atom+"
        node="node5"
        count={atomInfo?.npu_count ?? 2}
        vendorColor={VENDOR_COLOR}
        badgeLabel="Rebellions Atom+"
        extraInfo={atomInfo ? `${atomInfo.memory_gb}GB HBM | ${atomInfo.compute_tflops} TFLOPS | ${atomInfo.npu_count} NPU(s) detected` : 'RBLN-CA22 | NPU Count: 2 | Discovery: rbln-smi'}
      />

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Atom+ NPU Evaluation</Typography>
          <Box sx={{ mt: 0.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              size="small"
              sx={{ color: VENDOR_COLOR, borderColor: VENDOR_COLOR }}
              onClick={() => navigate('/npu-eval/atomplus/device-comparison')}
            >
              <CompareIcon sx={{ mr: 0.5, fontSize: 18 }} />
              Atom+ vs GPU Comparison
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Rebellions Atom+ NPU benchmark tests (vendor=rebellions, node=node5)
          </Typography>
        </Box>
      </Box>

      {/* D-8: inform demo users why there is no "New Exam" button */}
      <Alert severity="info" sx={{ mb: 2 }}>
        Awaiting device plugin — exam creation disabled until node5 joins the cluster.
      </Alert>

      {/* Run Table */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>Failed to load Atom+ runs. Please refresh.</Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      ) : (
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
              {pagedRuns.map((run) => (
                <TableRow key={run.id} hover>
                  <TableCell>{run.id}</TableCell>
                  <TableCell sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                      color={(run as ComparisonRunRow & { data_number?: number }).data_number === 0 ? 'primary' : 'default'}
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
                      label={statusLabel(run.status)}
                      size="small"
                      color={statusColor(run.status) as any}
                      sx={[StatusEnum.RUNNING, StatusEnum.PREPARING, StatusEnum.PENDING].includes(run.status as StatusEnum)
                        ? { animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.6 }, '100%': { opacity: 1 } } }
                        : {}
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {run.completed_at ? dayjs(run.completed_at).format('MM/DD HH:mm') : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {pagedRuns.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    No Atom+ runs found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination count={totalPages} page={page} onChange={(_, v) => setPage(v)} />
        </Stack>
      )}

      {/* Active benchmarks panel */}
      {activeRuns.length > 0 && (
        <Paper sx={{ p: 3, mt: 3, border: '1px solid rgba(168,85,247,0.3)', bgcolor: 'rgba(168,85,247,0.02)' }}>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: VENDOR_COLOR, animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.4 }, '100%': { opacity: 1 } } }} />
            Active Atom+ Benchmarks
          </Typography>
          {activeRuns.map((run) => <ActiveBenchmarkCard key={run.id} run={run} />)}
        </Paper>
      )}

      <LiveBenchDashboard
        title="Live Bench Dashboard (node5 — Atom+)"
        src={NPU_REALTIME_URL}
        height={900}
      />
    </Box>
  );
};

export default AtomPlusNpuEvalPage;
