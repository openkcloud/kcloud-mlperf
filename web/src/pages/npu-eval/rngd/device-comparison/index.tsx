import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Typography, useTheme
} from '@mui/material';

import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader/DeviceDashboardHeader';
import { ComparisonDiagnosticPanel } from '@/components/ComparisonDiagnosticPanel';
import { ComparisonApi } from '@/api/domains/comparison';
import type { ComparisonRunRow, ComparisonDiagnosticReason } from '@/api/domains/comparison';

// ----------------------------------------------------------------------

const RngdDeviceComparisonPage = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  const [selectedRngd, setSelectedRngd] = useState<ComparisonRunRow | null>(null);
  const [selectedGpu, setSelectedGpu] = useState<ComparisonRunRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareData, setCompareData] = useState<Record<string, { a: number | null; b: number | null }> | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['comparison', 'list', 'npu', 'furiosa'],
    queryFn: () => ComparisonApi.list({ hardware: 'all' }),
    refetchInterval: 30_000
  });

  const runs = data?.runs ?? [];
  const rngdRuns = runs.filter((r) => r.hardware.type === 'npu' && r.hardware.vendor === 'furiosa');
  const gpuRuns = runs.filter((r) => r.hardware.type === 'gpu');

  const diagnosticReason: ComparisonDiagnosticReason = data?.diagnostic?.reason ?? 'no_runs_exist';

  const handleCompare = async () => {
    if (!selectedRngd || !selectedGpu) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    try {
      const result = await ComparisonApi.compare('all', selectedRngd.id, selectedGpu.id);
      setCompareData(result.metrics);
      setDialogOpen(true);
    } catch {
      setCompareError('Failed to load comparison data from server.');
      setDialogOpen(true);
    } finally {
      setCompareLoading(false);
    }
  };

  const canCompare = selectedRngd !== null && selectedGpu !== null;
  const isEmpty = !isLoading && !error && runs.length === 0;

  return (
    <Box>
      <DeviceDashboardHeader
        title="RNGD NPU vs GPU — Cross-Device Comparison"
        description="Select one completed FuriosaAI RNGD run and one MLPerf GPU run, then click Compare for a metric-by-metric breakdown."
        chipLabel="RNGD Only"
        chipColor="#F97316"
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>Failed to load exam data. Please refresh and try again.</Alert>
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
            if (diagnosticReason === 'no_runs_exist') navigate('/npu-eval/rngd');
            else if (diagnosticReason === 'all_runs_filtered') refetch();
            else navigate('/npu-eval/rngd');
          }}
        />
      )}

      {!isLoading && !error && runs.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {selectedRngd ? `RNGD: #${selectedRngd.id} ${selectedRngd.name}` : 'No RNGD run selected'}
            </Typography>
            <Typography variant="body2" color="text.secondary">&amp;</Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedGpu ? `GPU: #${selectedGpu.id} ${selectedGpu.name}` : 'No GPU run selected'}
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
                FuriosaAI RNGD Runs
              </Typography>
              {rngdRuns.length === 0 ? (
                <ComparisonDiagnosticPanel
                  reason="hardware_not_ready"
                  message="No completed RNGD runs found."
                  onAction={() => navigate('/npu-eval/rngd')}
                />
              ) : (
                <TableContainer>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Hardware</TableCell>
                        <TableCell>Benchmark</TableCell>
                        <TableCell>Date</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rngdRuns.map((run) => {
                        const selected = selectedRngd?.id === run.id;
                        return (
                          <TableRow key={run.id} hover selected={selected} onClick={() => setSelectedRngd(selected ? null : run)} sx={{ cursor: 'pointer' }}>
                            <TableCell>{run.id}</TableCell>
                            <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.name}</TableCell>
                            <TableCell><Chip label={run.hardware.model} size="small" variant="outlined" /></TableCell>
                            <TableCell><Chip label={run.benchmark.toUpperCase()} size="small" variant="outlined" /></TableCell>
                            <TableCell>{run.completed_at ? new Date(run.completed_at).toLocaleDateString() : '—'}</TableCell>
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
                MLPerf GPU Runs
              </Typography>
              {gpuRuns.length === 0 ? (
                <ComparisonDiagnosticPanel
                  reason="hardware_not_ready"
                  message="No completed MLPerf GPU runs found."
                  onAction={() => navigate('/ml-perf')}
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
                        const selected = selectedGpu?.id === run.id;
                        return (
                          <TableRow key={run.id} hover selected={selected} onClick={() => setSelectedGpu(selected ? null : run)} sx={{ cursor: 'pointer' }}>
                            <TableCell>{run.id}</TableCell>
                            <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.name}</TableCell>
                            <TableCell><Chip label={run.hardware.model} size="small" variant="outlined" /></TableCell>
                            <TableCell>{run.metrics.tps?.toFixed(1) ?? '—'}</TableCell>
                            <TableCell>{run.completed_at ? new Date(run.completed_at).toLocaleDateString() : '—'}</TableCell>
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
        <DialogTitle>RNGD NPU vs GPU — Side-by-Side Comparison</DialogTitle>
        <DialogContent dividers>
          {compareError && <Alert severity="error" sx={{ mb: 2 }}>{compareError}</Alert>}
          {compareData && (
            <Box>
              <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                <Paper variant="outlined" sx={{ flex: 1, p: 2, borderTop: '3px solid #F97316' }}>
                  <Typography variant="subtitle2" fontWeight={700}>RNGD: {selectedRngd?.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{selectedRngd?.hardware.model} (FuriosaAI)</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ flex: 1, p: 2, borderTop: `3px solid ${theme.palette.secondary.main}` }}>
                  <Typography variant="subtitle2" fontWeight={700}>GPU: {selectedGpu?.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{selectedGpu?.hardware.model}</Typography>
                </Paper>
              </Stack>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Metric</TableCell>
                      <TableCell>RNGD (NPU)</TableCell>
                      <TableCell>GPU</TableCell>
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

export default RngdDeviceComparisonPage;
