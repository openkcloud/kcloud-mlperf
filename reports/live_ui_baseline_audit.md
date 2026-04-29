# Live UI Baseline Audit (RUN_ID 20260429-052300-fd7cd81)

Synthesised from worker reports under `.omc/qa-live-ui/baseline-evidence/w*.md`.
Cluster as of audit: helm rev 12 / v18 frontend+backend on jungwooshim, all-jungwooshim chart.

## HTTP/API smoke (W1)

10/10 UI routes HTTP 200, 8/8 API endpoints HTTP 200, **0 5xx**. SPA shell served at every UI path; API base http://10.254.177.41:30980/api responsive.

## SSE wire format (W2)

7 slots in /api/realtime/exams/snapshot (4 GPU + RNGD + 2 Atom+). Wire format confirmed `id: N\ndata: {"type":"snapshot","data":{...}}`. v18 unwrap fix in `useRealtimeExams.ts` correctly consumes this shape — **no Malformed realtime frame** can be triggered by valid frames.

## Comparison API (W3)

`/comparison/list` returns 102 runs. `/comparison/diagnostics` reports mlperf 40/40, mmlu 17/17, npu_eval 41/45 completed, 0 ingestion errors. `/comparison/candidates?runId=72` returns 16 strict GPU candidates; `?runId=66` (NPU FP8) returns 36 related (no strict siblings — expected, NPU vs GPU is `hardware_optimized` class). Source-run details include `comparability_class` and `comparability_score`.

## Sidebar / router source-of-truth (W4)

Exactly **9 nav items** total: 4 Benchmarks (MLPerf, MMLU-Pro, RNGD NPU Eval, Atom+ NPU Eval), 3 Comparisons, 2 Operations (GPU Realtime, NPU Realtime). Every nav route is registered in `Routes.tsx`. **Exactly one** RNGD entry; **exactly one** Atom+ entry; no duplicates. Sweep Control is **not** in primary nav (admin-only at `/admin/sweep-control`).

## DB run-state (W5)

`npu_exam` totals: Completed 41, Failed 1, Stopped 3 — **no rows stuck in Running/Pending/Idle**. id=62 = Failed, started_at == end_at == 2026-04-28T15:19:14+09:00 (instant fail, reconciled).

## Kubernetes (W6)

Helm rev 12 deployed; all 5 deployments reference jungwooshim images. node5 cordoned (SchedulingDisabled) with **no rebellions/atom+ allocatable resource** — proves the device-plugin gate that blocks Atom+ benchmarking.

## Atom+ page (W7)

Page shows hardware identity (RBLN-CA22 / 2 NPUs / node5), explicit BLOCKED state via `BlockerDiagnostic` Alert, three numbered blockers (no device plugin / no inference framework / no benchmark profiles), runbook link. **No Run button**, no fake readiness claim. Honest.

## RNGD page (W8) — bug found

Page shows node identity, run list, comparison link, per-exam result link.

**BUG**: `web/src/pages/npu-eval/rngd/index.tsx:359` had `<Tt100tBadge value={null} />` hardcoded — every row showed grey UNKNOWN regardless of actual TT100T. Real value (e.g. 1.260s for run id=66) exists in `npu_exam_result` and is exposed by `/api/comparison/list`, but the page wasn't reading it. **Fixed in commit 94c657f** by querying `/api/comparison/list?hardware=npu` and looking up tt100t per row.

## GPU realtime (W9) and NPU realtime (W10)

Both pages render `DeviceRealtimeDashboard` consuming the v18 `useRealtimeExams` hook. Code walkthrough confirms valid `{"type":"snapshot","data":{...}}` frames flow through unwrap → shape guard → `adaptSnapshot` cleanly; "Malformed realtime frame" only fires on JSON.parse exceptions, never on valid frames. NPU page filters slots to `device_type='npu'` via `useDeviceRegistry` — RNGD + 2 Atom+ slots present.

## Findings summary

| ID | Status |
|----|--------|
| Atom+ menu | Present, BLOCKED honestly |
| RNGD menu duplication | Resolved (one entry only) |
| Comparison "Data Ingestion Error" | Not reproducible — endpoints return real data |
| Malformed realtime frame (GPU) | Resolved by v18 SSE unwrap fix |
| Malformed realtime frame (NPU) | Resolved by v18 SSE unwrap fix |
| RNGD stuck run id=62 | Reconciled to Failed |
| TT100T <1.1s PASS/FAIL | **Was broken on RNGD list page; fixed in 94c657f** (deploy v19 to make live) |
| Sweep control hidden from primary nav | Yes |

Live deploy state at end of mission depends on v19 build outcome — see final QA report.
