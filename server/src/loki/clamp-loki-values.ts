import type { LokiInstantQueryResponseDto } from './dto/loki-instant-query-response.dto';

type LokiResult = LokiInstantQueryResponseDto['data']['result'];

/**
 * Clamp Loki "<a>/<b>" progress values so the frontend ETA helper does not
 * extrapolate hours of remaining time when the user requested only a small
 * subset of the dataset. The Loki exporter reports raw
 * `vllm:request_success_total` which scales to the FULL dataset (e.g. 13368
 * for CNN/DailyMail) regardless of the user's `data_number` request.
 *
 * Without clamping, a 10-sample request after 1 sample done with elapsed=10s
 * yields ratio 1/13368 → ETA ≈ 10s × (13367) ≈ 37h.
 *
 * No-op when cap <= 0 (full-dataset mode) or when a value is malformed.
 */
export function clampLokiValuesToCap(
  result: LokiResult,
  cap: number | null | undefined,
): LokiResult {
  return mapLokiValues(result, ([_, parts]) =>
    typeof cap === 'number' && Number.isFinite(cap) && cap > 0
      ? `${Math.min(parts[0], cap)}/${Math.min(parts[1], cap)}`
      : null,
  );
}

/**
 * Cap reported progress at min(samples_done/N, elapsed/min_duration_ms) for
 * MLPerf performance-mode runs. Without this the bar shows 100% the moment
 * N samples have been served, even though the harness keeps looping until
 * min_duration elapses (MLCommons compliance rule). When min_duration_ms is
 * 0 or unset, the cap is a no-op.
 */
export function capLokiValuesByMinDuration(
  result: LokiResult,
  startedAt: string | null | undefined,
  minDurationMs: number | null | undefined,
): LokiResult {
  if (
    !startedAt ||
    typeof minDurationMs !== 'number' ||
    !Number.isFinite(minDurationMs) ||
    minDurationMs <= 0
  ) {
    return result;
  }
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) return result;
  const elapsedMs = Date.now() - startMs;
  const timeRatio = Math.min(1, Math.max(0, elapsedMs / minDurationMs));
  return mapLokiValues(result, ([_, parts]) => {
    const sampleRatio = parts[0] / parts[1];
    const effective = Math.min(sampleRatio, timeRatio);
    return `${Math.floor(effective * parts[1])}/${parts[1]}`;
  });
}

/** Internal helper: map every Loki "<a>/<b>" value through `transform`,
 *  preserving the timestamp + skipping malformed values + null-no-op. */
function mapLokiValues(
  result: LokiResult,
  transform: (parsed: [string, [number, number]]) => string | null,
): LokiResult {
  return result.map((series) => ({
    ...series,
    values: series.values.map(([ts, val]: [string, string]) => {
      const parts = (val ?? '').split('/').map(Number);
      if (
        parts.length !== 2 ||
        !Number.isFinite(parts[0]) ||
        !Number.isFinite(parts[1]) ||
        parts[1] <= 0
      ) {
        return [ts, val];
      }
      const next = transform([ts, [parts[0], parts[1]]]);
      return next === null ? [ts, val] : [ts, next];
    }),
  }));
}
