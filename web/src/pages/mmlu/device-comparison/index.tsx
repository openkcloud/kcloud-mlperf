import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
  Typography,
  useTheme
} from '@mui/material';

import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader/DeviceDashboardHeader';
import { MmExamApi } from '@/api/domains/mm-exam.domains';
import { NpuEvalApi } from '@/api/domains/npu-eval.domain';
import { httpClient } from '@/libs/http-client';
import type { MmExamResultList } from '@/api/types/mm-exam.types';
import type { NpuExamDetails } from '@/api/types/npu-eval.types';
import { MmluPageLinks } from '@/contexts/RouterContext/router.links';

// ----------------------------------------------------------------------

const MmluDeviceComparisonPage = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  const [selectedGpu, setSelectedGpu] = useState<MmExamResultList | null>(null);
  const [selectedNpu, setSelectedNpu] = useState<NpuExamDetails | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareData, setCompareData] = useState<any | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const {
    data: gpuData,
    isLoading: gpuLoading,
    error: gpuError
  } = useQuery({
    queryKey: ['device-comparison', 'mmlu', 'gpu-list'],
    queryFn: () => MmExamApi.list({ page: 1, limit: 100 }),
    refetchInterval: 30_000
  });

  const {
    data: npuData,
    isLoading: npuLoading,
    error: npuError
  } = useQuery({
    queryKey: ['device-comparison', 'mmlu', 'npu-list'],
    queryFn: () => NpuEvalApi.list({ page: 1, limit: 100 }),
    refetchInterval: 30_000
  });

  const gpuExams = (gpuData?.list ?? []).filter((e) => e.status === 'Completed');
  const npuExams = (npuData?.list ?? []).filter(
    (e) => e.status === 'Completed' && e.benchmark === 'mmlu'
  );

  const handleCompare = async () => {
    if (!selectedNpu || !selectedGpu) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    try {
      // Use server-side compare endpoint; falls back to client-side if not available
      const { data } = await httpClient.get(
        `/npu-eval/compare/${selectedNpu.id}/${selectedGpu.id}`
      );
      setCompareData(data);
      setDialogOpen(true);
    } catch {
      // Fallback: fetch both result sets and render side-by-side client-side
      try {
        const [npuRes, gpuRes] = await Promise.all([
          httpClient.get(`/npu-eval/results/${selectedNpu.id}`),
          httpClient.get(`/api/mm-exam-result/list?examId=${selectedGpu.id}`)
        ]);
        setCompareData({ npu: npuRes.data, gpu: gpuRes.data, clientSide: true });
        setDialogOpen(true);
      } catch {
        setCompareError('Failed to load comparison data from server.');
        setDialogOpen(true);
      }
    } finally {
      setCompareLoading(false);
    }
  };

  const canCompare = selectedGpu !== null && selectedNpu !== null;
  const isLoading = gpuLoading || npuLoading;
  const hasError = gpuError || npuError;

  return (
    <Box>
      <DeviceDashboardHeader
        title="MMLU vs NPU — Historical Cross-Device Comparison"
        description="Select one completed MMLU (GPU) run and one NPU MMLU run, then click Compare to see accuracy metrics side-by-side."
        chipLabel="Historical"
        chipColor={theme.palette.primary.main}
      />

      {hasError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load exam data. Please refresh and try again.
        </Alert>
      )}

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!isLoading && !hasError && (
        <>
          {/* Compare action row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {selectedGpu
                ? `MMLU selected: #${selectedGpu.id} ${selectedGpu.name}`
                : 'No MMLU exam selected'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              &amp;
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedNpu
                ? `NPU selected: #${selectedNpu.id} ${selectedNpu.name}`
                : 'No NPU exam selected'}
            </Typography>
            <Button
              variant="contained"
              disabled={!canCompare || compareLoading}
              onClick={handleCompare}
              sx={{ ml: 'auto' }}
            >
              {compareLoading ? 'Loading…' : 'Compare'}
            </Button>
          </Box>

          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            {/* MMLU GPU side */}
            <Paper sx={{ flex: 1, p: 2, overflow: 'auto', maxHeight: 520 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                MMLU GPU Runs
              </Typography>
              {gpuExams.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    No completed MMLU GPU exams found.
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => navigate(MmluPageLinks.main)}
                  >
                    Create a new exam
                  </Button>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>GPU Type</TableCell>
                        <TableCell>Accuracy</TableCell>
                        <TableCell>Date</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {gpuExams.map((exam) => {
                        const selected = selectedGpu?.id === exam.id;
                        return (
                          <TableRow
                            key={exam.id}
                            hover
                            selected={selected}
                            onClick={() => setSelectedGpu(selected ? null : exam)}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell>{exam.id}</TableCell>
                            <TableCell
                              sx={{
                                maxWidth: 160,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {exam.name}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={exam.status}
                                size="small"
                                color="success"
                                variant="outlined"
                              />
                            </TableCell>
                            <TableCell>{exam.gpu_type}</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>
                              {exam.created_at
                                ? new Date(exam.created_at).toLocaleDateString()
                                : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>

            {/* NPU MMLU side */}
            <Paper sx={{ flex: 1, p: 2, overflow: 'auto', maxHeight: 520 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                NPU MMLU Runs
              </Typography>
              {npuExams.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    No completed NPU MMLU exams found.
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => navigate('/npu-eval')}
                  >
                    Create a new exam
                  </Button>
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>NPU Type</TableCell>
                        <TableCell>Accuracy</TableCell>
                        <TableCell>Date</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {npuExams.map((exam) => {
                        const selected = selectedNpu?.id === exam.id;
                        return (
                          <TableRow
                            key={exam.id}
                            hover
                            selected={selected}
                            onClick={() => setSelectedNpu(selected ? null : exam)}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell>{exam.id}</TableCell>
                            <TableCell
                              sx={{
                                maxWidth: 160,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {exam.name}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={exam.status}
                                size="small"
                                color="success"
                                variant="outlined"
                              />
                            </TableCell>
                            <TableCell>{exam.npu_type}</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>
                              {exam.created_at
                                ? new Date(exam.created_at).toLocaleDateString()
                                : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>
          </Stack>
        </>
      )}

      {/* Comparison Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>MMLU vs NPU — Side-by-Side Comparison</DialogTitle>
        <DialogContent dividers>
          {compareError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {compareError}
            </Alert>
          )}
          {compareData && (
            <Box>
              <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                <Paper
                  variant="outlined"
                  sx={{ flex: 1, p: 2, borderTop: `3px solid ${theme.palette.secondary.main}` }}
                >
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                    MMLU GPU: {selectedGpu?.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedGpu?.gpu_type}
                  </Typography>
                </Paper>
                <Paper
                  variant="outlined"
                  sx={{ flex: 1, p: 2, borderTop: `3px solid ${theme.palette.primary.main}` }}
                >
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                    NPU: {selectedNpu?.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedNpu?.npu_type} &times; {selectedNpu?.npu_num}
                  </Typography>
                </Paper>
              </Stack>

              {compareData.metrics ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Metric</TableCell>
                        <TableCell>GPU (MMLU)</TableCell>
                        <TableCell>NPU</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.entries(
                        compareData.metrics as Record<string, { npu: number; gpu: number }>
                      ).map(([key, val]) => (
                        <TableRow key={key}>
                          <TableCell sx={{ fontWeight: 600 }}>{key}</TableCell>
                          <TableCell>
                            {typeof val.gpu === 'number' ? val.gpu.toFixed(3) : String(val.gpu)}
                          </TableCell>
                          <TableCell>
                            {typeof val.npu === 'number' ? val.npu.toFixed(3) : String(val.npu)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : compareData.clientSide ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                      GPU Results
                    </Typography>
                    <Typography variant="body2" component="pre" sx={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(compareData.gpu, null, 2)}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                      NPU Results
                    </Typography>
                    <Typography variant="body2" component="pre" sx={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(compareData.npu, null, 2)}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                  No structured metrics returned from server.
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MmluDeviceComparisonPage;
