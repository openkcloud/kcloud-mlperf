import {
  Alert,
  Box,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';

// ----------------------------------------------------------------------

const PRECISION_ROWS = [
  { device: 'NVIDIA L40', type: 'GPU', precision: 'FP8', notes: 'Served via vLLM with FP8 quantisation' },
  { device: 'NVIDIA A40', type: 'GPU', precision: 'BF16', notes: 'FP8 not supported on Ampere' },
  { device: 'NVIDIA A30', type: 'GPU', precision: 'BF16', notes: 'FP8 not supported on Ampere' },
  { device: 'FuriosaAI RNGD', type: 'NPU', precision: 'FP8', notes: 'Native FP8 tensor cores' },
  { device: 'Rebellions Atom+', type: 'NPU', precision: 'BF16', notes: 'FP8 pending SDK 3.x support' }
] as const;

// Current consolidation cluster (jw1 master). L40 / A40 rows above are retained
// for historical precision context only — that hardware is not in this cluster.
const TOPOLOGY_ROWS = [
  { device: 'NVIDIA A30', type: 'GPU', nodes: 'jw2, jw3', slots: '2 devices/node', status: 'Live' },
  { device: 'FuriosaAI RNGD', type: 'NPU', nodes: 'node4', slots: '1 device', status: 'Live' },
  {
    device: 'Rebellions Atom+',
    type: 'NPU',
    nodes: 'node5',
    slots: '2 devices',
    status: 'Joined — inference server pending'
  }
] as const;

const METRIC_ROWS = [
  {
    metric: 'TT100T',
    unit: 'seconds (lower = better)',
    definition:
      'Wall-clock time from first prompt token sent to the moment the 100th output token is received. Cluster target < 1.1 s.',
    notes: 'Single-stream; reflects end-to-end latency including network round-trip to the inference server.'
  },
  {
    metric: 'Throughput',
    unit: 'tokens / second (higher = better)',
    definition: 'Output token rate averaged over the full generation window.',
    notes: 'Derived from the same single-stream request used for TT100T.'
  },
  {
    metric: 'MMLU-Pro Accuracy',
    unit: 'fraction 0–1 (higher = better)',
    definition:
      '10-option (A–J) multiple-choice accuracy on the MMLU-Pro subset. Random baseline = 0.10 (uniform over 10 choices).',
    notes: 'Normalised view shifts the baseline to 0; values below 0 indicate below-random performance.'
  }
] as const;

// ----------------------------------------------------------------------

const SectionHeader = ({ children }: { children: React.ReactNode }) => (
  <Typography
    variant="overline"
    component="h2"
    sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: '0.1em', mb: 1.5, display: 'block' }}
  >
    {children}
  </Typography>
);

// ----------------------------------------------------------------------

const MethodologyPage = () => (
  <Box sx={{ maxWidth: 900, mx: 'auto', py: { xs: 2, md: 3 }, px: { xs: 0, md: 1 } }}>
    {/* Title */}
    <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 0.75, color: 'text.primary' }}>
      Methodology &amp; Reproducibility
    </Typography>
    <Typography variant="body1" sx={{ color: 'text.secondary', mb: 3 }}>
      This page documents how the ETRI LLM GPU-vs-NPU benchmarks are conducted, scored, and reported — the
      information needed to reproduce or independently audit every number shown in the leaderboard.
    </Typography>

    <Divider sx={{ mb: 3 }} />

    <Stack spacing={3}>
      {/* Cluster topology */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <SectionHeader>Cluster topology</SectionHeader>
        <Typography variant="body1" sx={{ color: 'text.primary', mb: 1.5 }}>
          All current numbers are produced on a single consolidation Kubernetes cluster:{' '}
          <strong>jw1</strong> (control plane) plus the accelerator nodes below. Historical
          NVIDIA&nbsp;L40 / A40 figures in the precision table predate this cluster and are not
          re-run here.
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Device</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Node(s)</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Capacity</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {TOPOLOGY_ROWS.map((row) => (
                <TableRow key={row.device} hover>
                  <TableCell sx={{ color: 'text.primary' }}>{row.device}</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{row.type}</TableCell>
                  <TableCell>
                    <Typography
                      component="span"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.8125rem',
                        px: 0.75,
                        py: 0.25,
                        borderRadius: '4px',
                        bgcolor: 'action.selected',
                        color: 'text.primary'
                      }}
                    >
                      {row.nodes}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{row.slots}</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{row.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Model under test */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <SectionHeader>Model under test</SectionHeader>
        <Typography variant="body1" sx={{ color: 'text.primary', mb: 1 }}>
          <strong>Llama-3.1-8B-Instruct</strong> (Meta, Apache 2.0). All devices serve the same model
          checkpoint; the only permitted variation is numeric precision, which is fixed per device as shown
          below.
        </Typography>
        <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
          Cross-device accuracy comparisons are fair only within the same precision tier. FP8 and BF16
          runs may differ by a small amount independent of hardware capability.
        </Alert>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Device</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Precision</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {PRECISION_ROWS.map((row) => (
                <TableRow key={row.device} hover>
                  <TableCell>{row.device}</TableCell>
                  <TableCell>{row.type}</TableCell>
                  <TableCell>
                    <Typography
                      component="span"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.8125rem',
                        px: 0.75,
                        py: 0.25,
                        borderRadius: '4px',
                        bgcolor: 'action.selected',
                        color: 'text.primary'
                      }}
                    >
                      {row.precision}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{row.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Metrics */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <SectionHeader>Metrics defined</SectionHeader>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Metric</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Unit</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Definition</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {METRIC_ROWS.map((row) => (
                <TableRow key={row.metric} hover>
                  <TableCell>
                    <Typography component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', fontWeight: 600, color: 'text.primary' }}>
                      {row.metric}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{row.unit}</TableCell>
                  <TableCell sx={{ fontSize: '0.8125rem', color: 'text.primary' }}>{row.definition}</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{row.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Measurement contexts */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <SectionHeader>Measurement contexts</SectionHeader>
        <Stack spacing={1.5}>
          <Typography variant="body2" sx={{ color: 'text.primary' }}>
            <strong>NPU path (RNGD, Atom+):</strong> single-stream server-side measurement. One request is
            in-flight at a time; the server records token timestamps internally. This is consistent with
            MLPerf Inference Server scenario semantics.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.primary' }}>
            <strong>GPU path (L40, A40, A30):</strong> offline / client-side batched measurement. The
            client submits a batch of prompts and measures wall-clock time from submission to final token
            receipt, then divides by total tokens to derive throughput.
          </Typography>
          <Alert severity="warning" sx={{ mt: 1 }}>
            <strong>Important caveat — cross-device TT100T is exploratory, not controlled.</strong>{' '}
            Single-stream (NPU) and batched-offline (GPU) are fundamentally different measurement contexts.
            Single-stream latency tends to be lower than per-sample latency under batching, so any NPU
            latency advantage shown in the leaderboard should be treated as an <em>upper bound</em> on the
            true single-stream advantage. Do not cite the cross-device TT100T delta as a controlled
            head-to-head result without acknowledging this distinction.
          </Alert>
        </Stack>
      </Paper>

      {/* Statistics */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <SectionHeader>Statistics &amp; significance</SectionHeader>
        <Stack spacing={1.5}>
          <Typography variant="body2" sx={{ color: 'text.primary' }}>
            Each reported value is the <strong>mean ± sample standard deviation</strong> (Bessel-corrected,
            denominator <em>n</em> − 1) over all completed runs for that device in the sweep window.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.primary' }}>
            For small-sample comparisons (<em>n</em> &lt; 30), <strong>Student-t</strong> critical values
            are used rather than z-scores. Device-vs-device lead/tie decisions use a{' '}
            <strong>Welch unequal-variance t-test</strong> on the difference of means; the 95 % confidence
            interval of the difference is compared to zero to classify the result as a statistically
            significant lead or a statistical tie.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            The live aggregation logic (mean, stdev, Welch CI) lives in{' '}
            <Typography component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
              src/components/home/deviceAggregates.ts
            </Typography>
            .
          </Typography>
        </Stack>
      </Paper>

      {/* Change log */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <SectionHeader>Change log</SectionHeader>
        <Stack spacing={1}>
          <Typography variant="body2" sx={{ color: 'text.primary' }}>
            <strong>2026-06</strong> — Initial methodology disclosure. MMLU-Pro 10-option scoring fix
            (backend v47); FP8 precision enabled for L40 and RNGD (backend v45); Welch CI lead/tie
            logic shipped (frontend v44+).
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
            Last updated: June 2026. This page will be updated whenever the measurement protocol,
            scoring logic, or device configuration changes.
          </Typography>
        </Stack>
      </Paper>
    </Stack>
  </Box>
);

export default MethodologyPage;
