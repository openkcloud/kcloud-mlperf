import {
  computeIncompatibilityReasons,
  normalizeStrLower,
  type HardwareVendor,
  type NormalizedRun,
} from './comparison.service';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';

/**
 * US-NEXT-1 — narrow input shape consumed by `selfFairnessSnapshot()`. Service
 * callers (MpExamService/MmExamService/NpuEvalService) only know vendor,
 * precision, and the latency measurement context at exam create-time, so they
 * pass this focused subset rather than synthesising a partial NormalizedRun.
 */
export interface FairnessSelfInput {
  vendor: HardwareVendor;
  precision: string | null;
  latency_measurement_context: LatencyMeasurementContext;
}

/**
 * WS-B05 — `fairness_assessment` is the canonical, persisted record of
 * whether two runs may be compared scientifically. The pair() endpoint
 * returns it alongside the legacy `incompatibility_reasons[]` so the
 * frontend can surface a richer fairness verdict without losing backward
 * compatibility. US-NEXT-1 wires `selfFairnessSnapshot()` (below) into
 * MpExamService/MmExamService/NpuEvalService.create() so the jsonb
 * `fairness_assessment` column added by US-0.5 migration
 * `1715000300000-canonical-reproducibility-n11` is populated at exam
 * create-time for single-run rows; pair-comparison fairness is computed
 * on demand by `assessFairness(a, b)`.
 *
 * `precision_mismatch: boolean` on NormalizedRun is preserved for backward
 * compat with toRunRow() and existing CSV/JSON exporters; the canonical
 * source of truth for fairness is this struct.
 */
export interface FairnessAssessment {
  precision_class: 'matched' | 'mismatched' | 'unknown';
  latency_context: 'matched' | 'mismatched' | 'unknown';
  tokenizer_match: 'verified' | 'unverified' | 'mismatch' | 'unknown';
  vendor_match: boolean;
  incompatibility_reasons: string[];
  /** ISO8601 timestamp recorded at assessment time. */
  computed_at: string;
}

function classifyPrecision(
  a: NormalizedRun,
  b: NormalizedRun,
): FairnessAssessment['precision_class'] {
  const pa = normalizeStrLower(a.precision);
  const pb = normalizeStrLower(b.precision);
  if (!pa || !pb) return 'unknown';
  return pa === pb ? 'matched' : 'mismatched';
}

function classifyLatencyContext(
  a: NormalizedRun,
  b: NormalizedRun,
): FairnessAssessment['latency_context'] {
  const ca = a.latency_measurement_context;
  const cb = b.latency_measurement_context;
  if (
    !ca ||
    !cb ||
    ca === LatencyMeasurementContext.UNKNOWN ||
    cb === LatencyMeasurementContext.UNKNOWN
  ) {
    return 'unknown';
  }
  return ca === cb ? 'matched' : 'mismatched';
}

function classifyTokenizerMatch(
  a: NormalizedRun,
  b: NormalizedRun,
): FairnessAssessment['tokenizer_match'] {
  const va = a.hardware.vendor;
  const vb = b.hardware.vendor;
  if (va === 'unknown' || vb === 'unknown') return 'unknown';
  // Cross-vendor pairs cannot have tokenizer parity asserted by the platform
  // today (see US-003 audit gap on tokenizer SHA capture).
  if (va !== vb) return 'unverified';
  return 'verified';
}

/**
 * Single source of truth for the fairness signals consumed by the
 * /comparison UI's fairness gate (US-002) and the persisted
 * `fairness_assessment` column (US-0.5). Internally calls
 * `computeIncompatibilityReasons(a, b)` so the legacy reason-code list
 * and the richer struct can never disagree.
 */
export function assessFairness(
  a: NormalizedRun,
  b: NormalizedRun,
): FairnessAssessment {
  const reasons = computeIncompatibilityReasons(a, b);
  return {
    precision_class: classifyPrecision(a, b),
    latency_context: classifyLatencyContext(a, b),
    tokenizer_match: classifyTokenizerMatch(a, b),
    vendor_match: a.hardware.vendor === b.hardware.vendor,
    incompatibility_reasons: reasons,
    computed_at: new Date().toISOString(),
  };
}

/**
 * US-NEXT-1 — single-run fairness snapshot persisted into the
 * `fairness_assessment` jsonb column at exam create-time. The pair-based
 * `assessFairness(a, b)` requires a peer; new rows have none, so this
 * helper records what the platform knows about the row in isolation:
 *   - precision_class: 'matched' iff a precision string is set, 'unknown' otherwise
 *   - latency_context: 'matched' iff a concrete measurement context is known
 *   - tokenizer_match: 'unknown' until US-D02 wires tokenizer_sha capture
 *   - vendor_match: false by convention — there is no peer to match against
 *   - incompatibility_reasons: [] — single-run has no peer to disagree with
 */
export function selfFairnessSnapshot(
  input: FairnessSelfInput,
): FairnessAssessment {
  const precision = normalizeStrLower(input.precision);
  const ctx = input.latency_measurement_context;
  return {
    precision_class: precision ? 'matched' : 'unknown',
    latency_context:
      ctx && ctx !== LatencyMeasurementContext.UNKNOWN ? 'matched' : 'unknown',
    tokenizer_match: 'unknown',
    vendor_match: false,
    incompatibility_reasons: [],
    computed_at: new Date().toISOString(),
  };
}
