# Comparison Frontend Fix — Evidence Report

**Worker:** w-comparison-frontend  
**Date:** 2026-05-06  
**Branch:** fix/p0-atomplus-real-benchmarks-comparison-realtime-qa-20260429-071649-46d82f8  
**REDEPLOY REQUIRED:** YES — frontend build needed to pick up API shape fixes

---

## Files Changed

### 1. `web/src/api/domains/comparison.ts`
- Added `canonical` and `node` fields to `ComparisonHardware` type (matches actual backend shape)
- Added `elapsed_seconds`, `precision`, `scenario`, `batch_size`, `dataset`, `data_number`, `max_output_tokens`, `source_table` fields to `ComparisonRunRow` (backend returns these)
- **Replaced `ComparisonListResponse`** with proper dual-envelope handling. Backend returns either `{empty:false, total, runs}` or `{empty:true, reason, message, ...}`. Previously the frontend treated both as identical shapes, so `diagnostic?.reason` was always `undefined` and defaulted to `'no_runs_exist'` even when data was present.
- Added `BackendListRaw` union type to model both envelopes.
- Added `PairBenchmark = 'mlperf' | 'mmlu'` export.
- **Fixed `ComparisonApi.list()`** — now normalises both backend envelopes into a consistent `{runs, total, diagnostic?}` shape the pages expect.
- **Fixed `ComparisonApi.compare()`** — backend route `GET /api/comparison/:benchmark/:idA/:idB` only accepts `'mlperf'` or `'mmlu'`; previously pages passed `'all'` which causes `400 BadRequest`. Now coerces unknown/`'all'` to `'mlperf'`. Also fixed return shape: backend returns `{benchmark, a, b, delta}` not `{metrics}`; now maps `a.metrics` + `b.metrics` → `Record<string, {a,b}>` for the `ComparisonDetailDialog`.

### 2. `web/src/pages/npu/device-comparison/index.tsx`
- `handleSelectB` and `handleRetry`: replaced `ComparisonApi.compare('all', ...)` with `bench = selectedA.benchmark === 'mmlu' ? 'mmlu' : 'mlperf'` to use a valid benchmark key.

### 3. `web/src/pages/npu-eval/rngd/device-comparison/index.tsx`
- `handleCompare`: replaced `ComparisonApi.compare('all', ...)` with dynamic benchmark derived from `selectedRngd.benchmark`.

### 4. `web/src/pages/npu-eval/atomplus/device-comparison/index.tsx`
- `handleCompare`: replaced `ComparisonApi.compare('all', ...)` with dynamic benchmark derived from `selectedAtom.benchmark`.

---

## Root Causes Fixed

| Bug | Symptom | Fix |
|-----|---------|-----|
| `compare('all', ...)` | 400 from backend on Compare click in npu/rngd/atomplus pages | Coerce to valid benchmark ('mlperf'/'mmlu') based on selected run |
| `result.metrics` on pair response | undefined — backend returns `delta` not `metrics` | Map `a.metrics + b.metrics → Record<string,{a,b}>` in `compare()` |
| `data?.diagnostic?.reason` always undefined | Wrong empty-state reason shown (defaulted to `'no_runs_exist'`) | Normalise the dual-envelope backend response in `list()` |
| `data?.runs ?? []` silently empty on diagnostic envelope | No runs shown, wrong panel shown | list() now returns `runs: []` + `diagnostic` from empty envelope |

---

## API Evidence — Valid Pair Exists

### `GET /api/comparison/list` — 127+ runs, non-empty

```
curl http://10.254.177.41:30001/api/comparison/list | head -c 500
→ {"code":200,...,"data":{"empty":false,"total":127,"runs":[...]}}
```

### Canonical pair id=74 (Atom+ RNGD) vs id=75 (A40 GPU):

```
curl http://10.254.177.41:30001/api/comparison/mlperf/74/75
→ {
    "benchmark": "mlperf",
    "a": { "id": 74, "hardware": {"canonical":"Atom+"}, "metrics": {"tt100t_seconds": 1.3748} },
    "b": { "id": 75, "hardware": {"canonical":"A40"},   "metrics": {"tt100t_seconds": 1805.93} },
    "delta": { "tt100t_seconds": -1804.555, "tps": 17.93, ... }
  }
```

### Valid run pairs from /api/comparison/list (same fingerprint = directly comparable):

| ID | Table | HW | TT100T (s) | Fingerprint prefix |
|----|-------|----|------------|-------------------|
| 77 (npu_exam) | mlperf | RNGD | 1.328 | 9e0e05ed795fcbb4 |
| 75 (npu_exam) | mlperf | RNGD | 1.267 | 9e0e05ed795fcbb4 |
| 77 (mp_exam)  | mlperf | A40  | 3027.84 | 78311ce99b4f2a80 |
| 76 (mp_exam)  | mlperf | L40  | 2321.37 | 78311ce99b4f2a80 |
| 75 (mp_exam)  | mlperf | A40  | 1805.93 | 78311ce99b4f2a80 |

RNGD pair (id=77 vs id=75, npu_exam) share fingerprint `9e0e05ed795fcbb4` — directly comparable per contract v1.3.0.
GPU runs (id=77, 76, 75 mp_exam) share fingerprint `78311ce99b4f2a80` — directly comparable.

---

## Route 200 Proof (deployed v26)

```
mlperf/device-comparison        → 200  ✓
mmlu/device-comparison          → 200  ✓
npu/device-comparison           → 200  ✓
npu-eval/rngd/device-comparison → 404  (v26 deployed before these routes added; REDEPLOY will fix)
npu-eval/atomplus/device-comparison → 404  (same — REDEPLOY will fix)
```

The 404s are a deployment gap — `Routes.tsx` has these routes registered correctly (`NpuEvalRngdPaths.DEVICE_COMPARISON_PATH`, `NpuEvalAtomPlusPaths.DEVICE_COMPARISON_PATH`) but the running v26 image predates them. A rebuild+redeploy resolves this.

---

## TypeScript Check

```
npx tsc --noEmit -p web/tsconfig.app.json 2>&1 | grep -v MMLUPage
→ (no output — 0 errors from comparison files)
```

Only 2 pre-existing errors in `web/src/pages/mmlu/main/MMLUPage.tsx` (owned by w-gpu-bench-pages, not this worker).

---

## UI State Coverage

All 5 device-comparison pages implement:
1. **Loading state** — `isLoading` → skeleton table rows in `ComparisonRunTable`
2. **Error state** — `error` → `<Alert severity="error">` with retry message
3. **Empty state with reason** — `diagnostic.reason` from backend → `ComparisonDiagnosticPanel` with action button
4. **Success state** — `ComparisonRunTable` with hardware chips, TT100T badge, drift badge, subset badge, export CSV
5. **Picker / comparison dialog** — `ComparisonCandidatePicker` in Drawer (mlperf/mmlu/npu pages) or dual-table layout (rngd/atomplus pages), `ComparisonDetailDialog` with metrics table and delta column

Non-comparable runs excluded by backend fingerprint logic (see `comparison.service.ts:compareibilityClass`). Excluded runs shown in `ComparisonDiagnosticPanel` via `diagnostic.reason` field from the backend.
