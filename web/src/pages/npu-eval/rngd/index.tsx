import { useState, useEffect } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, MenuItem, Pagination, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import { Delete as DeleteIcon, Visibility as VisibilityIcon, Stop as StopIcon, CompareArrows as CompareIcon } from '@mui/icons-material';
import { friendlyError } from '@/helpers/friendly-error.helper';
import {
  precisionInfoFor,
  precisionOptionsFor
} from '@/shared/precision-rules';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { NpuEvalApi } from '@/api/domains/npu-eval.domain';
import { ComparisonApi } from '@/api/domains/comparison';
import { QueryBoundary } from '@/components/QueryBoundary';
import { NpuEvalQueryKeys } from '@/contexts/QueryContext/query.keys';
import { NpuEvalPageLinks } from '@/contexts/RouterContext/router.links';
import { StatusEnum } from '@/enums/status.enum';
import { Tt100tBadge } from '@/components/Tt100tBadge';
import { HardwareIdentityCard, LiveBenchDashboard } from '@/components/benchmark-page';
import { useRealtimeExams } from '@/hooks/useRealtimeExams';
import type { NpuExamCreateBody, NpuExamDetails } from '@/api/types/npu-eval.types.d';

// ----------------------------------------------------------------------

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

const ActiveBenchmarkCard = ({ exam }: { exam: NpuExamDetails }) => {
  const { data: details } = useQuery({
    queryKey: NpuEvalQueryKeys.details(exam.id),
    queryFn: () => NpuEvalApi.details(exam.id),
    enabled: [StatusEnum.RUNNING, StatusEnum.PREPARING, StatusEnum.PENDING].includes(exam.status as StatusEnum),
    refetchInterval: 5000,
  });
  const lastResult = details?.results?.[details.results.length - 1];
  const samplesDone = Math.floor(Number(lastResult?.result_npu_util ?? 0));
  const total = exam.data_number || 0;
  const pct = total > 0 && samplesDone > 0
    ? Math.min(100, (samplesDone / total) * 100)
    : exam.status === StatusEnum.PENDING ? 5 : exam.status === StatusEnum.PREPARING ? 12 : 0;
  const realProgress = total > 0 && samplesDone > 0;

  return (
    <Paper key={exam.id} sx={{ p: 2, mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box>
          <Typography fontWeight={700}>{exam.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {exam.benchmark.toUpperCase()} | {exam.model} | RNGD x{exam.npu_num}
          </Typography>
        </Box>
        <Chip
          label={statusLabel(exam.status)}
          size="small"
          color={statusColor(exam.status) as any}
          sx={{ animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.6 }, '100%': { opacity: 1 } } }}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Dataset</Typography>
          <Typography variant="body2" fontWeight={600}>{exam.dataset} ({exam.data_number === 0 ? 'Full' : exam.data_number})</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Max Tokens</Typography>
          <Typography variant="body2" fontWeight={600}>{exam.max_output_tokens === 0 ? 'Unlimited' : exam.max_output_tokens}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Repetitions</Typography>
          <Typography variant="body2" fontWeight={600}>{exam.retry_num}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Started</Typography>
          <Typography variant="body2" fontWeight={600}>{exam.started_at ? dayjs(exam.started_at).format('HH:mm:ss') : 'Scheduled'}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Progress</Typography>
          <Typography variant="body2" fontWeight={600} sx={{ color: realProgress ? '#16A34A' : 'text.secondary' }}>
            {realProgress ? `${samplesDone.toLocaleString()} / ${total.toLocaleString()} (${pct.toFixed(1)}%)` : 'awaiting first checkpoint…'}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ mt: 1.5, height: 6, bgcolor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{
          height: '100%', borderRadius: 3,
          bgcolor: realProgress ? '#16A34A' : '#F97316',
          width: `${pct}%`,
          transition: 'width 0.5s ease',
        }} />
      </Box>
    </Paper>
  );
};

// ----------------------------------------------------------------------

type NpuExamFormData = NpuExamCreateBody;

const DEFAULT_VALUES: NpuExamFormData = {
  name: '',
  description: '',
  benchmark: 'mlperf',
  model: 'furiosa-ai/Llama-3.1-8B-Instruct',
  precision: 'FP8',
  framework: 'furiosa-llm',
  batch_size: 1,
  dataset: 'CNN-DailyMail',
  data_number: 0,
  npu_type: 'RNGD',
  npu_num: 1,
  cpu_core: 8,
  ram_capacity: 64,
  retry_num: 3,
  max_output_tokens: 0,
  started_at: dayjs().format('YYYY-MM-DDTHH:mm')
};

// ----------------------------------------------------------------------

const RngdNpuEvalPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const limit = 10;

  const examListQuery = useQuery({
    queryKey: [...NpuEvalQueryKeys.list(page, limit), 'rngd'],
    queryFn: () => NpuEvalApi.list({ page, limit }),
    refetchInterval: 5000,
    select: (data) => ({
      ...data,
      list: data.list?.filter((e: NpuExamDetails) => e.npu_type === 'RNGD') ?? []
    })
  });
  const { data: examList } = examListQuery;

  const { data: npuListData } = useQuery({
    queryKey: NpuEvalQueryKeys.npuList(),
    queryFn: NpuEvalApi.npuList
  });

  // tt100t lives in npu_exam_result, not npu_exam — the npu-eval/list endpoint does
  // not currently surface it. Pull it from /comparison/list which already does the
  // join, and key by id so the table can look up per-row TT100T for the badge.
  const { data: comparisonList } = useQuery({
    queryKey: ['comparison', 'list', 'rngd-tt100t'],
    queryFn: () => ComparisonApi.list({ hardware: 'npu' }),
    refetchInterval: 5000,
  });
  const tt100tById = new Map<number, number | null>();
  for (const r of comparisonList?.runs ?? []) {
    tt100tById.set(r.id, r.metrics?.tt100t_seconds ?? null);
  }

  const rngdInfo = npuListData?.npus?.find((n) => n.npu_model?.toLowerCase().includes('rngd')) ?? npuListData?.npus?.[0];

  const { snapshot: realtimeSnapshot } = useRealtimeExams({ pollIntervalMs: 5000 });
  const rngdSlot = realtimeSnapshot?.slots?.find(
    (s) => s.vendor === 'furiosa' && s.device_type === 'npu'
  ) ?? null;

  const createMutation = useMutation({
    mutationFn: NpuEvalApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NpuEvalQueryKeys.PREFIX] });
      setShowForm(false);
      reset(DEFAULT_VALUES);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: NpuEvalApi.deleteExam,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NpuEvalQueryKeys.PREFIX] });
      setDeleteTarget(null);
    }
  });

  const stopMutation = useMutation({
    mutationFn: NpuEvalApi.stopExam,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NpuEvalQueryKeys.PREFIX] });
    }
  });

  const { control, handleSubmit, reset, watch, setValue } = useForm<NpuExamFormData>({
    defaultValues: DEFAULT_VALUES
  });

  const selectedBenchmark = watch('benchmark');
  useEffect(() => {
    const datasetMap: Record<string, string> = { mlperf: 'CNN-DailyMail', mmlu: 'MMLU-Pro' };
    if (datasetMap[selectedBenchmark]) setValue('dataset', datasetMap[selectedBenchmark]);
  }, [selectedBenchmark, setValue]);

  const onSubmit = (data: NpuExamFormData) => {
    createMutation.mutate({
      ...data,
      npu_type: 'RNGD',
      started_at: dayjs(data.started_at).format('YYYY-MM-DDTHH:mm:ssZ')
    });
  };

  return (
    <Box>
      <HardwareIdentityCard
        vendor="FuriosaAI"
        model="RNGD"
        node="node4"
        count={rngdInfo?.npu_count ?? 1}
        vendorColor="#F97316"
        badgeLabel="FuriosaAI RNGD"
        extraInfo={rngdInfo ? `${rngdInfo.memory_gb}GB HBM3 | ${rngdInfo.compute_tflops} TFLOPS | ${rngdInfo.npu_count} NPU(s) detected` : undefined}
      />

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" component="h2" fontWeight={700}>RNGD NPU Evaluation</Typography>
          <Box sx={{ mt: 0.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              size="small"
              sx={{ color: '#F97316', borderColor: '#F97316' }}
              onClick={() => navigate('/npu-eval/rngd/device-comparison')}
            >
              <CompareIcon sx={{ mr: 0.5, fontSize: 18 }} />
              RNGD vs GPU Comparison
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            FuriosaAI RNGD NPU benchmark tests (vendor=furiosa, npu_type=RNGD)
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'New RNGD Exam'}
        </Button>
      </Box>

      {/* Create Form */}
      {showForm && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Create RNGD NPU Exam</Typography>
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
              <TextField {...field} label="Model" size="small" />
            )} />
            <Box>
              <Controller name="precision" control={control} render={({ field }) => (
                <TextField {...field} label="Precision" size="small" select fullWidth>
                  {precisionOptionsFor('rngd').map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </TextField>
              )} />
              {precisionInfoFor('rngd') && (
                <Chip
                  size="small"
                  label={precisionInfoFor('rngd')}
                  sx={{
                    mt: 0.75, fontSize: '0.6875rem', height: 22,
                    bgcolor: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A'
                  }}
                />
              )}
            </Box>
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
            <TextField label="NPU Type" size="small" value="RNGD" disabled />
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
              <Button variant="outlined" onClick={() => { setShowForm(false); reset(DEFAULT_VALUES); }}>Cancel</Button>
              <Button variant="contained" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Exam'}
              </Button>
            </Box>
          </Box>
        </Paper>
      )}

      {/* Exam List */}
      <QueryBoundary query={examListQuery} isEmpty={d => !d || !d.list || d.list.length === 0}>
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
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {examList?.list?.map((exam: NpuExamDetails) => (
              <TableRow key={exam.id} hover>
                <TableCell>{exam.id}</TableCell>
                <TableCell>{exam.name}</TableCell>
                <TableCell>
                  <Chip label={exam.benchmark.toUpperCase()} size="small" variant="outlined" />
                </TableCell>
                <TableCell sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {exam.model}
                </TableCell>
                <TableCell>{exam.precision}</TableCell>
                <TableCell>RNGD x{exam.npu_num}</TableCell>
                <TableCell>
                  <Chip
                    label={exam.data_number === 0 ? 'Full' : exam.data_number.toLocaleString()}
                    size="small"
                    variant="outlined"
                    color={exam.data_number === 0 ? 'primary' : 'default'}
                  />
                </TableCell>
                <TableCell>
                  <Tt100tBadge value={tt100tById.get(exam.id) ?? null} />
                </TableCell>
                <TableCell>
                  <Chip
                    label={statusLabel(exam.status)}
                    size="small"
                    color={statusColor(exam.status) as any}
                    sx={[StatusEnum.RUNNING, StatusEnum.PREPARING, StatusEnum.PENDING].includes(exam.status as StatusEnum)
                      ? { animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.6 }, '100%': { opacity: 1 } } }
                      : {}
                    }
                  />
                </TableCell>
                <TableCell>
                  {dayjs(exam.created_at).format('MM/DD HH:mm')}
                  {exam.status === 'Error' && exam.error_log && (() => {
                    const fe = friendlyError(exam.error_log);
                    return (
                      <Tooltip
                        arrow
                        title={
                          <Box sx={{ maxWidth: 320 }}>
                            <Typography variant="caption" fontWeight={700} display="block">{fe?.title}</Typography>
                            <Typography variant="caption" display="block">{fe?.detail}</Typography>
                            {fe?.action && <Typography variant="caption" display="block" sx={{ mt: 0.5, fontStyle: 'italic' }}>Fix: {fe.action}</Typography>}
                            <Typography variant="caption" display="block" sx={{ mt: 0.5, opacity: 0.6 }}>{fe?.raw}</Typography>
                          </Box>
                        }
                      >
                        <Typography variant="caption" color="error" sx={{ display: 'block', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help', fontWeight: 600 }}>
                          {fe?.title}
                        </Typography>
                      </Tooltip>
                    );
                  })()}
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" aria-label={`View results for ${exam.name}`} onClick={() => navigate(NpuEvalPageLinks.testResult(exam.id))}>
                    <VisibilityIcon fontSize="small" />
                  </IconButton>
                  {exam.status === StatusEnum.RUNNING && (
                    <IconButton size="small" color="warning" aria-label={`Stop ${exam.name}`} onClick={() => stopMutation.mutate(exam.id)}>
                      <StopIcon fontSize="small" />
                    </IconButton>
                  )}
                  <IconButton size="small" color="error" aria-label={`Delete ${exam.name}`} onClick={() => setDeleteTarget({ id: exam.id, name: exam.name })}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {(!examList?.list || examList.list.length === 0) && (
              <TableRow>
                <TableCell colSpan={11} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No RNGD exams found. Create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      </QueryBoundary>

      {examList && (examList as any).total_pages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination count={(examList as any).total_pages} page={page} onChange={(_, v) => setPage(v)} />
        </Stack>
      )}

      {/* Active benchmarks panel */}
      {examList?.list?.some((e: NpuExamDetails) => [StatusEnum.RUNNING, StatusEnum.PREPARING, StatusEnum.PENDING].includes(e.status as StatusEnum)) && (
        <Paper sx={{ p: 3, mt: 3, border: '1px solid rgba(249,115,22,0.3)', bgcolor: 'rgba(249,115,22,0.02)' }}>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#F97316', animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.4 }, '100%': { opacity: 1 } } }} />
            Active RNGD Benchmarks
          </Typography>
          {examList.list
            .filter((e: NpuExamDetails) => [StatusEnum.RUNNING, StatusEnum.PREPARING, StatusEnum.PENDING].includes(e.status as StatusEnum))
            .map((exam: NpuExamDetails) => <ActiveBenchmarkCard key={exam.id} exam={exam} />)}
        </Paper>
      )}

      {/* Active Benchmark (cluster-source) — shows k8s job status even when systemd iframe is idle */}
      <Paper sx={{ p: 3, mb: 2, border: '1px solid rgba(249,115,22,0.3)', bgcolor: 'rgba(249,115,22,0.02)' }}>
        <Typography variant="h6" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#F97316',
            ...(rngdSlot && ['Running', 'Preparing', 'Queued'].includes(rngdSlot.status)
              ? { animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.4 }, '100%': { opacity: 1 } } }
              : {})
          }} />
          Active Benchmark (cluster-source)
        </Typography>
        {rngdSlot && rngdSlot.exam_name ? (
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Exam</Typography>
              <Typography variant="body2" fontWeight={600}>{rngdSlot.exam_name}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Status</Typography>
              <Chip
                label={rngdSlot.status}
                size="small"
                color={rngdSlot.status === 'Running' ? 'info' : rngdSlot.status === 'Preparing' ? 'info' : 'warning'}
                sx={['Running', 'Preparing', 'Queued'].includes(rngdSlot.status)
                  ? { animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.6 }, '100%': { opacity: 1 } } }
                  : {}}
              />
            </Box>
            {rngdSlot.elapsed_seconds != null && (
              <Box>
                <Typography variant="caption" color="text.secondary">Elapsed</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {Math.floor(rngdSlot.elapsed_seconds / 60)}m {rngdSlot.elapsed_seconds % 60}s
                </Typography>
              </Box>
            )}
            {rngdSlot.exam_id != null && (
              <Box>
                <Typography variant="caption" color="text.secondary">Exam ID</Typography>
                <Typography variant="body2" fontWeight={600}>{rngdSlot.exam_id}</Typography>
              </Box>
            )}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No active RNGD job in cluster orchestrator
          </Typography>
        )}
      </Paper>

      {/* TODO: LAN-only fallback IP — set VITE__APP_RNGD_LIVE_BENCH_URL for external access */}
      <LiveBenchDashboard
        title="Live Bench Dashboard (node4 — RNGD)"
        src="http://10.254.202.114:30890/"
        height={900}
      />

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete RNGD Exam</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete <strong>"{deleteTarget?.name}"</strong> (ID: {deleteTarget?.id})? This will permanently remove all results.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} color="error" variant="contained" disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RngdNpuEvalPage;
