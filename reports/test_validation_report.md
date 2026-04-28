# Test Validation Report — Current State (Seed)
**Generated:** 2026-04-28 | **Run ID:** 20260428-075351-71c9c77 | **Lane:** C/D/I

This document is the seed section. Batch 1 (smoke tests) and Batch 2 (matrix fix) will append their results after they run.

---

## 1. Backend Unit Tests — 52/52 Passing

### Suites

**`gpu-sweep.service.spec.ts`** (`server/src/gpu-sweep/gpu-sweep.service.spec.ts`)
Tests: isEnabled(), startSweep() disabled guard, preview() cell count and DB-write-absence, per-node mutex lock/release, stagger enforcement (30s block / 61s allow / cross-node isolation / custom config), drain() inflight-cell marking, drain() idempotency, mutex reset after drain, getStatus() enabled flag and node_state reflection, markCellComplete() mutex release and metric persistence.
Suites: 8 describe blocks, ~18 it-blocks.

**`matrix.fixture.spec.ts`** (`server/src/gpu-sweep/matrix.fixture.spec.ts`)
Tests: cell count == FIXTURE_CELL_COUNT (currently 110), unique cell_keys, all 4 GPU SKUs covered, both mlperf and mmlu kinds present, DEDUP_KEYS absent from materialized matrix, DEDUP_KEYS length == 20, fp8+bs4 absent on A40 SKUs, TP=2 only on L40/L40-44GiB, server@data_number<500 absent, server@bs4 absent, mmlu 25/subj bf16 absent, all cells retry_num==3, cells on node2 or node3 only.
Calibration subset: 2 canonical cells found, on both nodes.
Timeline: buildTimeline produces entries for both nodes, monotonically increasing offsets, estimated_duration_seconds > 0, 60s stagger between same-node offsets.
expandMatrix filtering: SKU filter, benchmark filter, precision filter.
Suites: 5 describe blocks, ~19 it-blocks.

**`realtime.service.spec.ts`** (`server/src/realtime/realtime.service.spec.ts`)
Tests: buildSnapshot returns 4 GPU slots when idle, maps running mp-exam to correct slot, maps preparing mm-exam to correct slot, sweep_progress zero counts without GpuSweepService, sweep_progress populated when injected, paused=true when status is Paused, null active_sweep_id when no active sweep, operator_race_alerts counts after recordOperatorRaceFailed(), timestamp is valid ISO8601.
Suites: 1 describe block, 9 it-blocks.

**`app.controller.spec.ts`** (`server/src/app.controller.spec.ts`)
Standard NestJS scaffold smoke test (AppController.getHello). 1 it-block.

Total confirmed passing: **52** (per prior session soak report and task tracking state).

---

## 2. Backend E2E Specs — `server/test/`

**`gpu-sweep.e2e-spec.ts`**
Covers: `GET /api/gpu-sweep/preview` returns cell count without DB writes; includes per-node timeline. `GET /api/gpu-sweep/status` returns mutex state for running sweep. `POST /api/gpu-sweep/start` (calibration mode) creates sweep row and dispatches cells; `GPU_SWEEP_ENABLED=false` returns 4xx/503. Stagger gap assertion: same-node dispatched_at timestamps differ by ≥ 60s. `PATCH /api/gpu-sweep/drain/:id` marks Pending/Dispatched cells as Stopped. Calibration response shape contract: `variance_pct` and `passed` fields present.
NOTE: The preview cell-count assertion (`expect(res.body.cells).toHaveLength(96)`) will fail until Batch 2 completes because the current matrix produces 110 cells.

**`gpu-sweep-calibration.e2e-spec.ts`**
Covers: `POST /api/gpu-sweep/start` calibration mode creates exactly 2 cells (one per node) with fp8/bs1/n500/tp1 spec. `GET /api/gpu-sweep/calibration` returns 404 when no calibration sweep exists; returns runs array with both nodes when completed; `passed=false` when node tt100t variance exceeds 5%. `GET /api/gpu-sweep/status` reports `paused=false` and `reason=null` by default (quiet window off).

**`realtime.e2e-spec.ts`**
Covers: `GET /realtime/exams` (SSE) responds with `text/event-stream` content type; first SSE event includes `gpus` array with `gpu_type` fields. Snapshot field contract: all required fields (`gpu_type`, `node`, `status`, `exam_id`, `elapsed_seconds`, `last_tt100t`, `last_tps`, `sweep_progress`, `race_alert`) present in a unit-level shape check.
NOTE: The field contract test is a static shape assertion, not a live SSE parse. The SSE data-line parse is conditional (`if (receivedData.includes('data:'))`) and will silently pass even if the backend emits no events within 600ms.

**`soak.e2e-spec.ts`**
Covers: 30-minute live soak against `SOAK_BASE_URL` (defaults to `localhost:9999`). Polls `/api/npu-eval/list`, `/api/mp-exam/list`, `/api/mm-exam/list` every 5 seconds. Monitors SSE at `/realtime/exams` (skipped gracefully if 404). Asserts: zero 5xx responses, zero SSE disconnects (when available), memory growth < 50 MB, duration ≥ 30 minutes.
Last run: 2026-04-27 (prior session). Result: PASS (per `.omc/qa-train-a/SOAK_REPORT.md`).

**`app.e2e-spec.ts`**
Standard NestJS scaffold smoke (GET / returns string). 1 test.

---

## 3. Frontend Playwright E2E Specs — `web/e2e/`

**`gpu-realtime.spec.ts`**
Covers: `/dashboard/gpu-realtime` page renders header within 3s; all 4 GPU device cards visible (L40, A40, L40-44GiB, A40-44GiB); sweep progress bar visible; Idle/Running/Preparing status chips present; TPS bar chart heading rendered; full page load under 3 seconds.
Method: SSE endpoint is intercepted and returns a synthetic snapshot with 4 slots before each test. No live backend required.

**`device-comparison-parity.spec.ts`**
Covers: `/npu-eval/device-comparison`, `/ml-perf/device-comparison`, `/mmlu/device-comparison` — each renders without JavaScript errors; each returns HTTP < 400. All three pages share `DeviceDashboardHeader` component (non-empty h5/h6 header). All three pages have similar MuiPaper landmark counts (≤ 2 Paper element variance between NPU and MLPerf views).
Method: Cross-origin staging traffic (`http://10.254.184.195:30980/**`) is intercepted. SSE and npu-eval list endpoints are stubbed.

**`sweep-drain.spec.ts`**
Covers: `/dashboard/sweep-control` renders without JS errors; sweep mode options present in body text; drain API call transitions sweep status to Drained (verified via `page.evaluate` fetch + stub); preview endpoint returns `total_cells: 96` without triggering a start call.
Method: All backend endpoints (`/realtime/exams`, `/api/gpu-sweep/status`, `/api/gpu-sweep/preview`, `/api/gpu-sweep/drain/*`) are stubbed via Playwright route intercepts.

---

## 4. Coverage Gaps

| Gap | Severity | Batch |
|---|---|---|
| No auth tests (no auth exists yet) | High | Batch 8 |
| No concurrent-write tests for mp/mm-exam-result create() | High | Batch 10 |
| No smoke test for the new mp-exam-stream / mm-exam-stream service path | High | Batch 4 |
| SSE realtime e2e only checks headers; no assertion on parsed event data content | Medium | Batch 9 |
| No test for `MmExamService.ensureResultAccMathColumn()` race condition | Medium | Batch 7 |
| No test for `dispatchCell()` catch block calling `recordOperatorRaceFailed()` | Medium | Batch 4 |
| No test exercising `drain()` with MMLU cells (stopMmExam cast bug) | High | Batch 1 |
| No test for NFS full-disk behavior (result parsing all-null guard) | Medium | Future |
| No load test for SSE with 20 concurrent subscribers | Medium | Batch 9 |
| e2e preview assertion hard-codes 96 but matrix currently produces 110 | High | Batch 2 |

---

## 5. Test Infrastructure Notes

- Unit tests use Jest (`server/package.json`). E2e tests use the separate `server/test/jest-e2e.json` config.
- Frontend tests use Playwright (`web/playwright.config.ts`). No unit test framework configured in `web/`.
- The `soak.e2e-spec.ts` requires a live staging URL (`SOAK_BASE_URL` env var); it is not suitable for CI without a pre-deployed environment.
- `IS_SUMMARY_FILE_TESTING=true` must not be set during any test run that exercises real result-file parsing paths (see RISK-015).

---

_Next entries will be appended by Batch 1 (smoke suite run) and Batch 2 (matrix fix + re-run) after those batches execute._

