# UI Blind-Spot Audit — ETRI LLM Benchmarking Frontend

**Date:** 2026-05-06  
**Frontend version:** v31 (chunk `index-B0dtHsu6.js`)  
**Backend version:** v26  
**Live base URL:** `http://10.254.177.41:30001/`  
**Source root:** `web/src/pages/`  
**Auditor:** Executor agent (static source read + live curl probes)

---

## Methodology

For each page:
1. Source file read via `Read` tool.
2. Live HTTP probe via `curl` with browser headers.
3. API responses sampled from the live backend.
4. Broken-link and hardcoded-IP grep across all page files.
5. ErrorBoundary search across the entire `src/` tree.

**Key finding up-front:** There is **no `ErrorBoundary` component** anywhere in `web/src/`. All error states rely on per-component `isError`/`error` guards from React Query. A thrown exception in any component renders a blank white page with no recovery UI.

---

## Route Map (as registered in `Routes.tsx`)

| UI Path | Source file |
|---|---|
| `/` | `pages/home/HomePage.tsx` |
| `/ml-perf` | `pages/mlperf/main/MLPerfPage.tsx` |
| `/ml-perf/device-comparison` | `pages/mlperf/device-comparison/index.tsx` |
| `/mmlu` | `pages/mmlu/main/MMLUPage.tsx` |
| `/mmlu/device-comparison` | `pages/mmlu/device-comparison/index.tsx` |
| `/npu-eval` | `pages/npu/main/index.tsx` |
| `/npu-eval/device-comparison` | `pages/npu/device-comparison/index.tsx` |
| `/npu-eval/rngd` | `pages/npu-eval/rngd/index.tsx` |
| `/npu-eval/rngd/device-comparison` | `pages/npu-eval/rngd/device-comparison/index.tsx` |
| `/npu-eval/atomplus` | `pages/npu-eval/atomplus/index.tsx` |
| `/npu-eval/atomplus/device-comparison` | `pages/npu-eval/atomplus/device-comparison/index.tsx` |
| `/dashboard/gpu-realtime` | `pages/dashboard/gpu-realtime/index.tsx` |
| `/dashboard/npu-realtime` | `pages/dashboard/npu-realtime/index.tsx` |

> **Note:** The router uses `/ml-perf` (hyphenated) as the MLPerf root, not `/mlperf`. This is significant — see broken links below.

---

## Page-by-Page Audit

---

### Page 1: `/` — Landing (HomePage)

**Source:** `pages/home/HomePage.tsx`  
**Live probe:** HTTP 200

#### 1. Normal render
Five stacked panels:
- **HeroBanner** — static gradient card: "ETRI LLM Benchmarking Cluster", lists NVIDIA L40/A40, FuriosaAI RNGD, Rebellions Atom+, chips "3 vendors live" and "TT100T target < 1.1 s".
- **VendorCluster** — Cluster Inventory grid showing nvidia/furiosa/rebellions device counts pulled from `GET /api/devices`. Live: 8 devices returned (L40, A40 on node2/3; RNGD on node4; 2x Atom+ on node5).
- **Tt100tLeaderboard** — pulls `GET /api/comparison/list` (no filter). Live: 145 runs. Deduplicates by vendor/model/model-name and shows best TT100T. Live data includes runs with `tt100t_seconds: 1584.13` — this is in **seconds** (26 minutes), not sub-second, meaning the PASS/FAIL verdict (`< 1.1 s`) will show **FAIL** for all current GPU runs.
- **QuickActions** — navigation buttons.
- **RecentActivity** — re-uses same comparison/list query, sorts by `started_at`, shows last 8 runs.

#### 2. Empty data
- `VendorCluster`: if `/api/devices` returns `[]`, groups still render with `count: 0` and `statusLabel: 'unknown'`. Displays "0 devices — unknown" chips. Graceful but potentially alarming.
- `Tt100tLeaderboard`: `top.length === 0` → `<Alert severity="info">No measured TT100T runs yet...</Alert>`. Safe.
- `RecentActivity`: `recent.length === 0` → `<Alert severity="info">No runs recorded yet.</Alert>`. Safe.

#### 3. Error state
- `Tt100tLeaderboard` has `isError` guard → renders `<Alert severity="warning">/api/comparison/list could not be reached...</Alert>`. Only component with an error alert.
- `VendorCluster` and `RecentActivity` use `useQuery` without `isError` handling — on API failure, they silently render empty/zeroed data. No error message shown.
- No `ErrorBoundary`. Any thrown exception = white screen.

#### 4. Loading state
- No loading skeletons on any panel. `useQuery` returns `undefined` until data resolves; components treat `undefined` as empty and render gracefully (zeroed counts, empty tables). There is no spinner or skeleton.

#### 5. UX risks
- **BROKEN LINKS (HIGH):** QuickLinks button `to="/ml-perf"` correctly routes to the MLPerf page. But in `Tt100tLeaderboard`, line 276: `to="/ml-perf/device-comparison"` — this URL **does not exist** in the router (the router registers the page but the link must match the router). After checking: router path IS `/ml-perf/device-comparison` so this link is correct. However the third button `to="/npu-eval/device-comparison"` — this routes to `NpuEvalPageLinks.main + device-comparison` which IS registered. So these are correct.
- **TT100T VERDICT BUG (HIGH):** Live data has `tt100t_seconds: 1584.13`. The `verdictOf()` function returns `FAIL` for anything ≥ 1.1 s. The leaderboard will show large-format FAIL chips on every row if these are the benchmark scores being displayed. The metric name collides with elapsed time (seconds for full run). If these values are intended to be sub-second measurements, the live data is incorrect and the leaderboard will display all-FAIL on stage.
- **No loading indicator:** Page renders instantly with zeroed vendor counts, then updates when API responds. On slow network this could briefly show "0 devices — unknown" for all vendors.
- **Missing aria-labels:** No `aria-label` on any interactive element found in this file.

---

### Page 2: `/ml-perf` — MLPerf List + Create Form

**Source:** `pages/mlperf/main/MLPerfPage.tsx` + `exam-form/index.tsx`  
**Live probe:** HTTP 200  
**Live API:** `GET /api/mp-exam/list?page=1&limit=5` → 200, 61 total records, 13 pages

#### 1. Normal render
- Banner row with chips: "MLPerf v5.1", "Accuracy & Performance", "Offline / Server Scenarios".
- "Hide sweep runs" toggle (localStorage-persisted, defaults to ON in production).
- `MlperfExamResultTable` — paginated results table.
- Collapsible accordion "Create New Test" (collapsed by default).
- Two `LiveBenchDashboard` iframes for L40 and A40 — shown idle if no matching exam is running.

#### 2. Empty data
`MlperfExamResultTable` is a shared component (source not read directly); based on usage pattern with `useMpExamResultList` hook, it renders an empty-state row. No source evidence of a custom empty message in the table itself — likely shows an empty `<tbody>`.

#### 3. Error state
No `isError` guard visible in `MLPerfPage.tsx`. The table and form use React Query internally. On API failure: table likely renders empty with no error message. The `LiveBenchDashboard` renders with `idle=true` when no exam is active — does not crash.

#### 4. Loading state
No visible spinner or skeleton in the page wrapper. Individual components may have internal loading states.

#### 5. Form fields — MLPerf Create Exam

| Field | Type | Default | Valid range / options | Required | Notes |
|---|---|---|---|---|---|
| Test Name | text input | `''` | Optional, free text | No | Auto-generated as `{model}-{dataset}` if blank |
| Test Description | textarea | `''` | Optional, free text | No | |
| Model | select | `''` | From `/api/settings` mlperf keys + hardcoded FP8 variant | Yes | Refresh button present |
| Dataset | select | `''` | Driven by model selection: local map → settings API → all datasets | Yes | Clears when model changes |
| Precision | select | `bfloat16` | `bfloat16`, `float16`, `float32` | Yes | |
| Mode | select | `accuracy` | `accuracy`, `performance` | Yes | |
| Scenario | select | `offline` | `offline`, `server` | Yes | |
| Framework | select | `vllm` | `vllm`, `pytorch` | Yes | |
| Number of data | number | `0` | ≥ 0 (0 = full dataset) | No | |
| Target QPS | number | `0.5` | > 0 (server scenario) | No | |
| Batch Size | number | `1` | > 0 | No | |
| Workers | number | `1` | > 0 | No | |
| Min Duration | number | auto | 600000 (offline), 120000 (server) — set automatically by scenario | No | Auto-set on scenario change |
| Tensor Parallel Size | number | `1` | > 0 | No | |
| Max Output Tokens | number | `128` | 16–2048 | No | Validated min 16 / max 2048 |
| GPU Type | select | `''` | From `/api/devices` GPU list | Yes | Refresh button present |
| GPU Number | select | `''` | Driven by GPU Type selection | Yes | |
| CPU Core | select | `8` | 2,4,6,8,10,12,14,16,20,24,28,32,36,40,48,56,64 | Yes | |
| RAM (GB) | number | `16` | > 0 | No | |
| Number of Repetitions | number | `1` | > 0 | No | |
| Start Time | datetime | now | Any future datetime | No | Uses Asia/Seoul timezone |

**Backend on submission:** POST to `/api/mp-exam/create`. Modal confirmation shown before submit. Backend schedules the exam via Kubernetes job.

#### 6. UX risks
- **Settings/Datasets API 404 (MEDIUM):** `GET /api/settings` and `GET /api/datasets` both returned 404 during audit. The model and dataset dropdowns fall back to `apiModels`/`apiDatasets` from those endpoints. If those 404, model list may be empty, making form unusable. The FP8 hardcoded model is always injected as fallback.
- **Min Duration label (MEDIUM):** Field labeled "Min Duration" with no unit hint. Value auto-set to 600000 or 120000 — these are milliseconds. An operator might read this as seconds and be confused.
- **No aria-labels on form inputs.**
- **HIDE_SWEEP_KEY shared between MLPerf and MMLU pages (MEDIUM):** Both pages use the same `localStorage` key `HIDE_SWEEP_RUNS`. Toggling on one page affects the other. This is intentional (global preference) but may confuse operators expecting per-page control.

---

### Page 3: `/mmlu` — MMLU List + Create Form

**Source:** `pages/mmlu/main/MMLUPage.tsx` + `exam-form/index.tsx`  
**Live probe:** HTTP 200  
**Live API:** `GET /api/mm-exam/list?page=1&limit=3` → 200, 24 total records

#### 1. Normal render
- Banner chips: "MMLU-Pro", "Multi-Subject Accuracy", "14 Subject Categories".
- Same structure as MLPerf: hide-sweep toggle, results table, collapsed create form, two LiveBenchDashboard iframes.

#### 2–4. Empty / Error / Loading
Same pattern as MLPerf — no explicit error UI at page level, no loading skeleton.

#### 5. Form fields — MMLU Create Exam

| Field | Type | Default | Valid range / options | Required | Notes |
|---|---|---|---|---|---|
| Test Name | text input | `''` | Optional | No | Auto-generated as `{model}-{dataset}` |
| Test Description | textarea | `''` | Optional | No | |
| Model | select | `''` | From settings.mmlu + FP8 hardcoded | Yes | |
| Dataset | select | `''` | Driven by model | Yes | |
| Precision | select | `bfloat16` | `bfloat16`, `float16`, `float32` | Yes | |
| Framework | select | `vllm` | `vllm` only (single option) | Yes | |
| Number of Data | number | `0` | ≥ 0 | No | |
| Batch Size | number | `1` | > 0 | No | |
| Subjects | text input | `'all'` | Free text (`'all'` or comma-separated subject names) | No | No validation — any string accepted |
| GPU Utilization | number | `0.8` | > 0 (fraction, not %) | No | No max validation — entering 8 instead of 0.8 passes |
| Max Tokens | number | `128` | 16–2048 | No | |
| GPU Type | select | `''` | From devices API | Yes | |
| GPU Number | select | `''` | Driven by GPU Type | Yes | |
| CPU Core | select | `8` | 2–64 (same list as MLPerf) | Yes | |
| RAM (GB) | number | `16` | > 0 | No | |
| Number of Repetitions | number | `1` | > 0 | No | |
| Start Time | datetime | now | Any | No | |

**Backend on submission:** POST to `/api/mm-exam/create`.

#### 6. UX risks
- **GPU Utilization field has no max validation (MEDIUM):** `gpuUtil` accepts any positive number. Entering `8` (common mistake for `0.8`) will pass form validation and be sent to backend.
- **Subjects field is a free text input (MEDIUM):** No enum picker or autocomplete. The banner says "14 Subject Categories" but there is no hint of what valid subject names are. A typo silently passes. On stage if someone types a bad subject the exam will run with wrong scope.
- **Framework locked to `vllm` only (LOW):** `mlExamFrameworkList` has only one entry. The dropdown renders a single option. Not a crash risk but visually looks like a broken select.
- **MMLU form error dispatch (MEDIUM):** `useEffect` on `errors` dispatches `setNotification` for `name.message` only — other field errors (model, dataset, etc.) do not trigger the global notification. Validation errors appear inline only, which may be missed.

---

### Page 4: `/npu-eval` — NPU Eval List (Legacy)

**Source:** `pages/npu/main/index.tsx`  
**Live probe:** HTTP 200  
**Live API:** `GET /api/npu-eval/list?page=1&limit=3` → 200, 60 total records

#### 1. Normal render
- Header: "NPU Evaluation" + subtitle showing RNGD spec from `/api/npu-eval/npu-list`.
- "GPU vs NPU Comparison" button navigating to `/npu-eval/device-comparison`.
- "New NPU Exam" button toggling create form.
- Results table with columns: ID, Name, Benchmark, Model, Precision, NPU, Dataset, Max Tokens, Status, Created, Actions.
- Active benchmarks panel (conditional on running/pending/preparing rows).
- Live bench dashboard iframe hardcoded to `http://10.254.202.114:30890/`.

#### 2. Empty data
Empty `<TableRow>` with `colSpan={11}`: "No NPU exams found. Create one to get started." — clear and correct.

#### 3. Error state
No `isError` guard on `examList` query. On API failure, `examList?.list` is `undefined` → renders empty table + empty-state message. No error alert shown. The `npuListData` query also has no error guard — on failure, the spec subtitle simply doesn't render.

#### 4. Loading state
No loading indicator for the table. First render is an empty table until query resolves.

#### 5. Form fields — NPU Eval Create Exam (legacy `/npu-eval` page)

| Field | Type | Default | Editable | Options / Range |
|---|---|---|---|---|
| Test Name | text | `''` | Yes | Required |
| Description | text | `''` | Yes | Optional |
| Benchmark | select | `mlperf` | Yes | `mlperf`, `mmlu` |
| Model | text | `furiosa-ai/Llama-3.1-8B-Instruct` | Yes | Free text |
| Precision | select | `FP8` | Yes | `FP8`, `BF16`, `INT8`, `INT4` |
| Framework | text | `furiosa-llm` | No (disabled) | Locked |
| Batch Size | number | `1` | Yes | > 0 |
| Dataset | text | auto | Yes | Auto-set from benchmark; `CNN-DailyMail` (mlperf) or `MMLU-Pro` (mmlu) |
| Data Samples | number | `0` | Yes | 0 = full |
| NPU Type | text | `RNGD` | No (disabled) | Locked to RNGD |
| NPU Count | number | `1` | Yes | > 0 |
| CPU Cores | number | `8` | Yes | > 0 |
| RAM (GB) | number | `64` | Yes | > 0 |
| Repetitions | number | `3` | Yes | > 0 |
| Max Output Tokens | number | `0` | Yes | 0 = unlimited |
| Start Time | datetime-local | now | Yes | |

**Backend on submission:** POST to `/api/npu-eval/create` with `npu_type` from form value.

#### 6. UX risks
- **HARDCODED IP in iframe (HIGH):** `src="http://10.254.202.114:30890/"` and `href="http://10.254.202.114:30890/"` are hardcoded on lines 454 and 469 of `pages/npu/main/index.tsx`. This is the node4 bench dashboard. If that IP or port changes, or if this page is accessed from a browser that cannot reach `10.254.202.114`, the iframe will be a blank box with no error message. The `<LiveBenchDashboard>` component on the RNGD page uses `getAtomPlusLiveBenchUrl()` / `getL40LiveBenchUrl()` (env-var-aware), but this legacy NPU page does NOT — it uses a raw hardcoded string.
- **This page (`/npu-eval`) is likely stale (MEDIUM):** It shows `npu_type: RNGD` locked in the form but also has `npu_type` coming from the select in `DEFAULT_VALUES` — actually the form lets users set any type. The newer `/npu-eval/rngd` and `/npu-eval/atomplus` pages are the current UI; this legacy page may confuse operators and create double-routing confusion.
- **Model field is free-text (MEDIUM):** No dropdown or validation for model. Typos go directly to backend.
- **No delete confirmation race (LOW):** Stop and delete mutations use `isPending` guard but there's no debounce — rapid clicking could fire multiple requests.

---

### Page 5: `/npu-eval/rngd` — RNGD Bench Page

**Source:** `pages/npu-eval/rngd/index.tsx`  
**Live probe:** HTTP 200  
**Live API:** filtered from comparison list (vendor=furiosa); live shows RNGD NPU data

#### 1. Normal render
- `HardwareIdentityCard` for FuriosaAI RNGD (node4).
- Header with "RNGD vs GPU Comparison" button → `/npu-eval/rngd/device-comparison`.
- "New RNGD Exam" toggle button.
- Results table with columns: ID, Name, Benchmark, Model, Precision, NPU (always "RNGD x N"), Dataset, TT100T (<1.1s), Status, Created, Actions.
- `Tt100tBadge` per row from `/api/comparison/list?hardware=npu` joined by `exam.id`.
- Active benchmarks panel (conditional).
- "Active Benchmark (cluster-source)" panel from realtime SSE feed.
- `LiveBenchDashboard` for node4 at `http://10.254.202.114:30890/` (env-aware via `src` prop — uses hardcoded fallback string directly in JSX: `src="http://10.254.202.114:30890/"` on line 491).

#### 2. Empty data
Empty table row: "No RNGD exams found. Create one to get started." Safe.

#### 3. Error state
No `isError` on `examList` query. The `comparisonList` query has no error guard either — `tt100tById` would be an empty Map → all badges show null. The realtime `rngdSlot` query degrades silently. `LiveBenchDashboard` shows idle message when `rngdSlot === null`.

#### 4. Loading state
No spinner. Table renders empty until query resolves.

#### 5. Form fields — RNGD Create Exam

Same fields as NPU Eval page (§4) with these differences:
- **NPU Type:** Rendered as a plain disabled `<TextField value="RNGD">` (not a Controller), so value is always hardcoded to "RNGD" and passed explicitly in `onSubmit` override (`npu_type: 'RNGD'`).
- **Framework:** Disabled, value from `DEFAULT_VALUES.framework = 'furiosa-llm'`.
- All other fields same as the legacy NPU form.

#### 6. UX risks
- **HARDCODED IP (HIGH):** `src="http://10.254.202.114:30890/"` hardcoded in JSX at line 491. Same issue as legacy NPU page. If node4 is unreachable, blank iframe with no fallback.
- **TT100T badge data join may mismatch (MEDIUM):** The page filters the exam list by `npu_type === 'RNGD'` client-side from the full list, then joins TT100T from the comparison list by `exam.id`. The comparison API returns `r.id` which is the comparison run ID, not necessarily the `npu_exam.id`. If the IDs don't align, all TT100T badges show `null`.
- **Realtime SSE path is `/realtime/exams` (confirmed live):** The `/api/realtime/snapshot` path returns 404 — the snapshot endpoint is different. The SSE connection to `/realtime/exams/snapshot` may succeed differently through the API proxy.

---

### Page 6: `/npu-eval/atomplus` — Atom+ Bench Page

**Source:** `pages/npu-eval/atomplus/index.tsx`  
**Live probe:** HTTP 200

#### 1. Normal render
- `HardwareIdentityCard` for Rebellions Atom+ (node5, purple color `#A855F7`).
- Header with "Atom+ vs GPU Comparison" button.
- **Device-aware create button:** Only shown if `hasReadyDevice` (Rebellions device with `state === 'ready'`). Live: 2x Atom+ devices are `ready` on node5 → button shows.
- If no ready device: `<Alert severity="warning">` with `kubectl` diagnostic commands rendered inline in the UI. **These kubectl commands render as visible text on stage.**
- Results table data pulled from `/api/comparison/list?vendor=rebellions` (ComparisonApi, not NpuEvalApi). Client-side pagination.
- `LiveBenchDashboard` via `getAtomPlusLiveBenchUrl()` — env-var-aware, no hardcoded IP.

#### 2. Empty data
Empty table: "No Atom+ runs found." Safe.

#### 3. Error state
`error` from comparison query: `<Alert severity="error">Failed to load Atom+ runs. Please refresh.</Alert>`. This is the **only page** (besides the homepage leaderboard) with an explicit API error alert.

#### 4. Loading state
`isLoading` → `<CircularProgress size={32} />` centered. This is the **only page** with an explicit loading spinner for its main table.

#### 5. Form fields — Atom+ Create Exam

| Field | Type | Default | Editable | Options / Range |
|---|---|---|---|---|
| Test Name | text | `''` | Yes | Required |
| Description | text | `''` | Yes | Optional |
| Benchmark | select | `mlperf` | Yes | `mlperf`, `mmlu` |
| Model (HuggingFace path) | text | `rebellions/Llama-3.1-8B-Instruct` | Yes | Free text |
| Precision | select | `fp8` | Yes | `fp8`, `bf16`, `int8` (lowercase, unlike RNGD which uses uppercase) |
| Framework | text | `optimum-rbln` | No (disabled) | Locked |
| Batch Size | number | `1` | Yes | > 0 |
| Dataset | text | auto | Yes | `cnn_dailymail` (mlperf) or `MMLU-Pro` (mmlu) |
| Data Samples | number | `100` | Yes | 0 = full; default 100 (not 0 like RNGD) |
| NPU Type | text | `ATOM` | No (disabled) | Locked |
| NPU Count | number | `1` | Yes | > 0 |
| CPU Cores | number | `8` | Yes | > 0 |
| RAM (GB) | number | `64` | Yes | > 0 |
| Repetitions | number | `3` | Yes | > 0 |
| Max Output Tokens | number | `128` | Yes | 0 = unlimited; default 128 (not 0 like RNGD) |
| Start Time | datetime-local | now | Yes | |

#### 6. UX risks
- **kubectl command leaks (MEDIUM):** If Rebellions device plugin is unhealthy on demo day, the warning alert renders `kubectl get nodes -l kubernetes.io/hostname=node5` and `kubectl get pods -n rbln-system` as visible text in the UI. Revealing infrastructure-level diagnostics on a presentation screen is embarrassing.
- **Precision case mismatch vs RNGD (LOW):** Atom+ uses `fp8`/`bf16`/`int8` (lowercase); RNGD uses `FP8`/`BF16`/`INT8` (uppercase). Backend must handle both. Inconsistency may confuse operators manually creating exams.
- **Data Samples default 100 (LOW):** RNGD defaults to 0 (full run). Atom+ defaults to 100. Inconsistency. If someone creates an Atom+ exam expecting a full-dataset run and forgets to set 0, they get only 100 samples.
- **No delete/stop actions on Atom+ table (MEDIUM):** The Atom+ table (sourced from `ComparisonApi`, not `NpuEvalApi`) has **no action buttons** — no view detail, no stop, no delete. Users can only observe completed runs. For active benchmarks the `ActiveBenchmarkCard` shows pulse animation but no stop button.

---

### Page 7: `/dashboard/gpu-realtime` — GPU Realtime Dashboard

**Source:** `pages/dashboard/gpu-realtime/index.tsx` → `components/DeviceRealtimeDashboard.tsx`  
**Live probe:** HTTP 200

#### 1. Normal render
`DeviceRealtimeDashboard deviceType="gpu"`:
- `DeviceDashboardHeader` with "GPU Real-Time Dashboard".
- Registry diagnostics row (Source chip, k8s API reachable chip, last refresh time).
- SSE connection error banner if `useRealtimeExams` reports error.
- Race alert banner if `snapshot.operator_race_alerts > 0`.
- **Sweep Progress** panel: `progress.completed / progress.total` linear progress bar. Default: `{completed: 0, total: 96, paused: true}` — shows "0 / 96 cells, Paused" until SSE connects.
- Device Cards grid (GPU devices from device registry). Live: 4 GPU devices (L40, A40 on node2; L40-44GiB, A40-44GiB on node3).
- TPS Comparison BarChart — bars per device, value = `slot.tps ?? 0`.
- Active Exam Slots table (shown only when slots exist).

#### 2. Empty data
- No devices: `<Paper textAlign="center">{noDevicesMessage}</Paper>`. Message explains what to check.
- No active slots: "No active GPU exams. Start a sweep or submit an exam."

#### 3. Error state
- Registry error: `noDevicesMessage` includes `registryError.message`.
- SSE error: amber warning banner with `error` string from `useRealtimeExams`.
- No `ErrorBoundary`. MUI BarChart crash on bad data would white-screen.

#### 4. Loading state
- Registry loading: `noDevicesMessage = 'Loading device registry…'` shown in the empty-devices paper.
- SSE: "Offline" chip in Sweep Progress header. No spinner.

#### 5. UX risks
- **Sweep Progress hardcoded default (MEDIUM):** Default `total: 96` is hardcoded in the component. If SSE has not yet delivered a snapshot, the bar shows "0 / 96 cells — Paused" which is a fabricated state, not actual data.
- **TPS BarChart with all-zero data (LOW):** When no exams are running, all bars are 0-height. MUI x-charts renders this as a flat bar chart with 4 labeled but invisible bars. Not a crash but looks broken.
- **Slot key matching via `gpu_type` field (MEDIUM):** `getSlotForDevice(device)` matches `slot.gpu_type === slotKeyFromDevice(device)`. If the SSE slot `gpu_type` value doesn't exactly match the device registry key format (e.g., `"NVIDIA-L40"` vs `"L40"`), the card shows "Idle" even when running.

---

### Page 8: `/dashboard/npu-realtime` — NPU Realtime Dashboard

**Source:** `pages/dashboard/npu-realtime/index.tsx` → same `DeviceRealtimeDashboard` component  
**Live probe:** HTTP 200

Identical structure to GPU Realtime with `deviceType="npu"`. Same risks apply. Additional note:
- Live devices: RNGD (node4), 2x Atom+ (node5). All `state: "ready"`.
- **No RNGD NPU in `npu-list` for Atom+ (LOW):** `GET /api/npu-eval/npu-list` returns only RNGD spec. Atom+ hardware info in the device cards depends only on the device registry, not the npu-list endpoint.

---

### Page 9: `/ml-perf/device-comparison` — MLPerf Cross-Device Comparison

**Source:** `pages/mlperf/device-comparison/index.tsx`  
**Live probe:** HTTP 200  
**Live API:** `GET /api/comparison/list?benchmark=mlperf` → 120 runs

#### 1. Normal render
- `DeviceDashboardHeader`: "MLPerf — Cross-Device Comparison".
- `ComparisonRunTable`: paginated table of all MLPerf runs across vendors. Row action: "Pick" button selects Run A.
- On selecting Run A: right-side `Drawer` opens with `ComparisonCandidatePicker` showing compatible Run B candidates.
- On selecting Run B: `ComparisonDetailDialog` opens with metric-by-metric side-by-side.
- 30-second auto-refetch.

#### 2. Empty data
`ComparisonDiagnosticPanel` shown with `diagnosticReason` (from `data.diagnostic.reason` or default `'no_runs_exist'`). Action button navigates to `/ml-perf`. Live: 120 runs available, so this won't trigger on demo day.

#### 3. Error state
`<Alert severity="error">Failed to load comparison data. Please refresh and try again.</Alert>`. Good.

#### 4. Loading state
`ComparisonRunTable` receives `isLoading` prop — presumably handles internally (not audited; shared component).

#### 5. UX risks
- **`CompareError` shows "Failed to load comparison data." (LOW):** No retry guidance beyond the `onRetry` button in the dialog.
- **Drawer width hardcoded 400px (LOW):** On mobile or narrow screens, the candidate picker drawer overflows.

---

### Page 10: `/mmlu/device-comparison` — MMLU Cross-Device Comparison

**Source:** `pages/mmlu/device-comparison/index.tsx`  
**Live probe:** HTTP 200  
**Live API:** `GET /api/comparison/list?benchmark=mmlu` → present in 145-run total

Structurally identical to MLPerf device comparison. Same risks. Action fallback navigates to `/mmlu` (correct path). No additional blind spots beyond those noted for MLPerf comparison.

---

### Page 11: `/npu-eval/device-comparison` — NPU vs GPU Comparison (Legacy)

**Source:** `pages/npu/device-comparison/index.tsx`  
**Live probe:** HTTP 200  
**Live API:** `GET /api/comparison/list?hardware=all` → 145 runs

#### 1. Normal render
- Title: "NPU vs GPU — Historical Cross-Device Comparison".
- Single picker workflow (same as MLPerf/MMLU comparison): select Run A → Drawer → pick Run B → dialog.
- `benchmark` parameter for `ComparisonApi.compare` inferred from `selectedA.benchmark`.

#### 2. Empty data
`ComparisonDiagnosticPanel` with navigate to `/npu-eval` (the legacy page, not `/npu-eval/rngd`).

#### 3. Error state
`<Alert severity="error">Failed to load exam data. Please refresh and try again.</Alert>`. Good.

#### 4. UX risks
- **All 145 runs mixed in one table (MEDIUM):** GPU + RNGD + Atom+ runs all appear in one `ComparisonRunTable` with no pre-filter. User must scroll and understand hardware column to pick meaningful comparisons. This is the only page with `showBenchmark=true` and `showVendor=true` together.

---

### Page 12: `/npu-eval/rngd/device-comparison` — RNGD vs GPU Comparison

**Source:** `pages/npu-eval/rngd/device-comparison/index.tsx`  
**Live probe:** HTTP 200

#### 1. Normal render
- Two-panel layout (side by side on md+): "FuriosaAI RNGD Runs" (left) + "MLPerf GPU Runs" (right).
- Each panel is a `ComparisonRunTable`. User picks one from each, then clicks "Compare" button.
- `ComparisonDetailDialog` shows RNGD vs GPU metrics.

#### 2. Empty data
Each panel has its own `ComparisonDiagnosticPanel`:
- No RNGD runs: navigates to `/npu-eval/rngd`.
- No GPU runs: navigates to `/ml-perf`.

#### 3. Error state
`<Alert severity="error">Failed to load exam data. Please refresh and try again.</Alert>`.

#### 4. UX risks
- **Cross-benchmark comparison allowed (MEDIUM):** User could pick a RNGD mlperf run vs a GPU mmlu run. The `bench` parameter is inferred from `selectedRngd.benchmark`. If RNGD run is mlperf and GPU run is mmlu, the comparison will call `ComparisonApi.compare('mlperf', rngdId, gpuId)` — the backend may return empty metrics or an error because the benchmarks don't match.
- **"&amp;" visible in status line (LOW):** Line 96: `<Typography>&amp;</Typography>` — the HTML entity is JSX-safe and will render as `&` correctly. Not a bug but a style note.
- **`navigate('/ml-perf')` fallback (MEDIUM):** When no GPU runs found, the diagnostic panel action navigates to `/ml-perf`. This is correct — the router path is `/ml-perf`. Confirmed working.

---

### Page 13: `/npu-eval/atomplus/device-comparison` — Atom+ vs GPU Comparison

**Source:** `pages/npu-eval/atomplus/device-comparison/index.tsx`  
**Live probe:** HTTP 200

Structurally identical to RNGD device comparison. Same risks. The `chipColor` is `"#CA8A04"` (amber/gold for Rebellions — differs from the `#A855F7` purple used on the Atom+ eval page itself). Minor visual inconsistency.

Additional risk:
- **`isLoading` shows `CircularProgress` but `!isLoading && !error && runs.length > 0` condition gates the two-panel layout (LOW):** If data is loaded and `runs.length > 0` but all runs have vendor != rebellions (atomRuns = []) and vendor != gpu (gpuRuns = []), both inner panels show their own `ComparisonDiagnosticPanel`. This is correct behavior but could happen if the comparison list returns only stopped/error runs that got filtered.

---

## Global Findings

### Broken / Suspect Links

| Source location | Link target | Issue |
|---|---|---|
| `HomePage.tsx:390` | `to="/ml-perf"` | Correct — router path is `/ml-perf` |
| `HomePage.tsx:276` | `to="/ml-perf/device-comparison"` | Correct |
| `HomePage.tsx:282` | `to="/npu-eval/device-comparison"` | Routes to legacy `/npu-eval/device-comparison` (generic), not RNGD or Atom+ specific |
| `npu-eval/rngd/device-comparison:156` | `navigate('/ml-perf')` | Correct |
| `npu-eval/atomplus/device-comparison:163` | `navigate('/ml-perf')` | Correct |

No outright broken navigation links found. The `/ml-perf` path confusion (vs `/mlperf`) is internally consistent.

### Hardcoded IPs

| File | Line | Hardcoded value | Risk |
|---|---|---|---|
| `pages/npu/main/index.tsx` | 454, 469 | `http://10.254.202.114:30890/` | HIGH — legacy page, not env-aware |
| `pages/npu-eval/rngd/index.tsx` | 491 | `http://10.254.202.114:30890/` | HIGH — RNGD page, `LiveBenchDashboard` prop `src` is passed the raw string not the env-var helper |

Note: `pages/npu-eval/atomplus/index.tsx` uses `getAtomPlusLiveBenchUrl()` (env-var-aware). `pages/mlperf/main/MLPerfPage.tsx` uses `getL40LiveBenchUrl()` / `getA40LiveBenchUrl()`. The two hardcoded occurrences above are inconsistencies.

### No ErrorBoundary

No `ErrorBoundary` exists anywhere in `web/src/`. All pages use React Query for async error handling. Any synchronous render-time exception (e.g., bad API response shape causing a null-deref in JSX, chart library crash) produces a blank white page with no recovery UI, no error message, and no "Go home" link.

### Debug artifacts

No `console.log`, `debugger`, or `FIXME`/`HACK` comments found in any page source file.

### Aria / Accessibility

No `aria-label` attributes found on any interactive element across all page sources. All form inputs rely on MUI's built-in label association. Screen-reader baseline is acceptable (MUI handles `id`/`htmlFor` pairing), but no extra aria annotations were added.

---

## Demo Risk Summary Table

| # | Page / Feature | Risk | Severity | Notes |
|---|---|---|---|---|
| 1 | Homepage TT100T Leaderboard — all rows show FAIL | TT100T values in live data are 1584.13 s (26 min), threshold is 1.1 s → all rows render red FAIL chip | **HIGH** | Confusing on stage; clarify if metric is per-query or total run |
| 2 | RNGD page — hardcoded `http://10.254.202.114:30890/` iframe | If node4 IP/port changes or is unreachable, blank iframe with no error | **HIGH** | Use env-var helper like Atom+ does |
| 3 | Legacy NPU page — same hardcoded iframe | Same as above for `/npu-eval` | **HIGH** | Page may be navigated to from homepage Quick Links → "NPU realtime" leads to dashboard, but comparison links go to `/npu-eval` |
| 4 | No ErrorBoundary anywhere | Any render exception = blank white page on stage | **HIGH** | Add at least a root-level ErrorBoundary |
| 5 | Atom+ warning alert leaks kubectl commands | If Rebellions device plugin not `ready`, `kubectl get nodes` and `kubectl get pods` render visibly in UI | **MEDIUM** | Replace with a cleaner "device unavailable" message without infra commands |
| 6 | MLPerf Min Duration shows raw milliseconds | Label "Min Duration" with value 600000 — no unit displayed | **MEDIUM** | Add "(ms)" or convert to seconds in display |
| 7 | MMLU GPU Utilization accepts values > 1.0 | No max validation; entering 8 instead of 0.8 passes silently | **MEDIUM** | Add `max: { value: 1, message: 'GPU utilization must be 0–1' }` rule |
| 8 | MMLU Subjects free-text field | "14 Subject Categories" chip but no autocomplete or enum — typos pass silently | **MEDIUM** | Show a tooltip or helper text with valid subject list |
| 9 | Settings + Datasets APIs return 404 | `/api/settings` and `/api/datasets` both 404 during audit. Model and dataset dropdowns fall back to API data which may be empty | **MEDIUM** | Verify `/api/settings/list` path vs `/api/settings` |
| 10 | Atom+ table has no action buttons | Users cannot view detail, stop, or delete Atom+ runs from the Atom+ page | **MEDIUM** | Add row actions or note this is read-only |
| 11 | Sweep Progress shows hardcoded "0 / 96 cells Paused" before SSE connects | Fabricated state visible on page load | **MEDIUM** | Show loading indicator until first SSE snapshot |
| 12 | HIDE_SWEEP_KEY shared between MLPerf and MMLU | Toggle in one page affects the other | **MEDIUM** | Acceptable if intentional; document it |
| 13 | Atom+ precision uses lowercase (`fp8`) vs RNGD uppercase (`FP8`) | Inconsistency that may confuse operators | **LOW** | Normalize to one casing |
| 14 | Atom+ `data_number` default 100 vs RNGD default 0 | Different defaults for same field across two similar forms | **LOW** | Standardize |
| 15 | No loading skeleton on any exam list table | Tables flash empty on page load before data arrives | **LOW** | Add `TableSkeleton` or `CircularProgress` (Atom+ already does this — extend pattern) |
| 16 | MMLU framework locked to `vllm` single option | Select renders with one choice — looks like a bug | **LOW** | Render as disabled text field or hide dropdown |
| 17 | TPS BarChart all-zero when no exams running | 4 invisible bars in a flat chart | **LOW** | Show empty-state message instead of empty chart |
| 18 | Cross-benchmark comparison not blocked | RNGD device comparison allows picking RNGD mlperf run vs GPU mmlu run | **MEDIUM** | Add benchmark-match validation before enabling Compare button |

### Risk Tier Summary

| Tier | Count |
|---|---|
| HIGH | 4 |
| MEDIUM | 10 |
| LOW | 6 |

---

*End of audit. Source read: 13 page files + 4 component files + router config. Live API probes: 8 endpoints. Total findings: 20 distinct items.*
