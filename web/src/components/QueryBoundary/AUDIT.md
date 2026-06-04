# QueryBoundary Audit

All `useQuery` callsites discovered in `web/src/` as of this audit.

| Page / Component | File | Hook | QueryBoundary |
|---|---|---|---|
| MLPerf list table | `pages/mlperf/main/exam-table/index.tsx` | `useMpExamResultList` | ✓ wrapped (via `useMpExamResultList`) |
| MLPerf list table | `pages/mlperf/main/exam-table/index.tsx` | `useMpExamResultsList` | ✓ wrapped (via `useMpExamResultsList`) |
| MMLU list table | `pages/mmlu/main/exam-table/index.tsx` | `useMmExamResultList` | ✓ wrapped (via `useMmExamResultList`) |
| MLPerf device comparison | `pages/mlperf/device-comparison/index.tsx` | `ComparisonApi.list` (mlperf) | ✓ wrapped |
| MMLU device comparison | `pages/mmlu/device-comparison/index.tsx` | `ComparisonApi.list` (mmlu) | ✓ wrapped |
| NPU device comparison | `pages/npu/device-comparison/index.tsx` | `ComparisonApi.list` | ✓ wrapped (2026-05-11) |
| NPU eval RNGD | `pages/npu-eval/rngd/index.tsx` | `useQuery` | ✓ wrapped (2026-05-11) |
| NPU eval AtomPlus device-comparison | `pages/npu-eval/atomplus/device-comparison/index.tsx` | `useQuery` | ✓ wrapped (2026-05-11) |
| NPU eval RNGD device-comparison | `pages/npu-eval/rngd/device-comparison/index.tsx` | `useQuery` | ✓ wrapped (2026-05-11) |
| GPU realtime | `pages/dashboard/gpu-realtime/index.tsx` | `useDeviceRegistry` (indirect) | ⏳ deferred — dashboard uses WebSocket/SSE not standard `useQuery`; has dedicated error rendering |
| NPU realtime | `pages/dashboard/npu-realtime/index.tsx` | `useDeviceRegistry` (indirect) | ⏳ deferred — same as GPU realtime |
| Sweep control | `pages/dashboard/sweep-control/index.tsx` | `useQuery` | ⏳ deferred — specialised sweep UI |
| MLPerf test result | `pages/mlperf/test-result/TestResultPage.tsx` | `useTestResult` | ⏳ deferred — page has full custom loading/error layout |
| MMLU test result | `pages/mmlu/test-result/TestResultPage.tsx` | `useMmExamTestResult` | ⏳ deferred — page has full custom loading/error layout |
| MLPerf comparison page | `pages/mlperf/test-comparison/ComparisonPage.tsx` | `useTestDetails` | ⏳ deferred — returns null guards, dedicated layout |
| MMLU comparison page | `pages/mmlu/test-comparison/TestComparisonPage.tsx` | `useMmExamTestDetails` | ⏳ deferred — returns null guards, dedicated layout |
| ComparisonCandidatePicker | `components/ComparisonCandidatePicker/index.tsx` | `useQuery` | ⏳ deferred — small inline widget with own spinner |
| JobStatusFooter | `components/JobStatusFooter/index.tsx` | `useQuery` | ⏳ deferred — footer-level, silent polling |
| GPU model hook | `hooks/useGpuModel.ts` | `useQuery` | ⏳ deferred — utility hook, callers manage state |
| Datasets list hook | `hooks/useDatasetsList.ts` | `useQuery` | ⏳ deferred — utility hook, callers manage state |
| Models list hook | `hooks/useModelsList.ts` | `useQuery` | ⏳ deferred — utility hook, callers manage state |
| Settings list hook | `hooks/useSettingsList.ts` | `useQuery` | ⏳ deferred — utility hook, callers manage state |
| Exam form GPU list (MLPerf) | `pages/mlperf/main/exam-form/useGpuList.ts` | `useQuery` | ⏳ deferred — dropdown data, silent |
| Exam form GPU list (MMLU) | `pages/mmlu/main/exam-form/useGpuList.ts` | `useQuery` | ⏳ deferred — dropdown data, silent |
| ExamStatusBadge (MLPerf) | `pages/mlperf/main/components/ExamStatusBadge/useExamStatus.ts` | `useQuery` | ⏳ deferred — per-row polling badge, no boundary needed |
| ExamStatusBadge (MMLU) | `pages/mmlu/main/components/ExamStatusBadge/useExamStatus.ts` | `useQuery` | ⏳ deferred — per-row polling badge, no boundary needed |
| DeleteConfirmModal (MLPerf) | `pages/mlperf/main/components/DeleteConfirmModal/index.tsx` | `useQuery` | ⏳ deferred — modal with local state |
| DeleteConfirmModal (MMLU) | `pages/mmlu/main/components/DeleteConfirmModal/index.tsx` | `useQuery` | ⏳ deferred — modal with local state |
| MLPerf AccuracyExamGraph | `pages/mlperf/test-result/components/AccuracyExamGraph.tsx` | `useQuery` | ⏳ deferred — graph component, inline loading |
| MLPerf PerformanceExamGraph | `pages/mlperf/test-result/components/PerformanceExamGraph.tsx` | `useQuery` | ⏳ deferred — graph component, inline loading |
| MLPerf AverageAccuracyExamGraph | `pages/mlperf/test-result/components/AverageAccuracyExamGraph.tsx` | `useQuery` | ⏳ deferred — graph component, inline loading |
| MLPerf AveragePerformanceExamGraph | `pages/mlperf/test-result/components/AveragePerformanceExamGraph.tsx` | `useQuery` | ⏳ deferred — graph component, inline loading |
| MLPerf PerformanceComparisonGraph | `pages/mlperf/test-comparison/components/PerformanceComparisonGraph.tsx` | `useQuery` | ⏳ deferred — graph component, inline loading |
| MLPerf AccuracyComparisonGraph | `pages/mlperf/test-comparison/components/AccuracyComparisonGraph.tsx` | `useQuery` | ⏳ deferred — graph component, inline loading |
| NPU main page | `pages/npu/main/index.tsx` | `useQuery` | ✓ wrapped (2026-05-11) |
| Home page | `pages/home/HomePage.tsx` | `useQuery` | ✓ wrapped (2026-05-11) — VendorCluster + Tt100tLeaderboard |

## Wrapped pages (✓)

1. `pages/mlperf/main/exam-table` — MLPerf list table uses `useMpExamResultList` + `useMpExamResultsList`; both wrapped via `QueryBoundary`
2. `pages/mmlu/main/exam-table` — MMLU list table uses `useMmExamResultList`; wrapped via `QueryBoundary`
3. `pages/mlperf/device-comparison` — MLPerf cross-device comparison list; wrapped via `QueryBoundary`
4. `pages/mmlu/device-comparison` — MMLU cross-device comparison list; wrapped via `QueryBoundary`

## Deferred rationale

- Utility hooks (`useGpuList`, `useDatasetsList`, etc.) are consumed by multiple callers; the boundary belongs at the callsite, and those callers already handle empty states through form validation.
- Per-row polling badges (`useExamStatus`) emit no user-visible error; suppressing them avoids noise.
- Full-page comparison/result pages have bespoke layouts (multi-panel, chart grids) that do not reduce cleanly to a single `QueryBoundary`; they are candidates for a future per-section boundary refactor.
- WebSocket/SSE-backed pages (`DeviceRealtimeDashboard`) are not `useQuery` consumers — they use `useDeviceRegistry` which has its own loading/error returns handled in the component.
