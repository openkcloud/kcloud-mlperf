import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography
} from '@mui/material';

import { CandidatesApi } from '@/api/domains/comparison';
import type { CandidateCategory, ComparisonCandidate } from '@/api/domains/comparison';
import { ComparisonDiagnosticPanel } from '@/components/ComparisonDiagnosticPanel';
import { Tt100tBadge } from '@/components/Tt100tBadge';

// ----------------------------------------------------------------------

const CATEGORY_LABELS: Record<CandidateCategory, string> = {
  strict: 'Strict',
  hardware_optimized: 'Hardware-Optimized',
  related: 'Related'
};

const CATEGORY_ORDER: CandidateCategory[] = ['strict', 'hardware_optimized', 'related'];

// ----------------------------------------------------------------------

type CandidateCardProps = {
  candidate: ComparisonCandidate;
  onSelect: (candidate: ComparisonCandidate) => void;
};

const CandidateCard = ({ candidate, onSelect }: CandidateCardProps) => {
  const { run } = candidate;
  const hwLabel = `${run.hardware.vendor.toUpperCase()} ${run.hardware.model}`;
  const hwType = run.hardware.type.toUpperCase();

  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardActionArea onClick={() => onSelect(candidate)}>
        <CardContent sx={{ py: 1.5, px: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={hwType} size="small" color={run.hardware.type === 'npu' ? 'primary' : 'default'} />
            <Chip label={hwLabel} size="small" variant="outlined" />
            <Chip label={run.benchmark.toUpperCase()} size="small" variant="outlined" />
            <Tt100tBadge value={run.metrics.tt100t_seconds} />
          </Stack>
          <Typography
            variant="body2"
            fontWeight={600}
            sx={{ mt: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            #{run.id} {run.name}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
            {run.metrics.tps != null && (
              <Typography variant="caption" color="text.secondary">
                TPS: {run.metrics.tps.toFixed(1)}
              </Typography>
            )}
            {run.metrics.accuracy_pct != null && (
              <Typography variant="caption" color="text.secondary">
                Accuracy: {run.metrics.accuracy_pct.toFixed(1)}%
              </Typography>
            )}
          </Stack>
          <Typography variant="caption" color="text.disabled" sx={{ mt: 0.25, display: 'block' }}>
            {candidate.comparability_reason}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
};

// ----------------------------------------------------------------------

type Props = {
  runId: number | string;
  benchmark?: string;
  onSelect: (candidate: ComparisonCandidate) => void;
  'data-testid'?: string;
};

export const ComparisonCandidatePicker = ({
  runId,
  benchmark,
  onSelect,
  'data-testid': testId
}: Props) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['comparison', 'candidates', String(runId), benchmark],
    queryFn: () => CandidatesApi.getCandidates(runId, benchmark ? { benchmark } : undefined),
    enabled: runId != null
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }} data-testid={testId}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box data-testid={testId}>
        <ComparisonDiagnosticPanel reason="ingestion_failed" message="Failed to load candidate runs." />
      </Box>
    );
  }

  const candidates = data?.candidates ?? [];

  if (candidates.length === 0) {
    return (
      <Box data-testid={testId ?? 'comparison-candidate-picker'}>
        <ComparisonDiagnosticPanel
          reason={data?.diagnostic?.reason ?? 'all_runs_filtered'}
          message="No comparable runs — try changing filter or running a sibling benchmark"
        />
      </Box>
    );
  }

  const grouped = CATEGORY_ORDER.reduce<Record<CandidateCategory, ComparisonCandidate[]>>(
    (acc, cat) => {
      acc[cat] = candidates.filter((c) => c.category === cat);
      return acc;
    },
    { strict: [], hardware_optimized: [], related: [] }
  );

  return (
    <Box data-testid={testId ?? 'comparison-candidate-picker'}>
      {CATEGORY_ORDER.map((cat, idx) => {
        const items = grouped[cat];
        if (items.length === 0) return null;
        return (
          <Box key={cat}>
            {idx > 0 && <Divider sx={{ my: 2 }} />}
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              {CATEGORY_LABELS[cat]}
            </Typography>
            {items.map((c) => (
              <CandidateCard key={c.run.id} candidate={c} onSelect={onSelect} />
            ))}
          </Box>
        );
      })}
    </Box>
  );
};
