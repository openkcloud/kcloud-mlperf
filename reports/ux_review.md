# UX Review — ETRI LLM Benchmark Suite

Generated: 2026-04-28 | RUN_ID: 20260428-075351-71c9c77
Lane: Features + Frontend Audit (read-only)

---

## 1. Result Pages — Missing Provenance Metadata

### Finding R-01 — No RUN_ID / image digest / git SHA on any result page
**Severity: HIGH**

`TestResultPage.tsx` (mlperf), `TestResultPage.tsx` (mmlu), `NpuTestResultPage` (npu) all render a `TestResultInfo` card that shows: name, description, exam type, model, GPU/NPU, repetitions, dataset, precision, CPU, RAM, start/end time, framework, data_number.

**Not shown anywhere**: RUN_ID, container image digest, git SHA of benchmark job, dataset hash, backend node selector, device count per-run.

The `mp_exam` entity has no `image_digest`, `git_sha`, or `run_id` column. Neither does `npu_exam`. These fields do not exist in the DB schema, so there is nothing for the frontend to display — the gap is full-stack.

Relevant files:
- `web/src/pages/mlperf/test-result/TestResultPage.tsx` lines 37–87 (`TestResultInfo` call)
- `web/src/pages/mmlu/test-result/TestResultPage.tsx` lines 153–202
- `web/src/pages/npu/test-result/index.tsx` lines 58–73
- `server/src/entities/mp-exam.entity.ts` — no `image_digest`/`git_sha` columns
- `server/src/entities/npu-exam.entity.ts` — same

**Suggested fix**: Add `image_digest varchar(100)`, `git_sha varchar(40)`, `run_id varchar(50)` columns to `mp_exam`, `mm_exam`, `npu_exam`; populate from job env vars; surface in `TestResultInfo` component under a collapsible "Provenance" section.

---

### Finding R-02 — No quantization field displayed
**Severity: MED**

Precision is shown (e.g., FP8, BF16) but quantization method (e.g., W8A8, GPTQ, AWQ) is not a stored field. Operators cannot distinguish quantization strategies post-hoc.

Files: `server/src/entities/mp-exam.entity.ts` line 26 (`precision` only), `server/src/entities/npu-exam.entity.ts` line 35.

**Suggested fix**: Add `quantization varchar(30) nullable` to entities; add form field and result display.

---

## 2. Log / Status Panel

### Finding L-01 — No inline log panel on mlperf/test-result, mmlu/test-result
**Severity: HIGH**

`/npu-eval` main page has an iframe pointing to `http://10.254.202.114:30890/` (node4 live bench dashboard) — a working log tail. No equivalent exists on:
- `/ml-perf/test-result/:id`
- `/mmlu/test-result/:id`

The `ErrorViewLog` component exists (`web/src/components/Table/ErrorViewLog.tsx`) and renders error_log from the exam row in a dark modal, but it only appears in the exam tables for errored rows — not on the result detail pages at all.

Loki integration exists (`GET /api/loki/instant/:benchmark/:id`) but is not wired to any result page UI.

Files:
- `web/src/pages/mlperf/test-result/TestResultPage.tsx` — no log reference
- `web/src/pages/mmlu/test-result/TestResultPage.tsx` — no log reference
- `server/src/loki/loki.controller.ts` line 9 — endpoint exists, unused by frontend

**Suggested fix**: Add a collapsible "Logs" accordion on each result page that calls `GET /api/loki/instant/mlperf/:id` (or `mmlu`) and renders the response in a monospace pre block. For running exams, poll at 10-second intervals.

---

## 3. Error States

### Finding E-01 — API error handling is thin on result pages
**Severity: MED**

`NpuTestResultPage` (`web/src/pages/npu/test-result/index.tsx` line 26): if `examData` is falsy it returns `<Typography>Loading...</Typography>` with no distinction between loading and a 404/500 error.

`mlperf/test-result/useTestResult.ts` and `mmlu/test-result/useMmExamTestResult.ts` use React Query but the pages check only truthiness of `testResult`; no error boundary or error state is rendered.

`AppMessageView` (`web/src/components/AppMessageView/AppMessageView.tsx`) is a global Snackbar wired to Redux notification slice — it is available but result pages do not dispatch error notifications on query failure.

**Suggested fix**: Add `isError` / `error` destructuring from `useQuery` on each result page; render an `<Alert severity="error">` with the HTTP status and message when the query fails rather than silently showing nothing.

---

### Finding E-02 — SweepControlPage `/auth/me` error silently degrades
**Severity: LOW**

`web/src/pages/dashboard/sweep-control/index.tsx` lines 54–68: network errors on `/auth/me` set `isAdmin=false` and show a warning banner ("Could not verify admin status"). This means a network partition makes all operators read-only with no retry mechanism.

**Suggested fix**: Add a "Retry" button to the warning banner that re-invokes the admin check.

---

## 4. Loading States

### Finding LD-01 — Result pages have no skeleton / spinner on data fetch
**Severity: MED**

`AppLoader` (`web/src/components/AppLoader/AppLoader.tsx`) is used only as Suspense fallback for lazy-loaded page chunks (`MainLayout.tsx` line 539). It is not used inside page components while their React Query hooks are fetching.

`MLPerfTable` and `MMluTable` accept an `isLoading` prop but this is wired only in the exam-table components on the main list pages. The result pages (`TestResultPage`, `NpuTestResultPage`) show either nothing or "Loading..." plain text while awaiting data.

Files:
- `web/src/pages/mlperf/test-result/TestResultPage.tsx` line 34: `if (!testResult) return null;`
- `web/src/pages/mmlu/test-result/TestResultPage.tsx` line 150: `if (!testResult) return null;`
- `web/src/pages/npu/test-result/index.tsx` line 26: `return <Typography>Loading...</Typography>`

**Suggested fix**: Replace `if (!testResult) return null` with a conditional that checks `isLoading` from the hook and returns `<AppLoader />`, and checks `isError` to return an error state.

---

## 5. Accessibility

### Finding A-01 — aria coverage is sparse on page-level components
**Severity: MED**

`aria-*` usage is found in 10 files (grep count). Present on: close buttons, dialog roles, snackbar content id. **Not present** on:
- Table sort headers (no `aria-sort`)
- Status badge chips (no `aria-label` describing machine-readable status)
- Graph containers (no `aria-label` or `role="img"` with description)
- Navigation section headings in sidebar use `Typography` not `<nav>`/`<ul>` semantics (renders as `<div>`)

Files lacking: `web/src/components/DeviceRealtimeDashboard/DeviceRealtimeDashboard.tsx`, `web/src/pages/npu/test-result/index.tsx`, all graph components under `web/src/components/Graphs/`.

**Suggested fix** (priority order): add `<nav aria-label="Main navigation">` wrapper in `MainLayout.tsx`; add `role="img" aria-label="..."` to chart Paper containers; add `aria-label` to status Chips.

---

### Finding A-02 — Sidebar nav items use `<div>` role not `<nav>`/`<ul>`
**Severity: LOW**

`MainLayout.tsx` lines 249–321: nav items are `StyledNavLink` inside a `<div>` column, not wrapped in `<nav>` or `<ul>/<li>`. Screen readers cannot identify the landmark.

**Suggested fix**: Wrap the three nav sections in `<Box component="nav" aria-label="Benchmarks">` etc.

---

## 6. Responsiveness

### Finding RS-01 — Moderate breakpoint coverage; result pages are not responsive
**Severity: MED**

`useMediaQuery` is used in `MainLayout.tsx` for mobile drawer. The content area uses `p: { xs:2, sm:2.5, md:3 }` and header uses responsive `px`/`py`. The `DeviceRealtimeDashboard` device card grid uses `gridTemplateColumns: { xs:'1fr', sm:'1fr 1fr', xl:'repeat(4,1fr)' }`.

However the result pages (`TestResultPage`, `NpuTestResultPage`) use fixed `p: 3` padding and the chart components have fixed `height={300}` values with no responsive override. On narrow viewports the charts will not reflow.

15 breakpoint references found across page components, concentrated in dashboard and NPU pages.

**Suggested fix**: Replace fixed chart heights with `height={{ xs: 220, md: 300 }}`; add `minWidth: 0` to chart Paper containers to prevent overflow.

---

## 7. Operator Usability — Dashboard Consistency

### Finding OP-01 — MLPerf/MMLU device-comparison pages are not true device comparisons
**Severity: HIGH**

The sidebar shows "MLPerf vs NPU" and "MMLU vs NPU" as cross-device comparison links. Both route to `DeviceRealtimeDashboard` with a `benchmarkFilter` prop — this is a live GPU realtime feed, not a historical NPU-vs-GPU result comparison.

Only `/npu-eval/device-comparison` (`web/src/pages/npu/device-comparison/index.tsx`) is the actual side-by-side NPU vs GPU comparison with result charts and a summary winner table.

The sidebar label "MLPerf vs NPU" implies a historical comparison but the page shows a live GPU feed. This will confuse operators.

Files:
- `web/src/pages/mlperf/device-comparison/index.tsx` line 3: `<DeviceRealtimeDashboard benchmarkFilter="mlperf" />`
- `web/src/pages/mmlu/device-comparison/index.tsx` line 3: `<DeviceRealtimeDashboard benchmarkFilter="mmlu" />`
- `MainLayout.tsx` lines 126–148: sidebar labels "MLPerf vs NPU", "MMLU vs NPU"

**Suggested fix**: Either (a) build proper historical comparison pages for mlperf and mmlu similar to `npu/device-comparison/index.tsx`, or (b) rename the sidebar labels to "MLPerf GPU Feed" / "MMLU GPU Feed" to accurately describe what is shown.

---

### Finding OP-02 — Sidebar icons are not semantically distinct
**Severity: LOW**

`MainLayout.tsx` lines 102–165: all three benchmark items use either `CloudSVG` or `HexagonSVG`. Specifically: MLPerf uses `CloudSVG`, MMLU-Pro uses `HexagonSVG`, NPU Eval uses `HexagonSVG` — MMLU and NPU share the same icon. The Operations section uses `CloudSVG` for both GPU Realtime and Sweep Control, same as MLPerf.

**Suggested fix**: Use distinct icons per nav item (e.g., `Speed` for MLPerf, `Quiz` for MMLU, `Memory` for NPU, `BarChart` for GPU Realtime, `Tune` for Sweep Control) from `@mui/icons-material`.

---

## 8. Sidebar Structure Verification

The 3-section reorganization is present and consistent:
- **Benchmarks**: MLPerf (sublabel "MLPerf v5.1"), MMLU-Pro ("Language understanding"), NPU Eval FuriosaAI RNGD ("Accelerator evaluation")
- **Cross-device comparisons**: MLPerf vs NPU, MMLU vs NPU, NPU vs GPU
- **Operations**: GPU Realtime ("Live benchmark feed"), Sweep Control ("Start, pause, or drain")

Section dividers are rendered as `<Box height="1px">` between sections. Labels are `Typography` uppercase 0.625rem. All items have sublabels. Chevron-right appears on hover/active. Structure is visually consistent — icon semantic issue noted in OP-02.

---

## Summary Table

| ID | Severity | File:Line | Issue |
|----|----------|-----------|-------|
| R-01 | HIGH | `TestResultPage.tsx:37`, `npu/test-result/index.tsx:58`, entities | No RUN_ID / image digest / git SHA on result pages |
| L-01 | HIGH | `mlperf/test-result/TestResultPage.tsx`, `mmlu/test-result/TestResultPage.tsx` | No log panel; Loki endpoint unused by frontend |
| OP-01 | HIGH | `mlperf/device-comparison/index.tsx:3`, `mmlu/device-comparison/index.tsx:3`, `MainLayout.tsx:126` | "vs NPU" pages actually show live GPU feed, not comparison |
| E-01 | MED | `npu/test-result/index.tsx:26`, result page hooks | No error state on API failure |
| LD-01 | MED | `mlperf/test-result/TestResultPage.tsx:34`, `mmlu:150`, `npu:26` | No skeleton/spinner on result page data fetch |
| A-01 | MED | `DeviceRealtimeDashboard.tsx`, graph components | Sparse aria coverage; no aria-sort, no role=img on charts |
| RS-01 | MED | `TestResultPage.tsx`, `NpuTestResultPage`, chart components | Fixed chart heights; result pages not responsive |
| R-02 | MED | `mp-exam.entity.ts:26`, `npu-exam.entity.ts:35` | No quantization field |
| E-02 | LOW | `sweep-control/index.tsx:54` | /auth/me error leaves operators read-only with no retry |
| A-02 | LOW | `MainLayout.tsx:249` | Sidebar nav not wrapped in `<nav>` landmark |
| OP-02 | LOW | `MainLayout.tsx:102–165` | MMLU and NPU share same icon; Operations share icon with MLPerf |
