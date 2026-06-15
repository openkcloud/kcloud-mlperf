import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { TIMEZONE } from '@/constants/timezone.constants';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(duration);

// ----------------------------------------------------------------------

export function calculateRemainingTime(params: {
  completed: number;
  total: number;
  startTime: string;
}) {
  const { completed, total, startTime } = params;

  const progressRatio = completed / total;

  const start = dayjs(startTime).tz(TIMEZONE);
  const now = dayjs().tz(TIMEZONE);

  const elapsedMs = now.diff(start); // elapsed milliseconds
  const estimatedTotalMs = elapsedMs / progressRatio;
  const remainingMs = estimatedTotalMs - elapsedMs;

  const remainingDuration = dayjs.duration(remainingMs);

  return {
    hours: remainingDuration.hours(),
    minutes: remainingDuration.minutes(),
    seconds: remainingDuration.seconds(),
    remainingMs
  };
}
