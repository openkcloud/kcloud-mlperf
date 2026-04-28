# Improvement Backlog
**Generated:** 2026-04-28 | **Run ID:** 20260428-075351-71c9c77

Batches are ordered by `value × safety / effort` descending.
SAFE TO RUN THIS SESSION = LOW risk + small files + no DB schema change.

---

## Batch 1 — Fix `stopMmExam` unsafe cast in `drain()` [SAFE TO RUN THIS SESSION]

**Objective:** Replace the `(this.mmExamService as unknown as { stopMmExam })` runtime cast with a direct call to the existing `stop(id)` method so draining MMLU cells actually cancels the Kubernetes job.

**Files Affected:**
- `server/src/gpu-sweep/gpu-sweep.service.ts` (lines 527–531)

**Risk Level:** LOW

**Expected Behavior Change:** MMLU cells with an `exam_id` are properly stopped on drain; the Kubernetes CRD deletion RPC fires instead of silently failing.

**Tests to Run:**
```
cd server && npx jest gpu-sweep.service.spec --testNamePattern="drain"
cd server && npx jest gpu-sweep.e2e-spec --testNamePattern="drain"
```

**Rollback Plan:** Revert the single-line change; the unsafe cast restores previous behavior.

**Acceptance Criteria:**
- `drain()` unit test passes with a mock `MmExamService` that exposes `stop()`.
- The e2e drain spec returns status `Drained` for a sweep containing an MMLU cell.

---

## Batch 2 — Reconcile GPU-sweep matrix cell count (110 → 96) [SAFE TO RUN THIS SESSION]

**Objective:** Complete the remaining trim/dedup rules so `expandMatrix()` yields exactly 96 cells and update `FIXTURE_CELL_COUNT = 96`. This also fixes the failing e2e assertion `expect(res.body.cells).toHaveLength(96)`.

**Files Affected:**
- `server/src/gpu-sweep/matrix.ts` (trim rules / DEDUP_KEYS)
- `server/src/gpu-sweep/matrix.fixture.ts` (`FIXTURE_CELL_COUNT`)

**Risk Level:** LOW

**Expected Behavior Change:** `GET /api/gpu-sweep/preview` returns 96 cells; CI matrix snapshot test passes.

**Tests to Run:**
```
cd server && npx jest matrix.fixture.spec
cd server && npx jest gpu-sweep.e2e-spec --testNamePattern="preview"
```

**Rollback Plan:** Revert `matrix.ts` trim additions and reset `FIXTURE_CELL_COUNT = 110`.

**Acceptance Criteria:**
- `matrix.fixture.spec` passes with count 96.
- All existing trim-rule invariant tests still pass (TP=2, fp8+bs4+A40, server@bs4, etc.).

---

## Batch 3 — Add backend DTO validation gaps (`gpu_util` max, `description` optional) [SAFE TO RUN THIS SESSION]

**Objective:** Close the three identified class-validator gaps: add `@Max(1)` to `CreateMmExamDto.gpu_util`; add `@IsOptional()` to `CreateMpExamDto.description`; audit `@Length(0, N)` fields.

**Files Affected:**
- `server/src/mm-exam/dto/create-mm-exam.dto.ts`
- `server/src/mp-exam/dto/create-mp-exam.dto.ts`

**Risk Level:** LOW

**Expected Behavior Change:** `POST /api/mm-exam/create` with `gpu_util: 999` returns 400 instead of succeeding. Requests without `description` no longer require the key.

**Tests to Run:**
```
cd server && npx jest app.controller.spec
```
Add a unit test: POST with `gpu_util: 2` expects 400; POST without `description` expects 201.

**Rollback Plan:** Remove the new decorators; existing behavior restored immediately.

**Acceptance Criteria:**
- Validation pipe rejects `gpu_util > 1`.
- Omitting `description` from a create-mp-exam body passes validation.

---

## Batch 4 — Add smoke e2e suite `server/test/smoke.e2e-spec.ts` [SAFE TO RUN THIS SESSION]

**Objective:** Create a minimal smoke test that hits every list endpoint and verifies 200 + correct pagination shape against a real DB (or mocked repos). Covers the gap that no test currently exercises the full HTTP request → service → repository chain for mp-exam, mm-exam, npu-eval, and gpu-sweep status simultaneously.

**Files Affected:**
- `server/test/smoke.e2e-spec.ts` (new file)

**Risk Level:** LOW

**Expected Behavior Change:** CI gains a fast (~5s) end-to-end smoke check.

**Tests to Run:**
```
cd server && npx jest smoke.e2e-spec
```

**Rollback Plan:** Delete `smoke.e2e-spec.ts`.

**Acceptance Criteria:**
- All smoke assertions pass with mocked repositories.
- No 500 responses from any monitored list endpoint.

---

## Batch 5 — Add result-page metadata enrichment (git SHA, image digest, model revision) [SAFE TO RUN THIS SESSION]

**Objective:** Expose a `/api/version` or extend the `GET /api/gpu-sweep/status` response to include `git_sha`, `image_digest`, and `model_version` fields sourced from build-time env vars (`GIT_SHA`, `IMAGE_DIGEST`, `MODEL_VERSION`). This satisfies the user spec requirement for reproducibility metadata on every result page.

**Files Affected:**
- `server/src/app.controller.ts` (add `/version` endpoint)
- `server/src/app.service.ts` (read env vars)
- `server/Dockerfile.prod` (inject `GIT_SHA` / `IMAGE_DIGEST` as `ARG` + `ENV`)

**Risk Level:** LOW

**Expected Behavior Change:** `GET /api/version` returns `{ git_sha, image_digest, model_version, timestamp }`.

**Tests to Run:**
```
cd server && npx jest app.controller.spec
```

**Rollback Plan:** Remove the `/version` endpoint; no schema change.

**Acceptance Criteria:**
- `GET /api/version` returns 200 with all four fields present.
- Values are non-empty when build args are supplied.

---

## Batch 6 — Fix `console.log` → `Logger` in mp-exam and mm-exam services [SAFE TO RUN THIS SESSION]

**Objective:** Replace all 15+ `console.log` / `console.error` calls in `mp-exam.service.ts` and `mm-exam.service.ts` with structured `this.logger.*` calls. Remove emoji from log strings.

**Files Affected:**
- `server/src/mp-exam/mp-exam.service.ts`
- `server/src/mm-exam/mm-exam.service.ts`

**Risk Level:** LOW

**Expected Behavior Change:** All log output goes through the NestJS Logger with service context; Loki label routing works correctly; no emoji in log lines.

**Tests to Run:**
```
cd server && npx jest --passWithNoTests
```
(No behavioral change; existing tests continue to pass.)

**Rollback Plan:** Revert the file; console.log behavior restored.

**Acceptance Criteria:**
- `grep -r "console\." server/src/mp-exam server/src/mm-exam` returns zero results.

---

## Batch 7 — Migrate `ensureResultAccMathColumn` DDL to a TypeORM migration [DEFERRED — requires DB migration review]

**Objective:** Remove the ad-hoc `ALTER TABLE` DDL from `MmExamService.onModuleInit()` and express the column addition as `server/src/migrations/1714276800001-add-result-acc-math.ts`.

**Files Affected:**
- `server/src/mm-exam/mm-exam.service.ts` (remove `ensureResultAccMathColumn` method + call)
- `server/src/migrations/1714276800001-add-result-acc-math.ts` (new file)

**Risk Level:** MED (requires coordinated migration run against production DB)

**Expected Behavior Change:** Column addition runs once under TypeORM migration lock; concurrent pod starts no longer risk duplicate-column errors.

**Tests to Run:**
```
cd server && npx typeorm migration:run
cd server && npx jest --passWithNoTests
```

**Rollback Plan:** Run `typeorm migration:revert`; restore the `ensureResultAccMathColumn` method as a fallback.

**Acceptance Criteria:**
- `mm_exam_result.result_acc_math` column exists after migration.
- The `ensureResultAccMathColumn` code is absent from the service.

---

## Batch 8 — Add auth scaffold: JwtStrategy + admin role guard on write endpoints [DEFERRED — MED risk, coordinate with ops]

**Objective:** Add `passport-jwt`, `JwtStrategy`, and an `AdminRoleGuard`. Gate `POST /api/gpu-sweep/start`, `PATCH /api/gpu-sweep/drain`, `PATCH /api/mp-exam/stop/:id`, `DELETE /api/*/delete/:id` behind the guard. Restrict CORS to the known frontend origin.

**Files Affected:**
- `server/src/auth/` (new directory: `jwt.strategy.ts`, `admin.guard.ts`, `auth.module.ts`)
- `server/src/main.ts` (CORS origin restriction)
- `server/src/gpu-sweep/gpu-sweep.controller.ts`
- `server/src/mp-exam/mp-exam.controller.ts`
- `server/src/mm-exam/mm-exam.controller.ts`

**Risk Level:** MED (requires coordination: frontend must send Authorization header; ops must provision JWT secret)

**Expected Behavior Change:** Unauthenticated requests to write endpoints receive 401. Read endpoints (`GET /api/*/list`) remain public.

**Tests to Run:**
```
cd server && npx jest auth --passWithNoTests
```
Add unit tests: unauthenticated POST to /start returns 401; authenticated POST returns 201/503.

**Rollback Plan:** Remove `@UseGuards(AdminRoleGuard)` decorators; restore `origin: '*'` in CORS config.

**Acceptance Criteria:**
- `POST /api/gpu-sweep/start` without Authorization header returns 401.
- `GET /api/gpu-sweep/status` without Authorization header returns 200.

---

## Batch 9 — Add shared snapshot cache to `RealtimeService` (SSE backpressure) [DEFERRED — MED risk]

**Objective:** Add a 2-second TTL in-memory cache in `RealtimeService.buildSnapshot()` so all SSE subscribers share one snapshot per tick instead of each triggering independent DB queries. Separately add a per-client write-deadline to evict slow SSE clients.

**Files Affected:**
- `server/src/realtime/realtime.service.ts`
- `server/src/realtime/realtime.controller.ts`

**Risk Level:** MED (changes SSE delivery semantics slightly; requires verifying all Playwright specs still pass)

**Expected Behavior Change:** DB query rate drops from `20 × 4 queries / 2s` to `1 × 4 queries / 2s`. Slow clients are disconnected after 5 seconds of no drain.

**Tests to Run:**
```
cd server && npx jest realtime.service.spec
cd server && npx jest realtime.e2e-spec
web: npx playwright test gpu-realtime
```

**Rollback Plan:** Remove the cache variable; restore direct `buildSnapshot()` per subscriber.

**Acceptance Criteria:**
- `realtime.service.spec` still passes all 10 existing tests.
- Under a synthetic 20-subscriber load test, DB query rate is < 10 queries/second.

---

## Batch 10 — Wrap mp/mm-exam-result writes in DB transactions [DEFERRED — MED risk]

**Objective:** Wrap the `for (let i = 1; i <= repeatCount; i++)` loop in `MpExamResultService.create()` and `MmExamResultService.create()` in a TypeORM `manager.transaction()` so partial write failures roll back cleanly.

**Files Affected:**
- `server/src/mp-exam-result/mp-exam-result.service.ts`
- `server/src/mm-exam-result/mm-exam-result.service.ts`

**Risk Level:** MED (transaction isolation change; requires testing under concurrent result writes)

**Expected Behavior Change:** If any repeat-count file read or DB write fails, no partial results are persisted; the caller receives a clean error.

**Tests to Run:**
```
cd server && npx jest --passWithNoTests
```
Add unit test: simulate NFS failure on repeatCount=2 of 3; assert zero rows saved.

**Rollback Plan:** Remove `manager.transaction()` wrapper; restore individual saves.

**Acceptance Criteria:**
- Simulated mid-loop failure leaves zero result rows for that examId.
- Successful 3-repeat write produces exactly 3 rows.

