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
import { ComparisonDiagnosticPanel } from '@/components/ComparisonDiagnosticPanel';
import { ComparisonApi } from '@/api/domains/comparison';
import type { ComparisonRunRow, ComparisonDiagnosticReason } from '@/api/domains/comparison';
import { MpExamPageLinks } from '@/contexts/RouterContext/router.links';

// ----------------------------------------------------------------------

const MlperfDeviceComparisonPage = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  const [selectedA, setSelectedA] = useState<ComparisonRunRow | null>(null);
  const [selectedB, setSelectedB] = useState<ComparisonRunRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareData, setCompareData] = useState<Record<string, { a: number | null; b: number | null }> | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['comparison', 'list', 'mlperf'],
    queryFn: () => ComparisonApi.list({ benchmark: 'mlperf' }),
    refetchInterval: 30_000
  });

  const runs = data?.runs ?? [];
  const gpuRuns = runs.filter((r) => r.hardware.type === 'gpu');
  const npuRuns = runs.filter((r) => r.hardware.type === 'npu');

  const diagnosticReason: ComparisonDiagnosticReason =
    data?.diagnostic?.reason ?? 'no_runs_exist';

  const handleCompare = async () => {
    if (!selectedA || !selectedB) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    try {
      const result = await ComparisonApi.compare('mlperf', selectedA.id, selectedB.id);
      setCompareData(result.metrics);
      setDialogOpen(true);
    } catch {
      setCompareError('Failed to load comparison data.');
      setDialogOpen(true);
    } finally {
      setCompareLoading(false);
    }
  };

  const canCompare = selectedA !== null && selectedB !== null;
  const isEmpty = !isLoading && !error && runs.length === 0;

  return (
    <Box>
      <DeviceDashboardHeader
        title="MLPerf — Cross-Device Comparison"
        description="Select one GPU run and one NPU run, then click Compare to see a side-by-side metric breakdown."
        chipLabel="Historical"
        chipColor={theme.palette.primary.main}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load comparison data. Please refresh and try again.
        </Alert>
      )}

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {isEmpty && (
        <ComparisonDiagnosticPanel
          reason={diagnosticReason}
          message={data?.diagnostic?.message}
          onAction={() => {
            if (diagnosticReason === 'no_runs_exist') navigate(MpExamPageLinks.main);
            else if (diagnosticReason === 'all_runs_filtered') refetch();
            else navigate(MpExamPageLinks.main);
          }}
        />
      )}

      {!isLoading && !error && runs.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {selectedA ? `GPU: #${selectedA.id} ${selectedA.name}` : 'No GPU run selected'}
            </Typography>
            <Typography variant="body2" color="text.secondary">&amp;</Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedB ? `NPU: #${selectedB.id} ${selectedB.name}` : 'No NPU run selected'}
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
            <Paper sx={{ flex: 1, p: 2, overflow: 'auto', maxHeight: 520 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                MLPerf GPU Runs
              </Typography>
              {gpuRuns.length === 0 ? (
                <ComparisonDiagnosticPanel
                  reason="hardware_not_ready"
                  message="No completed MLPerf GPU runs found."
                  onAction={() => navigate(MpExamPageLinks.main)}
                />
              ) : (
                <TableContainer>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Hardware</TableCell>
                        <TableCell>TPS</TableCell>
                        <TableCell>Date</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {gpuRuns.map((run) => {
                        const selected = selectedA?.id === run.id;
                        return (
                          <TableRow
                            key={run.id}
                            hover
                            selected={selected}
                            onClick={() => setSelectedA(selected ? null : run)}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell>{run.id}</TableCell>
                            <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {run.name}
                            </TableCell>
                            <TableCell>
                              <Chip label={run.hardware.model} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell>{run.metrics.tps?.toFixed(1) ?? '—'}</TableCell>
                            <TableCell>
                              {run.completed_at ? new Date(run.completed_at).toLocaleDateString() : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>

            <Paper sx={{ flex: 1, p: 2, overflow: 'auto', maxHeight: 520 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                NPU MLPerf Runs
              </Typography>
              {npuRuns.length === 0 ? (
                <ComparisonDiagnosticPanel
                  reason="hardware_not_ready"
                  message="No completed NPU MLPerf runs found."
                  onAction={() => navigate('/npu-eval')}
                />
              ) : (
                <TableContainer>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Hardware</TableCell>
                        <TableCell>TPS</TableCell>
                        <TableCell>Date</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {npuRuns.map((run) => {
                        const selected = selectedB?.id === run.id;
                        return (
                          <TableRow
                            key={run.id}
                            hover
                            selected={selected}
                            onClick={() => setSelectedB(selected ? null : run)}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell>{run.id}</TableCell>
                            <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {run.name}
                            </TableCell>
                            <TableCell>
                              <Chip label={run.hardware.model} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell>{run.metrics.tps?.toFixed(1) ?? '—'}</TableCell>
                            <TableCell>
                              {run.completed_at ? new Date(run.completed_at).toLocaleDateString() : '—'}
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>MLPerf Side-by-Side Comparison</DialogTitle>
        <DialogContent dividers>
          {compareError && (
            <Alert severity="error" sx={{ mb: 2 }}>{compareError}</Alert>
          )}
          {compareData && (
            <Box>
              <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                <Paper variant="outlined" sx={{ flex: 1, p: 2, borderTop: `3px solid ${theme.palette.secondary.main}` }}>
                  <Typography variant="subtitle2" fontWeight={700}>GPU: {selectedA?.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{selectedA?.hardware.model}</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ flex: 1, p: 2, borderTop: `3px solid ${theme.palette.primary.main}` }}>
                  <Typography variant="subtitle2" fontWeight={700}>NPU: {selectedB?.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{selectedB?.hardware.model}</Typography>
                </Paper>
              </Stack>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Metric</TableCell>
                      <TableCell>GPU</TableCell>
                      <TableCell>NPU</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(compareData).map(([key, val]) => (
                      <TableRow key={key}>
                        <TableCell sx={{ fontWeight: 600 }}>{key}</TableCell>
                        <TableCell>{typeof val.a === 'number' ? val.a.toFixed(3) : '—'}</TableCell>
                        <TableCell>{typeof val.b === 'number' ? val.b.toFixed(3) : '—'}</TableCell>
                      </TableRow>
                    ))}
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
