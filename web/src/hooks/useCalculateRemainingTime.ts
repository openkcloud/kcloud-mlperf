import { useMemo } from 'react';

import type { ExamStatusResponse } from '@/api/types/common.types';

import { calculateRemainingTime } from '@/helpers/calculate-remaining-time.helper';
import { progressValue } from '@/helpers/progress-value.helper';

export const useCalculateRemainingTime = (data: ExamStatusResponse | undefined) => {
  console.log('useCalculateRemainingTime data:', data);
  return useMemo(() => {
    if (data && data.result.length > 0) {
      const { completed, total, percentage } = progressValue(data.result[0].values[0]);
      console.log('useCalculateRemainingTime percentage:', percentage);

      const leftTime = calculateRemainingTime({
        completed,
        total,
        startTime: data.start_time
      });
      console.log('useCalculateRemainingTime leftTime:', leftTime);
      const hours = leftTime.hours ? leftTime.hours + 'h' : '';
      const colon = leftTime.minutes && leftTime.seconds ? ' ' : '';
      const minutes = leftTime.minutes ? leftTime.minutes + 'm' : '';
      const seconds = leftTime.seconds ? leftTime.seconds + 's left' : '';

      const time =
        leftTime.seconds || leftTime.minutes
          ? `(${hours}${colon}${minutes}${colon}${seconds})`
          : '';
      console.log('useCalculateRemainingTime time:', time);
      return `${Math.round(percentage)}% ${time}`;
    }

    return null;
  }, [data]);
};
