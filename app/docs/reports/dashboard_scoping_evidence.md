# Dashboard Scoping Evidence — WS-2

**Date:** 2026-05-06
**Agent:** w-dashboard-leak
**Status:** COMPLETE — REDEPLOY REQUIRED

## Summary

Implemented frontend filter so each benchmark page only renders its Grafana/realtime iframe when that benchmark type is actively running on a device of that page's class.

## Files Changed

### 1. `web/src/hooks/useRealtimeExams.ts`
- Added `exam_kind: 'mp' | 'mm' | 'npu' | null` field to `RealtimeExamSlot` type
- Threaded `s.current_exam?.kind ?? null` through `adaptSnapshot()` so the kind is available to all consumers

### 2. `web/src/components/benchmark-page/LiveBenchDashboard.tsx`
- Added `idle?: boolean` and `idleLabel?: string` props
- When `idle=true`: renders a dark placeholder box with the `idleLabel` message instead of the iframe
- Linter further enhanced with loading/error states (Live/Connecting/Error chips) — contract-compatible

### 3. `web/src/pages/mlperf/main/MLPerfPage.tsx`
- Added `useRealtimeExams()` hook
- Predicate: `slots.some(s => s.device_type === 'gpu' && s.exam_kind === 'mp')`
- Passes `idle={!isMlperfActive}` and `idleLabel="No MLPerf benchmark currently running on GPU devices"`

### 4. `web/src/pages/mmlu/main/MMLUPage.tsx`
- Added `useRealtimeExams()` hook
- Predicate: `slots.some(s => s.device_type === 'gpu' && s.exam_kind === 'mm')`
- Passes `idle={!isMmluActive}` and `idleLabel="No MMLU-Pro benchmark currently running on GPU devices"`

### 5. `web/src/pages/npu-eval/rngd/index.tsx`
- Used existing `rngdSlot` (already computed via `useRealtimeExams`)
- Predicate: `rngdSlot === null || rngdSlot.exam_id === null`
- Passes `idle` and `idleLabel="No NPU benchmark currently running on FuriosaAI RNGD devices"`

### 6. `web/src/pages/npu-eval/atomplus/index.tsx`
- Used existing `activeRuns` (Rebellions runs with running/preparing/pending status)
- Predicate: `activeRuns.length === 0`
- Passes `idle` and `idleLabel="No NPU benchmark currently running on Rebellions Atom+ devices"`

### 7. `web/e2e/dashboard_no_leak.spec.ts` (new)
- SSE-mocked e2e tests for MLPerf and MMLU pages
- Covers: idle→placeholder, running→iframe, wrong-kind→placeholder

## TypeScript Check

```
npx tsc --noEmit -p web/tsconfig.json
# Exit code: 0 (zero errors)
```

## slot.vendor Resolution

Confirmed `slot.vendor` is a **top-level field** on both:
- Wire type (`WireRealtimeSlot.vendor`) — `server/src/realtime/realtime.service.ts:55`
- Frontend type (`RealtimeExamSlot.vendor`) — `web/src/hooks/useRealtimeExams.ts:69`

No backend changes required.

## Coordination

- `LiveBenchDashboard.tsx` `idle` prop added — w-dashboard-parity can now proceed with `ComparisonRunTable` Compute-Precision column (non-conflicting).

## REDEPLOY REQUIRED

Yes. Changes are frontend-only (web/ bundle). The deployed v27 app will not reflect these changes until the web bundle is rebuilt and redeployed. E2e tests against live v27 will FAIL on the idle-placeholder assertions (BLOCKED-pending-redeploy).
