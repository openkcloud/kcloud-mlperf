import { memo } from 'react';

import { useExamStatus } from './useExamStatus';
import type { SxProps } from '@mui/material';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

import type { StatusEnum } from '@/enums/status.enum';

import { useCalculateRemainingTime } from '@/hooks/useCalculateRemainingTime.ts';

import { progressValue } from '@/helpers/progress-value.helper';

// ----------------------------------------------------------------------

type ExamStatusProgressBarProps = {
  id: number;
  status: StatusEnum;
  tablePageNumber: number;
};

// ----------------------------------------------------------------------

const progressBarStyles: SxProps = { height: '0.75rem', borderRadius: '2rem' };

// ----------------------------------------------------------------------

export const ExamStatusProgressBar = memo<ExamStatusProgressBarProps>(props => {
  const data = useExamStatus(props);

  const remainingTime = useCalculateRemainingTime(data);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexDirection: 'column' }}>
      <Box sx={{ minWidth: 35, mb: 1, textAlign: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
          {remainingTime || '-:-'}
        </Typography>
      </Box>
      <Box sx={{ width: '100%' }}>
        {!data || data.result.length === 0 ? (
          <LinearProgress color="secondary" sx={progressBarStyles} />
        ) : (
          <LinearProgress
            variant="determinate"
            color={'secondary'}
            sx={progressBarStyles}
            // Cap at 99 while the row is still RUNNING so the user never
            // sees the visual contradiction "100% Running"; the bar jumps
            // to 100% the instant useExamStatus flips status to Completed.
            value={Math.min(progressValue(data.result[0].values[0]).percentage, props.status === 'Running' ? 99 : 100)}
          />
        )}
      </Box>
    </Box>
  );
});
