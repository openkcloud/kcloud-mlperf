// Human "x ago" for a react-query dataUpdatedAt epoch (ms). Used by the home
// hero and the device-comparison freshness chips. Re-evaluated on each render
// (i.e. on the next refetch), not on a live ticker — good enough for a 30s feed.
export const formatAge = (ts: number | null | undefined): string => {
  if (!ts) return 'just now';
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
};
