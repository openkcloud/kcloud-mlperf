import { useEffect, useState } from 'react';

// Human "x ago" for a react-query dataUpdatedAt epoch (ms). Used by the home
// hero and the device-comparison freshness chips.
//
// `ts` of 0/null/undefined means "no successful fetch yet" (react-query reports
// dataUpdatedAt=0 before the first load resolves) — render 'Loading…' rather
// than the misleading 'just now', which implied fresh data on first paint.
export const formatAge = (ts: number | null | undefined): string => {
  if (!ts) return 'Loading…';
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
};

// ----------------------------------------------------------------------
// useFreshness — a self-ticking "x ago" string.
//
// `formatAge` alone only re-computes when its host component re-renders, which
// (for a 30s react-query feed) means the displayed age can under-report
// staleness by up to ~30s and look fresher than it is. Mounting this hook
// re-renders the host on a light interval so the age stays honest between
// refetches. Returns 'Loading…' while `ts` is falsy/0.
//
// Usage: const age = useFreshness(query.dataUpdatedAt);  // "12s ago"
// ----------------------------------------------------------------------
export const useFreshness = (
  ts: number | null | undefined,
  intervalMs = 2000,
): string => {
  // `tick` exists only to force a re-render on each interval; the value is
  // unused beyond invalidating the previous render.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!ts) return; // nothing to age yet — no need to tick
    const id = window.setInterval(() => setTick(t => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [ts, intervalMs]);

  return formatAge(ts);
};
