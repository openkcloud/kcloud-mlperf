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
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) {
    return result;
  }
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
      return [ts, `${Math.min(parts[0], cap)}/${Math.min(parts[1], cap)}`];
    }),
  }));
}
