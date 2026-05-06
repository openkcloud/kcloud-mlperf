---
title: Demo Risk Register — May 7, 2026
demo_date: 2026-05-07
prepared_by: w-demo-script
based_on: ui_critic_review.md + benchmark_critic_review.md + omc_worker_progress.md
---

# Demo Risk Register

## Executive Summary

**Overall Risk Level:** MODERATE  
**Go/No-Go Threshold:** Home page + RNGD page + Atom+ page must load and show real metrics. All 6 pages must resolve 200.  
**Critical Path:** Demo depends on Playwright QA screenshots (task #5) and critic signoff (task #6). Both expected by demo time.

---

## Risk Matrix

| ID | Component | Risk | Severity | Probability | Mitigation | Recovery Time |
|-----|-----------|------|----------|-------------|------------|----------------|
| R1 | Kaniko frontend bundle lag | Frontend source PASS but deployed bundle may lag source build | HIGH | MEDIUM (50%) | Pre-demo curl to /api/health or /ml-perf route-test | 2 min |
| R2 | RNGD iframe (systemd dashboard) unreachable | External NPU systemd service unavailable | MEDIUM | LOW (20%) | Show API response via curl `/api/realtime/exams/snapshot` instead | 3 min |
| R3 | Prometheus GPU metrics unavailable | GPU dashboard iframe depends on Prometheus cluster install | MEDIUM | MEDIUM (50%) | Show fallback message gracefully; explain Prometheus not in scope | 1 min |
| R4 | GPU BLOCKED cells confuse audience | L40/A40 show BLOCKED-with-stderr; audience may think demo is broken | HIGH | HIGH (70%) | Pre-rehearse vLLM dtype-rejection explanation; have stderr screenshot ready | 5 min |
| R5 | Atom+ BF16 disclosure unclear | Audience may not understand why Atom+ is BF16, not FP8 | HIGH | HIGH (70%) | Pre-rehearse 2-sentence SDK limitation explanation; show stderr from critic report | 5 min |
| R6 | Comparison page ad-hoc candidates endpoint incomplete | `/api/comparison/candidates?run_id_1=X&run_id_2=Y` returns null instead of diagnostic | LOW | HIGH (70%) | Use list-based comparison (leaderboard buttons); avoid ad-hoc queries | 2 min |
| R7 | No RNGD/Atom+ benchmark rows in DB | Critic review references id=75/id=74 but actual run may have different IDs | HIGH | MEDIUM (40%) | Pre-demo curl `/api/comparison/list | jq '.runs[] | select(.hardware | contains("RNGD"))'` to confirm row exists | 3 min |
| R8 | Realtime data stale (>120s) | RNGD realtime snapshot TTL is 120s; if last update >120s ago, shows null | MEDIUM | LOW (20%) | Explain TTL; run a benchmark 2 min before demo to populate fresh data | 5 min |
| R9 | Logo link broken (MainLayout) | Logo navigation to home may not work | LOW | LOW (5%) | Manually navigate home via URL if needed | 1 min |
| R10 | Subject category chip filtering fails (MMLU) | Filtering by subject may be incomplete | LOW | LOW (10%) | Skip detailed subject filtering; show table as-is | 1 min |

---

## Risk Mitigation Pre-Demo Tasks

### Task M1: Route availability test (5 min before demo)

```bash
curl -I http://10.254.177.41:30001/
curl -I http://10.254.177.41:30001/npu-eval/rngd
curl -I http://10.254.177.41:30001/npu-eval/atomplus
curl -I http://10.254.177.41:30001/ml-perf
curl -I http://10.254.177.41:30001/mmlu
curl -I http://10.254.177.41:30001/dashboard/gpu-realtime
curl -I http://10.254.177.41:30001/comparison/75/74
```

**Expected:** All 200.  
**If any 404:** Note the failed route and prepare verbal contingency.

### Task M2: Backend data availability (5 min before demo)

```bash
# Check comparison-list has at least one RNGD and one Atom+ row
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[] | select(.hardware | contains("RNGD") or contains("Atom")) | {id, hardware, benchmark, precision, tt100t_seconds}'
```

**Expected:** At least 2 rows (one RNGD with precision=fp8, one Atom+ with precision=fp8 or bf16).  
**If missing:** Check if benchmarks are still in RUNNING state; if so, demo the in-flight status instead of completed runs.

### Task M3: Realtime snapshot check (3 min before demo)

```bash
curl http://10.254.177.41:30980/api/realtime/exams/snapshot | jq '.slots | keys'
```

**Expected:** Slots for npu/furiosa/RNGD/node4 and others.  
**If empty:** Explain that realtime cache is empty (normal between runs); show the schema in the curl response instead.

### Task M4: Prometheus availability (5 min before demo)

```bash
curl -I http://10.254.177.41:30001/dashboard/gpu-realtime
```

If page loads → check iframe src in page HTML. If Prometheus URL is set and accessible, GPU realtime will show live dashboard; if not, fallback message will appear (both OK).

### Task M5: RNGD systemd iframe (5 min before demo)

```bash
curl -I http://10.254.202.114:30890/
```

**Expected:** 200 (or 301 redirect). If timeout or 503, prepare fallback: show API response via curl instead.

### Task M6: Pre-rehearse talking points (10 min before demo)

- [ ] BF16 fallback explanation for Atom+ (2 sentences max)
- [ ] vLLM dtype-rejection explanation for GPU BLOCKED cells (2 sentences max)
- [ ] <1.1s target miss explanation (1 sentence)
- [ ] RNGD true FP8 confirmation (1 sentence)

---

## Per-Risk Recovery Procedures

### R1: Frontend Bundle Lag (Kaniko build in flight)

**Symptom:** Source PASS but 404 or stale UI on deployed bundle.

**Recovery:**
1. Explain to audience: "The source code has passed verification, but the Kaniko containerized build may still be packaging. Let me show you the source verification report." (Show ui_critic_review.md.)
2. Switch to dev server at http://localhost:5173 if available (may require SSH into orchestrator or VPN).
3. Fallback: Verbally walk through the pages, referencing the critic review evidence and demo script.

**Time:** 2-5 min

---

### R2: RNGD Iframe Unreachable

**Symptom:** RNGD page loads but systemd iframe at http://10.254.202.114:30890/ times out or shows blank.

**Recovery:**
1. Explain: "The RNGD systemd dashboard is the reference realtime source. Let me show you the live API equivalent." 
2. Open terminal, run:
   ```bash
   curl http://10.254.177.41:30980/api/realtime/exams/snapshot | jq '.slots["npu/furiosa/RNGD/node4"]'
   ```
3. Show the JSON response with current_exam field populated.
4. **Talking point:** "This API response is the live source for RNGD state. The iframe is a visual overlay; the API is the truth."

**Time:** 3 min

---

### R3: Prometheus Unavailable

**Symptom:** GPU realtime, MLPerf, or MMLU page shows "Unavailable" Chip + fallback message.

**Recovery:**
1. **If no Prometheus:** This is expected and acceptable. Show the fallback message gracefully.
   - **Talking point:** "Prometheus is not installed in this cluster. In a full observability setup, this dashboard would show live GPU metrics (utilization, memory, temperature, queue). For now, the cluster uses the comparison-list API for benchmark metrics."
2. If desired, show the comparison-list API response in curl:
   ```bash
   curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[] | select(.hardware | contains("L40") or contains("A40")) | {hardware, tt100t_seconds, tps}'
   ```

**Time:** 1-2 min

---

### R4: GPU BLOCKED Cells Confuse Audience

**Symptom:** Audience asks "Why are L40 and A40 blocked? Is the demo broken?"

**Recovery:**
1. **Honest explanation:** "L40 and A40 attempted FP8 inference using vLLM, a popular GPU inference engine. vLLM's dtype validator rejected the 'fp8' literal before model load. This is a vLLM version issue, not a benchmark configuration issue. Both runs produced concrete stderr proof." (Show logs/benchmarks/mlperf_l40_fp8_141_20260506.log line 37 or cite from benchmark_critic_review.md.)
2. **Positive framing:** "RNGD successfully executed FP8 using furiosa-llm, its vendor-native inference engine. This shows that vendor-specific optimizations work; generic frameworks (vLLM) need upgrades for new precisions."
3. **Talking point:** "The GPU cells are BLOCKED but not broken. The blocker is external and concrete. The demo's core message is that RNGD delivers working FP8 inference—and it does."

**Time:** 5 min (if audience is skeptical; otherwise 2 min)

---

### R5: Atom+ BF16 Disclosure Unclear

**Symptom:** Audience doesn't understand why Atom+ is labeled FP8 but actually ran BF16, or thinks it's a bug.

**Recovery:**
1. **Clear explanation:** "Atom+ attempted to match RNGD's FP8 precision. The optimum-rbln SDK (version 0.9.3.post1) does not expose FP8 quantization. Compilation failed with: 'cannot import name RBLNConfig from optimum.rbln'. Rather than skip the benchmark, we used the authorized BF16 fallback because FP8 was genuinely impossible at the SDK level—not a configuration choice."
2. **Honest comparison caveat:** "Atom+ delivers 1.375 seconds on this shape. RNGD delivers 1.267 seconds. We cannot directly compare them because RNGD is FP8 and Atom+ is BF16. Different precision arms. But both are valid for production use; the trade-off is vendor-specific."
3. **Show evidence:** Have benchmark_critic_review.md open to the "Cell 2 — Atom+ MLPerf" section showing the stderr proof.

**Time:** 5 min (2 min if concise)

---

### R6: Ad-Hoc Comparison Candidates Endpoint Incomplete

**Symptom:** Clicking "Load candidates" or navigating to `/api/comparison/candidates?run_id_1=X&run_id_2=Y` returns null instead of a list with diagnostics.

**Recovery:**
1. Use the list-based comparison instead: navigate back to home, click the comparison button on the leaderboard (which uses the comparison-list API).
2. **Talking point:** "The comparison-list API (used by the leaderboard buttons) correctly shows compatible and incompatible pairs with reasons. The ad-hoc candidates endpoint is not yet wired for diagnostics; we focus on the leaderboard UI path which works."
3. If audience asks: "The contract (benchmark_comparability_contract.md) specifies the diagnostics schema; the frontend uses that schema via the list path. The ad-hoc path is a secondary feature and not critical for the demo."

**Time:** 2 min

---

### R7: No RNGD/Atom+ Benchmark Rows in DB

**Symptom:** Navigating to /npu-eval/rngd or /npu-eval/atomplus shows empty completed runs table.

**Recovery:**
1. Check if benchmarks are in RUNNING state:
   ```bash
   curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[] | select(.status == "RUNNING")'
   ```
2. If RUNNING: **Switch to showing in-flight benchmarks.** Navigate to the page, show the "Active Benchmarks" section with ActiveBenchmarkCard panels. Refresh to show the 5-second polling in action.
   - **Talking point:** "Benchmarks are running now. Let me show you the live progress tracking. Refresh the page to see the status update every 5 seconds."
3. If no runs at all (RNGD, Atom+, GPU): **Explain blocker.** Refer to omc_worker_progress.md. May indicate orchestration issue or cluster unavailability.
   - **Fallback:** Show the comparison-list API response in JSON to prove the schema works.

**Time:** 3-10 min (depending on root cause)

---

### R8: Realtime Data Stale (>120s)

**Symptom:** Realtime snapshot shows null for current_exam (TTL expired).

**Recovery:**
1. **Explain TTL:** "The realtime cache has a 2-minute freshness window. If the last benchmark update was >2 minutes ago, it expires to avoid stale claims."
2. **Run a fresh benchmark:** If time permits, submit a new RNGD or Atom+ benchmark from the create form on the page. It will appear in the Active Benchmarks section within 5 seconds.
3. **Fallback:** Show the comparison-list API, which is a persistent database (not TTL-gated).

**Time:** 2-5 min (benchmark submission time varies)

---

### R9: Logo Link Broken

**Symptom:** Clicking logo does not navigate to home.

**Recovery:**
1. Manually type `http://10.254.177.41:30001/` in the address bar.
2. **Talking point:** "The logo link is a minor navigation feature. The core demo paths all work."

**Time:** 1 min

---

### R10: MMLU Subject Filtering Fails

**Symptom:** Clicking subject chip on MMLU page doesn't filter results.

**Recovery:**
1. Skip subject filtering. Show the full MMLU results table as-is.
2. **Talking point:** "MMLU results are historical (pre-resume contract). The demo's focus is MLPerf. You can see the full subject breakdown in the table; filtering is a convenience feature."

**Time:** 1 min

---

## Decision Tree: Continue or Abort?

**Go/No-Go at demo start:**

```
Does home page load (route /) with 200?
├─ NO  → Abort. Show omc_worker_progress.md to explain infrastructure blocker.
└─ YES → Proceed

Do RNGD and Atom+ pages load (routes /npu-eval/rngd + /npu-eval/atomplus)?
├─ NO (404) → Continue with contingency: explain bundle lag, show source verification.
└─ YES → Proceed

Does comparison-list API return at least 1 RNGD and 1 Atom+ row?
├─ NO  → Proceed with in-flight benchmarks (if RUNNING); else soft-fail and show APIs.
└─ YES → Proceed (ideal case)

Can you honestly explain:
  - RNGD is FP8 (real)?
  - Atom+ is BF16 (fallback, SDK limitation)?
  - GPU is BLOCKED (vLLM dtype)?
├─ NO  → Rehearse again (5 min). Do not proceed until confident.
└─ YES → GO for demo

```

**Final Go/No-Go:** Proceed if routes /, /npu-eval/rngd, /npu-eval/atomplus all load 200 AND you can confidently deliver the precision disclosure talking points.

---

## Escalation Contacts

- **Frontend build issue (Kaniko):** Check `.omc/state/` or team-lead notifications
- **Backend API down:** Check server logs at `/var/log/backend.log` or SSH to orchestrator
- **RNGD cluster unavailable:** Contact FuriosaAI team (on-call)
- **Atom+ cluster unavailable:** Contact Rebellions team (on-call)
- **Prometheus not available:** Acceptable; explain as out-of-scope for this demo

---

*End of risk register. See demo_recovery_playbook.md for step-by-step contingency procedures.*
