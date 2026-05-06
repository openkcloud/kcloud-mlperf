import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography
} from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { BarChart } from '@mui/x-charts/BarChart';

import { NpuEvalApi } from '@/api/domains/npu-eval.domain';
import { NpuEvalQueryKeys } from '@/contexts/QueryContext/query.keys';
import { NpuEvalPageLinks } from '@/contexts/RouterContext/router.links';
import { Tt100tBadge } from '@/components/Tt100tBadge';

// ----------------------------------------------------------------------

const TT100T_GOAL = 1.1;

function avg(arr: (number | null)[]): number | null {
  const valid = arr.filter((v): v is number => v !== null && isFinite(v));
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

// ----------------------------------------------------------------------

const NpuComparisonPage = () => {
  const { firstId, secondId } = useParams<{ firstId: string; secondId: string }>();
  const navigate = useNavigate();

  const { data: firstExam, isLoading: loadingFirst, error: errorFirst } = useQuery({
    queryKey: NpuEvalQueryKeys.details(firstId || ''),
    queryFn: () => NpuEvalApi.examDetails(firstId!),
    enabled: !!firstId
  });

  const { data: secondExam, isLoading: loadingSecond, error: errorSecond } = useQuery({
    queryKey: NpuEvalQueryKeys.details(secondId || ''),
    queryFn: () => NpuEvalApi.examDetails(secondId!),
    enabled: !!secondId
  });

  const isLoading = loadingFirst || loadingSecond;
  const hasError = !!errorFirst || !!errorSecond;

  const firstResults = firstExam?.results ?? [];
  const secondResults = secondExam?.results ?? [];

  const firstAvgTt100t = avg(firstResults.map(r => r.result_tt100t));
  const secondAvgTt100t = avg(secondResults.map(r => r.result_tt100t));
  const firstAvgTps = avg(firstResults.map(r => r.result_tps));
  const secondAvgTps = avg(secondResults.map(r => r.result_tps));
  const firstAvgTtft = avg(firstResults.map(r => r.result_ttft));
  const secondAvgTtft = avg(secondResults.map(r => r.result_ttft));

  const labels = [firstExam?.name ?? 'Run A', secondExam?.name ?? 'Run B'];

  if (isLoading) {
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Skeleton variant="rounded" width={80} height={36} />
          <Skeleton variant="text" width={200} height={32} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
          <Skeleton variant="rounded" height={100} />
          <Skeleton variant="rounded" height={100} />
        </Box>
        <Skeleton variant="rounded" height={320} sx={{ mb: 3 }} />
        <Skeleton variant="rounded" height={320} sx={{ mb: 3 }} />
        <Skeleton variant="rounded" height={320} />
      </Box>
    );
  }

  if (hasError) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(NpuEvalPageLinks.main)} sx={{ mb: 2 }}>
          Back
        </Button>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              Retry
            </Button>
          }
        >
          Failed to load one or both exam records. Please try again.
        </Alert>
      </Box>
    );
  }

  if (!firstExam || !secondExam) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(NpuEvalPageLinks.main)} sx={{ mb: 2 }}>
          Back
        </Button>
        <Alert severity="info">No exam data found for the requested IDs.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(NpuEvalPageLinks.main)}>
          Back
        </Button>
        <Typography variant="h5" fontWeight={700}>NPU Comparison</Typography>
        <Chip
          size="small"
          label="TT100T goal < 1.1s"
          sx={{ ml: 'auto', bgcolor: 'rgba(14,165,233,0.12)', color: '#0369A1', fontWeight: 700 }}
        />
      </Box>

      {/* Exam Info */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 3 }}>
        {([firstExam, secondExam] as const).map((exam, idx) => (
          <Paper key={idx} sx={{ p: 2, borderTop: `3px solid ${idx === 0 ? '#4F46E5' : '#0EA5E9'}` }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>{exam.name}</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={exam.benchmark.toUpperCase()} size="small" />
              <Chip label={exam.model} size="small" variant="outlined" />
              <Chip label={exam.precision} size="small" variant="outlined" />
              <Chip label={`${exam.npu_type} x${exam.npu_num}`} size="small" color="primary" />
            </Stack>
          </Paper>
        ))}
      </Box>

      {/* TT100T Comparison — goal line highlighted */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Typography variant="h6">
            Time to 100 Tokens (seconds) — Lower is Better
          </Typography>
          <Stack direction="row" spacing={1}>
            <Tt100tBadge value={firstAvgTt100t} />
            <Tt100tBadge value={secondAvgTt100t} />
          </Stack>
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 2,
            px: 2,
            py: 0.75,
            borderRadius: 1,
            bgcolor: 'rgba(14,165,233,0.08)',
            border: '1px dashed #0EA5E9',
          }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#0EA5E9', flexShrink: 0 }} />
          <Typography variant="caption" sx={{ color: '#0369A1', fontWeight: 700 }}>
            Goal line: {TT100T_GOAL} s — bars below this line pass
          </Typography>
        </Box>
        <Tooltip title="Time to 100 output tokens. Goal: <1.1s" arrow>
          <Box>
            <BarChart
              xAxis={[{ scaleType: 'band', data: labels }]}
              yAxis={[{
                min: 0,
                valueFormatter: (v: number) => `${v}s`,
              }]}
              series={[
                {
                  data: [firstAvgTt100t ?? 0, secondAvgTt100t ?? 0],
                  label: 'Avg TT100T (s)',
                  color: '#4F46E5',
                  valueFormatter: (v: number | null) => v == null ? '—' : `${v.toFixed(3)}s`,
                }
              ]}
              height={300}
              margin={{ top: 20, right: 20, bottom: 40, left: 50 }}
            />
          </Box>
        </Tooltip>
      </Paper>

      {/* TPS Comparison */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Tokens per Second — Higher is Better</Typography>
        <BarChart
          xAxis={[{ scaleType: 'band', data: labels }]}
          yAxis={[{ valueFormatter: (v: number) => `${v}` }]}
          series={[
            {
              data: [firstAvgTps ?? 0, secondAvgTps ?? 0],
              label: 'Avg TPS',
              color: '#059669',
              valueFormatter: (v: number | null) => v == null ? '—' : `${v.toFixed(1)} tok/s`,
            }
          ]}
          height={300}
          margin={{ top: 20, right: 20, bottom: 40, left: 50 }}
        />
      </Paper>

      {/* TTFT Comparison */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Time to First Token (seconds) — Lower is Better</Typography>
        <BarChart
          xAxis={[{ scaleType: 'band', data: labels }]}
          yAxis={[{ valueFormatter: (v: number) => `${v}s` }]}
          series={[
            {
              data: [firstAvgTtft ?? 0, secondAvgTtft ?? 0],
              label: 'Avg TTFT (s)',
              color: '#D97706',
              valueFormatter: (v: number | null) => v == null ? '—' : `${v.toFixed(3)}s`,
            }
          ]}
          height={300}
          margin={{ top: 20, right: 20, bottom: 40, left: 50 }}
        />
      </Paper>
    </Box>
  );
};

export default NpuComparisonPage;
