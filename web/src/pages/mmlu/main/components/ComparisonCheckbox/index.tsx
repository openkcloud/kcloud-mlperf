import { memo } from 'react';

import { Box, Checkbox } from '@mui/material';

import { SelectedTestResultCount } from '@/constants/test-comparison.constants.ts';
import { useStore } from '@/store';

// ----------------------------------------------------------------------

type MmluComparisonCheckboxProps = {
  id: number;
  disabled?: boolean;
};

// ----------------------------------------------------------------------

export const MmluComparisonCheckbox = memo<MmluComparisonCheckboxProps>(props => {
  const { id, disabled } = props;

  const { mlExamIds, setExamId, removeExamId } = useStore(store => store.testComparison);

  return (
    <Box sx={{ textAlign: 'center' }}>
      <Checkbox
        id={`test-comparison-${id}`}
        name={'test-test-comparison'}
        checked={Boolean(mlExamIds.includes(id))}
        disabled={disabled}
        onChange={event => {
          if (event.target.checked && mlExamIds.length <= SelectedTestResultCount - 1) {
            setExamId(id, 'ml');
          }

          if (!event.target.checked) {
            removeExamId(id, 'ml');
          }
        }}
      />
    </Box>
  );
});
