import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
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
import { ArrowBack } from '@mui/icons-material';

import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader/DeviceDashboardHeader';
import { ComparisonDiagnosticPanel } from '@/components/ComparisonDiagnosticPanel';
import { ComparisonCandidatePicker } from '@/components/ComparisonCandidatePicker';
import { ComparisonRunTable } from '@/components/ComparisonRunTable';
import { ComparisonApi } from '@/api/domains/comparison';
import type { ComparisonRunRow, ComparisonDiagnosticReason, ComparisonCandidate } from '@/api/domains/comparison';

// ----------------------------------------------------------------------

const NpuDeviceComparisonPage = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  const [selectedA, setSelectedA] = useState<ComparisonRunRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareData, setCompareData] = useState<Record<string, { a: number | null; b: number | null }> | null>(null);
  const [selectedB, setSelectedB] = useState<ComparisonRunRow | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['comparison', 'list', 'all'],
    queryFn: () => ComparisonApi.list({ hardware: 'all' }),
    refetchInterval: 30_000
  });

  const runs = data?.runs ?? [];
  const diagnosticReason: ComparisonDiagnosticReason = data?.diagnostic?.reason ?? 'no_runs_exist';

  const handleSelectA = (run: ComparisonRunRow) => {
    setSelectedA(run);
    setSelectedB(null);
    setPickerOpen(true);
  };

  const handleSelectB = async (candidate: ComparisonCandidate) => {
    setPickerOpen(false);
    const runB = candidate.run;
    setSelectedB(runB);
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    try {
      const result = await ComparisonApi.compare('all', selectedA!.id, runB.id);
      setCompareData(result.metrics);
      setDialogOpen(true);
    } catch {
      setCompareError('Failed to load comparison data from server.');
      setDialogOpen(true);
    } finally {
      setCompareLoading(false);
    }
  };

  const isEmpty = !isLoading && !error && runs.length === 0;

  return (
    <Box>
      <DeviceDashboardHeader
        title="NPU vs GPU — Historical Cross-Device Comparison"
        description="Select run A from the list below — comparable candidates will appear instantly for run B."
        chipLabel="Historical"
        chipColor={theme.palette.primary.main}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load exam data. Please refresh and try again.
        </Alert>
      )}

      {isEmpty && (
        <ComparisonDiagnosticPanel
          reason={diagnosticReason}
          message={data?.diagnostic?.message}
          onAction={() => {
            if (diagnosticReason === 'no_runs_exist') navigate('/npu-eval');
            else if (diagnosticReason === 'all_runs_filtered') refetch();
            else navigate('/npu-eval');
          }}
        />
      )}

      {selectedA && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Button
            size="small"
            startIcon={<ArrowBack />}
            onClick={() => { setSelectedA(null); setSelectedB(null); setPickerOpen(false); }}
          >
            Change Run A
          </Button>
          <Typography variant="body2" color="text.secondary">
            Run A: <strong>#{selectedA.id} {selectedA.name}</strong>
          </Typography>
          {selectedB && (
            <Typography variant="body2" color="text.secondary">
              &nbsp;vs Run B: <strong>#{selectedB.id} {selectedB.name}</strong>
            </Typography>
          )}
          {compareLoading && <CircularProgress size={16} sx={{ ml: 1 }} />}
        </Box>
      )}

      <ComparisonRunTable
        runs={runs}
        isLoading={isLoading}
        onSelectRun={handleSelectA}
        selectedId={selectedA?.id}
        showBenchmark
        showVendor
        exportParams={{ hardware: 'all' }}
        renderRowAction={(run) => (
          <Button
            size="small"
            variant={selectedA?.id === run.id ? 'contained' : 'outlined'}
            onClick={(e) => { e.stopPropagation(); handleSelectA(run); }}
          >
            {selectedA?.id === run.id ? 'Selected' : 'Pick'}
          </Button>
        )}
        onClearFilters={() => refetch()}
      />

      <Drawer
        anchor="right"
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        PaperProps={{ sx: { width: 400, p: 3 } }}
      >
        <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
          Pick Run B
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Comparable runs for #{selectedA?.id} {selectedA?.name}
        </Typography>
        {selectedA && (
          <ComparisonCandidatePicker
            runId={selectedA.id}
            benchmark={selectedA.benchmark}
            onSelect={handleSelectB}
            data-testid="npu-candidate-picker"
          />
        )}
      </Drawer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>NPU vs GPU — Side-by-Side Comparison</DialogTitle>
        <DialogContent dividers>
          {compareError && (
            <Alert severity="error" sx={{ mb: 2 }}>{compareError}</Alert>
          )}
          {compareData && (
            <Box>
              <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                <Paper variant="outlined" sx={{ flex: 1, p: 2, borderTop: `3px solid ${theme.palette.primary.main}` }}>
                  <Typography variant="subtitle2" fontWeight={700}>Run A: {selectedA?.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{selectedA?.hardware.model}</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ flex: 1, p: 2, borderTop: `3px solid ${theme.palette.secondary.main}` }}>
                  <Typography variant="subtitle2" fontWeight={700}>Run B: {selectedB?.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{selectedB?.hardware.model}</Typography>
                </Paper>
              </Stack>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Metric</TableCell>
                      <TableCell>Run A</TableCell>
                      <TableCell>Run B</TableCell>
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

export default NpuDeviceComparisonPage;
