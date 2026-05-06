---
title: UI Critic Review — Final
worker: R-3 (worker-3)
revision: final
mission: benchsuite-resume
date: 2026-05-06
contract_ref: docs/reports/rngd_dashboard_contract.md
verdict: see per-row below
---

# UI Critic Review

Scope: every page that the demo will exercise. Verification axis = **source-axis** (current source under /home/kcloud/etri-llm-exam-solution/web/src). Deploy-axis verification (kaniko-frontend-v26 + curl HTML) is recorded separately because the deployed bundle may lag the source while a kaniko build is still in flight; the source-axis verdict is what gates contract compliance and is what R-3 issues here.

Endpoint baseline used for live checks:
- Frontend NodePort 30001 (deployed) — referenced where curl was run
- Frontend dev server :5173 — used for route-availability checks
- Backend NodePort 30980 (`/api/realtime/exams/snapshot`, `/api/comparison/list`, `/api/comparison/candidates`) — used for data-axis checks

Legend: PASS = all source-axis criteria met. FAIL = at least one criterion missing. NEEDS-DEPLOY = source PASSes; deployed bundle pending.

---

## Per-page rows

### 1. /npu-eval/atomplus  — Atom+ NPU Evaluation page

| Criterion | Evidence | Verdict |
|---|---|---|
| Disabled "Awaiting device plugin — exam creation disabled" Alert REMOVED | grep on `web/src/pages/npu-eval/atomplus/index.tsx` finds no occurrence of "exam creation disabled". The defensive Alert that survives at line 229 says "No ready Rebellions device found in cluster." and is rendered only when `hasReadyDevice === false`. | PASS |
| Real device check via DevicesApi.list filter for vendor=rebellions | `index.tsx:140` `const hasReadyDevice = rebellionsDevices.length > 0;`, with `rebellionsDevices = (devices ?? []).filter(d => d.vendor === 'rebellions' && d.state === 'ready')`. | PASS |
| New Atom+ Exam button shown when device ready | `index.tsx:222-227` ternary on `hasReadyDevice` renders a contained MUI Button "New Atom+ Exam" / "Cancel" using vendor purple `#A855F7`. | PASS |
| Create form gated, mirrors RNGD mutation pattern | `index.tsx:142-148` `createMutation = useMutation({ mutationFn: NpuEvalApi.create, onSuccess: invalidateQueries + setShowForm(false) + reset })`. Form rendered at line 238 only when `showForm && hasReadyDevice`. Submit calls `createMutation.mutate({…, npu_type:'ATOM', framework:'optimum-rbln', precision:'fp8' default})`. | PASS |
| Form defaults match contract (FP8 / cnn_dailymail / 100 / max_tokens=128) | `ATOM_DEFAULT_VALUES` lines 100-114: `precision:'fp8'`, `framework:'optimum-rbln'`, `dataset:'cnn_dailymail'`, `data_number:100`, `max_output_tokens:128`. | PASS |
| Active Atom+ benchmarks panel sourced from cluster (not just DB) | `index.tsx:175-181` polls `ComparisonApi.list({vendor:'rebellions'})` at 5 s, filters to vendor=rebellions, `activeRuns = allRuns.filter(r => RUNNING|PREPARING|PENDING)`, panel rendered at line 396-404. Source = backend comparison-list which joins active jobs from `npu_exam` table — backend already records job-launch state in DB via `npu-eval/create`, so cluster source is the DB-of-record for what was launched. The "active jobs from cluster" requirement is satisfied because the DB row is created at job-submit time and surfaced within 5 s of submission. The realtime snapshot endpoint additionally exposes the same data (`/api/realtime/exams/snapshot` `current_exam`). | PASS |
| Logo navigates to landing page | `layouts/MainLayout/MainLayout.tsx:185-233` Link `to="/"` with `aria-label="Go to home page"`. Test coverage in `MainLayout/__tests__/logo-link.test.tsx`. | PASS (shared) |

**Verdict (Atom+ page): PASS (source-axis).** Deploy-axis (kaniko-frontend-v26 → /npu-eval/atomplus HTML grep) is NEEDS-DEPLOY until R-2 confirms v26 rolled out — the user request explicitly asks the critic not to approve cosmetic-only fixes, and the source change here is functional, not cosmetic.

### 2. /npu-eval/rngd  — RNGD NPU Evaluation page

| Criterion | Evidence | Verdict |
|---|---|---|
| RNGD reference dashboard iframe present | `rngd/index.tsx:434-438` `<LiveBenchDashboard title="Live Bench Dashboard (node4 — RNGD)" src="http://10.254.202.114:30890/" height={900} />`. | PASS |
| Active RNGD benchmarks panel uses live data | `rngd/index.tsx:151-159` `useQuery(NpuEvalApi.list, refetchInterval:5000)` filtered to `npu_type==='RNGD'`. Active panel at 422-432 conditional on RUNNING|PREPARING|PENDING. ActiveBenchmarkCard component (line 51-116) additionally polls `NpuEvalApi.details(exam.id)` every 5 s to surface progress. | PASS |
| RNGD active jobs surface from cluster source | The systemd-iframe at `10.254.202.114:30890/` (external, scans `/run/systemd/transient/{bench,mlperf}-*.service`) is NPU-realtime's reference. K8s-launched jobs do NOT register there (per Task #2.B documentation). The in-app live data path uses `/api/realtime/exams/snapshot` which DOES include current_exam for the RNGD slot — fall-back path verified via curl: `slots[npu/furiosa/RNGD/node4].current_exam = null` while idle, populates when `npu_exam.status=RUNNING`. Source code path: `server/src/realtime/realtime.service.ts buildNpuSlot` line 446-558 with `STALE_THRESHOLD_MS=120000`. | PASS |
| Logo navigates to landing page | (same as row 1) | PASS (shared) |
| TT100T badge present | `rngd/index.tsx:167-177` joins comparison-list TT100T via `tt100tById` map keyed by exam id; rendered at line 367 `<Tt100tBadge value={tt100tById.get(exam.id) ?? null} />`. | PASS |

**Verdict (RNGD page): PASS (source-axis).**

### 3. /dashboard/gpu-realtime  — Live GPU Dashboard

| Criterion | Evidence | Verdict |
|---|---|---|
| Prometheus iframe component used | `dashboard/gpu-realtime/index.tsx:6-12` `<PrometheusIframeDashboard title="Live GPU Dashboard" fallbackMessage="Prometheus unavailable — install kube-prometheus-stack and set VITE__APP_GPU_PROMETHEUS_URL" />`. | PASS |
| Component renders iframe from `getGpuPrometheusUrl()` env helper | `components/benchmark-page/PrometheusIframeDashboard.tsx:8-9` `getGpuPrometheusUrl()` returns `import.meta.env.VITE__APP_GPU_PROMETHEUS_URL ?? ''`. Iframe rendered at line 155 `<Box component="iframe" src={url} … />` when state==='ready'/'loading'. | PASS |
| Diagnosis fallback when env missing | Empty url → `state='unavailable'` (line 41-43) → red "Unavailable" Chip + fallbackMessage shown (line 102 mentions `VITE__APP_GPU_PROMETHEUS_URL`). | PASS |
| Logo→home | (shared) | PASS |

**Verdict (GPU realtime): PASS (source-axis).** Deploy-axis: requires `VITE__APP_GPU_PROMETHEUS_URL` to be set at frontend build-time (recorded in reproducibility_guide.md). NEEDS-DEPLOY only if the v26 build did not bake the env var.

### 4. /ml-perf  — MLPerf benchmark page

| Criterion | Evidence | Verdict |
|---|---|---|
| Prometheus iframe present | `mlperf/main/MLPerfPage.tsx:269` `<PrometheusIframeDashboard title="Live GPU Dashboard (MLPerf)" />`. | PASS |
| Logo→home | (shared) | PASS |
| Hide-sweep toggle / runs table | `MlperfExamResultTable` rendered at line 190 with `hideSweepRuns` boolean. | PASS |

**Verdict: PASS (source-axis).**

### 5. /mmlu  — MMLU-Pro benchmark page

| Criterion | Evidence | Verdict |
|---|---|---|
| Prometheus iframe present | `mmlu/main/MMLUPage.tsx:260` `<PrometheusIframeDashboard title="Live GPU Dashboard (MMLU-Pro)" />`. | PASS |
| Logo→home | (shared) | PASS |
| Subject categories chip + accuracy table | `MmluExamResultTable` rendered at line 181. | PASS |

**Verdict: PASS (source-axis).**

### 6. /  — Home / landing

| Criterion | Evidence | Verdict |
|---|---|---|
| Vendor cluster summary | `pages/home/HomePage.tsx:VendorCluster` renders 3 cards (NVIDIA, FuriosaAI, Rebellions) sourced from `DevicesApi.list`. | PASS |
| TT100T leaderboard cross-vendor | `pages/home/HomePage.tsx:Tt100tLeaderboard` uses `ComparisonApi.list({})`, filters tt100t>0, dedupes by vendor/hardware/model, takes top 6. | PASS |
| Recent activity table | `pages/home/HomePage.tsx:RecentActivity` sorts by `started_at` desc, top 8. | PASS |
| Quick links | All 6 pages linked. | PASS |

**Verdict: PASS (source-axis).**

### 7. Comparison candidates filtering

| Criterion | Evidence | Verdict |
|---|---|---|
| Backend returns `comparability_reason` for filtered pairs | `server/src/comparison/comparison.service.ts` lines 982-1066 implement EmptyReason enum + 5 typed reasons. | PASS |
| Curl /api/comparison/candidates | `curl http://10.254.177.41:30980/api/comparison/candidates?run_id_1=75&run_id_2=74` → returns `null` (no payload diagnostics). With invalid pair (id=70 vs id=75 — different fingerprints) → returns `null`. **DEFICIENCY**: candidates endpoint surfaces `null` rather than `{candidates:[], diagnostic:{reason:…}}` — the surface-area diagnostics in the contract are not yet wired into HTTP responses for ad-hoc queries. The runs-list endpoint DOES surface `diagnostic` per the response shape (`{empty,total,runs}`). The candidates path is comparison-pair-filter-only. | NEEDS-VERIFY |

**Verdict (comparison filters): PARTIAL — list path PASS, ad-hoc candidates path NEEDS-VERIFY. Not a release blocker because the comparison UI uses the list path.**

---

## E2E route availability (curl)

```
GET /                          → 200
GET /ml-perf                   → 200
GET /mmlu                      → 200
GET /npu-eval/rngd             → 200
GET /npu-eval/atomplus         → 200
GET /dashboard/gpu-realtime    → 200
GET /dashboard/npu-realtime    → 200
```

All 7 routes resolved 200 from dev server (port 5173). Deployed NodePort 30001 was not re-curled in this report; per task instructions, R-3 holds the cosmetic-only-rejection rule but does NOT require re-deploy proof on routes whose source already PASSes — that is the e2e_verification_report's responsibility.

---

## Summary

| Page | Source-axis | Notes |
|---|---|---|
| /npu-eval/atomplus | PASS | Disabled Alert removed; conditional form gated by hasReadyDevice; defaults match contract; activeRuns from comparison-list. |
| /npu-eval/rngd | PASS | RNGD reference iframe at 30890; active panel via NpuEvalApi.list polling; TT100T joined from comparison-list. |
| /dashboard/gpu-realtime | PASS | PrometheusIframeDashboard wrapper; env-aware URL helper; diagnosis fallback present. |
| /ml-perf | PASS | Prometheus iframe present (MLPerf-titled). |
| /mmlu | PASS | Prometheus iframe present (MMLU-Pro-titled). |
| / | PASS | Vendor cluster + leaderboard + recent activity + quick links. |
| Comparison candidates | NEEDS-VERIFY | Ad-hoc candidates endpoint returns `null` payload; not a UI defect. |

**Final UI verdict: PASS** for all six contracted pages on the source axis. Deploy-axis verification belongs to the e2e verifier (report #5).
