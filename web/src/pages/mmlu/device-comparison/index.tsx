import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  Typography,
  useTheme
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';

import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader/DeviceDashboardHeader';
import { ComparisonDiagnosticPanel } from '@/components/ComparisonDiagnosticPanel';
import { ComparisonCandidatePicker } from '@/components/ComparisonCandidatePicker';
import { ComparisonRunTable } from '@/components/ComparisonRunTable';
import { ComparisonDetailDialog } from '@/components/ComparisonDetailDialog';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ComparisonApi } from '@/api/domains/comparison';
import type { ComparisonRunRow, ComparisonDiagnosticReason, ComparisonCandidate, ComparisonListResponse } from '@/api/domains/comparison';
import { MmluPageLinks } from '@/contexts/RouterContext/router.links';

// ----------------------------------------------------------------------

const MmluDeviceComparisonPage = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  const [selectedA, setSelectedA] = useState<ComparisonRunRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareData, setCompareData] = useState<Record<string, { a: number | null; b: number | null }> | null>(null);
  const [selectedB, setSelectedB] = useState<ComparisonRunRow | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['comparison', 'list', 'mmlu'],
    queryFn: () => ComparisonApi.list({ benchmark: 'mmlu' }),
    refetchInterval: 30_000
  });

  const { data, isLoading, error, refetch } = listQuery;

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
    setDialogOpen(true);
    try {
      const result = await ComparisonApi.compare('mmlu', selectedA!.id, runB.id);
      setCompareData(result.metrics);
    } catch {
      setCompareError('Failed to load comparison data.');
    } finally {
      setCompareLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!selectedA || !selectedB) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    try {
      const result = await ComparisonApi.compare('mmlu', selectedA.id, selectedB.id);
      setCompareData(result.metrics);
    } catch {
      setCompareError('Failed to load comparison data.');
    } finally {
      setCompareLoading(false);
    }
  };

  const isEmpty = !isLoading && !error && runs.length === 0;

  return (
    <Box>
      <DeviceDashboardHeader
        title="MMLU — Cross-Device Comparison"
        description="Select run A from the list below — comparable candidates will appear instantly for run B."
        chipLabel="Historical"
        chipColor={theme.palette.primary.main}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load comparison data. Please refresh and try again.
        </Alert>
      )}

      {isEmpty && (
        <ComparisonDiagnosticPanel
          reason={diagnosticReason}
          message={data?.diagnostic?.message}
          onAction={() => {
            if (diagnosticReason === 'no_runs_exist') navigate(MmluPageLinks.main);
            else if (diagnosticReason === 'all_runs_filtered') refetch();
            else navigate(MmluPageLinks.main);
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

      <QueryBoundary<ComparisonListResponse>
        query={listQuery}
        isEmpty={d => !d || d.runs.length === 0}
      >
        <ComparisonRunTable
          runs={runs}
          isLoading={isLoading}
          onSelectRun={handleSelectA}
          selectedId={selectedA?.id}
          showBenchmark={false}
          showVendor
          exportParams={{ benchmark: 'mmlu' }}
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
      </QueryBoundary>

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
            benchmark="mmlu"
            onSelect={handleSelectB}
            data-testid="mmlu-candidate-picker"
          />
        )}
      </Drawer>

      <ComparisonDetailDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="MMLU Side-by-Side Comparison"
        runA={selectedA}
        runB={selectedB}
        metrics={compareData}
        isLoading={compareLoading}
        error={compareError}
        onRetry={handleRetry}
        accentA={theme.palette.secondary.main}
        accentB={theme.palette.primary.main}
        labelA="Run A"
        labelB="Run B"
      />
    </Box>
  );
};

export default MmluDeviceComparisonPage;
