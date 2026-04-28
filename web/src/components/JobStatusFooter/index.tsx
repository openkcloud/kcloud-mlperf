import { useEffect, useRef } from 'react';

import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { httpClient } from '@/libs/http-client';

// ----------------------------------------------------------------------

type Props = {
  benchmark: 'mlperf' | 'mmlu' | 'npu';
  examId: number;
  examStatus?: string;
  artifacts?: Array<{ name: string; url: string }>;
};

// ----------------------------------------------------------------------

// Loki only accepts 'mmlu' | 'mlperf'; NPU falls back to 'mlperf'
type LokiBenchmark = 'mmlu' | 'mlperf';

const toLokiBenchmark = (b: Props['benchmark']): LokiBenchmark =>
  b === 'mmlu' ? 'mmlu' : 'mlperf';

// ----------------------------------------------------------------------

type LokiResult = {
  stream: { id: string; logger: string; severity: string };
  values: Array<[string, string]>; // [nanosecondTimestamp, logLine]
};

type LokiResponse = {
  status: string;
  data: {
    resultType: string;
    result: LokiResult[];
  };
};

// ----------------------------------------------------------------------

const statusChipStyles: Record<string, { bgcolor: string; color: string; border: string }> = {
  Pending: {
    bgcolor: '#EEF2FF',
    color: '#3730A3',
    border: '1px solid #C7D2FE'
  },
  Preparing: {
    bgcolor: '#EEF2FF',
    color: '#3730A3',
    border: '1px solid #C7D2FE'
  },
  Running: {
    bgcolor: '#EEF2FF',
    color: '#3730A3',
    border: '1px solid #C7D2FE'
  },
  Completed: {
    bgcolor: '#ECFDF5',
    color: '#065F46',
    border: '1px solid #A7F3D0'
  },
  Error: {
    bgcolor: '#FEF2F2',
    color: '#991B1B',
    border: '1px solid #FECACA'
  },
  Terminating: {
    bgcolor: '#FFFBEB',
    color: '#92400E',
    border: '1px solid #FDE68A'
  },
  Stopped: {
    bgcolor: '#FFFBEB',
    color: '#92400E',
    border: '1px solid #FDE68A'
  },
  Idle: {
    bgcolor: '#EEF2FF',
    color: '#3730A3',
    border: '1px solid #C7D2FE'
  },
  Undefined: {
    bgcolor: '#EEF2FF',
    color: '#3730A3',
    border: '1px solid #C7D2FE'
  }
};

const getChipStyle = (status?: string) =>
  (status && statusChipStyles[status]) ?? statusChipStyles['Undefined'];

// ----------------------------------------------------------------------

const REFETCH_INTERVAL_MS = 5000;

// ----------------------------------------------------------------------

export const JobStatusFooter = ({ benchmark, examId, examStatus, artifacts }: Props) => {
  const logBoxRef = useRef<HTMLDivElement>(null);
  const lokiBenchmark = toLokiBenchmark(benchmark);

  const {
    data: lokiData,
    isError: lokiError,
    error: lokiRawError
  } = useQuery<LokiResponse>({
    queryKey: ['loki-logs', benchmark, examId],
    queryFn: async () => {
      // The httpClient interceptor spreads response.data onto the response object,
      // so we request the raw AxiosResponse via shouldReturnOriginalResponse and
      // read .data directly, which gives us the full LokiResponse body.
      const response = await httpClient.get<LokiResponse>(
        `/loki/instant/${lokiBenchmark}/${examId}`,
        { shouldReturnOriginalResponse: true }
      );
      return response.data;
    },
    refetchInterval: REFETCH_INTERVAL_MS,
    retry: false
  });

  // Parse log lines from all result streams, sorted by timestamp
  const logLines: string[] = (() => {
    if (!lokiData || !lokiData.data?.result?.length) return [];

    const entries: Array<[string, string]> = [];
    for (const stream of lokiData.data.result) {
      for (const [ts, line] of stream.values) {
        entries.push([ts, line]);
      }
    }
    // Sort by nanosecond timestamp string (lexicographic works for fixed-width ns timestamps)
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    const lines = entries.map(([, line]) => line);
    // Keep last 200 lines
    return lines.slice(-200);
  })();

  const lokiUnavailable =
    lokiData?.status === 'unavailable' ||
    (lokiError && (lokiRawError as { response?: { status?: number } })?.response?.status !== 404);

  const noLogsYet = !lokiUnavailable && logLines.length === 0;

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logLines.length]);

  const chipStyle = getChipStyle(examStatus);

  return (
    <Box sx={{ mt: 4 }}>
      <Typography
        component="h3"
        fontWeight={700}
        fontSize="1.25rem"
        sx={{ color: '#1E293B', letterSpacing: '-0.02em', mb: 2 }}
      >
        Job status &amp; logs
      </Typography>

      <Stack spacing={2}>
        {/* Section 1: Status chip */}
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Current status
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Chip
              size="small"
              label={examStatus ?? 'Unknown'}
              sx={{
                ...chipStyle,
                fontWeight: 600,
                fontSize: '0.6875rem',
                textTransform: 'uppercase'
              }}
            />
            <Typography variant="body2" color="text.secondary">
              {examStatus === 'Running'
                ? 'Benchmark is currently executing.'
                : examStatus === 'Completed'
                  ? 'Benchmark finished successfully.'
                  : examStatus === 'Preparing'
                    ? 'Setting up the environment.'
                    : examStatus === 'Pending'
                      ? 'Waiting to be scheduled.'
                      : examStatus === 'Error' || examStatus === 'Stopped'
                        ? 'Benchmark ended with an issue.'
                        : '—'}
            </Typography>
          </Box>
        </Paper>

        {/* Section 2: Live log stream */}
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Live logs
          </Typography>
          {lokiUnavailable ? (
            <Typography variant="body2" color="warning.main">
              Log service is currently unreachable. Logs may not be available.
            </Typography>
          ) : noLogsYet ? (
            <Typography variant="body2" color="text.secondary">
              Logs will appear once the job starts.
            </Typography>
          ) : (
            <Box
              ref={logBoxRef}
              sx={{
                bgcolor: '#0F172A',
                color: '#94A3B8',
                fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
                fontSize: '0.75rem',
                lineHeight: 1.6,
                p: 2,
                borderRadius: 1,
                maxHeight: 400,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {logLines.join('\n')}
            </Box>
          )}
        </Paper>

        {/* Section 3: Artifacts */}
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Artifacts
          </Typography>
          {!artifacts || artifacts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No artifacts yet.
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {artifacts.map(artifact => (
                <Button
                  key={artifact.url}
                  variant="outlined"
                  size="small"
                  component="a"
                  href={artifact.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {artifact.name}
                </Button>
              ))}
            </Stack>
          )}
        </Paper>
      </Stack>
    </Box>
  );
};
