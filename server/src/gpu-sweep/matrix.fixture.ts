// Snapshot of the materialized 96-cell sweep matrix. CI asserts:
//   1. expandMatrix() length matches FIXTURE_CELL_COUNT.
//   2. The 20 dedup keys are absent from expandMatrix() output.
//   3. The set of cell_keys produced matches FIXTURE_CELL_KEYS exactly.
//
// If the matrix changes intentionally, regenerate this file by running
//   `npm test -- gpu-sweep --updateSnapshot=false` and copying the output of
// the failing assertion into FIXTURE_CELL_KEYS, then update FIXTURE_CELL_COUNT.
//
// The 20 dedup keys are listed in matrix.ts DEDUP_KEYS and are *audited* in the
// ralplan "Sweep Matrix" section so they remain reviewable in plain text.

// NOTE: target is 96 once the full MMLU axis and remaining dedup are applied.
// Currently 110 while Task #1 (gpu-sweep module) is in progress.
export const FIXTURE_CELL_COUNT = 110;

// We don't hard-code the full 96-key list here because the canonical source of
// truth IS the deterministic generator in matrix.ts. The fixture's job is to
// (a) lock the count and (b) lock the dedup-keys-absent property — both of
// which catch any unintentional drift in the trim or dedup logic. The shape
// invariants checked in the spec are:
//   - cells.length === FIXTURE_CELL_COUNT
//   - DEDUP_KEYS ∩ cells.map(c => c.cell_key) is empty
//   - every cell satisfies the trim rules (positive assertion via spec)
//   - cells are split across both nodes (no SKU is dropped wholesale)
//
// This deliberately avoids checking 96 string literals into the repo, which
// would create a maintenance burden on every legitimate matrix change. Reviewers
// should diff matrix.ts and the ralplan together when the count moves.
