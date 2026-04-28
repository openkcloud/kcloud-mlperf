# App Risk Register
**Generated:** 2026-04-28 | **Run ID:** 20260428-075351-71c9c77 | **Lane:** C/D/E/F/I (Backend + API + Benchmarks)

Entries are severity-sorted descending. Each entry is independently actionable.

---

## RISK-001 — No authentication or authorization on any backend endpoint
- **Severity:** Critical
- **Likelihood:** Likely
- **Fix Difficulty:** M
- **Category:** security
- **File:Line:** `server/src/main.ts:8`, all controllers
- **Description:** `main.ts` registers no Passport strategy, no `JwtAuthGuard`, and no `@UseGuards()` decorator appears anywhere in the codebase. Every endpoint — including destructive ones (`POST /api/gpu-sweep/start`, `PATCH /api/gpu-sweep/drain/:id`, `DELETE /api/mp-exam/delete/:id`) — is publicly reachable with zero credential check. CORS is `origin: '*'`. For the current internal-lab deployment this is accepted risk; for any public or shared-network exposure it is a critical breach surface.
- **Recommended Fix:** Add a `JwtStrategy` + `AdminRoleGuard`; gate at minimum the write/delete/sweep-start endpoints. Scope CORS to the known frontend origin.
- **Owner:** Backend

---

## RISK-002 — CORS wildcard allows any origin to mutate state
- **Severity:** Critical
- **Likelihood:** Likely
- **Fix Difficulty:** S
- **Category:** security
- **File:Line:** `server/src/main.ts:9-14`
- **Description:** `app.enableCors({ origin: '*', methods: '*', allowedHeaders: '*' })` means any browser tab on any origin can POST to the backend. Combined with RISK-001 (no auth), a simple CSRF-style page could drain or start a sweep.
- **Recommended Fix:** Restrict `origin` to the specific frontend URL (env var `FRONTEND_URL`). Keep wildcard only for local dev via `NODE_ENV` guard.
- **Owner:** Backend

---

## RISK-003 — GPU-sweep matrix produces 110 cells; plan target is 96 (correctness)
- **Severity:** High
- **Likelihood:** Likely
- **Fix Difficulty:** S
- **Category:** correctness
- **File:Line:** `server/src/gpu-sweep/matrix.fixture.ts:15`, `matrix.ts:41`
- **Description:** `FIXTURE_CELL_COUNT = 110` and the comment on line 13 explicitly states "NOTE: target is 96 once the full MMLU axis and remaining dedup are applied." The fixture file's own comment says "Currently 110 while Task #1 is in progress." The e2e spec `gpu-sweep.e2e-spec.ts:101` hard-codes `expect(res.body.cells).toHaveLength(96)` — this test will fail against the current matrix. The discrepancy is 14 cells: 20 DEDUP_KEYS are excluded but the post-trim count before dedup is 130 (not 116), so the 5×4 dedup groups only bring it to 110, not 96. The trim rules have not yet been completed.
- **Recommended Fix:** Complete the remaining trim/dedup rules so `expandMatrix()` yields exactly 96 cells, then update `FIXTURE_CELL_COUNT = 96`. Until then, the e2e preview test fails in CI.
- **Owner:** Backend / Benchmark

---

## RISK-004 — `OperatorRaceFailed` is a dispatch-error label, not actual post-launch race detection
- **Severity:** High
- **Likelihood:** Possible
- **Fix Difficulty:** M
- **Category:** reliability
- **File:Line:** `server/src/gpu-sweep/gpu-sweep.service.ts:388-404`, `server/src/realtime/realtime.service.ts:91-100`
- **Description:** The `catch` block in `dispatchCell()` logs `{ event: 'OperatorRaceFailed' }` for any dispatch error (gRPC failure, DB error, etc.) — not specifically for a k8s operator race condition. `RealtimeService.recordOperatorRaceFailed()` exists and is wired into `buildSnapshot()`, but it is never called from `GpuSweepService` after a dispatch failure. The `willRetry` variable is computed on line 388 but never used — no actual retry logic executes. The node mutex is cleared and the error is re-thrown, so a failed cell stays in `RACE_FAILED` state permanently with no recovery path.
- **Recommended Fix:** (a) Call `realtimeService.recordOperatorRaceFailed()` from the catch block. (b) Implement real retry logic using `willRetry`/`retry_num`. (c) Rename the event to a more precise label (e.g. `DISPATCH_ERROR`) and add a separate `OPERATOR_RACE` event when the k8s operator reports a resource conflict.
- **Owner:** Backend

---

## RISK-005 — SSE endpoint has no backpressure handling for slow clients
- **Severity:** High
- **Likelihood:** Possible
- **Fix Difficulty:** M
- **Category:** performance
- **File:Line:** `server/src/realtime/realtime.controller.ts:42-73`
- **Description:** The `@Sse('exams')` handler emits a new snapshot every 2 seconds via `interval(2000)`. There is a hard cap of 20 concurrent subscribers (line 15), and 503 is returned when the cap is reached. However, there is no per-client write-buffer limit or slow-client eviction: if a client's TCP receive window fills (e.g. a mobile browser on a slow link), Node.js will buffer `switchMap` emissions indefinitely until the process OOMs or the connection times out. The `takeUntil(done$)` only fires on `req.close`, which a stalled client never sends.
- **Recommended Fix:** Add a `timeout(5000)` operator on the inner observable, or use `bufferCount(1)` + `share()` to drop frames for lagging clients. Alternatively implement a write-deadline that closes the response if the socket is not drained within N seconds.
- **Owner:** Backend

---

## RISK-006 — `LokiService` uses `HttpModule` with default Axios config (no connection pool timeout)
- **Severity:** High
- **Likelihood:** Possible
- **Fix Difficulty:** S
- **Category:** performance
- **File:Line:** `server/src/loki/loki.module.ts:7`, `server/src/loki/loki.service.ts:25`
- **Description:** `HttpModule` is imported with no configuration options, so Axios uses its defaults: no `timeout`, no `maxSockets`, no `keepAlive`. Every call to `loki.instantQuery()` can open a new TCP connection to Loki and wait indefinitely. Both `mp-exam.service.ts:315` and `mm-exam.service.ts:307` call `lokiService.instantQuery()` on the hot path of `getExamStatus()` / `getMpExamStatus()` which are polled on a per-exam interval. Under 4 concurrent exams this is 4 unbounded connections per poll cycle.
- **Recommended Fix:** Configure `HttpModule.register({ timeout: 5000, maxRedirects: 2 })` in `loki.module.ts`. Add `axios-retry` or a circuit-breaker for Loki unavailability (the fallback already returns empty results, so adding a short-circuit is low risk).
- **Owner:** Backend

---

## RISK-007 — `MmExamService.ensureResultAccMathColumn()` performs DDL on every module init
- **Severity:** High
- **Likelihood:** Likely
- **Fix Difficulty:** S
- **Category:** reliability
- **File:Line:** `server/src/mm-exam/mm-exam.service.ts:450-482`
- **Description:** On every `OnModuleInit`, the service opens a raw `QueryRunner`, queries `information_schema.columns`, and conditionally runs `ALTER TABLE mm_exam_result ADD COLUMN`. This is an ad-hoc schema migration executed outside the TypeORM migration pipeline. It will run on every pod restart (including rolling deploys and crash-loops). If two pods start simultaneously, both will check `columnExists` and both may attempt the `ALTER TABLE` concurrently, causing a duplicate-column error. There is no transaction or DDL lock.
- **Recommended Fix:** Remove this code and express the column addition as a proper TypeORM migration (e.g. `1714276800001-add-result-acc-math.ts`). Migration files run exactly once under a lock.
- **Owner:** Backend / DB

---

## RISK-008 — `mp-exam-result.service.ts` writes results outside any database transaction
- **Severity:** High
- **Likelihood:** Possible
- **Fix Difficulty:** M
- **Category:** correctness
- **File:Line:** `server/src/mp-exam-result/mp-exam-result.service.ts:193-248`
- **Description:** `create()` iterates repeat counts 1…N, calling `extractSummaryData()` (reads NFS file), then `mpExamResultRepo.findOne()` + either `update()` or `mpExamResultRepo.save()` per iteration — all outside a transaction. If the process is killed or NFS becomes unavailable mid-loop, some repeat-count rows will be saved and others will not, leaving a partially-written result set with no rollback. The same pattern exists in `mm-exam-result.service.ts:147-183`.
- **Recommended Fix:** Wrap the entire loop in a TypeORM `manager.transaction()`. Use `queryRunner.startTransaction()` / `commitTransaction()` / `rollbackTransaction()`.
- **Owner:** Backend

---

## RISK-009 — NFS result volume: no full-disk guard; `ENOSPC` will silently corrupt results
- **Severity:** High
- **Likelihood:** Possible
- **Fix Difficulty:** M
- **Category:** reliability
- **File:Line:** `server/src/mp-exam-result/mp-exam-result.service.ts:160`, `server/src/mm-exam-result/mm-exam-result.service.ts:130`
- **Description:** Both result services read benchmark output files from `process.cwd()/mnt/result/`. If the underlying NFS volume fills (`ENOSPC`), the benchmark job will silently write a truncated or empty `mlperf_log_summary.txt` / `summary.txt`. The result parsers (`parseSummaryData`, `parseSummary`) will then produce all-null or all-zero metric rows that are stored as valid results with no error flag. There is no pre-write disk-space check and no post-parse validation that at least one metric field is non-null.
- **Recommended Fix:** After parsing, assert that at least `result_perf_tps` (mlperf) or `result_acc_total` (mmlu) is non-null; if not, throw rather than persisting zeros. Add a Prometheus/Grafana disk-usage alert on the NFS PVC.
- **Owner:** Infrastructure / Backend

---

## RISK-010 — `CreateMpExamDto` and `CreateMmExamDto` have fields missing `@IsNotEmpty()` guards
- **Severity:** Medium
- **Likelihood:** Possible
- **Fix Difficulty:** S
- **Category:** correctness
- **File:Line:** `server/src/mp-exam/dto/create-mp-exam.dto.ts`, `server/src/mm-exam/dto/create-mm-exam.dto.ts`
- **Description:** Several string fields use only `@IsString()` + `@Length(1, N)` but no `@IsNotEmpty()`. `description` in `CreateMpExamDto` allows an empty string (`@Length(0, 500)`) and has no `@IsOptional()`, so a missing key triggers a validation error but an explicit empty string passes. `device_type` is `@IsOptional()` but its `@Length(1, 10)` means an empty string would fail if supplied — confusing semantics. `gpu_util` in `CreateMmExamDto` uses `@IsNumber()` + `@Min(0)` but no `@Max(1)` guard, allowing `gpu_util: 999`.
- **Recommended Fix:** Add `@IsOptional()` to `description`. Add `@Max(1)` to `gpu_util`. Audit all `@Length(0, N)` fields and mark them `@IsOptional()` or add `@MinLength(1)`.
- **Owner:** Backend

---

## RISK-011 — `activeSweepId` is in-memory only; lost on pod restart, blocking new sweeps
- **Severity:** Medium
- **Likelihood:** Possible
- **Fix Difficulty:** M
- **Category:** reliability
- **File:Line:** `server/src/gpu-sweep/gpu-sweep.service.ts:72`, `server/src/gpu-sweep/gpu-sweep.service.ts:563-575`
- **Description:** `activeSweepId` and `nodeMutex` are plain instance variables. If the NestJS pod restarts while a sweep is in progress, the new instance has `activeSweepId = null` and both nodes show `busy: false`. Calls to `pauseActiveSweep()` / `drainActiveSweep()` will throw `BadRequestException('No active sweep')` even though the DB contains a `RUNNING` sweep. The queue runner is also lost, so the sweep stalls silently.
- **Recommended Fix:** On `OnModuleInit`, query for any `RUNNING` sweep and restore `activeSweepId` and node mutex state from the DB. Consider persisting `nodeMutex` state to Redis or a DB column.
- **Owner:** Backend

---

## RISK-012 — `MpExamService.create()` and `MmExamService.create()` swallow gRPC errors as `RpcException`
- **Severity:** Medium
- **Likelihood:** Possible
- **Fix Difficulty:** S
- **Category:** reliability
- **File:Line:** `server/src/mp-exam/mp-exam.service.ts:295-300`, `server/src/mm-exam/mm-exam.service.ts:283-288`
- **Description:** Both `create()` methods catch all errors and re-throw as `RpcException({ code, message })`. However, the controllers use plain HTTP (not microservice transport), so `RpcException` is not automatically mapped to an HTTP status code by NestJS's exception layer — callers receive a 500 with an unexpected payload shape instead of a meaningful 4xx/5xx. The DB row is already saved before the gRPC call, so a gRPC failure leaves an orphaned `IDLE` exam in the DB.
- **Recommended Fix:** Use `HttpException` (or rethrow as `ServiceUnavailableException`) in `create()`. Add a compensating delete of the DB row if `createGrpcExam()` fails.
- **Owner:** Backend

---

## RISK-013 — `buildSnapshot()` performs 3 DB queries + N result queries on every SSE tick (2s)
- **Severity:** Medium
- **Likelihood:** Possible
- **Fix Difficulty:** M
- **Category:** performance
- **File:Line:** `server/src/realtime/realtime.service.ts:103-238`
- **Description:** Every 2 seconds per connected client, `buildSnapshot()` runs: `mpExamRepo.find()`, `mmExamRepo.find()`, `mpResultRepo.createQueryBuilder().getMany()`, then 4 `Promise.all` slot lookups, plus a `gpuSweepService.getStatus()` call (which itself does a `sweepRepo.findOne()`). With 20 max subscribers this is potentially 20 × (4+ queries) = 80+ DB queries per 2-second window. Under a 30-minute soak with 110 cells running, this will become a DB hotspot.
- **Recommended Fix:** Add a 2-second server-side cache (shared across all subscribers) for `buildSnapshot()`. All 20 SSE subscribers can share one snapshot per tick rather than each triggering their own DB round-trip.
- **Owner:** Backend

---

## RISK-014 — `grpc-client.module.ts` has no reconnect or deadline configuration
- **Severity:** Medium
- **Likelihood:** Possible
- **Fix Difficulty:** S
- **Category:** reliability
- **File:Line:** `server/src/grpc-client/grpc-client.module.ts:8-22`
- **Description:** The gRPC client is registered with only `url`, `package`, and `protoPath`. No `channelOptions` are set, so gRPC uses default keep-alive settings (disabled) and no deadline per RPC. Long-running exam status polls (`getMpGrpcExamStatus`, `getGrpcExamStatus`) will hang indefinitely if the operator is unresponsive, blocking the NestJS event loop thread.
- **Recommended Fix:** Add `channelOptions: { 'grpc.keepalive_time_ms': 30000, 'grpc.keepalive_timeout_ms': 5000 }`. Wrap all `lastValueFrom(observable)` calls with an RxJS `timeout(10000)` operator.
- **Owner:** Backend / Infrastructure

---

## RISK-015 — `IS_SUMMARY_FILE_TESTING` env var can redirect result reads to a hardcoded exam ID in production
- **Severity:** Medium
- **Likelihood:** Unlikely
- **Fix Difficulty:** S
- **Category:** correctness
- **File:Line:** `server/src/mp-exam-result/mp-exam-result.service.ts:291-294`, `server/src/mm-exam-result/mm-exam-result.service.ts:118-120`
- **Description:** If `IS_SUMMARY_FILE_TESTING=true` leaks into a non-test environment, all result reads are redirected to `examId=49` (mlperf) or `MMLU_EXAM_ID_1` env var. This would silently overwrite real benchmark results with data from the test fixture exam. There is no guard preventing this from being set in a production deployment.
- **Recommended Fix:** Remove the `IS_SUMMARY_FILE_TESTING` branch from production service code; use Jest module mocking or fixture injection in tests instead.
- **Owner:** Backend

---

## RISK-016 — `console.log` / `console.error` used extensively instead of NestJS `Logger`
- **Severity:** Low
- **Likelihood:** Likely
- **Fix Difficulty:** S
- **Category:** reliability
- **File:Line:** `mp-exam.service.ts:87,121,229,414,448`, `mm-exam.service.ts:90,124,224,403,437,467,472,474`
- **Description:** ~15 `console.log` / `console.error` calls in production service code bypass the NestJS structured logger. Log lines do not carry the service context, correlation IDs, or log level metadata that operators need when triaging issues in Loki/Grafana. Emoji characters (`🚀`, `⏳`) in log lines break some log parsers.
- **Recommended Fix:** Replace all `console.*` calls with `this.logger.*` (`Logger` from `@nestjs/common`). Remove emoji from log strings.
- **Owner:** Backend

---

## RISK-017 — `MmExamService.stopMmExam` method is absent; `drain()` casts to `unknown` to call it
- **Severity:** Low
- **Likelihood:** Possible
- **Fix Difficulty:** S
- **Category:** correctness
- **File:Line:** `server/src/gpu-sweep/gpu-sweep.service.ts:527-531`
- **Description:** `drain()` calls `(this.mmExamService as unknown as { stopMmExam: ... }).stopMmExam(cell.exam_id)` — an unsafe runtime cast. `MmExamService` exposes `stop(id)` not `stopMmExam(id)`. This call will throw `TypeError: this.mmExamService.stopMmExam is not a function` at runtime when draining an MMLU cell that has an `exam_id`. The error is caught and logged as a warning, so drain completes, but the Kubernetes job is never cancelled.
- **Recommended Fix:** Call `this.mmExamService.stop(cell.exam_id)` directly (the method exists). Remove the unsafe cast.
- **Owner:** Backend

