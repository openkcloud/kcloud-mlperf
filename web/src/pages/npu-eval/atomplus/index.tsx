import { useState, useEffect } from 'react';
import {
  Box, Button, Chip, CircularProgress, Alert, MenuItem,
  Pagination, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import { CompareArrows as CompareIcon } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { NpuEvalApi } from '@/api/domains/npu-eval.domain';
import { DevicesApi } from '@/api/domains/devices.domains';
import { ComparisonApi } from '@/api/domains/comparison';
import { NpuEvalQueryKeys } from '@/contexts/QueryContext/query.keys';
import { StatusEnum } from '@/enums/status.enum';
import { Tt100tBadge } from '@/components/Tt100tBadge';
import {
  HardwareIdentityCard,
  LiveBenchDashboard,
  getAtomPlusLiveBenchUrl,
} from '@/components/benchmark-page';
import type { ComparisonRunRow } from '@/api/domains/comparison';
import type { NpuExamCreateBody } from '@/api/types/npu-eval.types.d';

// ----------------------------------------------------------------------

const VENDOR_COLOR = '#A855F7'; // Rebellions purple — contract §11

// Atom+ live bench dashboard: served by atomplus_bench_dashboard.py on node5
// at port 30892. URL is env-aware via getAtomPlusLiveBenchUrl() (env var
// VITE__APP_ATOMPLUS_LIVE_BENCH_URL with hardcoded fallback).

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

type AtomExamFormData = NpuExamCreateBody;

const ATOM_DEFAULT_VALUES: AtomExamFormData = {
  name: '',
  description: '',
  benchmark: 'mlperf',
  model: 'rebellions/Llama-3.1-8B-Instruct',
  precision: 'fp8',
  framework: 'optimum-rbln',
  batch_size: 1,
  dataset: 'cnn_dailymail',
  data_number: 100,
  npu_type: 'ATOM',
  npu_num: 1,
  cpu_core: 8,
  ram_capacity: 64,
  retry_num: 3,
  max_output_tokens: 128,
  started_at: dayjs().format('YYYY-MM-DDTHH:mm')
};

// ----------------------------------------------------------------------

const AtomPlusNpuEvalPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const limit = 10;

  const { data: npuListData } = useQuery({
    queryKey: NpuEvalQueryKeys.npuList(),
    queryFn: NpuEvalApi.npuList,
  });

  const { data: devicesList } = useQuery({
    queryKey: ['devices', 'list'],
    queryFn: DevicesApi.list,
    refetchInterval: 15000,
  });

  const rebellionsDevices = (devicesList ?? []).filter(
    (d) => d.vendor === 'rebellions' && d.state === 'ready'
  );
  const hasReadyDevice = rebellionsDevices.length > 0;

  const createMutation = useMutation({
    mutationFn: NpuEvalApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NpuEvalQueryKeys.PREFIX] });
      setShowForm(false);
      reset(ATOM_DEFAULT_VALUES);
    }
  });

  const { control, handleSubmit, reset, watch, setValue } = useForm<AtomExamFormData>({
    defaultValues: ATOM_DEFAULT_VALUES
  });

  const selectedBenchmark = watch('benchmark');
  useEffect(() => {
    const datasetMap: Record<string, string> = { mlperf: 'cnn_dailymail', mmlu: 'MMLU-Pro' };
    if (datasetMap[selectedBenchmark]) setValue('dataset', datasetMap[selectedBenchmark]);
  }, [selectedBenchmark, setValue]);

  const onSubmit = (data: AtomExamFormData) => {
    createMutation.mutate({
      ...data,
      npu_type: 'ATOM',
      started_at: dayjs(data.started_at).format('YYYY-MM-DDTHH:mm:ssZ')
    });
  };

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

      {/* Device-aware create button and form */}
      {hasReadyDevice ? (
        <Box sx={{ mb: 2 }}>
          <Button variant="contained" sx={{ bgcolor: VENDOR_COLOR, '&:hover': { bgcolor: '#9333ea' } }} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'New Atom+ Exam'}
          </Button>
        </Box>
      ) : (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No ready Rebellions device found in cluster.
          Run: <code>kubectl get nodes -l kubernetes.io/hostname=node5</code> and
          <code>kubectl get pods -n rbln-system</code> to diagnose.
          Device plugin must report allocatable rebellions.ai/ATOM before exam creation is available.
        </Alert>
      )}

      {/* Create Form */}
      {showForm && hasReadyDevice && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Create Atom+ NPU Exam</Typography>
          <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
            <Controller name="name" control={control} rules={{ required: true }} render={({ field }) => (
              <TextField {...field} label="Test Name" size="small" required />
            )} />
            <Controller name="description" control={control} render={({ field }) => (
              <TextField {...field} label="Description" size="small" />
            )} />
            <Controller name="benchmark" control={control} render={({ field }) => (
              <TextField {...field} label="Benchmark" size="small" select>
                <MenuItem value="mlperf">MLPerf</MenuItem>
                <MenuItem value="mmlu">MMLU</MenuItem>
              </TextField>
            )} />
            <Controller name="model" control={control} render={({ field }) => (
              <TextField {...field} label="Model (HuggingFace path)" size="small" />
            )} />
            <Controller name="precision" control={control} render={({ field }) => (
              <TextField {...field} label="Precision" size="small" select>
                <MenuItem value="fp8">FP8</MenuItem>
                <MenuItem value="bf16">BF16</MenuItem>
                <MenuItem value="int8">INT8</MenuItem>
              </TextField>
            )} />
            <Controller name="framework" control={control} render={({ field }) => (
              <TextField {...field} label="Framework" size="small" disabled />
            )} />
            <Controller name="batch_size" control={control} render={({ field }) => (
              <TextField {...field} label="Batch Size" size="small" type="number" />
            )} />
            <Controller name="dataset" control={control} render={({ field }) => (
              <TextField {...field} label="Dataset" size="small" />
            )} />
            <Controller name="data_number" control={control} render={({ field }) => (
              <TextField {...field} label="Data Samples (0=full)" size="small" type="number" />
            )} />
            <TextField label="NPU Type" size="small" value="ATOM" disabled />
            <Controller name="npu_num" control={control} render={({ field }) => (
              <TextField {...field} label="NPU Count" size="small" type="number" />
            )} />
            <Controller name="cpu_core" control={control} render={({ field }) => (
              <TextField {...field} label="CPU Cores" size="small" type="number" />
            )} />
            <Controller name="ram_capacity" control={control} render={({ field }) => (
              <TextField {...field} label="RAM (GB)" size="small" type="number" />
            )} />
            <Controller name="retry_num" control={control} render={({ field }) => (
              <TextField {...field} label="Repetitions" size="small" type="number" />
            )} />
            <Controller name="max_output_tokens" control={control} render={({ field }) => (
              <TextField {...field} label="Max Output Tokens (0=unlimited)" size="small" type="number" />
            )} />
            <Controller name="started_at" control={control} render={({ field }) => (
              <TextField {...field} label="Start Time" size="small" type="datetime-local" InputLabelProps={{ shrink: true }} />
            )} />
            <Box sx={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button variant="outlined" onClick={() => { setShowForm(false); reset(ATOM_DEFAULT_VALUES); }}>Cancel</Button>
              <Button variant="contained" type="submit" disabled={createMutation.isPending} sx={{ bgcolor: VENDOR_COLOR, '&:hover': { bgcolor: '#9333ea' } }}>
                {createMutation.isPending ? 'Creating...' : 'Create Exam'}
              </Button>
            </Box>
          </Box>
        </Paper>
      )}

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
        src={getAtomPlusLiveBenchUrl()}
        height={900}
        idle={activeRuns.length === 0}
        idleLabel="No NPU benchmark currently running on Rebellions Atom+ devices"
      />
    </Box>
  );
};

export default AtomPlusNpuEvalPage;
