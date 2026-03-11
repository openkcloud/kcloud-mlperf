import { memo } from 'react';

import { Box, Checkbox } from '@mui/material';

import { SelectedTestResultCount } from '@/constants/test-comparison.constants.ts';
import type { MpExamModeEnum } from '@/enums/mp-exam-mode.enum.ts';
import { useStore } from '@/store';

// ----------------------------------------------------------------------

type MlperfComparisonCheckboxProps = {
  id: number;
  disabled?: boolean;
  examMode: MpExamModeEnum;
};

// ----------------------------------------------------------------------

export const MlperfComparisonCheckbox = memo<MlperfComparisonCheckboxProps>(props => {
  const { id, disabled, examMode } = props;

  const { mpExamIds, mpExamMode, setExamId, removeExamId, clearMpExamMode, setMpExamMode } =
    useStore(store => store.testComparison);

  const matchedExamMode = Boolean(mpExamMode) && mpExamMode !== examMode;

  return (
    <Box sx={{ textAlign: 'center' }}>
      <Checkbox
        id={`test-comparison-${id}`}
        name={'test-test-comparison'}
        disabled={disabled || matchedExamMode}
        checked={Boolean(mpExamIds.includes(id))}
        onChange={event => {
          if (event.target.checked && mpExamIds.length <= SelectedTestResultCount - 1) {
            setExamId(id, 'mp');
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
});
