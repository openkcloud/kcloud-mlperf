import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Typography, Paper, Button, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Alert } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { BarChart } from '@mui/x-charts/BarChart';
import dayjs from 'dayjs';

import { NpuEvalApi } from '@/api/domains/npu-eval.domain';
import { NpuEvalQueryKeys } from '@/contexts/QueryContext/query.keys';
import { NpuEvalPageLinks } from '@/contexts/RouterContext/router.links';
import { StatusEnum } from '@/enums/status.enum';

// ----------------------------------------------------------------------

const NpuTestResultPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: examData } = useQuery({
    queryKey: NpuEvalQueryKeys.details(id || ''),
    queryFn: () => NpuEvalApi.examDetails(id!),
    enabled: !!id
  });

  if (!examData) {
    return <Typography>Loading...</Typography>;
  }

  const results = examData.results || [];
  const tt100tValues = results.filter(r => r.result_tt100t !== null).map(r => r.result_tt100t!);
  const bestTt100t = tt100tValues.length > 0 ? Math.min(...tt100tValues) : null;
  const targetMet = bestTt100t !== null && bestTt100t < 1.1;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(NpuEvalPageLinks.main)}>
          Back
        </Button>
        <Typography variant="h5" fontWeight={700}>
          NPU Exam Result: {examData.name}
        </Typography>
        <Chip label={examData.status} color={examData.status === StatusEnum.COMPLETED ? 'success' : 'default'} />
      </Box>

      {/* Target KPI Alert */}
      {results.length > 0 && (
        <Alert severity={targetMet ? 'success' : 'warning'} sx={{ mb: 3 }}>
          {targetMet
            ? `Target MET! First 100 tokens generated in ${bestTt100t?.toFixed(4)}s (target: < 1.1s)`
            : `Target NOT MET. Best TT100T: ${bestTt100t?.toFixed(4) ?? 'N/A'}s (target: < 1.1s)`
          }
        </Alert>
      )}

      {/* Exam Info */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Exam Configuration</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 1.5 }}>
          <Box><Typography variant="caption" color="text.secondary">Benchmark</Typography><Typography fontWeight={600}>{examData.benchmark.toUpperCase()}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Model</Typography><Typography fontWeight={600}>{examData.model}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Precision</Typography><Typography fontWeight={600}>{examData.precision}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Framework</Typography><Typography fontWeight={600}>{examData.framework}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">NPU</Typography><Typography fontWeight={600}>{examData.npu_type} x{examData.npu_num}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Max Output Tokens</Typography><Typography fontWeight={600}>{examData.max_output_tokens === 0 ? 'Unlimited' : examData.max_output_tokens.toLocaleString()}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Data Samples</Typography><Typography fontWeight={600}>{examData.data_number === 0 ? 'Full Dataset' : examData.data_number.toLocaleString()}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Batch Size</Typography><Typography fontWeight={600}>{examData.batch_size}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Dataset</Typography><Typography fontWeight={600}>{examData.dataset}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Started</Typography><Typography fontWeight={600}>{examData.started_at ? dayjs(examData.started_at).format('YYYY-MM-DD HH:mm:ss') : '-'}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Ended</Typography><Typography fontWeight={600}>{examData.end_at ? dayjs(examData.end_at).format('YYYY-MM-DD HH:mm:ss') : '-'}</Typography></Box>
        </Box>
      </Paper>

      {/* Results Chart */}
      {results.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Performance: Time to 100 Tokens (seconds)</Typography>
          <BarChart
            xAxis={[{ scaleType: 'band', data: results.map(r => `Run ${r.result_number}`) }]}
            series={[
              {
                data: results.map(r => r.result_tt100t ?? 0),
                label: 'TT100T (s)',
                color: '#4F46E5'
              }
            ]}
            height={300}
          />
          {/* Target line reference */}
          <Typography variant="caption" color="error" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
            Target: &lt; 1.1 seconds
          </Typography>
        </Paper>
      )}

      {/* TPS Chart */}
      {results.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Throughput: Tokens per Second</Typography>
          <BarChart
            xAxis={[{ scaleType: 'band', data: results.map(r => `Run ${r.result_number}`) }]}
            series={[
              {
                data: results.map(r => r.result_tps ?? 0),
                label: 'TPS',
                color: '#059669'
              }
            ]}
            height={300}
          />
        </Paper>
      )}

      {/* TTFT Chart */}
      {results.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Time to First Token (TTFT) — milliseconds</Typography>
          <BarChart
            xAxis={[{ scaleType: 'band', data: results.map(r => `Run ${r.result_number}`) }]}
            series={[
              {
                data: results.map(r => (r.result_ttft ?? 0) * 1000),
                label: 'TTFT (ms)',
                color: '#F97316'
              }
            ]}
            height={250}
          />
        </Paper>
      )}

      {/* TPOT & Latency Combined Chart */}
      {results.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Latency Breakdown per Run</Typography>
          <BarChart
            xAxis={[{ scaleType: 'band', data: results.map(r => `Run ${r.result_number}`) }]}
            series={[
              {
                data: results.map(r => (r.result_tpot ?? 0) * 1000),
                label: 'TPOT (ms/token)',
                color: '#2563EB'
              },
              {
                data: results.map(r => r.result_latency ?? 0),
                label: 'Total Latency (s)',
                color: '#7C3AED'
              }
            ]}
            height={300}
          />
        </Paper>
      )}

      {/* All Metrics Overview */}
      {results.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>All Metrics Comparison Across Runs</Typography>
          <BarChart
            xAxis={[{ scaleType: 'band', data: results.map(r => `Run ${r.result_number}`) }]}
            series={[
              { data: results.map(r => r.result_tps ?? 0), label: 'TPS', color: '#059669' },
              { data: results.map(r => (r.result_tt100t ?? 0)), label: 'TT100T (s)', color: '#4F46E5' },
              { data: results.map(r => (r.result_ttft ?? 0) * 1000), label: 'TTFT (ms)', color: '#F97316' },
              { data: results.map(r => r.result_sps ?? 0), label: 'SPS', color: '#DC2626' },
            ]}
            height={350}
          />
        </Paper>
      )}

      {/* Summary Stats */}
      {results.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Summary Statistics</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 2 }}>
            <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 1, bgcolor: 'rgba(79,70,229,0.06)' }}>
              <Typography variant="caption" color="text.secondary">Best TT100T</Typography>
              <Typography variant="h6" fontWeight={700} color={targetMet ? 'success.main' : 'error.main'}>
                {bestTt100t?.toFixed(3) ?? 'N/A'}s
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 1, bgcolor: 'rgba(5,150,105,0.06)' }}>
              <Typography variant="caption" color="text.secondary">Avg TPS</Typography>
              <Typography variant="h6" fontWeight={700}>
                {results.length > 0 ? (results.reduce((s, r) => s + (r.result_tps ?? 0), 0) / results.length).toFixed(2) : 'N/A'}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 1, bgcolor: 'rgba(249,115,22,0.06)' }}>
              <Typography variant="caption" color="text.secondary">Avg TTFT</Typography>
              <Typography variant="h6" fontWeight={700}>
                {results.length > 0 ? (results.reduce((s, r) => s + (r.result_ttft ?? 0), 0) / results.length * 1000).toFixed(1) : 'N/A'}ms
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 1, bgcolor: 'rgba(37,99,235,0.06)' }}>
              <Typography variant="caption" color="text.secondary">Avg TPOT</Typography>
              <Typography variant="h6" fontWeight={700}>
                {results.length > 0 ? (results.reduce((s, r) => s + (r.result_tpot ?? 0), 0) / results.length * 1000).toFixed(2) : 'N/A'}ms
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 1, bgcolor: 'rgba(148,163,184,0.06)' }}>
              <Typography variant="caption" color="text.secondary">Runs</Typography>
              <Typography variant="h6" fontWeight={700}>{results.length}</Typography>
            </Box>
          </Box>
        </Paper>
      )}

      {/* Results Table */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Detailed Results</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Run</TableCell>
                <TableCell>TTFT (s)</TableCell>
                <TableCell>TT100T (s)</TableCell>
                <TableCell>TPS</TableCell>
                <TableCell>TPS Best</TableCell>
                <TableCell>SPS</TableCell>
                <TableCell>Latency (s)</TableCell>
                <TableCell>TPOT (s)</TableCell>
                <TableCell>Accuracy</TableCell>
                <TableCell>NPU Mem (GB)</TableCell>
                <TableCell>NPU Util (%)</TableCell>
                <TableCell>Power (W)</TableCell>
                <TableCell>Valid</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.result_number}</TableCell>
                  <TableCell>{r.result_ttft?.toFixed(4) ?? '-'}</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: r.result_tt100t && r.result_tt100t < 1.1 ? 'success.main' : 'error.main' }}>
                    {r.result_tt100t?.toFixed(4) ?? '-'}
                  </TableCell>
                  <TableCell>{r.result_tps?.toFixed(2) ?? '-'}</TableCell>
                  <TableCell>{r.result_tps_best?.toFixed(2) ?? '-'}</TableCell>
                  <TableCell>{r.result_sps?.toFixed(4) ?? '-'}</TableCell>
                  <TableCell>{r.result_latency?.toFixed(4) ?? '-'}</TableCell>
                  <TableCell>{r.result_tpot?.toFixed(6) ?? '-'}</TableCell>
                  <TableCell>{r.result_accuracy?.toFixed(2) ?? '-'}</TableCell>
                  <TableCell>{r.result_npu_mem_peak?.toFixed(1) ?? '-'}</TableCell>
                  <TableCell>{r.result_npu_util?.toFixed(1) ?? '-'}</TableCell>
                  <TableCell>{r.result_npu_power?.toFixed(1) ?? '-'}</TableCell>
                  <TableCell>{r.result_valid ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

export default NpuTestResultPage;
