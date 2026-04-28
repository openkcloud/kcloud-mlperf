import { useState, useEffect } from 'react';
import { Box, Typography, Paper, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Grid } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { BarChart } from '@mui/x-charts/BarChart';
import { httpClient } from '@/libs/http-client';
import { DEVICE_COLORS } from '@/constants/device-colors';

type ExamSummary = {
  id: number;
  name: string;
  model: string;
  precision: string;
  benchmark: string;
  status: string;
  device_type: string;
  device_name: string;
  batch_size: number;
  dataset: string;
  data_number: number;
  retry_num: number;
  created_at: string;
};

type ExamWithResults = ExamSummary & {
  results: Array<any>;
};

const DeviceComparisonPage = () => {
  const [npuExams, setNpuExams] = useState<ExamSummary[]>([]);
  const [selectedNpu, setSelectedNpu] = useState<ExamSummary | null>(null);
  const [gpuModalOpen, setGpuModalOpen] = useState(false);
  const [gpuExams, setGpuExams] = useState<ExamSummary[]>([]);
  const [comparison, setComparison] = useState<{ npu: ExamWithResults; gpu: ExamWithResults } | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch completed NPU exams
  useEffect(() => {
    const fetchNpuExams = async () => {
      setLoading(true);
      try {
        const res = await httpClient.get('/npu-eval/list', { params: { page: 1, limit: 100 } });
        const list = (res.data?.list || []).filter((e: any) => e.status === 'Completed');
        setNpuExams(list.map((e: any) => ({
          id: e.id,
          name: e.name,
          model: e.model,
          precision: e.precision,
          benchmark: e.benchmark,
          status: e.status,
          device_type: 'NPU',
          device_name: `${e.npu_type} x${e.npu_num}`,
          batch_size: e.batch_size,
          dataset: e.dataset,
          data_number: e.data_number,
          retry_num: e.retry_num,
          created_at: e.created_at,
        })));
      } catch (e) {
        console.error('Failed to fetch NPU exams', e);
      }
      setLoading(false);
    };
    fetchNpuExams();
  }, []);

  // When user clicks "Compare" on an NPU exam, fetch matching GPU exams
  const handleCompareClick = async (exam: ExamSummary) => {
    setSelectedNpu(exam);
    setGpuModalOpen(true);
    try {
      const endpoint = exam.benchmark === 'mlperf' ? '/mp-exam/list' : '/mm-exam/list';
      const res = await httpClient.get(endpoint, { params: { page: 1, limit: 100 } });
      const list = (res.data?.list || []).filter((e: any) => e.status === 'Completed');
      setGpuExams(list.map((e: any) => ({
        id: e.id,
        name: e.name,
        model: e.model,
        precision: e.precision,
        benchmark: exam.benchmark,
        status: e.status,
        device_type: 'GPU',
        device_name: `${e.gpu_type} x${e.gpu_num || 1}`,
        batch_size: e.batch_size,
        dataset: e.dataset,
        data_number: e.data_number,
        retry_num: e.retry_num,
        created_at: e.created_at,
      })));
    } catch (e) {
      console.error('Failed to fetch GPU exams', e);
    }
  };

  // When user selects a GPU exam from the modal, fetch both details
  const handleGpuSelect = async (gpuExam: ExamSummary) => {
    setGpuModalOpen(false);
    if (!selectedNpu) return;
    try {
      const gpuEndpoint = selectedNpu.benchmark === 'mlperf'
        ? `/mp-exam/details/${gpuExam.id}`
        : `/mm-exam/details/${gpuExam.id}`;
      const [npuRes, gpuRes] = await Promise.all([
        httpClient.get(`/npu-eval/details/${selectedNpu.id}`),
        httpClient.get(gpuEndpoint),
      ]);
      setComparison({
        npu: { ...selectedNpu, results: npuRes.data?.results || [] },
        gpu: { ...gpuExam, results: gpuRes.data?.results || [] },
      });
    } catch (e) {
      console.error('Failed to fetch comparison data', e);
    }
  };

  // Helper: extract metric from result (handles NPU vs GPU field names)
  const getMetric = (result: any, metric: string, deviceType: string): number => {
    if (deviceType === 'NPU') {
      const map: Record<string, string> = {
        tps: 'result_tps',
        tt100t: 'result_tt100t',
        latency: 'result_latency',
        ttft: 'result_ttft',
        tpot: 'result_tpot',
        sps: 'result_sps',
      };
      return result[map[metric]] ?? 0;
    }
    // GPU fields
    const map: Record<string, string> = {
      tps: 'result_perf_tps',
      tt100t: 'result_tt100t',
      latency: 'result_perf_latency',
      ttft: 'result_perf_serv_ttft',
      tpot: 'result_perf_serv_tpot',
      sps: 'result_perf_sps',
    };
    return result[map[metric]] ?? 0;
  };

  const avgMetric = (results: any[], metric: string, deviceType: string): number => {
    if (results.length === 0) return 0;
    const sum = results.reduce((s, r) => s + getMetric(r, metric, deviceType), 0);
    return sum / results.length;
  };

  // Normalize GPU TT100T from ms to seconds if needed
  const normTt100t = (val: number, deviceType: string): number => {
    if (deviceType === 'GPU' && val > 100) return val / 1000; // ms → s
    return val;
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>GPU vs NPU Comparison</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Select a completed NPU exam, then choose a GPU exam to compare side-by-side.
      </Typography>

      {/* Comparison View */}
      {comparison && (
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Side-by-Side Comparison</Typography>
            <Button variant="outlined" size="small" onClick={() => setComparison(null)}>
              Clear Comparison
            </Button>
          </Box>

          {/* Test Cards */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            {[
              { exam: comparison.npu, color: DEVICE_COLORS.NPU, label: 'NPU', num: 1 },
              { exam: comparison.gpu, color: DEVICE_COLORS.GPU, label: 'GPU', num: 2 },
            ].map(({ exam, color, label, num }) => (
              <Grid size={{ xs: 12, lg: 6 }} key={num}>
                <Paper sx={{ p: 2.5, borderTop: `3px solid ${color}` }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                    <Box sx={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: `linear-gradient(135deg, ${color}, ${color}99)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 700, fontSize: '0.875rem'
                    }}>
                      {num}
                    </Box>
                    <Box>
                      <Typography fontWeight={700}>{label}: {exam.device_name}</Typography>
                      <Typography variant="caption" color="text.secondary">{exam.name}</Typography>
                    </Box>
                    <Chip label={label} size="small" sx={{ ml: 'auto', bgcolor: color, color: '#fff', fontWeight: 600 }} />
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, fontSize: '0.8125rem' }}>
                    <Box><Typography variant="caption" color="text.secondary">Model</Typography><Typography fontSize="0.8125rem" fontWeight={600}>{exam.model}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Precision</Typography><Typography fontSize="0.8125rem" fontWeight={600}>{exam.precision}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Dataset</Typography><Typography fontSize="0.8125rem" fontWeight={600}>{exam.dataset}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Results</Typography><Typography fontSize="0.8125rem" fontWeight={600}>{exam.results.length} runs</Typography></Box>
                  </Box>
                </Paper>
              </Grid>
            ))}
          </Grid>

          {/* Performance Comparison Charts */}
          {comparison.npu.results.length > 0 && comparison.gpu.results.length > 0 && (
            <>
              {/* TPS */}
              <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>Tokens per Second (TPS) — Higher is Better</Typography>
                <BarChart
                  xAxis={[{ scaleType: 'band', data: [`NPU: ${comparison.npu.device_name}`, `GPU: ${comparison.gpu.device_name}`] }]}
                  series={[{
                    data: [
                      avgMetric(comparison.npu.results, 'tps', 'NPU'),
                      avgMetric(comparison.gpu.results, 'tps', 'GPU'),
                    ],
                    label: 'Avg TPS',
                  }]}
                  colors={[DEVICE_COLORS.NPU, DEVICE_COLORS.GPU]}
                  height={300}
                />
              </Paper>

              {/* TT100T */}
              <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  Time to 100 Tokens (seconds) — Lower is Better
                  <Chip label="Target: < 1.1s" color="error" size="small" sx={{ ml: 1 }} />
                </Typography>
                <BarChart
                  xAxis={[{ scaleType: 'band', data: [`NPU: ${comparison.npu.device_name}`, `GPU: ${comparison.gpu.device_name}`] }]}
                  series={[{
                    data: [
                      normTt100t(avgMetric(comparison.npu.results, 'tt100t', 'NPU'), 'NPU'),
                      normTt100t(avgMetric(comparison.gpu.results, 'tt100t', 'GPU'), 'GPU'),
                    ],
                    label: 'Avg TT100T (s)',
                  }]}
                  colors={[DEVICE_COLORS.NPU, DEVICE_COLORS.GPU]}
                  height={300}
                />
              </Paper>

              {/* Latency */}
              <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>Average Latency (seconds) — Lower is Better</Typography>
                <BarChart
                  xAxis={[{ scaleType: 'band', data: [`NPU: ${comparison.npu.device_name}`, `GPU: ${comparison.gpu.device_name}`] }]}
                  series={[{
                    data: [
                      avgMetric(comparison.npu.results, 'latency', 'NPU'),
                      avgMetric(comparison.gpu.results, 'latency', 'GPU'),
                    ],
                    label: 'Avg Latency (s)',
                  }]}
                  colors={[DEVICE_COLORS.NPU, DEVICE_COLORS.GPU]}
                  height={300}
                />
              </Paper>

              {/* Summary Table */}
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>Comparison Summary</Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Metric</TableCell>
                        <TableCell>
                          <Chip label={`NPU: ${comparison.npu.device_name}`} size="small" sx={{ bgcolor: DEVICE_COLORS.NPU, color: '#fff', fontWeight: 600 }} />
                        </TableCell>
                        <TableCell>
                          <Chip label={`GPU: ${comparison.gpu.device_name}`} size="small" sx={{ bgcolor: DEVICE_COLORS.GPU, color: '#fff', fontWeight: 600 }} />
                        </TableCell>
                        <TableCell>Winner</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {[
                        { label: 'Avg TPS', npu: avgMetric(comparison.npu.results, 'tps', 'NPU'), gpu: avgMetric(comparison.gpu.results, 'tps', 'GPU'), higher: true },
                        { label: 'Avg TT100T (s)', npu: normTt100t(avgMetric(comparison.npu.results, 'tt100t', 'NPU'), 'NPU'), gpu: normTt100t(avgMetric(comparison.gpu.results, 'tt100t', 'GPU'), 'GPU'), higher: false },
                        { label: 'Avg Latency (s)', npu: avgMetric(comparison.npu.results, 'latency', 'NPU'), gpu: avgMetric(comparison.gpu.results, 'latency', 'GPU'), higher: false },
                        { label: 'Avg SPS', npu: avgMetric(comparison.npu.results, 'sps', 'NPU'), gpu: avgMetric(comparison.gpu.results, 'sps', 'GPU'), higher: true },
                      ].map(({ label, npu, gpu, higher }) => {
                        const npuWins = higher ? npu > gpu : npu < gpu;
                        return (
                          <TableRow key={label}>
                            <TableCell sx={{ fontWeight: 600 }}>{label}</TableCell>
                            <TableCell sx={{ fontWeight: 700, color: npuWins ? 'success.main' : 'text.primary' }}>
                              {npu.toFixed(3)}
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700, color: !npuWins ? 'success.main' : 'text.primary' }}>
                              {gpu.toFixed(3)}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={npuWins ? 'NPU' : 'GPU'}
                                size="small"
                                sx={{ bgcolor: npuWins ? DEVICE_COLORS.NPU : DEVICE_COLORS.GPU, color: '#fff', fontWeight: 600 }}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </>
          )}
        </Box>
      )}

      {/* NPU Exam Selection Table */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {comparison ? 'Select Another NPU Exam' : 'Step 1: Select an NPU Exam'}
        </Typography>
        {loading && <Typography color="text.secondary">Loading NPU exams...</Typography>}
        {!loading && npuExams.length === 0 && (
          <Typography color="text.secondary">No completed NPU exams found. Run benchmarks first.</Typography>
        )}
        {!loading && npuExams.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Benchmark</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell>Device</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {npuExams.map((exam) => (
                  <TableRow key={exam.id} hover>
                    <TableCell>{exam.id}</TableCell>
                    <TableCell>{exam.name}</TableCell>
                    <TableCell><Chip label={exam.benchmark.toUpperCase()} size="small" variant="outlined" /></TableCell>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exam.model}</TableCell>
                    <TableCell>{exam.device_name}</TableCell>
                    <TableCell align="right">
                      <Button
                        variant="contained"
                        size="small"
                        sx={{ bgcolor: DEVICE_COLORS.NPU, '&:hover': { bgcolor: '#EA580C' } }}
                        onClick={() => handleCompareClick(exam)}
                      >
                        Compare with GPU
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* GPU Selection Modal */}
      <Dialog open={gpuModalOpen} onClose={() => setGpuModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Step 2: Select a GPU Exam to Compare
          <IconButton onClick={() => setGpuModalOpen(false)} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent>
          {selectedNpu && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'rgba(249,115,22,0.06)', borderRadius: 1, border: '1px solid rgba(249,115,22,0.2)' }}>
              <Typography variant="body2">
                Comparing NPU: <strong>{selectedNpu.name}</strong> ({selectedNpu.benchmark.toUpperCase()}, {selectedNpu.model})
              </Typography>
            </Box>
          )}
          {gpuExams.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              No completed GPU {selectedNpu?.benchmark.toUpperCase()} exams found.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Model</TableCell>
                    <TableCell>GPU</TableCell>
                    <TableCell>Precision</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {gpuExams.map((exam) => (
                    <TableRow key={exam.id} hover sx={{ cursor: 'pointer' }}>
                      <TableCell>{exam.id}</TableCell>
                      <TableCell>{exam.name}</TableCell>
                      <TableCell sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exam.model}</TableCell>
                      <TableCell>{exam.device_name}</TableCell>
                      <TableCell>{exam.precision}</TableCell>
                      <TableCell align="right">
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => handleGpuSelect(exam)}
                        >
                          Select
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGpuModalOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DeviceComparisonPage;
