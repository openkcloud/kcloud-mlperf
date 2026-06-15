import { createHash } from 'crypto';

export interface DecodingParams {
  temperature: number;
  top_p?: number | null;
  top_k?: number | null;
}

export interface DatasetSubset {
  name: string;
  n_samples: number;
}

/**
 * Canonical run descriptor: the fields that define "same benchmark config"
 * across hardware targets.
 *
 * Hardware identity fields (node, runtime, driver) are intentionally absent —
 * those are metadata, not config. Two runs on L40 and RNGD with identical
 * config fields should produce the same fingerprint hash so they can be placed
 * side-by-side in the comparison view.
 *
 * precision must be 'fp8' for all MLPerf canonical runs across all hardware.
 * BF16 runs produce a different fingerprint and are not in the canonical group.
 * dataset_subset, when present, is included in the hash so a 100-sample run
 * never matches a full-dataset run.
 */
export interface CanonicalRunConfig {
  benchmark: 'mlperf' | 'mmlu';
  model: string;
  dataset: string;
  dataset_version?: string | null;
  precision: string;
  batch_size: number;
  data_number: number;
  decoding: DecodingParams;
  scenario?: string | null;
  max_output_tokens?: number | null;
  dataset_subset?: DatasetSubset | null;
}

/**
 * Normalize a single string field: trim, lowercase, collapse whitespace,
 * treat null/undefined as empty string.
 */
function normalizeStr(value: string | null | undefined): string {
  if (value == null) return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normalize a numeric field: null/undefined → 0.
 */
function normalizeNum(value: number | null | undefined): number {
  return value ?? 0;
}

/**
 * Build a deterministic sorted object for hashing. All optional/null fields
 * are normalized to a stable representation so that absent and explicit-null
 * fields produce the same hash.
 */
function buildNormalizedObject(
  run: CanonicalRunConfig,
): Record<string, unknown> {
  return {
    benchmark: normalizeStr(run.benchmark),
    model: normalizeStr(run.model),
    dataset: normalizeStr(run.dataset),
    dataset_subset: run.dataset_subset
      ? {
          name: normalizeStr(run.dataset_subset.name),
          n_samples: normalizeNum(run.dataset_subset.n_samples),
        }
      : { name: '', n_samples: 0 },
    dataset_version: normalizeStr(run.dataset_version),
    precision: normalizeStr(run.precision),
    batch_size: normalizeNum(run.batch_size),
    data_number: normalizeNum(run.data_number),
    decoding: {
      temperature: normalizeNum(run.decoding?.temperature),
      top_p: normalizeNum(run.decoding?.top_p),
      top_k: normalizeNum(run.decoding?.top_k),
    },
    scenario: normalizeStr(run.scenario),
    max_output_tokens: normalizeNum(run.max_output_tokens),
  };
}

/**
 * Recursively sort object keys so JSON.stringify is deterministic regardless
 * of insertion order. Primitives are returned as-is.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Return a SHA-256 hex digest of the canonical config fields.
 *
 * Same canonical config → same hash.
 * Any change to a config field → different hash.
 * Optional/null fields are normalized so absent ≡ null ≡ 0/empty.
 *
 * The hash excludes hardware identity (node, runtime, driver) by design:
 * L40 and RNGD runs with identical config produce the same fingerprint,
 * which is what enables apples-to-apples cross-hardware comparison.
 */
export function canonicalize(run: CanonicalRunConfig): string {
  const normalized = buildNormalizedObject(run);
  const json = JSON.stringify(sortKeys(normalized));
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Compare two runs and return true if they share the same canonical fingerprint.
 */
export function isSameConfig(
  a: CanonicalRunConfig,
  b: CanonicalRunConfig,
): boolean {
  return canonicalize(a) === canonicalize(b);
}

/**
 * Return the fields that differ between two runs (for drift detection).
 * Returns an empty array when configs are identical.
 */
export function diffConfig(
  a: CanonicalRunConfig,
  b: CanonicalRunConfig,
): string[] {
  const na = buildNormalizedObject(a);
  const nb = buildNormalizedObject(b);
  const diffs: string[] = [];

  function compareDeep(
    objA: Record<string, unknown>,
    objB: Record<string, unknown>,
    prefix: string,
  ) {
    for (const key of Object.keys(objA)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const va = objA[key];
      const vb = objB[key];
      if (
        typeof va === 'object' &&
        va !== null &&
        typeof vb === 'object' &&
        vb !== null
      ) {
        compareDeep(
          va as Record<string, unknown>,
          vb as Record<string, unknown>,
          path,
        );
      } else if (va !== vb) {
        diffs.push(path);
      }
    }
  }

  compareDeep(na, nb, '');
  return diffs;
}
