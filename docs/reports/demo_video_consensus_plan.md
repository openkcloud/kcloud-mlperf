---
title: Demo Video Consensus Plan — RALPLAN-DR (Deliberate Mode)
mode: ralplan-deliberate
demo_target: 2026-05-07
prepared_by: oh-my-claudecode:planner
based_on_head: f166600 (origin/jshim0978, fix/p0-atomplus-real-benchmarks-comparison-realtime-qa-20260429-071649-46d82f8)
live_state:
  frontend: jungwooshim/etri-llm-frontend:v27 (chunk index-CJ9aEfXL.js)
  backend:  jungwooshim/etri-llm-backend:v23 (cpu_core <=7 cap active)
  cluster_url: http://10.254.177.41:30001/
  rngd_streamlit: http://10.254.202.114:30890/
  prometheus_nodeport: http://10.254.177.41:30900/
authoritative_user_ask: "presentable FP8 GPU results, dashboards must filter to the actual running HW, all 4 menus must look alike, run all 4 HW types simultaneously without errors, then record the demo video"
---

# 1. RALPLAN-DR SUMMARY

## 1.1 Principles (P-1..P-5)

- **P-1 Apples-to-apples or honest-with-stderr.** Every cross-vendor cell either runs the same `(model, dataset, n_samples, max_tokens, precision)` fingerprint, or shows BLOCKED with the verbatim stderr line and one-sentence root cause. No silent precision substitution.
- **P-2 The dashboard never lies.** A page's live panel reflects ONLY the device(s) currently executing THAT page's benchmark type. Idle = idle, running = running, never "GPU active because some other page launched a job."
- **P-3 One component, one shape, four data sources.** The four hardware menus (L40 MLPerf, L40 MMLU, RNGD, Atom+) render with the same header, status chips, height, refresh cadence, and "Open in new tab" affordance. Only the underlying URL differs.
- **P-4 Concurrency is a first-class test.** Stability is not "MLPerf works in isolation"; it is "all 6 devices in 4 vendor combos finish their declared benchmarks under controlled concurrency without error spam."
- **P-5 Recording is the verification gate.** The video is the system test. If the recording session would visibly fail (toast, error chip, blank iframe), no recording happens; we fix and re-shoot.

## 1.2 Decision Drivers (top 3)

1. **Demo deadline 2026-05-07.** All five workstreams must converge in <24h of real engineering time. A perfect WS-3 unification that misses the deadline is a failure; a "good enough but uniform" parity is a success.
2. **Truth over polish.** The user explicitly called out fake-looking activity in the iframes. Showing real data — even when one cell is BLOCKED with stderr — beats showing wrong data that looks complete.
3. **Reversibility.** Every shipped change must have a documented one-command rollback (revert image tag, revert helm rev, revert env var). The deployed v27/v23 baseline is the floor we fall back to if something breaks.

## 1.3 Viable Options (per workstream)

### WS-1: FP8-on-GPU research + remediation

**Option A — Re-run existing harness as-is, prove FP8 already works on L40.**
- Pros: `scripts/mlperf_cnndm100_fp8.py:95-104` already uses `dtype="auto"` (the CORRECT compressed-tensors path) and logs `quantization` from `model_config`. The prior `Unknown dtype: fp8` failure was on a different SUT path (`SUT_VLLM.py`), not this script. Most likely FP8 already loads on L40 (sm_89) — we just haven't proven it on the current cluster after v23 deployment.
- Cons: A40 (sm_86) lacks native FP8 tensor cores; vLLM will fall back to dequant-to-bf16 with the Marlin kernel — slower but functionally correct. Must label A40 as "FP8-weights / BF16-compute" in the comparison table.

**Option B — Author a new vendor-recommended config (neuralmagic model card + vLLM 0.6+ flags).**
- Pros: Most defensible against scrutiny; aligns with `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` model card.
- Cons: Requires switching the model path (we currently use `/mnt/models/Llama-3.1-8B-Instruct-FP8/` neuralmagic; the L40 job already uses `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` — see `jobs/mlperf-cnndm100-fp8-l40.yaml:35`). Risk of cache/network surprise on demo day.

**Decision driver:** P-1 (apples-to-apples) and time. **Recommended: A first, B as fallback.**

### WS-2: GPU realtime dashboard scoping (cross-page leak)

**Option A — Frontend-side filter using `useRealtimeExams.snapshot.slots[].current_exam.kind`.**
- Pros: Zero backend change. The realtime contract (`server/src/realtime/realtime.service.ts:53-82`) already emits `current_exam.kind` as `'mp' | 'mm' | 'npu'`. The MLPerf page can compute "which L40 slots have `current_exam.kind === 'mp'`" and pass only those device IDs / a state flag to the iframe. If none match, render an "Idle — no MLPerf jobs running" state that REPLACES the iframe.
- Cons: The Prometheus iframe is opaque — frontend can only choose to render or hide it, not filter what's inside it. The "filter" is binary: show iframe vs show idle placeholder. (If the user wants per-device-within-iframe filtering, that's a Prometheus query construction job — Option B.)

**Option B — Construct a Prometheus expr URL parameterized by which GPUs are currently running THIS benchmark type.**
- Pros: True per-device filtering inside the iframe; matches user intent literally.
- Cons: Requires building Prometheus PromQL strings on the frontend, encoding label selectors based on live snapshot, and trusting that DCGM exporters tag pods so we can filter `DCGM_FI_DEV_GPU_UTIL{pod=~"mp-exam-.*"}`. Higher engineering risk in <24h.

**Option C (invalidated) — Backend exposes a per-benchmark-type Prometheus URL.**
- Why invalid: pushes UI policy into the backend, doesn't actually solve the problem (same iframe URL leaks regardless of which controller serves it), and adds a deploy cycle.

**Decision driver:** P-2 (dashboard never lies) and time. **Recommended: A — render iframe ONLY when at least one slot of the page's vendor+device-type has `current_exam.kind` matching the page's benchmark; otherwise render idle placeholder. Defer B to post-demo.**

### WS-3: Dashboard parity across all 4 menus

**Option A — Standardize on `LiveBenchDashboard` (already used everywhere) with a state-aware "data source URL" per menu.**
- Pros: Already deployed. RNGD uses Streamlit URL, GPU pages use Prometheus URL, Atom+ uses in-app SPA URL. All four already use the same component. Parity work = wrap with the WS-2 idle-aware shell so the four menus have IDENTICAL chrome (header, "Live"/"Idle" chip, height=900, "open in new tab", idle placeholder copy).
- Cons: The underlying iframes look very different inside (Streamlit panel vs Prometheus graph vs in-app card). The "look alike" requirement is satisfied at the chrome layer, not the content layer.

**Option B — Build a unified per-vendor Streamlit board (RNGD already has one; build GPU and Atom+ equivalents) and embed all four as Streamlit iframes.**
- Pros: True content-layer parity.
- Cons: 1-2 days of Streamlit + Prometheus client work per board. Will not land before May 7.

**Option C — Retire iframes; build one in-app `<UnifiedLiveDashboard vendor="..." benchmarkKind="..."/>` reading from `/api/realtime/exams/snapshot` + a new `/api/realtime/metrics` endpoint.**
- Pros: Best long-term solution; no iframe brittleness.
- Cons: Multi-day backend work. Out of scope for May 7.

**Decision driver:** P-3 + time. **Recommended: A for May 7 (chrome-layer parity); promote B to follow-up backlog.**

### WS-4: Multi-HW concurrent stability hardening

**Option A — Deploy operator v1.0.3 (already built) + run a controlled concurrent-matrix soak before recording.**
- Pros: v1.0.3 contains the per-loop scheduling-race fix that has been waiting in registry. cpu_core<=7 cap (already in v23) handles node3 starvation. Combining the two should resolve the known race.
- Cons: Operator swap is itself a risk window. Need a tested rollback to v1.0.1.

**Option B — Stay on operator v1.0.1 + sequence launches with 60s+ stagger via the scheduler (workaround already documented).**
- Pros: Zero deploy risk on the operator.
- Cons: Sequencing 6 devices serially with stagger inflates total demo recording time and visibly contradicts the "all running simultaneously" demo point.

**Option C (invalidated) — Skip multi-HW soak, trust per-device known-good runs.**
- Why invalid: directly contradicts the user's verbatim requirement to "relentlessly go over all HW... run test runs on all of them repetitively to check for any errors while running all 4 types of HW simultaneously."

**Decision driver:** P-4 (concurrency is first-class). **Recommended: A — deploy v1.0.3 in a quiet window with a documented `kubectl rollout undo` rollback.**

### WS-5: Demo video recording

**Option A — Single-take, full 6-device concurrent run, narrated live.**
- Pros: Most impressive. Single artifact.
- Cons: Any mid-take failure burns the whole take.

**Option B — Multi-segment, edited together, with checkpoints between segments.**
- Pros: Failure of one segment loses only that segment. Each segment can be retaken.
- Cons: Editing complexity; risk of "looks like cuts hide failures."

**Option C (invalidated) — Pre-recorded synthetic data, voiceover only.**
- Why invalid: violates P-1 truth-over-polish; user has explicitly rejected fake-looking activity.

**Decision driver:** P-5 (recording is the verification gate) and reversibility. **Recommended: B — 5 segments aligned to the existing `demo_script_tomorrow.md` paths, each <5 min, each a clean atomic recording.**

## 1.4 Pre-mortem (3 failure scenarios)

**Scenario 1: "L40 FP8 still throws `Unknown dtype: fp8` on real cluster run, blocking WS-1 acceptance."**
- *How we got here:* WS-1 Option A assumed the script's `dtype="auto"` is sufficient, but the cluster's vLLM image (`vllm/vllm-openai:v0.8.4` per `jobs/mlperf-cnndm100-fp8-l40.yaml:25`) may have a regression, or the model directory is missing the `config.json` `quantization_config` block.
- *Detection:* WS-1 Step 3 dry run on L40 with `n_samples=5` BEFORE committing to 100-sample.
- *Mitigation:* Fall back to WS-1 Option B (vendor model card config). If THAT fails, accept "L40 FP8 = BLOCKED-with-stderr" honestly per P-1, demo BF16 on L40 with a precision-disclosure footnote.
- *Rollback:* No deploy needed for WS-1 — script-only change, revert in git.

**Scenario 2: "WS-2 frontend filter hides the iframe even when L40 IS running MLPerf, because vendor matching is case-sensitive or the snapshot lags."**
- *How we got here:* The realtime snapshot polls every 5s; the user clicks "start" and immediately switches pages within 5s.
- *Detection:* Playwright e2e test asserting `iframe present <=10s after launch` and `iframe hidden <=10s after job completion`.
- *Mitigation:* Use a permissive predicate (any L40 slot's `current_exam.kind === 'mp'`) and add a "checking..." 10s grace state instead of binary show/hide.
- *Rollback:* Single-flag env var `VITE__APP_DISABLE_IFRAME_FILTER=true` reverts to v27 behavior.

**Scenario 3: "Operator v1.0.3 introduces a NEW failure mode under simultaneous 6-device launch; concurrent soak fails worse than v1.0.1."**
- *How we got here:* v1.0.3 was built but not deployed. We have no production evidence it is better than v1.0.1.
- *Detection:* WS-4 step `Run 1x cycle of the 36-job matrix in dry-run mode (n_samples=5) before swapping operator`.
- *Mitigation:* Have rollback `kubectl set image deployment/etri-llm-k8s-operator operator=mondrianai/etri-llm-k8s-operator:v1.0.1 -n llm-evaluation` ready in clipboard. If swap regresses, revert and fall back to WS-4 Option B (60s stagger).
- *Rollback:* One kubectl command (above).

## 1.5 Expanded Test Plan

### Unit
- `web/src/components/benchmark-page/__tests__/LiveBenchDashboard.idle.test.tsx` — given a snapshot with no slots matching `(vendor=nvidia, device_type=gpu, current_exam.kind='mp')`, the MLPerf-flavored dashboard renders the idle placeholder; given a matching slot, it renders the iframe.
- `server/src/realtime/realtime.service.spec.ts` — extend with a fixture asserting `current_exam.kind === 'mm'` is correctly emitted when an `mm-exam` is active on a GPU slot (regression guard for cross-page leak root cause).

### Integration
- `scripts/mlperf_cnndm100_fp8.py --hw l40 --n-samples 5` against a live L40 in the cluster. Assert the log contains `vllm quantization config: compressed-tensors` (or equivalent). Pass = FP8 weights confirmed loaded.
- `scripts/mlperf_cnndm100_fp8.py --hw a40 --n-samples 5` — same assertion; pass even if Marlin fallback warning is printed.

### E2E (Playwright)
- `web/e2e/dashboard_parity.spec.ts` — visit each of `/mlperf`, `/mmlu`, `/npu-eval/rngd`, `/npu-eval/atomplus`. Assert all four pages contain a panel with: an h6 title containing "Live", an "open in new tab" link, an iframe-or-idle-placeholder, and identical height (900px).
- `web/e2e/dashboard_no_leak.spec.ts` — start an MMLU job on L40, wait 10s, navigate to `/mlperf`, assert iframe is hidden / "Idle — no MLPerf running" placeholder is shown. Stop the job, navigate to `/mmlu`, assert iframe IS shown.
- `web/e2e/concurrent_six_device_smoke.spec.ts` — programmatic launch of 6 jobs (2x L40, 2x A40, 1x RNGD, 1x Atom+), wait until all reach `Running`, screenshot the home page leaderboard + each device page. Assert zero error toasts.

### Observability
- After each soak cycle, dump `kubectl get events -n llm-evaluation --sort-by=.lastTimestamp` and `kubectl logs deployment/etri-llm-k8s-operator -n llm-evaluation --tail=500` to `docs/reports/soak_evidence/cycle-<N>.txt`.
- Frontend: `console.error` count must be 0 across the entire 5-segment recording (Playwright `page.on('console')` collector).
- Backend: `realtime.gateway.ts` emit count >= 12 per minute per slot (5s cadence) — dump to `docs/reports/soak_evidence/realtime_emit_rate.csv`.

---

# 2. WORKSTREAM PLANS

## WS-1: FP8-on-GPU research + remediation

**Scope:** Prove FP8 works on L40 (sm_89 native), document A40 (sm_86) as "FP8-weights / BF16-compute" with stderr evidence, ship reproducible MLPerf + MMLU-Pro runs on both, and import results into the comparison DB so the comparison table shows real cells (not BLOCKED) for both GPUs.

**Files to touch (specific paths):**
- `scripts/mlperf_cnndm100_fp8.py` (verify `dtype="auto"` path for L40; add explicit `quantization` log assertion; add `--enforce-eager` fallback flag for A40)
- `jobs/mlperf-cnndm100-fp8-l40.yaml` (already targets `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8`; verify image `vllm/vllm-openai:v0.8.4` has compressed-tensors support)
- `jobs/mlperf-cnndm100-fp8-a40.yaml` (same, expect Marlin fallback warning)
- `jobs/mmlu-pro-l40.yaml` and `jobs/mmlu-pro-a40.yaml` (use FP8 model + `precision=bfloat16` runtime — proven path per project_fp8_and_mmlu_fix.md)
- `scripts/import-benchmark-result.ts` (ingest the new result rows into comparison DB)
- `docs/reports/fp8_gpu_evidence.md` (NEW — capture vLLM stdout proof of FP8 weights loaded, sample inference latencies, and final TT100T)

**Tasks (numbered):**
1. Pull `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` model card + `vllm/vllm-openai:v0.8.4` release notes via `document-specialist` agent. Confirm: (a) compressed-tensors loader path, (b) any required CLI flags, (c) sm_86 fallback behavior.
2. L40 dry run: `kubectl apply -f jobs/mlperf-cnndm100-fp8-l40.yaml` with `--n-samples 5` override. Tail logs; grep for `quantization`. PASS criterion: log line contains `compressed-tensors` (or `fp8`/`fbgemm_fp8` token), zero `Unknown dtype` errors.
3. If step 2 fails: invoke `document-specialist` for vendor-recommended invocation; either patch the script or pin a different vLLM image. Repeat step 2.
4. L40 full run: `--n-samples 100 --max-tokens 128`. Capture TT100T, TPS, and `vllm quantization config:` log line. Import via `import-benchmark-result.ts`.
5. A40 full run: same command, expect Marlin fallback warning; capture warning text verbatim into evidence doc; import result with `precision: "FP8-weights/BF16-compute"` label.
6. MMLU-Pro on both L40 and A40 with FP8 model + `precision=bfloat16` (proven path). Import results.
7. Verify the comparison table at `/mlperf/device-comparison` and `/mmlu/device-comparison` shows real cells (no BLOCKED) for L40 and A40.

**Dependencies:** None (independent of WS-2/3); blocks WS-5.

**Acceptance criteria:**
- L40 FP8 MLPerf 100-sample run completes; `vllm quantization config: ...` log line proves FP8 weights loaded; result row appears in `/mlperf/device-comparison`.
- A40 FP8 MLPerf 100-sample run completes (with Marlin fallback warning OK); result row appears with explicit precision label.
- Both GPUs show real MMLU-Pro cells, not BLOCKED.
- `docs/reports/fp8_gpu_evidence.md` contains verbatim stdout proof for both.

**Owner-agent recommendation:** `document-specialist` (vendor docs), then `executor` (model=opus for the script + cluster work), `verifier` for the proof check.

**Time estimate:** 4-6 hours (1h research, 1h L40 dry+full, 1h A40 full, 1h MMLU-Pro both, 1h ingest+verify, 1h evidence doc).

---

## WS-2: GPU realtime dashboard scoping (cross-page leak)

**Scope:** When a user is on `/mlperf` and the L40 is actually running an MMLU job (not MLPerf), the iframe must NOT show the L40 as "active." It must render an idle placeholder. Conversely, when L40 IS running MLPerf, the iframe shows. Same logic for `/mmlu`. Filter source: `useRealtimeExams.snapshot.slots[].current_exam.kind`.

**Files to touch:**
- `web/src/components/benchmark-page/LiveBenchDashboard.tsx` (add optional `idle: boolean` prop; when true, render placeholder INSTEAD of iframe; placeholder copy "No <BENCHMARK> jobs currently running on <VENDOR/MODEL>")
- `web/src/components/benchmark-page/__tests__/LiveBenchDashboard.idle.test.tsx` (NEW — unit tests for both states)
- `web/src/pages/mlperf/main/MLPerfPage.tsx` (compute `idle = !slots.some(s => s.vendor==='nvidia' && s.device_type==='gpu' && s.current_exam?.kind==='mp')` from `useRealtimeExams`; pass `idle` prop)
- `web/src/pages/mmlu/main/MMLUPage.tsx` (same pattern, `kind==='mm'`)
- `web/src/pages/npu-eval/rngd/index.tsx` (same pattern, `vendor==='furiosa', kind==='npu'`) — for parity, even though RNGD's Streamlit board is informative when idle
- `web/src/pages/npu-eval/atomplus/index.tsx` (same pattern, `vendor==='rebellions', kind==='npu'`)
- `web/e2e/dashboard_no_leak.spec.ts` (NEW — Playwright assertion of the bug fix)

**Tasks (numbered):**
1. Add `idle?: boolean` prop to `LiveBenchDashboard.tsx`; render an idle placeholder block (height=900, copy referencing the page's benchmark + vendor) when `idle === true`.
2. Add unit tests covering both `idle=true` and `idle=false` paths.
3. Wire MLPerf page to compute `idle` from `useRealtimeExams` snapshot using the predicate above.
4. Wire MMLU page identically.
5. Wire RNGD + Atom+ pages identically (with their vendor predicates) for parity.
6. Add Playwright `dashboard_no_leak.spec.ts` reproducing the user-reported bug + asserting fix.
7. Build frontend v28 image (`jungwooshim/etri-llm-frontend:v28`) via the existing kaniko manifest pattern. Roll out via Helm.
8. Manual verification per `demo_script_tomorrow.md`: start an MMLU on L40, navigate to `/mlperf`, confirm iframe hidden; stop MMLU, start MLPerf on L40, confirm iframe visible.

**Dependencies:** Depends on WS-1 only insofar as we want a real MLPerf job to test against; can proceed in parallel using a synthetic MMLU job.

**Acceptance criteria:**
- With L40 running MMLU, `/mlperf` shows "No MLPerf jobs currently running on NVIDIA L40" placeholder. `/mmlu` shows the iframe.
- Inverse case verified.
- Switch propagates within 10s (one snapshot tick + grace).
- `dashboard_no_leak.spec.ts` PASSES headlessly.
- Zero `console.error` during the spec.

**Owner-agent recommendation:** `executor` (sonnet) for component + page wiring, `test-engineer` for Playwright spec, `verifier` for live cluster check.

**Time estimate:** 3-4 hours (1h component+tests, 1h page wiring, 1h e2e spec, 1h build+rollout+verify).

---

## WS-3: Dashboard parity across all 4 menus

**Scope:** All four menus (MLPerf, MMLU, RNGD, Atom+) render their live dashboard panel with IDENTICAL chrome: same component (`LiveBenchDashboard`), same height (900px), same header layout (h6 title + status chip + "open in new tab" link), same idle placeholder behavior from WS-2, same loading-error states. The only intentional difference is the underlying `src` URL.

**Files to touch:**
- `web/src/components/benchmark-page/LiveBenchDashboard.tsx` (port the status-chip and loading/error/unavailable visual states from `PrometheusIframeDashboard.tsx`; the latter has the polished "Live"/"Connecting"/"Unavailable"/"Error" chips and the loading overlay — `LiveBenchDashboard` is a stripped-down version)
- `web/src/components/benchmark-page/PrometheusIframeDashboard.tsx` (DEPRECATE — replace usages with `LiveBenchDashboard`; current tests in `__tests__/PrometheusIframeDashboard.test.tsx` migrate to `LiveBenchDashboard`)
- `web/src/components/benchmark-page/index.ts` (drop `PrometheusIframeDashboard` export)
- `web/src/pages/mlperf/main/MLPerfPage.tsx`, `web/src/pages/mmlu/main/MMLUPage.tsx`, `web/src/pages/npu-eval/rngd/index.tsx`, `web/src/pages/npu-eval/atomplus/index.tsx` (audit: confirm all four call `<LiveBenchDashboard ... height={900} />` with identical prop shape; titles follow the pattern `Live <BENCHMARK_OR_DEVICE> Dashboard (<NODE> — <MODEL>)`)
- `web/e2e/dashboard_parity.spec.ts` (NEW — Playwright spec asserting structural parity across all four pages)

**Tasks (numbered):**
1. Merge the polished status-chip/loading-overlay UX from `PrometheusIframeDashboard.tsx` into `LiveBenchDashboard.tsx` (keep WS-2's `idle` prop).
2. Migrate `PrometheusIframeDashboard.test.tsx` cases into the unified component's test suite.
3. Remove `PrometheusIframeDashboard` from `index.ts` and delete the file (or keep as a thin compat alias for one release cycle).
4. Audit all four page files: confirm props, title pattern, height. Diff the four against a parity-checklist.
5. Author `dashboard_parity.spec.ts`: visits all four pages, queries DOM for the panel structure, asserts identical structure (same number of children, same element types, same height computed style).
6. Rebuild frontend v28 (combined with WS-2).

**Dependencies:** Sequenced AFTER WS-2 (WS-2 ships the `idle` prop; WS-3 polishes the unified component).

**Acceptance criteria:**
- Four pages render structurally identical dashboard panels (Playwright spec PASSES).
- Visual diff via `demo_qa_screenshots/`: chrome (header + chip + link) is pixel-equivalent across pages.
- Atom+'s `/dashboard/npu-realtime` self-iframe still loads correctly (no regression).
- RNGD's `http://10.254.202.114:30890/` Streamlit still loads correctly.
- Single component used everywhere; `PrometheusIframeDashboard` no longer exported.

**Owner-agent recommendation:** `executor` (sonnet) for the merge + cleanup, `designer` for the chrome-parity visual diff, `test-engineer` for the parity spec.

**Time estimate:** 2-3 hours (1h component merge, 0.5h test migration, 1h parity spec, 0.5h visual diff).

---

## WS-4: Multi-HW concurrent stability hardening

**Scope:** Deploy operator v1.0.3 (currently built but not deployed) to fix the per-loop scheduling race. Run a controlled concurrent-matrix soak: 6 devices (2x L40, 2x A40, 1x RNGD, 1x Atom+) x 2 benchmark types (MLPerf, MMLU) x 3 reps = 36 jobs. Classify and fix any failures with stderr-quoted root cause. Pass gate is <5% failure rate. Only AFTER pass do we proceed to WS-5.

**Files to touch:**
- `scripts/concurrent_matrix_soak.sh` (NEW — runs the 36-job matrix, collects per-job exit status + stderr, writes evidence to `docs/reports/soak_evidence/`)
- `docs/reports/soak_evidence/cycle-N.txt` (NEW per cycle — `kubectl get events`, `kubectl logs operator`, `kubectl get pods -A` snapshots)
- `docs/reports/soak_evidence/failure_classification.md` (NEW — per failure: job ID, hardware, benchmark, exit code, stderr line, root-cause guess, fix shipped Y/N)
- `helm/etri-llm-k8s-operator/values.yaml` (image tag bump v1.0.1 -> v1.0.3) — verify path; if helm chart not present, document `kubectl set image` command
- `server/src/mm-exam/mm-exam.service.ts:149` (verify `cpu_core <=7` cap is still in v23 backend; spot-check during soak)

**Tasks (numbered):**
1. Pre-deploy dry run: launch 6 jobs serially (one at a time, n_samples=5) with current operator v1.0.1, confirm each works in isolation. Baseline.
2. Deploy operator v1.0.3 in a quiet window: `kubectl set image deployment/etri-llm-k8s-operator operator=jungwooshim/etri-llm-k8s-operator:v1.0.3 -n llm-evaluation`. Wait for rollout. Verify pod healthy.
3. Smoke test post-deploy: launch 2 same-node jobs simultaneously (the race trigger). Assert no rejection.
4. Run the 36-job matrix via `scripts/concurrent_matrix_soak.sh`. Soak time estimate: ~45-60 min wall clock.
5. Collect failures into `failure_classification.md`. For each failure: stderr line, root cause, fix.
6. If failure rate >=5%: classify root causes, ship fixes (likely backend/operator), increment to v24/v1.0.4, re-soak. Iterate up to 3 times. If still failing, fall back to WS-4 Option B (60s stagger) and document the deviation.
7. If failure rate <5%: declare PASS, write `docs/reports/soak_pass_certificate.md` with cycle evidence.

**Dependencies:** WS-1 must have shipped FP8 (otherwise the GPU MLPerf jobs in the matrix would fail for FP8 reasons, polluting the failure classification). WS-2/WS-3 NOT blocking but recommended to roll together for one frontend image.

**Acceptance criteria:**
- Operator v1.0.3 healthy in cluster.
- 36-job matrix completes with <5% (<2) failures.
- Each failure has stderr-quoted root cause documented.
- `soak_pass_certificate.md` exists.
- Concurrent run of 6 devices visible in home leaderboard "Recent Activity" with no error toasts.

**Owner-agent recommendation:** `executor` (sonnet) for the soak script, `debugger` (sonnet) for failure classification, `verifier` for the pass certificate, `git-master` for the operator rollback runbook.

**Time estimate:** 4-6 hours (0.5h dry run, 0.25h deploy, 0.25h smoke, 1h matrix run, 1h classification + fixes, 0.5h pass certificate, plus 1-2h buffer for one fix iteration).

---

## WS-5: Demo video recording

**Scope:** 5-segment screen recording, each <5 min, aligned to `docs/reports/demo_script_tomorrow.md` paths. Pre-flight checklist gates the start. Each segment is atomic — failure of one does not invalidate the others. Video file lives at `docs/reports/demo_video/etri_demo_v1.mp4` (or per-segment files).

**Files to touch:**
- `docs/reports/demo_video/recording_runbook.md` (NEW — pre-flight checklist, OBS scene config, browser zoom level, audio cues, retry policy per segment)
- `docs/reports/demo_video/segment_storyboard.md` (NEW — narrator script per segment, expected screen state, what to do if a benchmark fails mid-segment)
- `docs/reports/demo_video/etri_demo_v1.mp4` (NEW — final artifact)

**Tasks (numbered):**
1. Author `recording_runbook.md`. Pre-flight gate: WS-1 PASS, WS-2 PASS, WS-3 PASS, WS-4 PASS-cert exists, frontend v28 + backend v23 + operator v1.0.3 deployed, six known-good test exam IDs queued.
2. Author `segment_storyboard.md`: 5 segments mapped to existing demo_script paths.
   - Segment 1 (Home + leaderboard, 2 min)
   - Segment 2 (RNGD evaluation + live dashboard, 5 min)
   - Segment 3 (Atom+ evaluation + live dashboard, 5 min)
   - Segment 4 (GPU L40 MLPerf + MMLU + live dashboards with WS-2 filter visible, 5 min)
   - Segment 5 (Concurrent 6-device launch + home leaderboard updating live, 5 min)
3. Pre-flight rehearsal: walk through each segment WITHOUT recording, watch for any visible defect. If found, file back into WS-2/3 and re-rehearse.
4. Record segments. Per segment, if a visible toast/error appears, cut and retake.
5. (Optional) Light edit: title cards between segments, no cuts WITHIN a segment.
6. Save final to `docs/reports/demo_video/etri_demo_v1.mp4`. Compute SHA-256, archive in `docs/reports/demo_video/SHA256SUMS`.

**Dependencies:** Hard block on WS-1, WS-2, WS-3, WS-4 ALL passing. No exceptions.

**Acceptance criteria:**
- Five segment files exist.
- Combined runtime ~22 min.
- Zero visible error toasts/banners across all segments.
- All six devices visually confirmed working.
- SHA-256 manifest exists.

**Owner-agent recommendation:** `qa-tester` (sonnet) for rehearsal, `writer` (haiku) for the storyboard script, manual recording by user.

**Time estimate:** 3-4 hours (1h runbook + storyboard, 1h rehearsal, 1-2h recording + retakes, 0.5h archive).

---

# 3. EXECUTION SEQUENCING (DAG)

```
                                    +------------+
                                    |   WS-1     |   FP8 GPU research + remediation
                                    | (4-6 hrs)  |   blocks WS-4 (matrix needs FP8 to test cleanly)
                                    +-----+------+
                                          |
                +-------------------------+-------------------------+
                |                                                   |
                v                                                   v
        +---------------+                                  +---------------+
        |     WS-2      |  ---- ships frontend v28 ---->   |     WS-3      |
        | dashboard     |       (combined image, one       | dashboard     |
        | leak fix      |        rollout)                  | parity        |
        | (3-4 hrs)     |                                  | (2-3 hrs)     |
        +-------+-------+                                  +-------+-------+
                |                                                   |
                +------------------------+--------------------------+
                                         |
                                         v
                                 +---------------+
                                 |     WS-4      |
                                 | concurrent    |   needs operator v1.0.3,
                                 | soak          |   needs FP8 working,
                                 | (4-6 hrs)     |   needs leak-fix iframe
                                 +-------+-------+
                                         |
                                         v
                                 +---------------+
                                 |     WS-5      |
                                 | record video  |
                                 | (3-4 hrs)     |
                                 +---------------+
```

**Parallelism opportunities:**
- WS-1 (FP8 work) runs **in parallel** with WS-2+WS-3 (frontend changes). Different repos/files, different cluster surfaces.
- Within WS-1: the L40 and A40 jobs can launch concurrently (different nodes).
- Within WS-2: component change + page wiring can be done by one executor; e2e spec by `test-engineer` in parallel.

**Serial bottlenecks:**
- WS-4 must come after WS-1 (FP8 must work before testing it under concurrency).
- WS-4 must come after WS-2/WS-3 frontend rollout (otherwise the iframe leak invalidates the recording).
- WS-5 is hard-gated on WS-1+WS-2+WS-3+WS-4 all PASS.

**Critical path:** WS-1 (4-6h) -> WS-4 (4-6h) -> WS-5 (3-4h) = ~14h sequential. With WS-2+WS-3 parallel to WS-1 (3-4h + 2-3h = 5-7h, which fits inside WS-1's 4-6h slot if you have 2 executors), total wall-clock = ~14h. Single-executor serial = ~20h.

---

# 4. RISK REGISTER

| WS | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| WS-1 | L40 FP8 still rejected by current cluster vLLM image | LOW (script uses `dtype="auto"`, the correct path) | HIGH (blocks entire FP8 narrative) | Dry run with n=5 before n=100; have vendor doc fallback ready (Option B); accept "L40 BLOCKED-with-stderr" as worst case per P-1 |
| WS-1 | A40 Marlin fallback is too slow to be "presentable" | MEDIUM | MEDIUM | Label as "FP8-weights/BF16-compute" in the table; lead with L40 numbers; honest disclosure per P-1 |
| WS-1 | Model file at `/mnt/models/Llama-3.1-8B-Instruct-FP8/` is corrupted/incomplete | LOW | HIGH | Verify SHA / file count before run; the L40 job uses `RedHatAI/...` from HF via `HF_TOKEN` so model integrity is HF-managed |
| WS-2 | Snapshot lag (5s cadence) causes user-visible flicker on rapid page switch | MEDIUM | LOW | 10s grace state ("Checking…") instead of binary show/hide |
| WS-2 | Vendor predicate too strict, hides iframe even when it should show | LOW | MEDIUM | Permissive predicate matches ANY slot of correct vendor+device_type+kind; integration test covers boundary cases |
| WS-3 | Visual parity demand interpreted as content-parity, not chrome-parity | MEDIUM | LOW | Explicit P-3 statement; user education in demo narration ("each iframe pulls from the most informative vendor source") |
| WS-3 | Removing `PrometheusIframeDashboard` breaks an unfound consumer | LOW | LOW | grep before delete; keep as compat alias for 1 release if uncertain |
| WS-4 | Operator v1.0.3 regresses vs v1.0.1 | MEDIUM | HIGH | Smoke test BEFORE matrix run; rollback `kubectl set image` ready in clipboard; fall back to 60s stagger if needed |
| WS-4 | 36-job matrix takes >2h wall clock and blows demo-day window | MEDIUM | MEDIUM | Reduce reps from 3 to 1 if needed; soak certificate accepts 12-job minimum (1 rep x 6 devices x 2 benchmarks) |
| WS-4 | NFS storage saturates with 6 concurrent vLLM model loads | LOW | HIGH | Stagger starts by 30s for the first cycle (model cache warm-up); subsequent cycles use cached weights |
| WS-5 | Mid-segment failure in a benchmark requires retake | HIGH (the user explicitly says this happens) | LOW (only loses one segment) | Multi-segment storyboard limits blast radius; have pre-canned "in case of failure: cut + retake" rule in runbook |
| WS-5 | Recording software glitches (audio drift, dropped frames) | LOW | MEDIUM | OBS pre-flight checklist in runbook; test-record one 30s clip before real recording |

---

# 5. ROLLBACK PLAN

| WS | If shipped change goes wrong, revert by... |
|----|---------------------------------------------|
| WS-1 (script) | `git revert <sha>` of the `mlperf_cnndm100_fp8.py` change. Already-imported result rows can be deleted via the comparison admin endpoint or marked `is_canonical=false`. |
| WS-1 (jobs) | `kubectl delete job <name>` on any in-flight FP8 jobs; revert `jobs/*.yaml` in git. |
| WS-2 (frontend filter) | `helm rollback etri-llm <prev-rev>` to v27. Or set `VITE__APP_DISABLE_IFRAME_FILTER=true` (add this kill-switch to the `LiveBenchDashboard` change as part of WS-2 task #1). |
| WS-3 (component unification) | Same `helm rollback` to v27. The deleted `PrometheusIframeDashboard` will be restored by git revert if needed. |
| WS-4 (operator v1.0.3) | `kubectl set image deployment/etri-llm-k8s-operator operator=mondrianai/etri-llm-k8s-operator:v1.0.1 -n llm-evaluation`. Wait for rollout. Validate with smoke test. |
| WS-4 (cpu cap regression) | Revert `server/src/mm-exam/mm-exam.service.ts` change; rebuild backend v22 image; `helm rollback`. |
| WS-5 (bad recording) | Re-record affected segment only. Keep all prior takes in `docs/reports/demo_video/takes/` for forensic comparison. |

**Universal floor:** Frontend v27 + Backend v23 + Operator v1.0.1 is the known-good baseline (currently deployed). Any rollback returns to this floor.

---

# 6. ACCEPTANCE CRITERIA SUMMARY (the full "done" definition)

The user's implicit "done" is: **a recorded video showing all 6 devices working concurrently, with truthful FP8 results on GPUs, no fake-looking iframes, all four menus visually consistent, and zero on-screen errors.**

To call this DONE, ALL of the following must be true:

**FP8 GPU truthfulness (WS-1)**
- [ ] L40 MLPerf FP8 100-sample run COMPLETED with vLLM stdout proof of FP8 weights loaded
- [ ] A40 MLPerf FP8 100-sample run COMPLETED (with documented Marlin fallback if applicable)
- [ ] L40 MMLU-Pro with FP8-model + bf16-runtime COMPLETED
- [ ] A40 MMLU-Pro with FP8-model + bf16-runtime COMPLETED
- [ ] All four results imported into comparison DB; visible in `/mlperf/device-comparison` and `/mmlu/device-comparison` as REAL cells (not BLOCKED)
- [ ] `docs/reports/fp8_gpu_evidence.md` contains verbatim stdout proof

**Dashboard truthfulness (WS-2)**
- [ ] `/mlperf` shows idle placeholder when no MLPerf job is running on any GPU
- [ ] `/mlperf` shows live iframe when ANY GPU has `current_exam.kind === 'mp'`
- [ ] `/mmlu` exhibits inverse behavior for `kind === 'mm'`
- [ ] Switch propagates within 10s
- [ ] Playwright `dashboard_no_leak.spec.ts` PASSES headlessly

**Dashboard parity (WS-3)**
- [ ] All four menus (MLPerf, MMLU, RNGD, Atom+) use `LiveBenchDashboard` exclusively
- [ ] All four panels: identical chrome (header + status chip + open-in-new-tab), identical height (900), identical loading/error/idle/ready states
- [ ] Playwright `dashboard_parity.spec.ts` PASSES headlessly
- [ ] `PrometheusIframeDashboard` no longer in `index.ts` exports (or marked deprecated alias)

**Concurrent stability (WS-4)**
- [ ] Operator v1.0.3 deployed and healthy
- [ ] 36-job matrix completed with <5% (<=2) failures
- [ ] Every failure has documented root-cause + stderr line
- [ ] `docs/reports/soak_pass_certificate.md` exists

**Demo video (WS-5)**
- [ ] 5 segment files recorded; combined runtime ~22 min
- [ ] Zero visible error toasts/banners across all segments
- [ ] All 6 devices visually confirmed working (2x L40, 2x A40, 1x RNGD, 1x Atom+)
- [ ] `docs/reports/demo_video/etri_demo_v1.mp4` exists with SHA-256 manifest

**Architectural Decision Record (ADR) — supplied so Architect/Critic review has the bottom line in one place**

- **Decision:** For May 7 demo, ship a chrome-parity dashboard unification with a frontend-side filter on `current_exam.kind`, deploy operator v1.0.3, and validate via a 36-job concurrent matrix soak before recording a 5-segment video. Defer Streamlit-per-vendor (true content parity) to post-demo backlog.
- **Drivers (top 3):** demo deadline 2026-05-07 (D-1); truth-over-polish (P-1); reversibility (P-5 + every WS has a documented one-command rollback).
- **Alternatives considered:** Streamlit per-vendor (rejected for May 7: too long to build); unified in-app dashboard reading from new metrics endpoint (rejected: backend work too large); Prometheus expr-builder per page (rejected: higher risk, defer to post-demo).
- **Why chosen:** Smallest reversible delta that satisfies ALL of the user's verbatim asks. Achieves "all menus look alike" at chrome layer (sufficient for the visual demand). Achieves "iframe shows real running HW" via frontend predicate using the contract field already emitted by the backend (`current_exam.kind`). Achieves "FP8 on GPUs" via the existing `dtype="auto"` path that has been correctly implemented but never end-to-end verified post-v23. Achieves "concurrent multi-HW" via the v1.0.3 operator + cpu_core cap combo.
- **Consequences:**
  - +Truthful, demoable system on May 7
  - +Lower regression risk (one frontend image v28, one operator deploy)
  - -Visual content of iframes differs across vendors (Streamlit vs Prometheus vs in-app) — addressed in narration
  - -Per-device-within-iframe filtering not implemented — Prometheus iframe still shows all GPUs of the cluster, just suppressed when no jobs of the page's kind are running
- **Follow-ups (post-demo backlog):**
  - Build Streamlit boards for L40/A40/Atom+ matching RNGD's :30890 reference
  - Or, retire iframes entirely; build `<UnifiedLiveDashboard>` with backend metrics endpoint
  - Promote operator v1.0.3 to mondrian fork OR merge upstream
  - Productionize `concurrent_matrix_soak.sh` into a CI nightly

---

## Open Questions (carry into `.omc/plans/open-questions.md`)

- [ ] WS-1: Should we use `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` (HF download) or the local `/mnt/models/Llama-3.1-8B-Instruct-FP8/` PVC? L40 job currently uses HF path; verify cache hit. — Why it matters: avoids first-run download surprise during recording.
- [ ] WS-1: For A40 with Marlin fallback, do we label the comparison cell `precision="FP8"` (model-level truth) or `precision="FP8-weights/BF16-compute"` (runtime truth)? — Why it matters: P-1 honest disclosure vs comparison-table column normalization.
- [ ] WS-2: Grace period before showing idle placeholder — 10s (P50 of snapshot poll cadence) or 30s (more forgiving)? — Why it matters: UX fluidity vs perceived responsiveness.
- [ ] WS-3: Keep `PrometheusIframeDashboard` as a compat alias for 1 release, or hard delete? — Why it matters: external scripts/notebooks may import it.
- [ ] WS-4: Acceptance threshold — <5% failure rate (current target) or <=0 failures? — Why it matters: stricter bar may force >3 fix iterations and miss demo window.
- [ ] WS-5: Single-take vs 5-segment — user preference unconfirmed. Plan defaults to 5-segment per Option B. — Why it matters: aesthetics of the final video.

---

## ADDENDUM A — USER-AUTHORITATIVE FINAL GOAL (added post-Planner, pre-Architect)

The user clarified the plan's terminal acceptance criterion:

> "Our final goal is to run the MLPerf inference bench on all 4 HW with the same parameters (same llama-3.1-8b-instruct-fp8 model, 100 datasets, 128 max tokens) and compare the TT100T values of each HW."

This SUPERSEDES any partial-success interpretation in the workstream-level acceptance criteria. The plan is not done until:

**APPLES-TO-APPLES MATRIX (4 cells, identical fingerprint):**

| HW | Model | Dataset | Samples | Max Tokens | Precision | TT100T | Status |
|----|-------|---------|---------|------------|-----------|--------|--------|
| L40 (sm_89) | Llama-3.1-8B-Instruct-FP8 | CNN/DailyMail | 100 | 128 | FP8 (native sm_89) | __ms__ | REQUIRED |
| A40 (sm_86) | Llama-3.1-8B-Instruct-FP8 | CNN/DailyMail | 100 | 128 | FP8-weights / Marlin-bf16-compute | __ms__ | REQUIRED |
| RNGD (FuriosaAI) | Llama-3.1-8B-Instruct-FP8 | CNN/DailyMail | 100 | 128 | FP8 (vendor-native) | __ms__ | REQUIRED |
| Atom+ (Rebellions) | Llama-3.1-8B-Instruct-FP8 (or BF16 if SDK-blocked) | CNN/DailyMail | 100 | 128 | FP8 OR BF16-fallback (precision-labeled) | __ms__ | REQUIRED |

**Comparison fingerprint constraint:** All 4 rows MUST share the same `config_fingerprint` per `benchmark_comparability_contract.md` v1.1.0 except for `precision` and `hardware`, which are the comparison axes. The precision delta must be explicitly labeled in the demo narration, not silently normalized.

**WS-1 acceptance is now upgraded:** WS-1 is not COMPLETE until:
1. The 4-row matrix above is populated with REAL imported result IDs
2. `/mlperf/device-comparison` UI loads ALL 4 cells side-by-side with TT100T values rendered
3. `docs/reports/fp8_gpu_evidence.md` includes the 4-row fingerprint table + verbatim vLLM `quantization` config stdout for L40 + A40 + identifies the RNGD + Atom+ source rows by ID

**WS-5 video acceptance is now upgraded:** The video MUST visibly show the 4-row apples-to-apples comparison loading on `/mlperf/device-comparison` as a key demo segment. This becomes the climax of the recording.

---

## ADDENDUM B — NO-STOP / ESCALATION POLICY (added post-Planner, pre-Architect)

The user added:

> "You should never stop until we obtain the results without any errors or hiccups. If something looks impossible, conduct research and ask for my advice."

This SUPERSEDES the time estimates and the "may stop on terminal blocked" stop condition.

**Operating policy for all execution:**

1. **No-quit on first failure.** If a benchmark errors, do not mark BLOCKED-with-stderr until: (a) the failure has been classified, (b) at least 2 alternative configurations have been tried, (c) authoritative documentation has been consulted via `document-specialist` agent.

2. **Research-first when stuck.** If a problem looks impossible (e.g., FP8 truly rejected on L40 by current vLLM image), spawn `oh-my-claudecode:document-specialist` to fetch vendor docs + GitHub issues + neuralmagic model card. Cite findings before concluding.

3. **User-escalate explicitly when blocked.** If after research the problem genuinely needs user input (e.g., authorize a vLLM image upgrade, authorize NFS dataset re-download, authorize a downtime window for operator swap), surface a decision point with: (a) the exact blocker, (b) the research evidence, (c) 2-3 concrete options with tradeoffs, (d) recommendation. Do NOT silently mark FAIL.

4. **Persistence loop bounded by user dialogue, not iteration count.** WS-4's "max 3 fix iterations" is REMOVED. Continue until either PASS or explicit user deferral via decision point.

5. **Escalation channel:** When user input is needed, send a message in the conversation explicitly tagged `[ESCALATION REQUIRED]` with the decision point. Pause execution on that workstream until reply. Other workstreams continue in parallel.

**Risk register update:** "Demo deadline 2026-05-07" remains a constraint, but is now classified as a **scope-tradeoff lever** (drop a workstream / accept a documented BLOCKED with user OK) rather than an auto-stop trigger.

---

## ADDENDUM C — REVISED ACCEPTANCE GATE

The plan is COMPLETE only when ALL of the following hold:

- [ ] WS-1: 4-row MLPerf FP8 100-sample 128-token matrix populated with real DB rows
- [ ] WS-1: All 4 cells render side-by-side on `/mlperf/device-comparison`
- [ ] WS-1: `fp8_gpu_evidence.md` documents methodology + verbatim vLLM stdout per HW
- [ ] WS-2: `dashboard_no_leak.spec.ts` PASS on live cluster
- [ ] WS-3: `dashboard_parity.spec.ts` PASS; all 4 menus chrome-identical
- [ ] WS-4: 36-job concurrent matrix soak PASS certificate exists
- [ ] WS-5: Video file exists with the 4-row TT100T comparison as visual climax
- [ ] All BLOCKED items have user-authorized deferral notes

Anything short of this is not done.

---

## ADDENDUM D — APPLIED REVISIONS (post-Architect, accepted by user 2026-05-06T08:30Z)

User accepted Path A: apply 3 must-fix revisions and start execution without Critic re-review.

### REV-1 (closes Architect §3 P-1 HIGH violation): Compute-Precision UI column
WS-3 task list now includes: edit `web/src/pages/mlperf/device-comparison/index.tsx` (and the 3 sibling pages) to render TWO precision labels per cell — `Storage Precision` and `Compute Precision`. Compute Precision values: `FP8 (sm_89 native)` for L40, `BF16 Marlin (FP8 weights dequant)` for A40, `FP8 (FuriosaAI vendor-native)` for RNGD, `FP8 OR BF16-fallback (per row)` for Atom+. Backend may need to expose a `compute_precision` field — if so, add as task to WS-3.

### REV-2 (closes Architect R-blind-2): Fix WS-4 deploy mechanism
WS-4 §Files-to-touch: STRIKE `helm/etri-llm-k8s-operator/values.yaml` (does not exist). Operator deploy + rollback = `kubectl set image deployment/etri-llm-operator etri-llm-operator=jungwooshim/etri-llm-k8s-operator:v1.0.3 -n llm-evaluation` and `… :v1.0.1` to revert. §5 Rollback Plan WS-4 row already correct.

### REV-3 (closes Architect Tension T3 + R-blind-1): T-6h pre-authorized triage + fingerprint audit
At wall-clock T-6h before demo (~02:00 KST 2026-05-07), if any of {WS-1 row 4 (Atom+), WS-4 soak, WS-5 segment 4} is still failing, automatically apply:
- **Triage cut #1:** drop A40 from the matrix → 3-row apples-to-apples (L40 + RNGD + Atom+); annotate the comparison page with "A40 deferred — see fp8_gpu_evidence.md §A40-blocker"
- **Triage cut #2:** WS-4 = single 6-device concurrent live run (1 cycle, not 12 or 36); soak certificate becomes "smoke certificate"
- **Triage cut #3:** WS-5 segment 4 (concurrent run) = single take, no retake budget
- **Triage cut #4:** Atom+ uses pre-collected id=76 (BF16 fallback) instead of fresh re-run
- These cuts are **pre-authorized**; team-lead executes without re-asking the user.

Additionally, WS-1 task 0 (Synth-5) added as hard precondition: audit `llmEvaluationDB.benchmark_results` for existing FP8 rows (id=75 RNGD, id=76 Atom+) and decide pre-import whether to re-run those for fingerprint match OR accept "subset comparability" labeling on the climax matrix.

### Decision Point Alpha (Synth-2): WS-1 L40 5-sample dry run
Hard gate. If `Unknown dtype: fp8` reappears on current vLLM image:
1. Spawn `document-specialist` for vLLM 0.8.x + neuralmagic FP8 model card research
2. Try image bump to next vLLM tag with documented FP8 support
3. If still failing: send `[ESCALATION REQUIRED]` to team-lead with 2-3 options (image upgrade, BF16 baseline contrarian path, defer L40 from matrix). Pause WS-1 only; other workstreams continue.

### No-stop policy enforcement (ADDENDUM B)
Every worker prompt includes: "Do NOT mark BLOCKED on first failure. Try ≥2 alternatives, consult `document-specialist` if needed, and only then send `[ESCALATION REQUIRED]` to team-lead with options."
