import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  IconButton,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material';
import { ArrowBack, Refresh } from '@mui/icons-material';

import { DeviceDashboardHeader } from '@/components/DeviceDashboardHeader/DeviceDashboardHeader';
import { ComparisonDiagnosticPanel } from '@/components/ComparisonDiagnosticPanel';
import { ComparisonCandidatePicker } from '@/components/ComparisonCandidatePicker';
import { ComparisonRunTable } from '@/components/ComparisonRunTable';
import { ComparisonDetailDialog } from '@/components/ComparisonDetailDialog';
import { QueryBoundary } from '@/components/QueryBoundary';
import { RenderErrorBoundary } from '@/components/ErrorBoundary';
import { ComparisonApi } from '@/api/domains/comparison';
import type { ComparisonRunRow, ComparisonDiagnosticReason, ComparisonCandidate, ComparisonListResponse } from '@/api/domains/comparison';
import type { FairnessAssessment } from '@/api/types/fairness-assessment';
import { MpExamPageLinks } from '@/contexts/RouterContext/router.links';
import { formatAge } from '@/helpers/format-age.helper';

// ----------------------------------------------------------------------

const MlperfDeviceComparisonPage = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  const [selectedA, setSelectedA] = useState<ComparisonRunRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareData, setCompareData] = useState<Record<string, { a: number | null; b: number | null }> | null>(null);
  const [selectedB, setSelectedB] = useState<ComparisonRunRow | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [incompat, setIncompat] = useState<string[]>([]);
  const [fairness, setFairness] = useState<FairnessAssessment | undefined>(undefined);

  const listQuery = useQuery({
    queryKey: ['comparison', 'list', 'mlperf'],
    queryFn: () => ComparisonApi.list({ benchmark: 'mlperf' }),
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
    if (!selectedA) return;
    setPickerOpen(false);
    const runB = candidate.run;
    setSelectedB(runB);
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    setIncompat([]);
    setFairness(undefined);
    setDialogOpen(true);
    try {
      const result = await ComparisonApi.compare('mlperf', selectedA.id, runB.id);
      setCompareData(result.metrics);
      setIncompat(result.incompatibility_reasons ?? []);
      setFairness(result.fairness_assessment);
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
    setIncompat([]);
    setFairness(undefined);
    try {
      const result = await ComparisonApi.compare('mlperf', selectedA.id, selectedB.id);
      setCompareData(result.metrics);
      setIncompat(result.incompatibility_reasons ?? []);
      setFairness(result.fairness_assessment);
    } catch {
      setCompareError('Failed to load comparison data.');
    } finally {
      setCompareLoading(false);
    }
  };

  const isEmpty = !isLoading && !error && runs.length === 0;

  return (
    <RenderErrorBoundary onRetry={refetch}>
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <DeviceDashboardHeader
          title="MLPerf — Cross-Device Comparison"
          description="Select run A from the list below — comparable candidates will appear instantly for run B."
          chipLabel="Historical"
          chipColor={theme.palette.primary.main}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Updated {formatAge(listQuery.dataUpdatedAt)}
          </Typography>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={() => refetch()} aria-label="refresh comparison list">
              <Refresh fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

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
            if (diagnosticReason === 'no_runs_exist') navigate(MpExamPageLinks.main);
            else if (diagnosticReason === 'all_runs_filtered') refetch();
            else navigate(MpExamPageLinks.main);
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
          exportParams={{ benchmark: 'mlperf' }}
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
            benchmark="mlperf"
            onSelect={handleSelectB}
            data-testid="mlperf-candidate-picker"
          />
        )}
      </Drawer>

      <ComparisonDetailDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="MLPerf Side-by-Side Comparison"
        runA={selectedA}
        runB={selectedB}
        metrics={compareData}
        isLoading={compareLoading}
        error={compareError}
        onRetry={handleRetry}
        incompatibilityReasons={incompat}
        fairnessAssessment={fairness}
        accentA={theme.palette.secondary.main}
        accentB={theme.palette.primary.main}
        labelA="Run A"
        labelB="Run B"
      />
    </Box>
    </RenderErrorBoundary>
  );
};

export default MlperfDeviceComparisonPage;
