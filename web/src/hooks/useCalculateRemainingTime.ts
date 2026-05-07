import { useMemo } from 'react';

import type { ExamStatusResponse } from '@/api/types/common.types';

import { calculateRemainingTime } from '@/helpers/calculate-remaining-time.helper';
import { progressValue } from '@/helpers/progress-value.helper';

export const useCalculateRemainingTime = (data: ExamStatusResponse | undefined) => {
  return useMemo(() => {
    if (data && data.result.length > 0) {
      const { completed, total, percentage } = progressValue(data.result[0].values[0]);

      const leftTime = calculateRemainingTime({
        completed,
        total,
        startTime: data.start_time
      });
      const hours = leftTime.hours ? leftTime.hours + 'h' : '';
      const colon = leftTime.minutes && leftTime.seconds ? ' ' : '';
      const minutes = leftTime.minutes ? leftTime.minutes + 'm' : '';
      const seconds = leftTime.seconds ? leftTime.seconds + 's left' : '';

      const time =
        leftTime.seconds || leftTime.minutes
          ? `(${hours}${colon}${minutes}${colon}${seconds})`
          : '';
      // Mirror the bar cap so the textual label can never read "100%" while
      // the row is still Running — the bar is capped to 99 in the same case.
      const capped = Math.min(percentage, data.status === 'Running' ? 99 : 100);
      return `${Math.round(capped)}% ${time}`;
    }

    return null;
  }, [data]);
};
