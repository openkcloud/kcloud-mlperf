import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Typography, Paper, Button, Chip, Alert } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { BarChart } from '@mui/x-charts/BarChart';

import { NpuEvalApi } from '@/api/domains/npu-eval.domain';
import { NpuEvalQueryKeys } from '@/contexts/QueryContext/query.keys';
import { NpuEvalPageLinks } from '@/contexts/RouterContext/router.links';

// ----------------------------------------------------------------------

const NpuComparisonPage = () => {
  const { firstId, secondId } = useParams<{ firstId: string; secondId: string }>();
  const navigate = useNavigate();

  const { data: firstExam } = useQuery({
    queryKey: NpuEvalQueryKeys.details(firstId || ''),
    queryFn: () => NpuEvalApi.examDetails(firstId!),
    enabled: !!firstId
  });

  const { data: secondExam } = useQuery({
    queryKey: NpuEvalQueryKeys.details(secondId || ''),
    queryFn: () => NpuEvalApi.examDetails(secondId!),
    enabled: !!secondId
  });

  if (!firstExam || !secondExam) {
    return <Typography>Loading comparison data...</Typography>;
  }

  const firstResults = firstExam.results || [];
  const secondResults = secondExam.results || [];

  // Compute averages
  const avg = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v !== null);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  };

  const firstAvgTt100t = avg(firstResults.map(r => r.result_tt100t));
  const secondAvgTt100t = avg(secondResults.map(r => r.result_tt100t));
  const firstAvgTps = avg(firstResults.map(r => r.result_tps));
  const secondAvgTps = avg(secondResults.map(r => r.result_tps));
  const firstAvgTtft = avg(firstResults.map(r => r.result_ttft));
  const secondAvgTtft = avg(secondResults.map(r => r.result_ttft));

  const labels = [firstExam.name, secondExam.name];

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(NpuEvalPageLinks.main)}>
          Back
        </Button>
        <Typography variant="h5" fontWeight={700}>NPU Comparison</Typography>
      </Box>

      {/* Exam Info */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
        {[firstExam, secondExam].map((exam, idx) => (
          <Paper key={idx} sx={{ p: 2 }}>
            <Typography variant="h6">{exam.name}</Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              <Chip label={exam.benchmark.toUpperCase()} size="small" />
              <Chip label={exam.model} size="small" variant="outlined" />
              <Chip label={exam.precision} size="small" variant="outlined" />
              <Chip label={`${exam.npu_type} x${exam.npu_num}`} size="small" color="primary" />
            </Box>
          </Paper>
        ))}
      </Box>

      {/* TT100T Comparison */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Time to 100 Tokens (seconds) — Lower is Better</Typography>
        <Alert severity="info" sx={{ mb: 2 }}>Target: &lt; 1.1 seconds</Alert>
        <BarChart
          xAxis={[{ scaleType: 'band', data: labels }]}
          series={[
            {
              data: [firstAvgTt100t ?? 0, secondAvgTt100t ?? 0],
              label: 'Avg TT100T (s)',
              color: '#4F46E5'
            }
          ]}
          height={300}
        />
      </Paper>

      {/* TPS Comparison */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Tokens per Second — Higher is Better</Typography>
        <BarChart
          xAxis={[{ scaleType: 'band', data: labels }]}
          series={[
            {
              data: [firstAvgTps ?? 0, secondAvgTps ?? 0],
              label: 'Avg TPS',
              color: '#059669'
            }
          ]}
          height={300}
        />
      </Paper>

      {/* TTFT Comparison */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Time to First Token (seconds) — Lower is Better</Typography>
        <BarChart
          xAxis={[{ scaleType: 'band', data: labels }]}
          series={[
            {
              data: [firstAvgTtft ?? 0, secondAvgTtft ?? 0],
              label: 'Avg TTFT (s)',
              color: '#D97706'
            }
          ]}
          height={300}
        />
      </Paper>
    </Box>
  );
};

export default NpuComparisonPage;
