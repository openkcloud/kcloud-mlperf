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
import { MpExamApi } from '@/api/domains/mp-exam.domain';
import { NpuEvalApi } from '@/api/domains/npu-eval.domain';
import { httpClient } from '@/libs/http-client';
import type { MpExamDetails } from '@/api/types/mp-exam.types';
import type { NpuExamDetails } from '@/api/types/npu-eval.types';
import { MpExamPageLinks } from '@/contexts/RouterContext/router.links';

// ----------------------------------------------------------------------

const MlperfDeviceComparisonPage = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  const [selectedGpu, setSelectedGpu] = useState<MpExamDetails | null>(null);
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
    queryKey: ['device-comparison', 'mlperf', 'gpu-list'],
    queryFn: () => MpExamApi.list({ page: 1, limit: 100 }),
    refetchInterval: 30_000
  });

  const {
    data: npuData,
    isLoading: npuLoading,
    error: npuError
  } = useQuery({
    queryKey: ['device-comparison', 'mlperf', 'npu-list'],
    queryFn: () => NpuEvalApi.list({ page: 1, limit: 100 }),
    refetchInterval: 30_000
  });

  const gpuExams = (gpuData?.list ?? []).filter(
    (e) => e.status === 'Completed' && e.gpu_type !== 'NPU'
  );
  const npuExams = (npuData?.list ?? []).filter(
    (e) => e.status === 'Completed' && e.benchmark === 'mlperf'
  );

  const handleCompare = async () => {
    if (!selectedNpu || !selectedGpu) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    try {
      const { data } = await httpClient.get(
        `/npu-eval/compare/${selectedNpu.id}/${selectedGpu.id}`
      );
      setCompareData(data);
      setDialogOpen(true);
    } catch {
      setCompareError('Failed to load comparison data.');
      setDialogOpen(true);
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
        title="MLPerf vs NPU — Historical Cross-Device Comparison"
        description="Select one completed MLPerf (GPU) run and one NPU MLPerf run, then click Compare to see a side-by-side metric breakdown."
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
                ? `GPU selected: #${selectedGpu.id} ${selectedGpu.name}`
                : 'No GPU exam selected'}
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
            {/* GPU side */}
            <Paper sx={{ flex: 1, p: 2, overflow: 'auto', maxHeight: 520 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                MLPerf GPU Runs
              </Typography>
              {gpuExams.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    No completed MLPerf GPU exams found.
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => navigate(MpExamPageLinks.main)}
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
                        <TableCell>TPS</TableCell>
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
                            onClick={() =>
                              setSelectedGpu(selected ? null : exam)
                            }
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

            {/* NPU side */}
            <Paper sx={{ flex: 1, p: 2, overflow: 'auto', maxHeight: 520 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                NPU MLPerf Runs
              </Typography>
              {npuExams.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    No completed NPU MLPerf exams found.
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
                        <TableCell>TPS</TableCell>
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
                            onClick={() =>
                              setSelectedNpu(selected ? null : exam)
                            }
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
        <DialogTitle>
          Side-by-Side Comparison
        </DialogTitle>
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
                  sx={{ flex: 1, p: 2, borderTop: `3px solid ${theme.palette.primary.main}` }}
                >
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    NPU: {selectedNpu?.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedNpu?.npu_type} &times; {selectedNpu?.npu_num}
                  </Typography>
                </Paper>
                <Paper
                  variant="outlined"
                  sx={{ flex: 1, p: 2, borderTop: `3px solid ${theme.palette.secondary.main}` }}
                >
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    GPU: {selectedGpu?.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedGpu?.gpu_type} &times; {selectedGpu?.gpu_num}
                  </Typography>
                </Paper>
              </Stack>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Metric</TableCell>
                      <TableCell>NPU</TableCell>
                      <TableCell>GPU</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {compareData.metrics
                      ? Object.entries(compareData.metrics as Record<string, { npu: number; gpu: number }>).map(
                          ([key, val]) => (
                            <TableRow key={key}>
                              <TableCell sx={{ fontWeight: 600 }}>{key}</TableCell>
                              <TableCell>{typeof val.npu === 'number' ? val.npu.toFixed(3) : String(val.npu)}</TableCell>
                              <TableCell>{typeof val.gpu === 'number' ? val.gpu.toFixed(3) : String(val.gpu)}</TableCell>
                            </TableRow>
                          )
                        )
                      : (
                        <TableRow>
                          <TableCell colSpan={3}>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ py: 2, textAlign: 'center' }}
                            >
                              No structured metrics returned from server. Raw data available.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                  </TableBody>
                </Table>
              </TableContainer>
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

export default MlperfDeviceComparisonPage;
