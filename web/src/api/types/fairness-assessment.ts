/**
 * WS-F03 — Frontend mirror of server/src/comparison/fairness-assessment.ts
 * Keep in sync with the backend FairnessAssessment interface.
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
