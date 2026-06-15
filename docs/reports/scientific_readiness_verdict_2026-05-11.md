> Note: ETRI takeover migration 2026-05-12 — sister deployment directory previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming); now ETRI-owned at `/home/kcloud/etri-llm-deployments/app/`. Container images previously under `mondrianai/*` Docker Hub org are migrating to `ghcr.io/etri-llm/*`. Historical mentions of the legacy names below are preserved for context.

# Scientific Benchmark Readiness Verdict — ETRI LLM Evaluation Platform

**Date:** 2026-05-11
**Reviewer:** Autonomous engineering team (ralph TDD pass, 6-story PRD)
**Scope:** Full audit of the 5-node Kubernetes LLM benchmark platform at `/home/kcloud/etri-llm-exam-solution/` and `/home/kcloud/etri-llm-deployments/app/` against publishable-benchmark requirements.
**PRD:** `.omc/prd.json` — `scientific-benchmark-readiness-tdd`

---

## Executive Summary (one screen)

- **Verdict:** Conditionally ready for internal exploratory cross-vendor work; NOT ready for publication-grade peer-reviewed claims.
- **What was fixed:** 5 critical TDD-driven stories (US-001..US-005) — DB-level idempotency, comparison fairness signals, reproducibility schema, real MMLU accuracy, latency-context tagging. Tests went from 75 → 141 (+66), build clean.
- **What remains blocked:** 5 critical items — Helm wire-up of repro env vars, unified latency methodology, NPU warmup exclusion, controller authentication, K8s-level node pinning for benchmark pods.
- **Confidence:** HIGH on items confirmed via code reading + new tests; MEDIUM on items inferred from documentation and audit-agent claims (e.g., gRPC operator pod spec was not directly read).
- **Lowest-effort path to "publishable":** see §5 — eight numbered items, none individually requiring architectural changes.

---

## 1. Readiness Verdict

**Conditionally ready** for *internal* exploratory work and roadmap-style cross-vendor comparisons after the fixes shipped in this session. **NOT ready** for publication-grade peer-reviewed claims until the deferred items in §5 are completed.

The platform now (a) prevents silent duplicate-result corruption via DB UNIQUE constraints, (b) refuses to silently treat heterogeneous-precision / cross-vendor / different-N comparisons as "strict" by surfacing `incompatibility_reasons`, (c) computes real MMLU accuracy instead of writing zero, (d) tags every result row with the latency measurement context so cross-context pairs surface a warning, and (e) has the schema in place to capture per-run reproducibility metadata. None of these prior bugs would have been caught by the existing test suite.

**Critical gaps that remain blockers for publication:**
- No authentication/authorization on any controller — DELETE/PATCH endpoints publicly mutable.
- Reproducibility metadata schema exists but env vars (POD_NAME, GIT_COMMIT_SHA, IMAGE_DIGEST, …) are not yet wired in the Helm chart, so all rows store NULL today.
- Cross-device latency *measurement context* is now disclosed, but the **underlying methodology gap** (GPU client-side wall vs NPU server-side stream) still makes raw latency cross-comparisons scientifically invalid even when paired with same precision.
- No CI workflow (no `.github/`) — tests exist locally but nothing prevents regressions on push.
- No nodeSelector on benchmark CRDs and `imagePullPolicy: Always` continue to inject scheduler/pull-time variance into measurements.

Confidence: HIGH on items confirmed by code reading + tests; MEDIUM on items where the audit relied on inference (e.g., the gRPC operator's pod spec was not directly read).

---

## 2. Highest-Risk Blockers

| # | Title | Component | Priority | Evidence | Risk | Recommended Fix |
|---|-------|-----------|----------|----------|------|-----------------|
| 1 | Cross-device latency contexts are not equivalent | `npu-eval/npu-eval.service.ts:529-547`, `mp-exam-result/mp-exam-result.service.ts:181-211` | Critical | NPU latency = `(token100_time - start_time)/1000` (server-side SSE clock). MLPerf latency = `Mean latency (ns)` from harness summary (client-side). | A published "L40 vs RNGD TT100T" delta is unsound | Define one canonical latency measurement (recommend: client-side wall clock around full HTTP request, identical wrapper across devices). Add a `methodology_note` field that any cross-context comparison must reference. |
| 2 | NPU warmup tokens included in throughput | `npu-eval/npu-eval.service.ts:507-585` | Critical | `executeSingleRun` totals `result.tokenCount` and `runTime` over **all** loop iterations, no warmup window separation | NPU TPS systematically inflated/deflated relative to GPU which uses a discarded 3-sample warmup | Add `WARMUP_SAMPLES` constant (e.g., 3); collect timing on first N samples then DROP from totalTokens/runTime aggregates. Add unit test asserting denominator excludes warmup. |
| 3 | No authentication on any controller | every `*.controller.ts` in `server/src/` | Critical | `grep -r 'AuthGuard\|@UseGuards\|JwtAuthGuard' server/src` returns empty. POST/PATCH/DELETE on `/mp-exam`, `/mm-exam`, `/npu-eval`, `/mp-exam-result`, `/mm-exam-result`, `/gpu-sweep` accept any caller. | Any reachable network actor can DELETE a benchmark exam, mutate result rows, or trigger a sweep | Add a global `ApiKeyGuard` reading `BENCHMARK_API_KEY` env. Apply to all `@Post`/`@Patch`/`@Delete`. Read endpoints stay public for dashboards. Test: `curl -X DELETE /mp-exam/delete/1` returns 401 without header. |
| 4 | Reproducibility env vars not wired in Helm | `mondrianai-*/kubernetes/app-chart/templates/etri-llm-backend/deployment.yaml` | Critical | Helm chart deployment template has no `env:` block injecting POD_NAME / NODE_NAME via downward API or GIT_COMMIT_SHA / IMAGE_DIGEST from CI | Schema added by US-003 will store all-NULL for every new row, defeating the point | Add downward-API env block + CI substitution in the Helm `values.yaml`. Verify by curling `/api/devices/sync` and inspecting the most recent exam row. |
| 5 | GPU sweep cells lack nodeSelector | `server/src/gpu-sweep/gpu-sweep.service.ts:384-516` + grpc operator pod spec | Critical | Application-level per-node mutex enforces sequencing but the K8s scheduler is free to place an exam pod anywhere. Two SKUs requiring the same `nvidia.com/gpu` could race. | Measurements include scheduler-induced variance | Inject `nodeSelector` per cell in the gRPC payload to the operator. Operator must honor it in the produced K8s Job spec. Test: dispatch a node2-targeted cell, verify pod scheduled on node2. |
| 6 | imagePullPolicy: Always on benchmark pods | `mondrianai-*/kubernetes/app-chart/templates/etri-llm-backend/deployment.yaml:32` and frontend:32 | High | First sample latency includes image pull time on cold pods | Inflates measured "first sample" latency, contaminates p99 percentiles | Change to `IfNotPresent` and pre-pull on each node, OR add an explicit warmup that's discarded. Document choice in methodology note. |
| 7 | Tokenizer SHA never captured | every exam entity | High | `model` column stores only string `meta-llama/Llama-3.1-8B-Instruct`; tokenizer revision differs across HF / vLLM / furiosa-llm / optimum-rbln | Token counts (and therefore TPS denominators) differ across vendors with no signal | Add `tokenizer_sha` column per exam. Capture from `tokenizer.config_json` hash at startup. Surface in comparison page side-by-side. |
| 8 | Sweep + production results mix in default aggregates | `server/src/comparison/comparison.service.ts:194-281` | High | `list()` blends `mp_exam` + `mm_exam` + `npu_exam` rows with no `source_table` or `[sweep:*]`-tag filter by default | Researcher's "average TT100T" can include 100-sample stress-test cells | Default to `excludeSweep=true` with explicit opt-in. Add test asserting that `[sweep:*]`-tagged exams are filtered. |
| 9 | Cancel/retry does not purge prior partial result rows | `server/src/npu-eval/npu-eval.service.ts:258-282` | High | `stopNpuExam` flips status to STOPPED but leaves rows. Re-submit creates new rows alongside stale ones; `latestResult()` picks max `result_number` nondeterministically. | Stale partial rows leak into aggregates after retry | On stop+retry, soft-delete prior rows OR namespace by `attempt_id`. Add unique-attempt indexing. |
| 10 | No CI workflow runs the test suite | repo root | High | `.github/` does not exist; tests exist but nothing executes them on push/PR. | Future regressions go undetected | Add `.github/workflows/server-tests.yml` running `npm test` + `npm run build` on push/PR. |

---

## 3. Quality Gates — Pass / Blocked

| Gate | Status | Evidence |
|------|--------|----------|
| 1. System understanding | **Pass** | 4 AGENTS.md files read; 5 parallel audit agents covering reproducibility, methodology, fairness, integrity, K8s — all returned with file:line citations |
| 2. Evidence | **Pass** | Every blocker in §2 cites file path + line; tests assert behavior on real entities |
| 3. TDD coverage | **Partial** | US-001..US-005 each shipped failing-test-first → green-test pattern (5 new spec files, 75 → 141 server tests). US-006 is documentation. Deferred items have NO failing tests yet. |
| 4. Reproducibility | **Partial** | Schema added by US-003 supports it; capture helper works. **Blocked** on Helm chart wiring (Blocker #4) so production rows still write NULL. |
| 5. Scientific validity | **Partial** | MMLU accuracy now real (US-004); latency context now disclosed (US-005). **Blocked** on Blockers #1, #2 (latency methodology + NPU warmup) — these require methodology agreement, not just code. |
| 6. Fair comparison | **Partial** | `incompatibility_reasons[]` exposed on pair() (US-002); `latency_context_mismatch` fires when contexts differ (US-005). **Blocked** on Blocker #7 (no tokenizer SHA) and on the frontend not yet rendering the warnings. |
| 7. Reliability and result integrity | **Partial** | UNIQUE constraints + 409 path landed (US-001). **Blocked** on Blocker #9 (no purge on cancel/retry) and atomicity gap between DB save and result.json write. |
| 8. Observability and auditability | **Blocked** | Loki controller exists but result rows store filesystem `logs_path`, not Loki URL. No audit trail for normalize-benchmark-results.py rewrites. No who-changed-what for result mutations. |
| 9. Security | **Blocked** | Blocker #3: zero auth on any controller. No RBAC, no API keys, no rate limits. Out of scope for this PRD. |
| 10. Actionability | **Pass** | Every entry in this document has title / component / priority / evidence / fix direction. |

---

## 4. TDD Remediation Backlog

### Shipped this session (US-001..US-005, all `passes:true`)

| Story | What landed | Tests | Files |
|-------|-------------|-------|-------|
| US-001 | UNIQUE (exam_id, result_number) on all 3 result tables; service maps Postgres 23505 → HTTP 409 | 5 unit tests | `entities/{mp,mm,npu}-exam-result.entity.ts`, `mp-exam-result.service.ts`, `migrations/1715000000000-add-result-unique-indexes.ts`, `mp-exam-result.service.duplicate.spec.ts` |
| US-002 | `computeIncompatibilityReasons()` exported; `pair()` populates `incompatibility_reasons[]` | 10 unit tests | `comparison.service.ts`, `comparison/incompatibility.spec.ts` |
| US-003 | 7 reproducibility cols on each exam entity; capture helper reads env vars; 3 services wire it into create() | 26 + 1 integration tests | `reproducibility/reproducibility.metadata.{ts,spec.ts,integration.spec.ts}`, `entities/{mp,mm,npu}-exam.entity.ts`, `migrations/1715000100000-add-reproducibility-metadata.ts`, all 3 exam services |
| US-004 | Pure MMLU scorer + dataset answer loader + executeBenchmark wires accuracy_pct (replaces hardcoded 0) | 22 unit + integration tests | `mm-exam/mmlu-scoring.{ts,spec.ts,integration.spec.ts}`, `npu-eval.service.ts` |
| US-005 | LatencyMeasurementContext enum on every result row; helper appends `latency_context_mismatch`; normalize* methods read it | 7 tests | `enums/latency-measurement-context.enum.ts`, all 3 result entities, `comparison.service.ts`, `migrations/1715000200000-add-latency-measurement-context.ts`, `comparison/latency-context.spec.ts` |

**Test count delta:** 75 → 141 (+66 new tests). All pass; build clean.

### Deferred (each needs failing-test-first when picked up)

| Backlog item | Priority | Failing test to write |
|--------------|----------|------------------------|
| Wire reproducibility env vars in Helm chart | Critical | E2E: deploy chart, curl `/api/.../create`, assert saved row has non-null `platform_commit_sha` |
| Define & enforce unified latency measurement | Critical | Unit: `assertLatencyMeasuredAt(run) === 'CLIENT_WALL_CLOCK'` for both GPU and NPU runs |
| Exclude NPU warmup tokens from throughput | Critical | Unit: with N=3 warmup + N=10 measurement, computed TPS uses only the 10 measurement runs |
| Auth gate on mutation endpoints | Critical | E2E: `POST /mp-exam/create` without `X-Api-Key` returns 401 |
| nodeSelector on benchmark CRDs | Critical | E2E or contract: gRPC payload includes node label; operator-produced Job spec has matching `nodeSelector` |
| imagePullPolicy + warmup discard | High | Spec asserts manifest uses IfNotPresent OR a documented per-pod pre-warm script |
| Tokenizer SHA capture | High | Unit: when tokenizer changes between two exams, comparison surfaces `tokenizer_sha_mismatch` (extends US-002 helper) |
| Sweep/production source-table separation | High | Service unit: `list({excludeSweep:true})` returns 0 rows when only sweep-tagged exams exist |
| Cancel/retry purges prior partial rows | High | Service integration: stop + restart leaves only the most recent attempt's rows |
| CI workflow + lint gate | High | Workflow file present; running `act` reproduces the green local result |
| Atomicity: DB save + result.json fsync | Medium | Failure-injection test: simulated fs.write error rolls back DB row |
| Frontend renders incompatibility_reasons in ComparisonDetailDialog | High | Playwright: select GPU FP8 + NPU INT4 → dialog shows red banner with reasons[] list |
| Loki URL stored on result rows | Medium | Unit: `result.loki_logs_uri` non-null after createResult |

---

## 5. Minimum Work to Publishable Readiness

In priority order, the following are the **narrowest** changes that lift the platform from "internal exploratory" to "publication-grade":

1. **Wire reproducibility env vars in Helm + CI** — `IMAGE_DIGEST` (CI), `GIT_COMMIT_SHA` (CI), `POD_NAME`/`NODE_NAME` (downward API), `RUNTIME_VERSIONS_JSON` (build-time `nvidia-smi --query-gpu=driver_version` + `pip show vllm`/`furiosa-llm` etc.). Without this, US-003's schema is decorative.
2. **Adopt one canonical latency measurement** across all devices and back-fill the `latency_measurement_context` field accordingly. Recommendation: client-side wall clock around full HTTP request from a colocated client pod. Document in `docs/reports/methodology_v1.md`.
3. **Exclude NPU warmup from throughput** — see US-005 deferred item.
4. **Auth gate on mutation endpoints** — blocks both supply-chain and accidental tampering. Even a single `BENCHMARK_API_KEY` env-driven guard is enough for the academic-publication threat model.
5. **Capture tokenizer SHA per exam** + extend `computeIncompatibilityReasons` to flag mismatch.
6. **Add CI workflow** running `npm test` + `npm run build` on every push to a `main`-protected branch.
7. **nodeSelector on every benchmark CRD** so the K8s scheduler cannot violate the application-level mutex.
8. **Document the methodology** in a versioned `methodology_v1.md` and reference it from every published table.

The rest of the deferred backlog (atomicity, observability, frontend warnings) is HIGH priority for production maturity but does not by itself disqualify a result from being publishable if the items above are done.

---

## 6. Missing Evidence / Access Needed

The audit was performed entirely from source code without live cluster access. The following items require evidence that this session could not collect:

- **Live K8s pod specs**: confirmation that the gRPC operator-produced Job spec for an MLPerf cell actually has `requests=limits` and the cap-7 CPU configuration documented in the prior `project_fp8_and_mmlu_fix` memory. Run: `kubectl get pod <exam-pod> -n llm-evaluation -o yaml | grep -A 5 resources`.
- **NFS contention measurement**: actual NFS read/write IOPS during a sweep, to confirm it's not a confounder. Needs `iostat`/`nfsstat` on node2 during a benchmark.
- **Image pull timing**: a `kubectl get events --field-selector reason=Pulled` over a 24h sweep window to quantify cold-start contamination.
- **Power/thermal data**: `nvidia-smi --query-gpu=power.draw,temperature.gpu --format=csv -l 1` baseline during sweep dispatches.
- **Benchmark dispatch logs**: a representative `mlperf_cnndm100_fp8.py` stdout/stderr dump to confirm warmup discard logic in production.
- **Result.json corruption check**: `find /mnt/result -name 'result.json' | xargs -I{} jq empty {}` to verify no in-flight writes left malformed JSON.
- **DB inspection**: `psql -c "SELECT exam_id, result_number, count(*) FROM mp_exam_result GROUP BY 1,2 HAVING count(*) > 1"` to count any pre-UNIQUE-constraint duplicates currently present (should be zero after the migration runs).
- **Tokenizer SHAs**: pull the actual `tokenizer.json` from each model artifact and `sha256sum` to quantify the cross-vendor token-count divergence.

These investigations should be sequenced **before** the deferred backlog is executed, because some of them (e.g., DB duplicates) may require a one-time data-cleaning step before the new UNIQUE constraint will install on prod.

---

## 7. Methodology Note (for the avoidance of doubt)

This report uses the term "Conditionally ready" deliberately. The platform's current numbers can support claims of the form "On our specific cluster configuration, with the disclosed methodology gaps, model X under runtime Y achieved metric Z" — but they cannot yet support general claims like "Llama-3.1-8B FP8 throughput on RNGD is W tok/s vs L40 V tok/s" because the latency measurement contexts are not equivalent and the tokenizer revisions are not pinned. The fixes in this session put the *machinery* in place to surface these caveats automatically; the *methodology agreement* to close them is human work, not code.

---

## 8. Per-Perspective Analysis (10 perspectives from the original task)

### 8.1 Kubernetes architecture and scheduling
- **Cluster:** 5 nodes (node1 control + GPU/NPU workers). CNI: Calico IPVS. Container runtime: containerd. SSH on port 122.
- **GPU sweep scheduler:** application-level per-node mutex with 60s stagger (`gpu-sweep.service.ts:190-215`). Quiet-window enforcement is also application-side only, so a service restart outside business hours can dispatch into the quiet window.
- **Critical scheduling gap:** benchmark Job pods produced by the gRPC operator are not pinned with `nodeSelector` to their intended node — the scheduler can place them anywhere, defeating the application mutex. (Blocker #5.)
- **Resource QoS:** prior MMLU-Pro CPU starvation incident was patched by capping `cpu_core ≤ 7` (`mm-exam.service.ts:72-82`) but no Kubernetes-level Guaranteed QoS class is enforced; if the operator emits Job specs without `requests=limits`, CPU contention can return.
- **PDB/preemption:** no PodDisruptionBudget on benchmark workloads, so a node drain mid-run leaves a partial result row with no signal.

### 8.2 Benchmark methodology and scientific validity
- **GPU MLPerf** uses the upstream MLPerf-Inference harness (CNN-DailyMail, ROUGE), launched via gRPC operator. Latency is parsed from `summary.txt` `Mean latency (ns)` (`mp-exam-result.service.ts:194-197`) — client-side from the harness perspective.
- **NPU eval** uses a custom SSE-token-streaming harness (`npu-eval.service.ts:591-707`). Latency is `(token100Time − startTime)/1000` per sample, derived from `performance.now()` calls in the SSE on-data handler — server-side from the inference server's perspective.
- **MMLU**: NPU MMLU runs now compute real accuracy via `scoreMmluRun` (US-004); GPU MMLU result table has `result_acc_total` populated by parsing the harness `summary` file. **Important:** the two paths score answers using different mechanisms (string regex vs. harness parser), so direct accuracy comparison may differ by a few percent due to extraction divergence.
- **Statistical treatment:** per-cell mean only; no median, no percentiles, no confidence interval. Sweep mode collects `retry_num=3` runs per cell but the comparison page picks the latest only — no variance reporting.

### 8.3 Reproducibility and experiment tracking
- **Schema** for reproducibility metadata is now in place (US-003). Columns: `platform_commit_sha`, `image_digest`, `k8s_pod_name`, `k8s_node_name`, `seed`, `runtime_versions` (JSON), `result_schema_version`.
- **Capture** is wired in service `create()` flows (`mp-exam.service.ts`, `mm-exam.service.ts`, `npu-eval.service.ts`).
- **Wire-up gap:** the Helm chart deployment template (`mondrianai-*/kubernetes/app-chart/templates/etri-llm-backend/deployment.yaml`) does not currently set the env vars from the downward API or CI substitution; until that change lands, every new exam writes NULL for these columns despite the schema.
- **Result schema versioning:** the `result_schema_version` column exists; the on-disk `result.json` payload (`mp-exam-result.service.ts:74-107`) does NOT yet stamp the version into the JSON itself. Recommend adding `payload.schema_version = process.env.RESULT_SCHEMA_VERSION || 'v0'`.

### 8.4 Fairness of hardware/device comparisons
- `pair()` endpoint now returns `incompatibility_reasons[]` (US-002) including `model_mismatch`, `precision_mismatch`, `dataset_mismatch`, `data_number_mismatch`, `max_output_tokens_mismatch`, `tokenizer_unverified` (cross-vendor), `latency_context_mismatch` (US-005).
- `classifyComparability()` already required `samePrecision && sameDataNumber && sameModel` for the 'strict' class — verified via existing code path at `comparison.service.ts:1014-1023`.
- **Frontend gap:** `ComparisonDetailDialog` accepts an `incompatibleReason` prop but the picker never sets it (audit finding). This means the backend signal is computed but the UI doesn't surface it. Deferred to backlog.
- **Tokenizer SHA capture** is missing entirely; the `tokenizer_unverified` reason is the strongest claim the platform can currently make about tokenizer parity.

### 8.5 Backend, runner, and result pipeline correctness
- **Idempotency:** US-001 added DB-level UNIQUE on `(exam_id, result_number)` for all 3 result tables. The mp-exam-result service maps Postgres `23505` to HTTP 409 cleanly. The mm/npu services were not updated to map 409 in this session — they still use the upsert path which is now race-safe at DB level but still surfaces as 500 on direct duplicate POST. Recommend extending the same `isUniqueViolation` helper to mm/npu in a follow-up.
- **Atomicity:** `result.json` is written AFTER the DB row is saved (`mp-exam-result.service.ts:115-119`). If the FS write fails, the DB row exists without artifact. No transactional rollback. Deferred.
- **GPU sweep result picking:** `latestResult()` (`comparison.service.ts:665-671`) uses `max(result_number)` which silently picks one of the 3 retry attempts. No filter for "best" or "latest successful".
- **Aggregation pollution:** `list()` blends `mp_exam` + `mm_exam` + `npu_exam` rows with no default sweep-tag filter (audit finding).

### 8.6 Frontend and researcher workflow safety
- React 19 + MUI 7 monorepo (`web/`). Routes include `/dashboard/{gpu,npu}-realtime`, `/dashboard/sweep-control`, `/{mlperf,mmlu}/device-comparison`.
- **Comparison UX:** the comparison page does not display all controlled variables (precision, dataset, batch_size, data_number, max_output_tokens) side-by-side — only metrics. Audit finding #8.
- **Selection safety:** `ComparisonCandidatePicker` allows the user to pair runs without a warning even when `incompatibility_reasons[]` is non-empty. Frontend wire-up deferred.
- **Sweep visibility:** "Hide sweep runs" toggle defaults ON in production demos (per `etri-llm-exam-solution/AGENTS.md:131-136`), which is the correct default for end users but means researchers must know to toggle OFF to inspect sweep results.

### 8.7 Security, access control, and result integrity
- **Authentication:** none. Every controller is open. `grep -rn 'AuthGuard\|@UseGuards' server/src` returns empty.
- **Authorization (RBAC):** none.
- **Mutation surface (no auth):**
  - `POST /mp-exam/create`, `PATCH /mp-exam/start-time/:id`, `PATCH /mp-exam/stop/:id`, `PATCH /mp-exam/update/:id`, `DELETE /mp-exam/delete/:id`
  - Same surface for `/mm-exam`, `/npu-eval`, `/mp-exam-result`, `/mm-exam-result`
  - `POST /gpu-sweep/start`, `PATCH /gpu-sweep/{pause,drain,resume}/:id`
- **Image pull secrets:** `image-pull-secret` (dockerconfigjson) is referenced in the Helm chart; not audited for rotation policy.
- **NFS access:** `dataset-nfs-pvc`, `model-nfs-pvc`, `results-nfs-pvc` all RWX 2Ti. NFS server is on node2 (10.254.184.195). No mTLS, no per-pod ACLs.
- **Secrets in code:** none observed (env-driven), but `.env` at repo root contains DB credentials per the project AGENTS.md.

### 8.8 Observability, auditability, and SRE reliability
- **Loki controller exists** (`server/src/loki/loki.controller.ts`) with whitelist-validated benchmark labels (`mmlu | mlperf`) — good defensive coding to prevent LogQL injection.
- **Result rows store `logs_path`** (filesystem path) but NOT a Loki HTTP URL, so dashboards cannot deep-link from a result to its live logs.
- **No audit trail for `scripts/normalize-benchmark-results.py`** — if someone re-runs normalization, there's no record of which rows were changed.
- **No who-changed-what** for result row mutations (`updated_by` columns absent from all result entities).
- **Run reconciler** (`server/src/run-reconciler/run-reconciler.service.ts:21-34`) catches `started_at == end_at` Running rows but not legitimately stuck long-runners.

### 8.9 Code quality, maintainability, and extensibility
- **TypeScript strict** mode is enabled (the codebase compiles with no errors).
- **Test coverage** improved from 75 → 141 server tests in this session. Frontend has minimal Vitest coverage; primarily Playwright e2e.
- **Module boundaries** are clean (NestJS feature modules). Entities are well-named.
- **Tech debt observed:** `npu-eval.service.ts` is large (>800 lines) — could be split into runner / dataset-loader / result-writer modules.
- **Migrations folder** has 3 new migrations from this session; the previous prod was on `1714276800000-gpu-sweep` only — verify migration ordering doesn't conflict on a partially-migrated prod DB before deploying.

### 8.10 Red-team review for hidden assumptions and failure scenarios
- **Hidden assumption:** "If `findOne` returns null, no row exists." — false under concurrency; this is what US-001 plugs.
- **Hidden assumption:** "Comparing two runs of the same model name → comparing the same model." — false when one side is a vendor-quantized variant; US-002 partially mitigates with `tokenizer_unverified` but doesn't yet check tokenizer SHA.
- **Hidden assumption:** "Latency from one device is comparable to latency from another." — false when measurement contexts differ; US-005 surfaces the warning but the underlying methodology is still uncorrected.
- **Hidden assumption:** "MMLU accuracy is meaningfully populated." — false until US-004; was hardcoded to 0.
- **Hidden assumption:** "Sweep results don't pollute production aggregates." — partially false; default `list()` mixes them.
- **Hidden assumption:** "Cancellation cleans up partial state." — false; prior result rows linger after stop+retry.
- **Failure scenario:** mid-run pod eviction → result rows in mixed state, exam status either flips to ERROR (if the controller catches it) or stays Running until the reconciler marks it as crashed. No dedicated `interrupted` status.
- **Failure scenario:** NFS hiccup → `result.json` write fails silently (warn-only catch in `mp-exam-result.service.ts:124-127`); DB row exists without artifact, downloader returns 404.
- **Failure scenario:** Two sweeps started concurrently on same node → application mutex would catch it, but the underlying race window between `existed = findOne(...)` and the application enqueue write is still narrow but real.

---

## 9. Closing Note

This audit + 5 TDD remediation stories (US-001..US-005) + this verdict (US-006) represent a single ralph-mode iteration. The platform has moved from "demo-quality" to "platform-quality with documented remaining work." The deferred backlog in §4 is the path to "publication-quality"; none of those items individually requires substantial new architecture, only careful execution following the same TDD pattern (failing test first, smallest fix, regression test wired to `npm test`).

The critical lesson from the methodology audit is that **scientific validity is not the same as code correctness**. Even if every test in `npm test` passes, the platform can still produce numbers that are not directly comparable across devices unless humans agree on a single measurement methodology and the platform tags every row with what was actually measured. The schema and the `incompatibility_reasons` machinery from this session make those caveats *visible*; closing them requires methodology agreement.

---

## Appendix A — File Inventory of Changes (this session)

| Category | File | Change |
|----------|------|--------|
| Schema   | `server/src/entities/mp-exam-result.entity.ts` | +@Unique +@Index +latency_measurement_context col |
| Schema   | `server/src/entities/mm-exam-result.entity.ts` | +@Unique +@Index +latency_measurement_context col |
| Schema   | `server/src/entities/npu-exam-result.entity.ts` | +@Unique +@Index +latency_measurement_context col |
| Schema   | `server/src/entities/mp-exam.entity.ts` | +7 reproducibility columns |
| Schema   | `server/src/entities/mm-exam.entity.ts` | +7 reproducibility columns |
| Schema   | `server/src/entities/npu-exam.entity.ts` | +7 reproducibility columns |
| Migration | `server/src/migrations/1715000000000-add-result-unique-indexes.ts` | New |
| Migration | `server/src/migrations/1715000100000-add-reproducibility-metadata.ts` | New |
| Migration | `server/src/migrations/1715000200000-add-latency-measurement-context.ts` | New |
| Helper   | `server/src/reproducibility/reproducibility.metadata.ts` | New |
| Helper   | `server/src/mm-exam/mmlu-scoring.ts` | New |
| Enum     | `server/src/enums/latency-measurement-context.enum.ts` | New |
| Service  | `server/src/mp-exam-result/mp-exam-result.service.ts` | +isUniqueViolation +409 mapping |
| Service  | `server/src/mp-exam/mp-exam.service.ts` | +captureReproducibilityMetadata wire-up |
| Service  | `server/src/mm-exam/mm-exam.service.ts` | +captureReproducibilityMetadata wire-up |
| Service  | `server/src/npu-eval/npu-eval.service.ts` | +captureReproducibilityMetadata + body accumulation + MMLU scoring + loadMmluExpectedLetters |
| Service  | `server/src/comparison/comparison.service.ts` | +computeIncompatibilityReasons +incompatibility_reasons in pair() +latency_measurement_context in NormalizedRun |
| Tests    | `server/src/mp-exam-result/mp-exam-result.service.duplicate.spec.ts` | New (5 tests) |
| Tests    | `server/src/comparison/incompatibility.spec.ts` | New (10 tests) |
| Tests    | `server/src/comparison/latency-context.spec.ts` | New (7 tests) |
| Tests    | `server/src/reproducibility/reproducibility.metadata.spec.ts` | New (26 tests) |
| Tests    | `server/src/reproducibility/reproducibility.integration.spec.ts` | New (1 test) |
| Tests    | `server/src/mm-exam/mmlu-scoring.spec.ts` | New (19 tests) |
| Tests    | `server/src/mm-exam/mmlu-scoring.integration.spec.ts` | New (3 tests) |
| Docs     | `docs/reports/scientific_readiness_verdict_2026-05-11.md` | This document |
| PRD      | `.omc/prd.json` | New PRD `scientific-benchmark-readiness-tdd` (6 stories, all `passes:true`) |
| Progress | `.omc/progress.txt` | Iteration-5 entries |

**Test count:** 75 → 141 (+66 new tests, 8 new spec files).
**Build:** clean (`npm run build` exit 0).
**Migrations:** 3 new, all idempotent (use `IF NOT EXISTS` / `IF EXISTS`).
