import { memo } from 'react';

import { useMpExamStatus } from './useExamStatus';
import type { SxProps } from '@mui/material';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

import { StatusEnum } from '@/enums/status.enum';

import { useCalculateRemainingTime } from '@/hooks/useCalculateRemainingTime';

import { progressValue } from '@/helpers/progress-value.helper';

// ----------------------------------------------------------------------

type MpExamStatusProgressBarProps = {
  id: number;
  status: StatusEnum;
  tablePageNumber: number;
};

// ----------------------------------------------------------------------

const progressBarStyles: SxProps = { height: '0.75rem', borderRadius: '2rem' };

// ----------------------------------------------------------------------

export const MpExamStatusProgressBar = memo<MpExamStatusProgressBarProps>(props => {
  const data = useMpExamStatus(props);

  const remainingTime = useCalculateRemainingTime(data);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexDirection: 'column' }}>
      <Box sx={{ minWidth: 35, mb: 1 }}>
        <Typography
          variant="body2"
          sx={{ color: 'text.secondary', fontWeight: 500, textAlign: 'center' }}
        >
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
            // Cap at 99 while RUNNING — bar jumps to 100 the moment status flips Completed.
            value={Math.min(progressValue(data.result[0].values[0]).percentage, props.status === StatusEnum.RUNNING ? 99 : 100)}
          />
        )}
      </Box>
    </Box>
  );
});
