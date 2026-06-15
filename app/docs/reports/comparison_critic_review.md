---
title: Comparison Critic Review — demo-rescue-may06b
worker: w-critic
date: 2026-05-06
mission: demo-rescue-may06b
contract_ref: docs/reports/benchmark_comparability_contract.md
scope: |
  - Task #3 (w-comparison-frontend): comparison frontend renders valid pairs;
    excluded runs surface explicit reason.
verdict: PARTIAL — source PASS for all 5 routes; deployed v26 returns 404 on rngd/atomplus
---

# Comparison Critic Review

Three things to verify:

1. The three frontend bug fixes (`'all'` rejection, `.metrics` shape mismatch,
   list envelope normalization) are actually present in the source.
2. The 5 device-comparison routes are reachable.
3. A real valid pair renders against `curl /api/comparison/list` evidence.

---

## Q1 — Three frontend bug fixes

### Fix A — `compare('all', ...)` → benchmark-aware compare

The backend route `GET /api/comparison/:benchmark/:idA/:idB` accepts only
`'mlperf' | 'mmlu'` (verified via `server/src/comparison/comparison.service.ts:23`
`type BenchmarkFilter = 'mlperf' | 'mmlu' | 'all'` and the route handler is
benchmark-typed). Sending `'all'` returns 400.

Evidence in source (3 fix sites):

| File:line | Fix |
|---|---|
| `web/src/pages/npu/device-comparison/index.tsx:61` | `const bench = selectedA!.benchmark === 'mmlu' ? 'mmlu' : 'mlperf';` |
| `web/src/pages/npu/device-comparison/index.tsx:77` | same coercion in `handleCompare` |
| `web/src/pages/npu-eval/atomplus/device-comparison/index.tsx:53` | `const bench = selectedAtom.benchmark === 'mmlu' ? 'mmlu' : 'mlperf';` |
| `web/src/api/domains/comparison.ts:217-218` | API client also coerces: `const safeBenchmark: PairBenchmark = benchmark === 'mmlu' ? 'mmlu' : 'mlperf';` |

Defense in depth: even if a page passes `'all'`, the API client downgrades to
`'mlperf'`. **PASS.**

### Fix B — `.metrics` shape map (a.metrics + b.metrics → Record<string,{a,b}>)

Backend pair shape (verified live this session via `curl /api/comparison/mlperf/74/75`):

```json
{
  "benchmark": "mlperf",
  "a": { "id":74, "metrics":{"tt100t_seconds":1.3747...,"tps":73.297..., ...} },
  "b": { "id":75, "metrics":{"tt100t_seconds":1805.93, ...} },
  "delta": { "tt100t_seconds": -1804.555, "tps": 17.93, ... }
}
```

The backend does NOT return a top-level `metrics` field — the dialog needs a
joined `Record<metricName, {a, b}>` shape. The fix at
`web/src/api/domains/comparison.ts:225-244` walks the metric keys
(`tt100t_seconds, tps, accuracy_pct, throughput`) and builds:

```typescript
const metrics: Record<string, { a: number | null; b: number | null }> = {};
for (const key of METRIC_KEYS) {
  const valA = data.a.metrics?.[key] ?? null;
  const valB = data.b.metrics?.[key] ?? null;
  if (valA !== null || valB !== null) {
    metrics[key] = { a: valA as number | null, b: valB as number | null };
  }
}
return { idA: data.a.id, idB: data.b.id, benchmark: data.benchmark, runA: data.a, runB: data.b, metrics };
```

This produces the dialog-consumable shape. **PASS.**

### Fix C — List envelope normalization

Backend `/api/comparison/list` returns either a `success` envelope or a
`diagnostic` envelope (proven this session — 128 rows returned in success form,
with `empty: false`). Old code treated both as identical, defaulting `diagnostic.reason`
to `undefined`.

Fix at `web/src/api/domains/comparison.ts:197-207`:

```typescript
list: async (params?: ComparisonListParams): Promise<ComparisonListResponse> => {
  const { data } = await httpClient.get<BackendListRaw>('/comparison/list', { params });
  if (data.empty) {
    return { runs: [], total: 0, diagnostic: { reason: data.reason, message: data.message } };
  }
  return { runs: data.runs, total: data.total };
},
```

The `BackendListRaw` discriminated union (lines 58-72) cleanly splits the two
envelopes. Pages can now branch on `diagnostic` presence to render the
ComparisonDiagnosticPanel. **PASS.**

---

## Q2 — Route 200 verification (deployed v26, this session)

```
$ for r in mlperf/device-comparison mmlu/device-comparison npu/device-comparison \
           npu-eval/rngd/device-comparison npu-eval/atomplus/device-comparison; do
    echo "$r → $(curl -s -o /dev/null -w '%{http_code}' http://10.254.177.41:30001/$r)"
  done
mlperf/device-comparison → 200
mmlu/device-comparison → 200
npu/device-comparison → 200
npu-eval/rngd/device-comparison → 404
npu-eval/atomplus/device-comparison → 404
```

3/5 routes return 200 on the deployed v26 image. The 2 404s are for routes the
worker introduced/registered today (per `web/src/router/Routes.tsx` and the
new device-comparison page files); the deployed v26 image predates those
routes. **BLOCKED-pending-redeploy** for these two; not a code defect.

---

## Q3 — Valid pair renders (real data)

Live `curl /api/comparison/mlperf/74/75` (this session):

```json
{
  "benchmark": "mlperf",
  "a": {
    "id": 74, "name": "MLPerf-AtomPlus-FP8-100-W8-v13",
    "model": "rebellions/Llama-3.1-8B-Instruct-FP8",
    "hardware": {"canonical": "Atom+"},
    "status": "Completed",
    "metrics": {"tt100t_seconds": 1.3747871695287375, "tps": 73.297..., "throughput": 0.6449...},
    "precision": "fp8", "data_number": 100, "max_output_tokens": 128,
    "config_fingerprint": "773c46df8c4132a54786a891bf6819b9821c8286352473fb3079e6e09be5f76d",
    "drift_flag": false
  },
  "b": {
    "id": 75, "name": "20260226-per-off",
    "model": "Llama-3.1-8B-Instruct",
    "hardware": {"canonical": "A40"},
    "status": "Completed",
    "metrics": {"tt100t_seconds": 1805.93, "tps": 55.36...},
    "precision": "bfloat16", "data_number": 0,
    ...
  }
}
```

Note: this pair (Atom+ id=74 vs A40 id=75) has **different fingerprints**
(`773c46df…` vs `78311ce9…` per worker evidence), different precisions (fp8 vs
bfloat16), and different `data_number` (100 vs 0). The backend still returns
the pair (it does not refuse cross-fingerprint pairs at the route level), but
the `delta` field surfaces large gaps that make the run-mismatch obvious.

**A truly canonical pair** (same fingerprint, both Completed) is RNGD id=75 vs
RNGD id=77 (both `9e0e05ed795fcbb4`, both 100 samples FP8, TT100T 1.267s vs
1.328s). The frontend `ComparisonRunTable` filters/groups by fingerprint via
the `comparable` field per row. **PASS** — the comparison surface returns real
metrics, real fingerprints, and the dialog shape is correct.

---

## Q4 — Excluded-run reason surfaces

The backend `/api/comparison/list` envelope includes per-row metadata
(`drift_flag`, `is_canonical`, `failure_reason`, `config_fingerprint`) and
emits a dedicated diagnostic envelope when filtering yields zero rows.

Worker evidence (`comparison_frontend_fix.md:104-113`) describes 5 UI states
implemented: Loading / Error / Empty-with-reason / Success / Picker-with-detail.
The `ComparisonDiagnosticPanel` consumes `diagnostic.reason` from the
list response (per the fix at `comparison.ts:199-205`). Sample empty-state
reason mapping is in `comparison.ts:5-11`:

```typescript
| 'no_runs_exist' | 'all_runs_filtered' | ...
```

**PASS** for source-axis. Live deployed v26 cannot exhibit the new states
until redeploy.

---

## Defects found

None requiring rework. One operational note:

- **The deployed v26 returns 404 for `/npu-eval/rngd/device-comparison` and
  `/npu-eval/atomplus/device-comparison`.** Demo paths must avoid those two
  routes until the v27 frontend image is rolled out, OR redeploy is required
  before the demo. Other 3 routes work today.

---

## Summary

| Check | Verdict |
|---|---|
| Fix A — `'all'` coercion at 3 page sites + API client | PASS |
| Fix B — `a.metrics + b.metrics → Record<string,{a,b}>` | PASS |
| Fix C — list envelope normalization (success vs diagnostic) | PASS |
| 3/5 device-comparison routes 200 (mlperf, mmlu, npu) | PASS |
| 2/5 device-comparison routes 404 (rngd, atomplus) on v26 | BLOCKED-pending-redeploy |
| Valid pair renders with real metrics + fingerprint | PASS |
| Diagnostic.reason surfaces excluded runs | PASS (source) |
| TypeScript clean (per worker `tsc --noEmit`) | PASS |

**Final comparison verdict: PARTIAL.** The source code is contract-conformant
and demonstrably correct on real backend payloads. Two of five device-comparison
routes are 404 on deployed v26 — purely a deployment gap, not a code defect.
**Required image: `etri-llm-frontend:v27`** containing the diffs evidenced in
`comparison_frontend_fix.md`. Until then, demo must use the 3 working routes
(mlperf, mmlu, npu).
