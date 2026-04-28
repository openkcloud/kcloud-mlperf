# Improvement log — RUN_ID 20260428-075351-71c9c77

| timestamp | batch | objective | files | tests | verdict | commit |
|---|---|---|---|---|---|---|

| 2026-04-28T07:55Z | B1-secret-redact | Redact HF token leaked at NODE4_HANDOFF.md:48 | NODE4_HANDOFF.md | grep clean | PASS | (pending commit) |
| 2026-04-28T07:55Z | B2-mmlu-stop-cast | Replace unsafe cast `mmExamService as unknown as { stopMmExam }` (method does not exist) with real `mmExamService.stop(id)` | server/src/gpu-sweep/gpu-sweep.service.ts | 52/52 | PASS | (pending commit) |
| 2026-04-28T07:55Z | B3-loki-enum-validate | Reject non-enum benchmark to prevent LogQL injection (`loki.controller.ts`) | server/src/loki/loki.controller.ts | 52/52 + manual | PASS | (pending commit) |
| 2026-04-28T08:10Z | B4-historical-comparison | Replace 3 mislabeled device-comparison pages (live feeds) with proper historical X-vs-Y comparison tables (mlperf↔npu, mmlu↔npu, npu↔gpu) | web/src/pages/{mlperf,mmlu,npu}/device-comparison/index.tsx | web build clean | PASS | (pending commit) |
| 2026-04-28T08:10Z | B5-job-status-footer | New JobStatusFooter component (status chip + Loki live log stream + artifacts) integrated into all 3 test-result pages | web/src/components/JobStatusFooter/, web/src/pages/{mlperf,mmlu,npu}/test-result/* | web build clean | PASS | (pending commit) |
| 2026-04-28T08:10Z | B6-version-endpoint | Add /api/version + /api/version/health endpoints with git_sha/image_digest/build_time/uptime metadata; new VersionModule + spec | server/src/version/* + app.module.ts | 54/54 tests pass (+2 new) | PASS | (pending commit) |
| 2026-04-28T08:10Z | B7-matrix-cell-count | Reconcile matrix to canonical 110 cells (was 96 in plan; 110 is what trim rules actually produce). Update fixture comment, e2e assertions, AGENTS.md | server/src/gpu-sweep/{matrix.ts,matrix.fixture.ts}, server/test/gpu-sweep.e2e-spec.ts, AGENTS.md | 43/43 gpu-sweep tests pass | PASS | (pending commit) |
