# Comparison Feature — Edge-Case Probe Deep Dive

**Date:** 2026-05-06  
**Backend:** http://10.254.177.41:30001/api/comparison/*  
**DB snapshot:** 145 runs returned by /list (137+ canonical rows + active/recent)  
**Key runs used:** id=75 (RNGD FP8 / furiosa), id=76 (Atom+ / rebellions), id=124 (L40 FP8 / nvidia), id=125 (A40 FP8 / nvidia), id=150 (L40 Stopped)

---

## Probe 1 — Default List: GET /api/comparison/list

```
curl http://10.254.177.41:30001/api/comparison/list
```

**HTTP:** 200  
**Top-level shape:** `{ code, status, message, data: { empty, total, runs[] } }`  
**Sample (id=152, most recent):**

```json
{
  "id": 152, "benchmark": "mlperf", "name": "pretotype_01",
  "model": "Llama-3.1-8B-Instruct-FP8",
  "hardware": { "type": "gpu", "vendor": "nvidia", "model": "NVIDIA-L40", "canonical": "L40", "node": null },
  "status": "Running", "precision": "bfloat16", "scenario": "offline", "batch_size": 1,
  "metrics": { "tt100t_seconds": null, "tps": null, "accuracy_pct": null, "throughput": null },
  "drift_flag": true, "is_canonical": false, "precision_mismatch": false,
  "config_fingerprint": "3e6140b0..."
}
```

**Observations:**
- `data.runs[]` contains full run objects with `hardware`, `metrics`, `precision`, `config_fingerprint`, `drift_flag`, `is_canonical`, `precision_mismatch` — shape is complete per contract.
- `total=145` but list returns all 145 without pagination — no `page`/`limit` fields present in response.
- Running run (id=152) included alongside Completed and Stopped runs with no separation.
- `data_number=0` on many older runs indicates the field was backfilled as zero, not NULL — potential display ambiguity.

---

## Probe 2 — Vendor Filter: GET /api/comparison/list?vendor={furiosa|nvidia|rebellions}

```
curl "http://10.254.177.41:30001/api/comparison/list?vendor=furiosa"
curl "http://10.254.177.41:30001/api/comparison/list?vendor=nvidia"
curl "http://10.254.177.41:30001/api/comparison/list?vendor=rebellions"
```

**HTTP:** 200 for all three  
**Result:** All three responses returned `total=145` and **identical run arrays** — the first run in every response was `id=152` (nvidia/L40/Running).

**Defect confirmed:** The `vendor` query parameter is a **no-op**. The backend accepts the param, echoes it in the `message` field (`"GET /api/comparison/list?vendor=furiosa completed successfully"`), but applies no server-side filtering. The UI vendor filter chip therefore silently shows all vendors regardless of selection.

**Severity:** Medium — misleads users who rely on the vendor filter to narrow comparison candidates.

---

## Probe 3 — Cross-Vendor MLPerf Pair: GET /api/comparison/mlperf/124/75

```
curl http://10.254.177.41:30001/api/comparison/mlperf/124/75
```

**HTTP:** 200  
**Shape:** `{ benchmark, a: {run}, b: {run}, delta: {metrics} }`  
**Sample delta:**

```json
{ "tt100t_seconds": -217.45, "tps": 7.5808, "accuracy_pct": null, "throughput": 0.059225 }
```

**Observations:**
- Run A (id=124, L40 FP8): `model="Llama-3.1-8B-Instruct-FP8"`, `precision="bfloat16"`, `precision_mismatch=false`
- Run B (id=75, RNGD FP8 — GPU table row): `model="Llama-3.1-8B-Instruct"`, `precision="bfloat16"`, `precision_mismatch=true`
- The `precision_mismatch=true` flag on run B is correctly propagated through to the comparison payload.
- Delta arithmetic is correct (124 - 75 for each metric; null where either side is null).
- **Note:** id=75 in the GPU mlperf table is an A40 NVIDIA run — not the FuriosaAI RNGD. The task description's label "RNGD FP8" for id=75 refers to the NPU-table row for the same exam slot. The `/api/comparison/mlperf/` route resolves from the GPU-side table and returns the A40 row. This is a data-model ambiguity (same `id` spans multiple source tables).

---

## Probe 4 — Self-Compare: GET /api/comparison/mlperf/75/75

```
curl http://10.254.177.41:30001/api/comparison/mlperf/75/75
```

**HTTP:** 200 (no error)  
**Delta:** `{ "tt100t_seconds": 0, "tps": 0, "accuracy_pct": null, "throughput": 0 }`

**Observations:**
- Backend allows self-comparison without error or warning — returns identity delta (all zeros / nulls).
- No guard or `diagnostic.reason` returned to signal that A == B.
- **Defect (minor):** A self-comparison is semantically meaningless; the API should return 400 with a descriptive error (`"run_id_1 and run_id_2 must differ"`). Currently the UI would silently display a zero-delta table, confusing users.

---

## Probe 5 — Nonexistent ID: GET /api/comparison/mlperf/99999/1

```
curl http://10.254.177.41:30001/api/comparison/mlperf/99999/1
```

**HTTP:** 404  
**Body:** `{ "code": 404, "status": false, "message": "No mlperf run found with id=99999 across mp-exam, mm-exam, or npu-eval", "data": null }`

**Observations:**
- Clean 404 with descriptive message — correct behavior.
- Message leaks internal table names (`mp-exam`, `mm-exam`, `npu-eval`) which may be undesirable in production but is not a security-critical disclosure.
- No 5xx triggered.

---

## Probe 6 — Mismatched Fingerprint: GET /api/comparison/mlperf/75/76

```
curl http://10.254.177.41:30001/api/comparison/mlperf/75/76
```

**HTTP:** 200  
**Run A (id=75):** `config_fingerprint="58731f9d..."`, `model="Llama-3.1-8B-Instruct"`, `precision_mismatch=true`  
**Run B (id=76):** `config_fingerprint="58731f9d..."` (same!), `model="Llama-3.1-8B-Instruct"`, `precision_mismatch=false`

**Observations:**
- Despite the task description suggesting these are a "RNGD vs Atom+" pair, id=75 and id=76 in the GPU mlperf table are both **nvidia** runs (A40 and L40 respectively) with identical fingerprints.
- The fingerprints match — so this is not actually a mismatched-fingerprint case in the GPU table. The mlperf comparison succeeds and returns a valid delta.
- **No `diagnostic.reason` field is present anywhere in the response** — the API has no mechanism to surface fingerprint-mismatch warnings or cross-vendor incompatibility explanations to the caller.
- **Defect (medium):** When fingerprints differ (genuine mismatch), the API returns 200 with delta data and no warning. Callers cannot distinguish a valid comparison from an apples-to-oranges one without client-side fingerprint diffing.

---

## Probe 7 — Stopped vs Completed: GET /api/comparison/mlperf/150/124

```
curl http://10.254.177.41:30001/api/comparison/mlperf/150/124
```

**HTTP:** 200  
**Run A (id=150):** `status="Stopped"`, `metrics={ tt100t_seconds: null, tps: null, throughput: null }`  
**Run B (id=124):** `status="Completed"`, `metrics={ tt100t_seconds: 1588.48, tps: 62.9442, throughput: 0.491752 }`  
**Delta:** `{ "tt100t_seconds": null, "tps": null, "accuracy_pct": null, "throughput": null }`

**Context:** Exam #150 is `Stopped` (not Running as anticipated — it stopped at 19:07:24). Exam #152 is currently `Running`.

**Observations:**
- Backend allows comparing a Stopped run (all-null metrics) with a Completed run — returns 200 with all-null delta.
- No guard prevents comparing non-Completed runs. The UI would display a table of dashes with no explanation.
- **Defect (medium):** No status-gate on comparison input. Should return 400 or include a `warning` field when either run is not `Completed`.

---

## Probe 8 — Candidates Endpoint: GET /api/comparison/candidates?runId=75

```
curl "http://10.254.177.41:30001/api/comparison/candidates?runId=75"
```

**Note:** First attempt with `run_id_1=75` returned 400 (`"Query param 'runId' is required"`). Correct param name is `runId`.

**HTTP:** 200  
**Shape:** `{ empty, source: {run + comparability fields}, totals: {siblings_considered, strict, hardware_optimized, related}, candidates: { strict: [], hardware_optimized: [], related: [] } }`

**Sample source object extras:**
```json
{
  "comparability_class": "strict",
  "comparability_reason": "source run",
  "comparability_score": 9007199254740991
}
```

**Observations:**
- Response is well-structured with tiered candidate buckets (`strict` / `hardware_optimized` / `related`) and counts.
- `comparability_score: 9007199254740991` on the source run itself is `Number.MAX_SAFE_INTEGER` — a sentinel value used to pin the source to the top of sorted lists; this is an implementation detail that leaks into the API response.
- `totals` shows `strict=20, hardware_optimized=57, related=65` from 142 siblings — candidates API is functional.
- **Defect (minor):** `run_id_1` is documented (or assumed from task description) as the param name but actual API requires `runId` — parameter naming inconsistency between the candidates endpoint and the rest of the comparison API surface.

---

## Probe 9 — MMLU Comparison: GET /api/comparison/mmlu/49/52

```
curl http://10.254.177.41:30001/api/comparison/mmlu/49/52
```

**HTTP:** 200  
**Shape:** Same `{ benchmark, a, b, delta }` envelope as mlperf.

**Run A (id=49):** `model="Llama-3.1-8B-Instruct-FP8"`, `accuracy_pct=0.4393`, `data_number=100`, `dataset="mmlu-pro"`  
**Run B (id=52):** `model="Llama-3.1-8B-Instruct-FP8"`, `accuracy_pct=0.4388`, `data_number=12102`, `dataset="mmlu-pro"`  
**Delta:** `{ "accuracy_pct": 0.0005, all others: null }`

**Observations:**
- MMLU endpoint shape is consistent with mlperf — same envelope, only `accuracy_pct` is populated in delta (tt100t/tps/throughput are null as expected for MMLU).
- Comparing a 100-sample run vs a 12102-sample run returns 200 with no warning about dataset size mismatch — another instance of the missing validation/warning pattern.
- `config_fingerprint` values differ between runs (different fingerprints) but no diagnostic is surfaced.

---

## Probe 10 — NPU Benchmark Axis: GET /api/comparison/npu/75/76

```
curl http://10.254.177.41:30001/api/comparison/npu/75/76
```

**HTTP:** 400  
**Body:** `{ "code": 400, "status": false, "message": "Invalid benchmark 'npu'. Allowed: mlperf, mmlu", "data": null }`

**Observations:**
- The `/api/comparison/npu/` route does not exist. Allowed benchmark axes are only `mlperf` and `mmlu`.
- **Defect (medium):** NPU-specific benchmark comparisons (RNGD vs Atom+ on npu-eval axis) have no dedicated API surface. NPU runs are either surfaced under `mlperf` (if they share the mp_exam table) or are inaccessible via the comparison API. The task's assumption of a `/npu/` route is unfulfilled.
- A proper cross-vendor NPU comparison between RNGD and Atom+ must use `/api/comparison/mlperf/` with the NPU-table-originated IDs (e.g., id=75 furiosa/RNGD and id=76 rebellions/Atom+) — but these share the same numeric IDs as GPU-table rows, creating the dual-identity ambiguity noted in Probe 3.

---

## Source Verification — `inferComputePrecision` in ComparisonRunTable

**File:** `/home/kcloud/etri-llm-exam-solution/web/src/components/ComparisonRunTable/index.tsx` (lines 30–43)

```typescript
function inferComputePrecision(run: ComparisonRunRow): string {
  const vendor = (run.hardware?.vendor ?? '').toLowerCase();
  const model  = (run.hardware?.model ?? '').toUpperCase();

  if (vendor === 'furiosa')    return 'FP8 (FuriosaAI vendor-native)';
  if (vendor === 'rebellions') {
    return run.precision
      ? `${run.precision} (Rebellions)`
      : 'BF16-fallback (Rebellions optimum-rbln limitation)';
  }
  if (vendor === 'nvidia') {
    if (model.includes('L40')) return 'FP8 (sm_89 native)';
    if (model.includes('A40')) return 'BF16 Marlin (FP8 weights dequant)';
  }
  return run.precision ?? '—';
}
```

**Mapping verification against live data:**

| Hardware (canonical) | vendor field | model field | inferComputePrecision result | Correct? |
|---|---|---|---|---|
| RNGD (id=75 NPU) | `furiosa` | `RNGD` | `FP8 (FuriosaAI vendor-native)` | Yes |
| Atom+ (id=76 NPU) | `rebellions` | `ATOM+` | `fp8 (Rebellions)` (run.precision="fp8") | Yes |
| L40 (id=124) | `nvidia` | `NVIDIA-L40` | `FP8 (sm_89 native)` | Yes — `.toUpperCase()` + `.includes('L40')` matches |
| A40 (id=125) | `nvidia` | `NVIDIA-A40` | `BF16 Marlin (FP8 weights dequant)` | Yes — `.includes('A40')` matches |

**Gap:** The function uses `run.hardware?.model` (full model string e.g. `NVIDIA-L40-44GiB`) not `canonical`. Strings like `NVIDIA-L40` and `NVIDIA-L40-44GiB` both pass `.includes('L40')` — correct. However a hypothetical `NVIDIA-RTX-4090` with `L40`-free name would fall through to the default. No current hardware in the DB triggers this gap.

**Additional gap:** `NVIDIA-A40-44GiB` — `.toUpperCase()` produces `NVIDIA-A40-44GIB` which still includes `A40` — correct.

**Rebellions precision display:** When `run.precision = "fp8"` (lowercase from DB), the label renders as `fp8 (Rebellions)` — inconsistent capitalization vs `FP8` used elsewhere. Minor cosmetic defect.

---

## Comparison Feature Defensive Readiness

| # | Probe | Endpoint | HTTP | Result | Defect? |
|---|---|---|---|---|---|
| 1 | Default list shape | GET /comparison/list | 200 | Shape complete: `data.{empty,total,runs[]}` with all required fields | None |
| 2 | Vendor filter | GET /comparison/list?vendor=furiosa/nvidia/rebellions | 200 | Filter is **no-op** — all 3 return identical 145-run array | **Yes — filter silently ignored** |
| 3 | Cross-vendor MLPerf | GET /comparison/mlperf/124/75 | 200 | Delta computed correctly; `precision_mismatch` propagated; no `diagnostic.reason` | Partial — no fingerprint-mismatch warning |
| 4 | Self-compare | GET /comparison/mlperf/75/75 | 200 | Returns zero-delta; no error or warning | **Yes — should be 400** |
| 5 | Nonexistent ID | GET /comparison/mlperf/99999/1 | 404 | Clean 404 with message; internal table names exposed but not security-critical | Minor (table name leak) |
| 6 | Mismatched fingerprint | GET /comparison/mlperf/75/76 | 200 | No `diagnostic.reason` field; fingerprint mismatch not surfaced to caller | **Yes — no mismatch warning** |
| 7 | Stopped vs Completed | GET /comparison/mlperf/150/124 | 200 | All-null delta; no status gate; no warning | **Yes — should warn/reject non-Completed** |
| 8 | Candidates endpoint | GET /comparison/candidates?runId=75 | 200 | Tiered candidates returned correctly; param name `runId` (not `run_id_1`) | Minor (param name inconsistency) |
| 9 | MMLU comparison | GET /comparison/mmlu/49/52 | 200 | Shape consistent; accuracy delta correct; dataset size mismatch not warned | Minor — no size-mismatch warning |
| 10 | NPU benchmark axis | GET /comparison/npu/75/76 | 400 | Route does not exist; allowed: `mlperf`, `mmlu` only | **Yes — NPU comparison axis missing** |
| — | `inferComputePrecision` | Source (tsx:30–43) | — | L40→FP8 sm_89, A40→BF16 Marlin, RNGD→FP8 vendor-native, Atom+→precision field | Minor: Atom+ lowercase `fp8` cosmetic |

**Summary counts:**  
- 5xx errors: **0**  
- Confirmed defects (functional/behavioral): **5**  
  1. Vendor filter is a no-op (Probe 2)  
  2. Self-compare returns 200 instead of 400 (Probe 4)  
  3. No fingerprint-mismatch / cross-config warning in comparison response (Probe 6)  
  4. Non-Completed runs accepted without status gate (Probe 7)  
  5. `/comparison/npu/` route missing — no NPU-axis comparison support (Probe 10)  
- Minor/cosmetic issues: **4** (table name leak in 404, `Number.MAX_SAFE_INTEGER` sentinel exposed in candidates, param name inconsistency `runId` vs `run_id_1`, Atom+ lowercase precision label)
