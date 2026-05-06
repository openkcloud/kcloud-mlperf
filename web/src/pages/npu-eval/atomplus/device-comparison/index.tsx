import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
  useTheme
} from '@mui/material';

import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader/DeviceDashboardHeader';
import { ComparisonDiagnosticPanel } from '@/components/ComparisonDiagnosticPanel';
import { ComparisonRunTable } from '@/components/ComparisonRunTable';
import { ComparisonDetailDialog } from '@/components/ComparisonDetailDialog';
import { ComparisonApi } from '@/api/domains/comparison';
import type { ComparisonRunRow, ComparisonDiagnosticReason } from '@/api/domains/comparison';

// ----------------------------------------------------------------------

const AtomPlusDeviceComparisonPage = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  const [selectedAtom, setSelectedAtom] = useState<ComparisonRunRow | null>(null);
  const [selectedGpu, setSelectedGpu] = useState<ComparisonRunRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareData, setCompareData] = useState<Record<string, { a: number | null; b: number | null }> | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['comparison', 'list', 'atomplus-device-comparison'],
    queryFn: () => ComparisonApi.list({ hardware: 'all' }),
    refetchInterval: 30_000,
  });

  const runs = data?.runs ?? [];
  const atomRuns = runs.filter((r) => r.hardware.vendor === 'rebellions');
  const gpuRuns = runs.filter((r) => r.hardware.type === 'gpu');

  const diagnosticReason: ComparisonDiagnosticReason = data?.diagnostic?.reason ?? 'no_runs_exist';

  const handleCompare = async () => {
    if (!selectedAtom || !selectedGpu) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    setDialogOpen(true);
    try {
      const bench = selectedAtom.benchmark === 'mmlu' ? 'mmlu' : 'mlperf';
      const result = await ComparisonApi.compare(bench, selectedAtom.id, selectedGpu.id);
      setCompareData(result.metrics);
    } catch {
      setCompareError('Failed to load comparison data from server.');
    } finally {
      setCompareLoading(false);
    }
  };

  const canCompare = selectedAtom !== null && selectedGpu !== null;
  const isEmpty = !isLoading && !error && runs.length === 0;

  return (
    <Box>
      <DeviceDashboardHeader
        title="Atom+ NPU vs GPU — Cross-Device Comparison"
        description="Select one completed Rebellions Atom+ run and one MLPerf GPU run, then click Compare for a metric-by-metric breakdown."
        chipLabel="Atom+ Only"
        chipColor="#CA8A04"
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
            if (diagnosticReason === 'no_runs_exist') navigate('/npu-eval/atomplus');
            else if (diagnosticReason === 'all_runs_filtered') refetch();
            else navigate('/npu-eval/atomplus');
          }}
        />
      )}

      {!isLoading && !error && runs.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              {selectedAtom ? `Atom+: #${selectedAtom.id} ${selectedAtom.name}` : 'No Atom+ run selected'}
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

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1, width: '100%' }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                Rebellions Atom+ Runs
              </Typography>
              {atomRuns.length === 0 ? (
                <ComparisonDiagnosticPanel
                  reason="hardware_not_ready"
                  message="No completed Atom+ runs found."
                  onAction={() => navigate('/npu-eval/atomplus')}
                />
              ) : (
                <ComparisonRunTable
                  runs={atomRuns}
                  isLoading={false}
                  onSelectRun={(run) => setSelectedAtom(prev => prev?.id === run.id ? null : run)}
                  selectedId={selectedAtom?.id}
                  showBenchmark
                  showVendor={false}
                  exportParams={{ hardware: 'npu' }}
                  renderRowAction={(run) => (
                    <Button
                      size="small"
                      variant={selectedAtom?.id === run.id ? 'contained' : 'outlined'}
                      color="warning"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAtom(prev => prev?.id === run.id ? null : run);
                      }}
                    >
                      {selectedAtom?.id === run.id ? 'Selected' : 'Pick'}
                    </Button>
                  )}
                  onClearFilters={() => refetch()}
                />
              )}
            </Box>

            <Box sx={{ flex: 1, width: '100%' }}>
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
                <ComparisonRunTable
                  runs={gpuRuns}
                  isLoading={false}
                  onSelectRun={(run) => setSelectedGpu(prev => prev?.id === run.id ? null : run)}
                  selectedId={selectedGpu?.id}
                  showBenchmark
                  showVendor
                  exportParams={{ hardware: 'gpu' }}
                  renderRowAction={(run) => (
                    <Button
                      size="small"
                      variant={selectedGpu?.id === run.id ? 'contained' : 'outlined'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedGpu(prev => prev?.id === run.id ? null : run);
                      }}
                    >
                      {selectedGpu?.id === run.id ? 'Selected' : 'Pick'}
                    </Button>
                  )}
                  onClearFilters={() => refetch()}
                />
              )}
            </Box>
          </Stack>
        </>
      )}

      <ComparisonDetailDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Atom+ NPU vs GPU — Side-by-Side Comparison"
        runA={selectedAtom}
        runB={selectedGpu}
        metrics={compareData}
        isLoading={compareLoading}
        error={compareError}
        onRetry={handleCompare}
        accentA="#CA8A04"
        accentB={theme.palette.secondary.main}
        labelA="Atom+ (NPU)"
        labelB="GPU"
      />
    </Box>
  );
};

export default AtomPlusDeviceComparisonPage;
