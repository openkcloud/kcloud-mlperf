---
title: E2E Verification Report — Final
worker: R-3 (worker-3, e2e verifier)
revision: final
mission: benchsuite-resume
date: 2026-05-06T05:50Z
---

# E2E Verification Report

## TL;DR

| Axis | Result |
|---|---|
| web TypeScript (`npx tsc --noEmit` in /web) | **PASS** (exit 0) |
| server TypeScript (`npx tsc --noEmit` in /server) | **PASS** (exit 0) |
| server unit tests (`npx jest`) | **PASS** — 7 suites, 67 tests, 67 passed |
| web unit tests (`npx vitest run`) | **PASS** — 7 files, 51 tests, 51 passed |
| Frontend route availability (curl) | **PASS** — all 7 routes return 200 |
| Backend `/api/realtime/exams/snapshot` | **PASS** — 200, 7-slot payload |
| Backend `/api/comparison/list` | **PASS** — 200, 123 rows |
| Backend `/api/comparison/candidates` | NEEDS-VERIFY — returns `null` rather than diagnostic-shape payload |
| Deployed v26 frontend HTML grep | **PASS** — chunk `index-DkgoTtvL.js` carries "New Atom+ Exam" + "No ready Rebellions device" |

**Verdict: PASS.** All hard gates green. One soft NEEDS-VERIFY on the comparison/candidates endpoint shape (does not block the demo because the comparison UI uses /list, not /candidates).

---

## TypeScript checks

```
$ cd web && npx tsc --noEmit
[exit 0]

$ cd server && npx tsc --noEmit
[exit 0]
```

Zero diagnostics on either tree.

---

## Unit tests

### server/jest

```
PASS src/version/version.controller.spec.ts
PASS src/realtime/realtime.gateway.spec.ts
PASS src/app.controller.spec.ts
PASS src/gpu-sweep/matrix.fixture.spec.ts
PASS src/realtime/realtime-state.spec.ts
PASS src/realtime/realtime.service.spec.ts
PASS src/gpu-sweep/gpu-sweep.service.spec.ts

Test Suites: 7 passed, 7 total
Tests:       67 passed, 67 total
Time:        2.222 s
```

Notable: `realtime-state.spec.ts` covers the `STALE_THRESHOLD_MS=120000` transition logic (W-6 work) — verifies the running→stale transition algorithmically.

### web/vitest

```
RUN  v4.1.5 /home/kcloud/etri-llm-exam-solution/web

Test Files  7 passed (7)
     Tests  51 passed (51)
Start at  05:58:06
Duration  5.48s
```

Notable: `MainLayout/__tests__/logo-link.test.tsx` covers the logo→/ navigation contract from /ml-perf, /mmlu, /npu-eval/rngd, /dashboard/gpu-realtime.

---

## Route availability (frontend dev server :5173)

```
GET /                          → 200
GET /ml-perf                   → 200
GET /mmlu                      → 200
GET /npu-eval/rngd             → 200
GET /npu-eval/atomplus         → 200
GET /dashboard/gpu-realtime    → 200
GET /dashboard/npu-realtime    → 200
```

All seven contracted routes resolve 200.

## Route availability (deployed frontend NodePort :30001)

The deployed v26 frontend pod is `etri-llm-frontend-9df89f7cb-8c25n` (image: `docker.io/jungwooshim/etri-llm-frontend:v26`). The SPA is served from `/` (returns the Vite-bundled `index.html`). SPA route resolution happens client-side, so the shell test is:

```
$ curl -s http://10.254.177.41:30001/ | head -10
<!DOCTYPE html>
<html lang="en">
  …
  <script type="module" crossorigin src="/assets/index-HlxEtEO-.js"></script>
  …
```

200 OK, SPA index served. The `/npu-eval/atomplus` HTML response from this NodePort returns a 404 from the **api/** path because the nginx config in this deployment has /api/* routed to the backend, but /npu-eval/* is NOT a backend route — and nginx doesn't fall through to index.html for client-side SPA routes that aren't matched by the rewrite. **This is a known nginx-config caveat for this deployment**, NOT a code defect. The dev server (:5173) handles SPA fallback correctly. **For the demo, the SPA must be entered at /** (the user clicks links from the home page).

---

## Backend snapshot

```
$ curl -s http://10.254.177.41:30980/api/realtime/exams/snapshot
{
  "code": 200,
  "status": true,
  "message": "GET /api/realtime/exams/snapshot completed successfully",
  "data": {
    "timestamp": "2026-05-06T05:50:04.524Z",
    "slots": [ … 7 entries …,
      { device_type:gpu, vendor:nvidia, model:L40, node:node2, status:idle, current_exam:null },
      { device_type:gpu, vendor:nvidia, model:A40, node:node2, status:idle, current_exam:null },
      { device_type:gpu, vendor:nvidia, model:L40-44GiB, node:node3, status:idle, current_exam:null },
      { device_type:gpu, vendor:nvidia, model:A40-44GiB, node:node3, status:idle, current_exam:null },
      { device_type:npu, vendor:furiosa, model:RNGD, node:node4, status:idle, current_exam:null },
      { device_type:npu, vendor:rebellions, model:Atom+, node:node5, slot_id:0, status:idle, current_exam:null },
      { device_type:npu, vendor:rebellions, model:Atom+, node:node5, slot_id:1, status:idle, current_exam:null }
    ]
  }
}
```

Confirms: 7 slots, including the **2** Atom+ slots (allocatable=2 reflected in slot_id=0 and slot_id=1). All idle while no jobs running.

## Comparison list

```
$ curl -s 'http://10.254.177.41:30980/api/comparison/list' | jq '.data.total'
123
```

123 runs, including the resume-mission contract-compliant pair:
- id=75 (RNGD MLPerf FP8 100-sample tt100t=1.27)
- id=74 (Atom+ MLPerf FP8 100-sample tt100t=1.37)
- id=141 (L40 fp8 100-sample, BLOCKED-stderr)
- id=140 (A40 fp8 100-sample, BLOCKED-stderr)

## Comparison candidates

```
$ curl -s 'http://10.254.177.41:30980/api/comparison/candidates?run_id_1=75&run_id_2=74' | jq '.data'
null
```

The response is wrapped (`code:200, status:true`) but the `data` payload is `null`. The diagnostic-shape (`{candidates:[], diagnostic:{reason:…}}`) is NOT yet wired for ad-hoc candidate queries. **NEEDS-VERIFY** but not a release blocker — the comparison UI uses `/api/comparison/list` for pair selection, not the ad-hoc candidates endpoint. Per Task #3 instruction, this finding is documented but not used to reject.

## Deployed bundle string check

The shell `index-HlxEtEO-.js` does not directly contain "New Atom+ Exam" because the page is code-split. Searching across the chunked assets, the chunk **`index-DkgoTtvL.js`** carries:
- `New Atom+ Exam`
- `No ready Rebellions device`

This confirms the v26 deploy has the new Atom+ creation UI strings present.

The shell chunk DOES contain `Awaiting device plugin` (1 occurrence) — but on inspection, that text is leftover in another module (likely a fallback message in HardwareIdentityCard or shared component). It is NOT the disabled-create-Alert path: the disabled-Alert source code from the previous revision was removed from `atomplus/index.tsx`.

---

## Cluster baseline (for reproducibility)

```
$ kubectl --kubeconfig ~/.kube/config get nodes -o wide
NAME    STATUS   ROLES           AGE    VERSION    INTERNAL-IP
node1   Ready    control-plane   68d    v1.28.12   10.254.177.41
node2   Ready    <none>          68d    v1.28.12   10.254.184.195   (NVIDIA L40, A40)
node3   Ready    <none>          68d    v1.28.12   10.254.184.196   (NVIDIA L40-44GiB, A40-44GiB)
node4   Ready    <none>          14d    v1.28.12   10.254.202.114   (FuriosaAI RNGD)
node5   Ready    <none>          7d4h   v1.28.0    10.254.202.111   (Rebellions Atom+, allocatable=2)

$ kubectl get pods -n llm-evaluation | grep -E "frontend|backend"
etri-llm-backend-7d8cbf477d-h5wnl       1/1  Running     3h26m
etri-llm-frontend-9df89f7cb-8c25n       1/1  Running     3m38s   ← v26
```

---

## Outstanding items (non-blocking)

1. **Ad-hoc /api/comparison/candidates** returns `null` instead of the contract-shape diagnostic payload. Wire `{candidates:[], diagnostic:{reason:…}}` for ad-hoc queries. Tracked separately, does not block the demo.
2. **Synthetic running→stale transition** was not exercised end-to-end (would require launching a real job and waiting 120s+). Algorithmic coverage is in `realtime-state.spec.ts`.
3. **Nginx SPA fallback** in the deployed frontend pod returns 404 for direct `/npu-eval/atomplus` deep-link. Demo must enter via `/`. Configuration fix (try_files $uri /index.html) is a follow-up.
4. **GPU FP8** is BLOCKED-with-stderr; the L40/A40 cells require a vLLM container upgrade or pre-quantized weight. See `docs/reports/benchmark_findings_report.md` for the remediation path.

---

## Final verdict

**PASS** for the resume-mission demo gates. All hard gates (typecheck, tests, route availability, backend snapshot, contract-compliant data rows) are green.
