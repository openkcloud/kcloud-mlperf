import { memo, useMemo } from 'react';

import { Box, Checkbox, Tooltip } from '@mui/material';

import { SelectedTestResultCount } from '@/constants/test-comparison.constants.ts';
import type { MpExamModeEnum } from '@/enums/mp-exam-mode.enum.ts';
import { useStore } from '@/store';
import type { ComparisonAnchor } from '@/store/slices/comparison-slice';

// ----------------------------------------------------------------------

type MlperfComparisonCheckboxProps = {
  id: number;
  disabled?: boolean;
  examMode: MpExamModeEnum;
  // F2: extra config dimensions used to enforce fairness gating.
  precision?: string | null;
  model?: string | null;
  dataset?: string | null;
  scenario?: string | null;
  maxOutputTokens?: number | null;
  dataNumber?: number | null;
};

// ----------------------------------------------------------------------

// F2: compute a human-readable reason why this row cannot be added to the
// current comparison. Returns null when the row matches the anchor.
const computeMismatchReason = (
  anchor: ComparisonAnchor,
  row: ComparisonAnchor
): string | null => {
  const checks: Array<[keyof ComparisonAnchor, string]> = [
    ['precision', 'precision'],
    ['model', 'model'],
    ['dataset', 'dataset'],
    ['scenario', 'scenario'],
    ['max_output_tokens', 'max output tokens'],
    ['data_number', 'sample count']
  ];
  for (const [key, label] of checks) {
    const a = anchor[key];
    const b = row[key];
    if (a == null || b == null) continue;
    if (a !== b) {
      return `Different ${label}: cannot compare ${String(b)} vs ${String(a)}`;
    }
  }
  return null;
};

// ----------------------------------------------------------------------

export const MlperfComparisonCheckbox = memo<MlperfComparisonCheckboxProps>(props => {
  const {
    id,
    disabled,
    examMode,
    precision,
    model,
    dataset,
    scenario,
    maxOutputTokens,
    dataNumber
  } = props;

  const {
    mpExamIds,
    mpExamMode,
    mpAnchor,
    fairnessOverride,
    setExamId,
    removeExamId,
    clearMpExamMode,
    setMpExamMode
  } = useStore(store => store.testComparison);

  const matchedExamMode = Boolean(mpExamMode) && mpExamMode !== examMode;

  const rowAnchor = useMemo<ComparisonAnchor>(
    () => ({
      precision,
      model,
      dataset,
      scenario,
      max_output_tokens: maxOutputTokens,
      data_number: dataNumber
    }),
    [precision, model, dataset, scenario, maxOutputTokens, dataNumber]
  );

  // F2: only gate when the user has already picked exam #1. Gating bypassed
  // when admin override is on, or when this row IS the first selection.
  const isChecked = mpExamIds.includes(id);
  const mismatchReason = useMemo(() => {
    if (fairnessOverride) return null;
    if (!mpAnchor) return null;
    if (isChecked) return null;
    return computeMismatchReason(mpAnchor, rowAnchor);
  }, [fairnessOverride, mpAnchor, rowAnchor, isChecked]);

  const tooltipText =
    disabled
      ? ''
      : matchedExamMode
        ? `Different mode: cannot compare ${examMode} vs ${mpExamMode}`
        : mismatchReason ?? '';

  const isDisabled = disabled || matchedExamMode || Boolean(mismatchReason);

  const node = (
    <Box sx={{ textAlign: 'center' }}>
      <Checkbox
        id={`test-comparison-${id}`}
        name={'test-test-comparison'}
        disabled={isDisabled}
        checked={isChecked}
        onChange={event => {
          if (event.target.checked && mpExamIds.length <= SelectedTestResultCount - 1) {
            setExamId(id, 'mp', rowAnchor);
            setMpExamMode(examMode);
          }

          if (!event.target.checked) {
            removeExamId(id, 'mp');

            if (mpExamIds.length === 1) {
              clearMpExamMode();
            }
          }
        }}
      />
    </Box>
  );

  if (!tooltipText) return node;
  return (
    <Tooltip title={tooltipText} placement="top" arrow>
      <span>{node}</span>
    </Tooltip>
  );
});
