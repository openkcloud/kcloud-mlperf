import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Alert, Box, Chip, Typography } from '@mui/material';

import { ComparisonApi } from '@/api/domains/comparison';

// ----------------------------------------------------------------------

type Run = {
  precision?: string | null;
  model: string;
  dataset?: string | null;
  scenario?: string | null;
  data_number?: number | null;
  max_output_tokens?: number | null;
};

type FairnessBannerProps = {
  benchmark: 'mlperf' | 'mmlu';
  idA: number | string;
  idB: number | string;
  // Fallback config when /comparison/{benchmark}/{idA}/{idB} is unavailable.
  fallbackA?: Run | null;
  fallbackB?: Run | null;
};

// ----------------------------------------------------------------------

type Delta = {
  label: string;
  a: string;
  b: string;
};

const computeDeltas = (a: Run, b: Run): Delta[] => {
  const out: Delta[] = [];
  const fields: Array<[string, keyof Run]> = [
    ['precision', 'precision'],
    ['model', 'model'],
    ['dataset', 'dataset'],
    ['scenario', 'scenario'],
    ['sample count', 'data_number'],
    ['max output tokens', 'max_output_tokens']
  ];
  for (const [label, key] of fields) {
    const va = a[key];
    const vb = b[key];
    if (va == null || vb == null) continue;
    if (String(va) !== String(vb)) {
      out.push({ label, a: String(va), b: String(vb) });
    }
  }
  return out;
};

// ----------------------------------------------------------------------

export const FairnessBanner = ({
  benchmark,
  idA,
  idB,
  fallbackA,
  fallbackB
}: FairnessBannerProps) => {
  // F3: pull /api/comparison/{benchmark}/{idA}/{idB}. Backend already returns
  // fairness_assessment; we still recompute deltas locally to render labels.
  const { data, isLoading } = useQuery({
    queryKey: ['comparison', 'pair', benchmark, idA, idB],
    queryFn: () => ComparisonApi.compare(benchmark, idA, idB),
    staleTime: 60_000,
    retry: 1
  });

  const runA: Run | null = data?.runA
    ? {
        precision: data.runA.precision ?? null,
        model: data.runA.model,
        dataset: data.runA.dataset ?? null,
        scenario: data.runA.scenario ?? null,
        data_number: data.runA.data_number ?? null,
        max_output_tokens: data.runA.max_output_tokens ?? null
      }
    : fallbackA ?? null;

  const runB: Run | null = data?.runB
    ? {
        precision: data.runB.precision ?? null,
        model: data.runB.model,
        dataset: data.runB.dataset ?? null,
        scenario: data.runB.scenario ?? null,
        data_number: data.runB.data_number ?? null,
        max_output_tokens: data.runB.max_output_tokens ?? null
      }
    : fallbackB ?? null;

  const deltas = useMemo(() => {
    if (!runA || !runB) return [];
    return computeDeltas(runA, runB);
  }, [runA, runB]);

  // Backend's structural assessment, when available
  const incompat = data?.fairness_assessment?.incompatibility_reasons ?? [];
  const precisionMismatch =
    data?.fairness_assessment?.precision_class === 'mismatched';

  if (isLoading && !fallbackA && !fallbackB) {
    return null;
  }

  if (deltas.length === 0 && incompat.length === 0 && !precisionMismatch) {
    return (
      <Alert
        severity="success"
        sx={{
          mb: 2,
          borderRadius: '0.75rem',
          '& .MuiAlert-message': { width: '100%' }
        }}
      >
        <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
          Directly comparable — config matches across precision, model, dataset, scenario.
        </Typography>
      </Alert>
    );
  }

  return (
    <Alert
      severity="error"
      sx={{
        mb: 2,
        borderRadius: '0.75rem',
        '& .MuiAlert-message': { width: '100%' }
      }}
    >
      <Typography sx={{ fontWeight: 700, fontSize: '0.9375rem', mb: 0.75 }}>
        ⚠ Not directly comparable
      </Typography>
      {deltas.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {deltas.map(d => (
            <Chip
              key={d.label}
              size="small"
              label={`${d.label}: ${d.a} vs ${d.b}`}
              sx={{
                bgcolor: '#FEE2E2',
                color: '#991B1B',
                border: '1px solid #FCA5A5',
                fontSize: '0.6875rem',
                fontWeight: 600,
                height: 22
              }}
            />
          ))}
        </Box>
      )}
      {incompat.length > 0 && (
        <Typography sx={{ mt: 0.75, fontSize: '0.75rem', color: '#7F1D1D' }}>
          Backend flagged: {incompat.join(', ')}
        </Typography>
      )}
    </Alert>
  );
};
