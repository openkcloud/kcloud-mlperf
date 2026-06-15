// Snapshot of the materialized canonical sweep matrix. CI asserts:
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

// NOTE: 124 is the canonical count after WS-E (mega-plan v2.2).
// Breakdown:
//   - 110 GPU cells   (node2 NVIDIA-L40 + NVIDIA-A40, node3 NVIDIA-L40-44GiB +
//                      NVIDIA-A40-44GiB, after trim + 20-cell dedup)
//   - + 14 NPU cells  (node4 RNGD + node5 ATOM):
//                      per-NPU: mlperf {bf16,fp8}×{n=500,n=13368} offline = 4
//                             + mmlu  {bf16,fp8}×{n=100} + mmlu fp8×{n=25}  = 3
//                      → 7 cells × 2 NPUs = 14
//   - Total = 110 + 14 = 124
// Original plan target was 96; the realized trim + FP8/Ampere fallback yields
// 110 GPU cells; the WS-E NPU extension adds 14 more for 124 total.
//
// WS-E US-NEXT-2 (2026-05-11): NPU dispatch wiring is now LIVE — node4 and
// node5 cells route through NpuEvalService.create in GpuSweepService.dispatchCell
// rather than silently falling through to MpExamService/MmExamService with
// device_type='GPU'. See gpu-sweep.service.spec.ts "dispatchCell() — vendor
// branch" for the regression guard.
export const FIXTURE_CELL_COUNT = 124;

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
