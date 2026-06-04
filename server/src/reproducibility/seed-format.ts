/**
 * WS-D03: Seed formatting helper for reproducibility metadata.
 *
 * formatSeed() converts an optional raw seed value into the string form stored
 * in the seed_value column. When BENCHMARK_DETERMINISTIC=1, the seed is stored
 * verbatim so consumers can reproduce the run exactly. Otherwise it is tagged
 * " advisory_only" to signal that the runtime did not enforce the seed and the
 * value is informational only.
 */

/**
 * Format a raw seed value for storage in the seed_value column.
 *
 * @param rawSeed  - The seed from the request DTO (number | string | undefined)
 * @param deterministic - Whether BENCHMARK_DETERMINISTIC=1 is active
 * @returns Formatted seed string, or null if no seed was provided
 */
export function formatSeed(
  rawSeed: number | string | undefined,
  deterministic: boolean,
): string | null {
  if (rawSeed === undefined || rawSeed === null || rawSeed === '') {
    return null;
  }

  const seedStr = String(rawSeed);

  if (deterministic) {
    return seedStr;
  }

  return `${seedStr} advisory_only`;
}
