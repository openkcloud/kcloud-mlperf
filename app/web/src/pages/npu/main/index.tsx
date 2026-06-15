import { useState, useEffect } from 'react';
import { Alert, Box, Button, Typography, TextField, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, IconButton, Pagination, Stack, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { Delete as DeleteIcon, Visibility as VisibilityIcon, Stop as StopIcon, CompareArrows as CompareIcon } from '@mui/icons-material';
import {
  precisionInfoFor,
  precisionOptionsFor
} from '@/shared/precision-rules';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { NpuEvalApi } from '@/api/domains/npu-eval.domain';
import { QueryBoundary } from '@/components/QueryBoundary';
import { LiveBenchDashboard } from '@/components/benchmark-page';
import { NpuEvalQueryKeys } from '@/contexts/QueryContext/query.keys';
import { NpuEvalPageLinks } from '@/contexts/RouterContext/router.links';
import { StatusEnum } from '@/enums/status.enum';
import type { NpuExamCreateBody, NpuExamDetails } from '@/api/types/npu-eval.types';

// ----------------------------------------------------------------------
// Live progress card: fetches result rows and shows real progress (samples done /
// total) using `result_npu_util` as the canonical "samples_done" counter posted
// by bench_universal_poster.py and other client-side scripts.

const ActiveBenchmarkCard = ({ exam }: { exam: NpuExamDetails }) => {
  const { data: details } = useQuery({
    queryKey: NpuEvalQueryKeys.details(exam.id),
    queryFn: () => NpuEvalApi.details(exam.id),
    enabled:
      exam.status === StatusEnum.RUNNING ||
      exam.status === StatusEnum.PREPARING ||
      exam.status === StatusEnum.PENDING,
    refetchInterval: 5000,
  });
  const lastResult = details?.results?.[details.results.length - 1];
  const samplesDone = Math.floor(Number(lastResult?.result_npu_util ?? 0));
  const total = exam.data_number || 0;
  const pct =
    total > 0 && samplesDone > 0
      ? Math.min(100, (samplesDone / total) * 100)
      : exam.status === StatusEnum.PENDING
        ? 5
        : exam.status === StatusEnum.PREPARING
          ? 12
          : 0;
  const realProgress = total > 0 && samplesDone > 0;
  return (
    <Paper key={exam.id} sx={{ p: 2, mb: 1.5, bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box>
          <Typography fontWeight={700}>{exam.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {exam.benchmark.toUpperCase()} | {exam.model} | {exam.npu_type} x{exam.npu_num}
          </Typography>
        </Box>
        <Chip
          label={statusLabel(exam.status)}
          size="small"
          color={statusColor(exam.status) as any}
          sx={{
            animation: 'pulse 1.5s infinite',
            '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.6 }, '100%': { opacity: 1 } },
          }}
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
          <Typography variant="caption" color="text.secondary">Elapsed</Typography>
          <Typography variant="body2" fontWeight={600}>
            {exam.started_at ? `${Math.floor(dayjs().diff(dayjs(exam.started_at), 'minute'))}m` : '-'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Progress</Typography>
          <Typography variant="body2" fontWeight={600} sx={{ color: realProgress ? '#16A34A' : 'text.secondary' }}>
            {realProgress
              ? `${samplesDone.toLocaleString()} / ${total.toLocaleString()} (${pct.toFixed(1)}%)`
              : 'awaiting first checkpoint…'}
          </Typography>
        </Box>
      </Box>
      {/* Real progress bar — width tracks samples_done from result_npu_util */}
      <Box sx={{ mt: 1.5, height: 6, bgcolor: 'action.disabledBackground', borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{
          height: '100%',
          borderRadius: 3,
          bgcolor: realProgress ? '#16A34A' : '#F97316',
          width: `${pct}%`,
          animation: realProgress ? 'none' : 'progress 2s ease-in-out infinite',
          '@keyframes progress': { '0%': { opacity: 0.7 }, '50%': { opacity: 1 }, '100%': { opacity: 0.7 } },
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

const statusColor = (status: string) => {
  switch (status) {
    case StatusEnum.COMPLETED: return 'success';
    case StatusEnum.RUNNING: return 'info';
    case StatusEnum.PREPARING: return 'info';
    case StatusEnum.PENDING: return 'warning';
    case StatusEnum.ERROR: return 'error';
    case StatusEnum.STOPPED: return 'warning';
    case StatusEnum.IDLE: return 'default';
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
// B-validation #22: pull a human-readable message out of an Axios/API error.
// NestJS class-validator failures arrive as { message: string | string[] }.

const extractApiErrorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: { message?: unknown }; statusText?: string } })?.response;
  const apiMessage = response?.data?.message;
  if (Array.isArray(apiMessage)) return apiMessage.join(', ');
  if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage;
  if (response?.statusText) return response.statusText;
  if (error instanceof Error && error.message) return error.message;
  return 'Unknown error';
};

// ----------------------------------------------------------------------

const NpuEvalPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const limit = 10;

  const examListQuery = useQuery({
    queryKey: NpuEvalQueryKeys.list(page, limit),
    queryFn: () => NpuEvalApi.list({ page, limit }),
    refetchInterval: 5000,
  });
  const { data: examList } = examListQuery;

  const { data: npuListData } = useQuery({
    queryKey: NpuEvalQueryKeys.npuList(),
    queryFn: NpuEvalApi.npuList
  });

  const createMutation = useMutation({
    mutationFn: NpuEvalApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NpuEvalQueryKeys.PREFIX] });
      setShowForm(false);
      reset(DEFAULT_VALUES);
    }
  });

  // B-validation #22: surface create errors (e.g. DTO validation rejections)
  // to the user instead of swallowing them silently.
  const createErrorMessage = createMutation.isError
    ? extractApiErrorMessage(createMutation.error)
    : null;

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

  // Auto-switch dataset when benchmark changes
  const selectedBenchmark = watch('benchmark');
  useEffect(() => {
    const datasetMap: Record<string, string> = {
      mlperf: 'CNN-DailyMail',
      mmlu: 'MMLU-Pro',
    };
    if (datasetMap[selectedBenchmark]) {
      setValue('dataset', datasetMap[selectedBenchmark]);
    }
  }, [selectedBenchmark, setValue]);

  const onSubmit = (data: NpuExamFormData) => {
    createMutation.mutate({
      ...data,
      started_at: dayjs(data.started_at).format('YYYY-MM-DDTHH:mm:ssZ')
    });
  };

  const handleDeleteClick = (exam: NpuExamDetails) => {
    setDeleteTarget({ id: exam.id, name: exam.name });
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" component="h1" fontWeight={700}>NPU Evaluation</Typography>
          <Button
            variant="outlined"
            size="small"
            sx={{ mt: 0.5, mr: 1, color: '#F97316', borderColor: '#F97316' }}
            onClick={() => navigate('/npu-eval/device-comparison')}
          >
            <CompareIcon sx={{ mr: 0.5, fontSize: 18 }} />
            GPU vs NPU Comparison
          </Button>
          <Typography variant="body2" color="text.secondary">
            FuriosaAI RNGD NPU benchmark tests
            {npuListData?.npus?.[0] && (
              <> — {npuListData.npus[0].npu_model} ({npuListData.npus[0].memory_gb}GB HBM3, {npuListData.npus[0].compute_tflops} TFLOPS)</>
            )}
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'New NPU Exam'}
        </Button>
      </Box>

      {/* Create Form */}
      {showForm && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Create NPU Exam</Typography>
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
                  color="warning"
                  variant="outlined"
                  label={precisionInfoFor('rngd')}
                  sx={{ mt: 0.75, fontSize: '0.6875rem', height: 22 }}
                />
              )}
            </Box>
            <Controller name="framework" control={control} render={({ field }) => (
              <TextField {...field} label="Framework" size="small" disabled />
            )} />
            <Controller
              name="batch_size"
              control={control}
              rules={{ min: { value: 1, message: 'Batch size must be at least 1' } }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Batch Size"
                  size="small"
                  type="number"
                  inputProps={{ min: 1 }}
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Controller name="dataset" control={control} render={({ field }) => (
              <TextField {...field} label="Dataset" size="small" />
            )} />
            <Controller
              name="data_number"
              control={control}
              rules={{ min: { value: 0, message: 'Data samples cannot be negative' } }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Data Samples (0=full)"
                  size="small"
                  type="number"
                  inputProps={{ min: 0 }}
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message ?? '0 = full dataset'}
                />
              )}
            />
            <Controller name="npu_type" control={control} render={({ field }) => (
              <TextField {...field} label="NPU Type" size="small" disabled />
            )} />
            <Controller
              name="npu_num"
              control={control}
              rules={{ min: { value: 1, message: 'At least 1 NPU required' } }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="NPU Count"
                  size="small"
                  type="number"
                  inputProps={{ min: 1 }}
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Controller
              name="cpu_core"
              control={control}
              rules={{ min: { value: 1, message: 'At least 1 CPU core required' } }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="CPU Cores"
                  size="small"
                  type="number"
                  inputProps={{ min: 1 }}
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Controller
              name="ram_capacity"
              control={control}
              rules={{ min: { value: 0, message: 'RAM cannot be negative' } }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="RAM (GB)"
                  size="small"
                  type="number"
                  inputProps={{ min: 0 }}
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Controller
              name="retry_num"
              control={control}
              rules={{ min: { value: 1, message: 'At least 1 repetition required' } }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Repetitions"
                  size="small"
                  type="number"
                  inputProps={{ min: 1 }}
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Controller
              name="max_output_tokens"
              control={control}
              rules={{ min: { value: 0, message: 'Max output tokens cannot be negative' } }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Max Output Tokens (0=unlimited)"
                  size="small"
                  type="number"
                  inputProps={{ min: 0 }}
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message ?? '0 = unlimited'}
                />
              )}
            />
            <Controller name="started_at" control={control} render={({ field }) => (
              <TextField {...field} label="Start Time" size="small" type="datetime-local" InputLabelProps={{ shrink: true }} />
            )} />
            {createErrorMessage && (
              <Alert severity="error" sx={{ gridColumn: '1 / -1' }} onClose={() => createMutation.reset()}>
                Failed to create test: {createErrorMessage}
              </Alert>
            )}
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
              <TableCell>Max Tokens</TableCell>
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
                <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {exam.model}
                </TableCell>
                <TableCell>{exam.precision}</TableCell>
                <TableCell>{exam.npu_type} x{exam.npu_num}</TableCell>
                <TableCell>
                  <Chip
                    label={exam.data_number === 0 ? 'Full' : exam.data_number.toLocaleString()}
                    size="small"
                    variant="outlined"
                    color={exam.data_number === 0 ? 'primary' : 'default'}
                  />
                </TableCell>
                <TableCell>
                  {exam.max_output_tokens === 0 ? (
                    <Chip label="Unlimited" size="small" variant="outlined" color="primary" />
                  ) : (
                    exam.max_output_tokens.toLocaleString()
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    label={statusLabel(exam.status)}
                    size="small"
                    color={statusColor(exam.status) as any}
                    sx={exam.status === StatusEnum.RUNNING || exam.status === StatusEnum.PREPARING || exam.status === StatusEnum.PENDING
                      ? { animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.6 }, '100%': { opacity: 1 } } }
                      : {}
                    }
                  />
                </TableCell>
                <TableCell>
                  {dayjs(exam.created_at).format('MM/DD HH:mm')}
                  {exam.status === 'Error' && exam.error_log && (
                    <Typography variant="caption" color="error" sx={{ display: 'block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={exam.error_log}>
                      {exam.error_log}
                    </Typography>
                  )}
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
                  <IconButton size="small" color="error" aria-label={`Delete ${exam.name}`} onClick={() => handleDeleteClick(exam)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      </QueryBoundary>

      {examList && examList.total_pages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination count={examList.total_pages} page={page} onChange={(_, v) => setPage(v)} />
        </Stack>
      )}

      {/* Benchmark Activity Panel */}
      {examList?.list?.some((e: NpuExamDetails) => e.status === StatusEnum.RUNNING || e.status === StatusEnum.PREPARING || e.status === StatusEnum.PENDING) && (
        <Paper sx={{ p: 3, mt: 3, border: '1px solid rgba(249,115,22,0.3)', bgcolor: 'rgba(249,115,22,0.02)' }}>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#F97316', animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.4 }, '100%': { opacity: 1 } } }} />
            Active Benchmarks
          </Typography>
          {examList.list
            .filter((e: NpuExamDetails) => e.status === StatusEnum.RUNNING || e.status === StatusEnum.PREPARING || e.status === StatusEnum.PENDING)
            .map((exam: NpuExamDetails) => (
              <ActiveBenchmarkCard key={exam.id} exam={exam} />
            ))}
        </Paper>
      )}

      {/* Live Bench Dashboard (node4) — NPU telemetry, MLPerf accuracy progress, log tails */}
      <LiveBenchDashboard
        title="Live Bench Dashboard (node4)"
        src={
          (import.meta.env.VITE__APP_RNGD_LIVE_BENCH_URL as string | undefined) ??
          'http://10.254.202.114:30890/'
        }
        height={900}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
      >
        <DialogTitle>Delete NPU Exam</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>"{deleteTarget?.name}"</strong> (ID: {deleteTarget?.id})?
            This will permanently remove the exam and all its results.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained" disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NpuEvalPage;
