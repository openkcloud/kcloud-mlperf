# Dashboard Parity Evidence — WS-3 (Task #9)

Generated: 2026-05-06

---

## DELIVERABLE A — Dashboard Chrome Parity

### Audit Result

All 4 benchmark menus (MLPerf, MMLU, RNGD, Atom+) already used `LiveBenchDashboard` exclusively.
No remaining `PrometheusIframeDashboard` usages found in main page files.

### Changes Made

**`web/src/components/benchmark-page/LiveBenchDashboard.tsx`** — Enhanced with full chrome parity:
- Added `useState` for `loaded` / `loadError` tracking
- Added status chips matching PrometheusIframeDashboard: `Live` (green), `Connecting…` (amber), `Idle` (slate), `Error` (red)
- Added loading overlay (matching PrometheusIframeDashboard loading state)
- Added error state panel with error message
- Retained `idle` + `idleLabel` props (already added by w-dashboard-leak for WS-2)
- `open in new tab ↗` link hidden when idle (matches PrometheusIframeDashboard pattern)
- iframe opacity transitions: 0 while loading → 1 when ready

**`web/src/components/benchmark-page/index.ts`** — `PrometheusIframeDashboard` marked `@deprecated` with JSDoc. Still exported as compat alias for one release (per task spec).

**`web/e2e/dashboard_parity.spec.ts`** — New Playwright e2e spec:
- Visits all 4 pages: `/ml-perf`, `/mmlu`, `/npu-eval/rngd`, `/npu-eval/atomplus`
- Asserts: no JS errors, status chip present (Live/Connecting/Idle/Error), "open in new tab" link or idle placeholder
- Cross-page structural parity test: MuiPaper count variance ≤ 2 across all 4 pages

### TypeScript Typecheck

```
$ cd web && npx tsc --noEmit
(exit 0 — zero errors)
```

---

## DELIVERABLE B — Compute-Precision UI Column (REV-1)

### Changes Made

**`web/src/components/ComparisonRunTable/index.tsx`** — Added:

1. `inferComputePrecision(run)` helper function with REV-1 source-of-truth labels:
   - `vendor=furiosa` → `FP8 (FuriosaAI vendor-native)`
   - `vendor=rebellions` → `<precision> (Rebellions)` if `run.precision` present, else `BF16-fallback (Rebellions optimum-rbln limitation)`
   - `vendor=nvidia, model includes L40` → `FP8 (sm_89 native)`
   - `vendor=nvidia, model includes A40` → `BF16 Marlin (FP8 weights dequant)`
   - fallback → `run.precision ?? '—'`

2. New **"Compute Precision"** column header (with Tooltip: "Effective compute precision used at inference time")

3. New **"Compute Precision"** data cell per row (monospace caption, slate color — matches Elapsed style)

4. `colCount` incremented by 1 to keep GoalLineRow spanning correctly

### Column appears in all 5 device-comparison pages

The column is rendered by `ComparisonRunTable` which is used in:
- `web/src/pages/mlperf/device-comparison/index.tsx`
- `web/src/pages/mmlu/device-comparison/index.tsx`
- `web/src/pages/npu/device-comparison/index.tsx`
- `web/src/pages/npu-eval/rngd/device-comparison/index.tsx`
- `web/src/pages/npu-eval/atomplus/device-comparison/index.tsx`

No per-page edits required — the column is added at the shared component level.

### Backend Assessment

`ComparisonRunRow.precision` field already exists in `web/src/api/domains/comparison.ts:38` and is populated from the backend `NormalizedRun.precision`. No backend changes required — compute precision is inferred client-side from `hardware.vendor` + `hardware.model` per REV-1.

---

## REDEPLOY REQUIRED: YES

Changes affect the frontend bundle:
- `web/src/components/benchmark-page/LiveBenchDashboard.tsx` (now stateful component)
- `web/src/components/ComparisonRunTable/index.tsx` (new column)
- `web/src/components/benchmark-page/index.ts` (deprecation comment only — no runtime change)

Frontend image rebuild to v28 required to deploy.
