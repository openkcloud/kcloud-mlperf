# Menu/Navigation Cleanup — Lane A Report

**RUN_ID**: 20260429-060404-82c193e
**Helm rev**: 14
**Verification**: Playwright DOM scan against the live `:30001` NodePort.

## Final navigation (verified in real Chromium)

The sidebar shows **9 entries**, no duplicates, no dead links:

| Section | Entries |
|---|---|
| Benchmarks | MLPerf, MMLU-Pro, RNGD NPU Eval, Rebellions Atom+ NPU Eval |
| Comparisons | MLPerf vs NPU, MMLU vs NPU, NPU vs GPU |
| Operations | GPU Realtime, NPU Realtime |

Sweep Control is **not** in primary nav — only at `/admin/sweep-control` behind the admin warning banner.

## DOM-level proof

For every audited route the audit captured `sidebar.rngd === 1 && sidebar.atomplus === 1`:

| Route | rngd links | atom+ links | npuEvalGeneric | sweep links |
|---|---|---|---|---|
| `/` | 1 | 1 | 0 | 0 |
| `/dashboard/gpu-realtime` | 1 | 1 | 0 | 0 |
| `/dashboard/npu-realtime` | 1 | 1 | 0 | 0 |
| `/npu-eval` | 1 | 1 | 0 | 0 |
| `/npu-eval/rngd` | 1 | 1 | 0 | 0 |
| `/npu-eval/atomplus` | 1 | 1 | 0 | 0 |
| `/mlperf/device-comparison` | 1 | 1 | 0 | 0 |
| `/mmlu/device-comparison` | 1 | 1 | 0 | 0 |
| `/npu-eval/device-comparison` | 1 | 1 | 0 | 0 |
| `/admin/sweep-control` | 1 | 1 | 0 | 0 |

(Sidebar measurement counts links matching `RNGD.*NPU Eval` and `Atom+.*NPU Eval` patterns; npuEvalGeneric counts the legacy plain-text `NPU Eval` link, which has been removed.)

## Source-of-truth

`web/src/layouts/MainLayout/MainLayout.tsx` (live, deployed in `index-NFhBb3Us.js`) carries the canonical 9-entry sidebar. The legacy duplicate `NPU Eval (FuriosaAI RNGD)` entry was removed in earlier commit `3cb204a`; this audit confirms it stays gone.

## Acceptance

- ✅ Exactly 1 RNGD NPU Eval menu (G1)
- ✅ Exactly 1 Rebellions Atom+ NPU Eval menu (G2)
- ✅ No duplicate RNGD menus (G3)
- ✅ Atom+ page reachable from menu (G4)
- ✅ No broken menu links — every visible link maps to a registered route in `Routes.tsx`

## Evidence

`.omc/qa-live-ui/screenshots-final-rev14/{home,gpu-realtime,npu-realtime,npu-eval-root,rngd,atomplus,mlperf-comparison,mmlu-comparison,npu-comparison,sweep-control}.{png,json}`
