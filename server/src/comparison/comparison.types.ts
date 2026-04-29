import { NormalizedRun, EmptyReason } from './comparison.service';

export type ComparabilityClass = 'strict' | 'hardware-optimized' | 'related';

export interface ComparabilityScore {
  benchmark: boolean;
  model: boolean;
  dataset: boolean;
  precision: boolean;
  scenario: boolean;
  batch_size: boolean;
  data_number: boolean;
  max_output_tokens: boolean;
}

export interface CandidateRun extends NormalizedRun {
  precision: string | null;
  scenario: string | null;
  batch_size: number | null;
  data_number: number | null;
  max_output_tokens: number | null;
  comparability_class: ComparabilityClass;
  comparability_reason: string;
  comparability_score: number;
}

export type CandidatesEmptyReason =
  | EmptyReason
  | 'source_run_not_found'
  | 'no_siblings_found';

export interface CandidatesEmptyEnvelope {
  empty: true;
  reason: CandidatesEmptyReason;
  message: string;
  source: {
    run_id: number;
    benchmark: string | null;
    model: string | null;
    hardware: string | null;
  };
  totals: {
    siblings_considered: number;
    strict: 0;
    hardware_optimized: 0;
    related: 0;
  };
}

export interface CandidatesResponse {
  empty: false;
  source: CandidateRun;
  totals: {
    siblings_considered: number;
    strict: number;
    hardware_optimized: number;
    related: number;
  };
  candidates: {
    strict: CandidateRun[];
    hardware_optimized: CandidateRun[];
    related: CandidateRun[];
  };
}
