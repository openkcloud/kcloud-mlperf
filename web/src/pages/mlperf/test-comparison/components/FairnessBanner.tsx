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
  /** True when at least one side is null/unknown — comparability can't be verified. */
  incomplete?: boolean;
};

const fmtField = (v: string | number | null | undefined): string =>
  v == null ? 'unknown' : String(v);

// Bug #15: do NOT silently skip null-valued fields. A precision=null vs precision='fp8'
// pair cannot be confirmed comparable, so surface it as an "incomplete" delta instead of
// dropping it (which previously let the banner claim "Directly comparable" on missing data).
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
    const aMissing = va == null;
    const bMissing = vb == null;

    if (aMissing && bMissing) {
      // Both unknown — not a mismatch we can assert; skip silently.
      continue;
    }
    if (aMissing || bMissing) {
      // One side known, the other unknown → can't verify equality.
      out.push({ label, a: fmtField(va), b: fmtField(vb), incomplete: true });
      continue;
    }
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

  // Backend's structural assessment, when available.
  // M5 fix: read the canonical top-level incompatibility_reasons from the mapped
  // ComparisonPairResponse (data.incompatibility_reasons), NOT the duplicated nested
  // data.fairness_assessment.incompatibility_reasons — the same field the
  // ComparisonDetailDialog gate uses (and where Agent A's scenario_mismatch will land).
  const incompat = data?.incompatibility_reasons ?? [];
  const precisionMismatch =
    data?.fairness_assessment?.precision_class === 'mismatched';

  if (isLoading && !fallbackA && !fallbackB) {
    return null;
  }

  // A real mismatch is a delta where BOTH sides are known but differ. Deltas where one
  // side is unknown are "incomplete metadata" — comparability can't be verified, but it
  // isn't a confirmed mismatch (bug #15).
  const hardMismatches = deltas.filter(d => !d.incomplete);
  const incompleteFields = deltas.filter(d => d.incomplete);

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

  // Only incomplete metadata (no confirmed mismatch / backend flag) → softer warning.
  const onlyIncomplete =
    hardMismatches.length === 0 && incompat.length === 0 && !precisionMismatch;

  return (
    <Alert
      severity={onlyIncomplete ? 'warning' : 'error'}
      sx={{
        mb: 2,
        borderRadius: '0.75rem',
        '& .MuiAlert-message': { width: '100%' }
      }}
    >
      <Typography sx={{ fontWeight: 700, fontSize: '0.9375rem', mb: 0.75 }}>
        {onlyIncomplete ? '⚠ Comparability unverified — incomplete metadata' : '⚠ Not directly comparable'}
      </Typography>
      {hardMismatches.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {hardMismatches.map(d => (
            <Chip
              key={d.label}
              size="small"
              label={`${d.label}: ${d.a} vs ${d.b}`}
              sx={{
                bgcolor: 'error.light',
                color: 'error.contrastText',
                fontSize: '0.6875rem',
                fontWeight: 600,
                height: 22
              }}
            />
          ))}
        </Box>
      )}
      {incompleteFields.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: hardMismatches.length > 0 ? 0.75 : 0 }}>
          {incompleteFields.map(d => (
            <Chip
              key={d.label}
              size="small"
              variant="outlined"
              color="warning"
              label={`${d.label}: ${d.a} vs ${d.b}`}
              sx={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                height: 22
              }}
            />
          ))}
        </Box>
      )}
      {incompat.length > 0 && (
        <Typography sx={{ mt: 0.75, fontSize: '0.75rem' }} color="error">
          Backend flagged: {incompat.join(', ')}
        </Typography>
      )}
    </Alert>
  );
};
