import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Stack,
  Typography,
  useTheme
} from '@mui/material';

import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader/DeviceDashboardHeader';
import { ComparisonDiagnosticPanel } from '@/components/ComparisonDiagnosticPanel';
import { ComparisonRunTable } from '@/components/ComparisonRunTable';
import { ComparisonDetailDialog } from '@/components/ComparisonDetailDialog';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ComparisonApi } from '@/api/domains/comparison';
import type { ComparisonRunRow, ComparisonDiagnosticReason, ComparisonListResponse } from '@/api/domains/comparison';

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

  const listQuery = useQuery({
    queryKey: ['comparison', 'list', 'npu', 'furiosa'],
    queryFn: () => ComparisonApi.list({ hardware: 'all' }),
    refetchInterval: 30_000
  });

  const { data, isLoading, error, refetch } = listQuery;

  const runs = data?.runs ?? [];
  const rngdRuns = runs.filter((r) => r.hardware.type === 'npu' && r.hardware.vendor === 'furiosa');
  const gpuRuns = runs.filter((r) => r.hardware.type === 'gpu');

  const diagnosticReason: ComparisonDiagnosticReason = data?.diagnostic?.reason ?? 'no_runs_exist';

  const handleCompare = async () => {
    if (!selectedRngd || !selectedGpu) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    setDialogOpen(true);
    try {
      const bench = selectedRngd.benchmark === 'mmlu' ? 'mmlu' : 'mlperf';
      const result = await ComparisonApi.compare(bench, selectedRngd.id, selectedGpu.id);
      setCompareData(result.metrics);
    } catch {
      setCompareError('Failed to load comparison data from server.');
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

      <QueryBoundary<ComparisonListResponse>
        query={listQuery}
        isEmpty={d => !d || d.runs.length === 0}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
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

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, width: '100%' }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              FuriosaAI RNGD Runs
            </Typography>
            {rngdRuns.length === 0 && !isLoading ? (
              <ComparisonDiagnosticPanel
                reason="hardware_not_ready"
                message="No completed RNGD runs found."
                onAction={() => navigate('/npu-eval/rngd')}
              />
            ) : (
              <ComparisonRunTable
                runs={rngdRuns}
                isLoading={isLoading}
                onSelectRun={(run) => setSelectedRngd(prev => prev?.id === run.id ? null : run)}
                selectedId={selectedRngd?.id}
                showBenchmark
                showVendor={false}
                exportParams={{ hardware: 'npu' }}
                renderRowAction={(run) => (
                  <Button
                    size="small"
                    variant={selectedRngd?.id === run.id ? 'contained' : 'outlined'}
                    color="warning"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedRngd(prev => prev?.id === run.id ? null : run);
                    }}
                  >
                    {selectedRngd?.id === run.id ? 'Selected' : 'Pick'}
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
            {gpuRuns.length === 0 && !isLoading ? (
              <ComparisonDiagnosticPanel
                reason="hardware_not_ready"
                message="No completed MLPerf GPU runs found."
                onAction={() => navigate('/ml-perf')}
              />
            ) : (
              <ComparisonRunTable
                runs={gpuRuns}
                isLoading={isLoading}
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
      </QueryBoundary>

      <ComparisonDetailDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="RNGD NPU vs GPU — Side-by-Side Comparison"
        runA={selectedRngd}
        runB={selectedGpu}
        metrics={compareData}
        isLoading={compareLoading}
        error={compareError}
        onRetry={handleCompare}
        accentA="#F97316"
        accentB={theme.palette.secondary.main}
        labelA="RNGD (NPU)"
        labelB="GPU"
      />
    </Box>
  );
};

export default RngdDeviceComparisonPage;
