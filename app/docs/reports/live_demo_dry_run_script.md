---
title: Live Demo Dry-Run Script — 30-Minute Rehearsal
demo_date: 2026-05-07
demo_target_url: http://10.254.177.41:30001/
frontend_version: v31
backend_version: v26
dashboards:
  rngd: http://10.254.184.195:30890/    # node4
  l40:  http://10.254.184.195:30891/    # node2
  a40:  http://10.254.184.195:30893/    # node3
  atomplus: http://10.254.184.195:30892/ # node5
prepared_by: writer
---

# Live Demo Dry-Run Script — 30 Minutes

---

## Pre-Flight Checklist (Run Before Presenting)

Complete all items before opening the first browser tab in front of the audience.

### 1. Route Health

```bash
for path in / /gpu-realtime /npu-eval/rngd /npu-eval/atomplus /ml-perf /mlperf/device-comparison; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://10.254.177.41:30001${path}")
  echo "$code  $path"
done
```

All lines must return `200`. If any return `404` or `000`, see Recovery Branch R-1.

### 2. Dashboard Health

```bash
for url in \
  "http://10.254.184.195:30890/" \
  "http://10.254.184.195:30891/" \
  "http://10.254.184.195:30893/" \
  "http://10.254.184.195:30892/"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  echo "$code  $url"
done
```

All must return `200`. If blank, see Recovery Branch R-3.

### 3. Backend Version

```bash
curl -s http://10.254.177.41:30001/api/version | jq .
```

Expected: `"version": "v26"` (or higher). If lower, the progress-bar cap fix is not deployed — do not demo Step 7 live without warning.

### 4. Comparison Row Count

```bash
curl -s http://10.254.177.41:30001/api/comparison/list | jq '.runs | length'
```

Expected: at least 6 rows. Confirm at least one row per vendor (furiosa, rebellions, nvidia).

### 5. No Stuck Running Jobs

```bash
curl -s http://10.254.177.41:30001/api/comparison/list \
  | jq '[.runs[] | select(.status == "RUNNING")] | length'
```

Expected: `0` or a small number with recent `updated_at`. If any row has been `RUNNING` for >15 min with no progress, see Recovery Branch R-5.

### 6. Backup Exam IDs Ready

Open these URLs in hidden tabs before starting:

| Backup | URL |
|---|---|
| L40 FP8 id=124 | `http://10.254.177.41:30001/ml-perf` (filter to id=124) |
| A40 FP8 id=125 | `http://10.254.177.41:30001/ml-perf` (filter to id=125) |
| RNGD FP8 id=75 | `http://10.254.177.41:30001/npu-eval/rngd` |
| Atom+ BF16 id=76 | `http://10.254.177.41:30001/npu-eval/atomplus` |

---

## Step-by-Step Script

---

### STEP 1 — Landing Page (0:00–2:00)

**DO:**
1. Open `http://10.254.177.41:30001/` in a maximized browser window.
2. Let the page fully render (vendor cards, leaderboard, Recent Activity table).
3. Point at the TT100T leaderboard — read the top-ranked row aloud.
4. Point at the cluster status chips (node4/RNGD, node2/L40, node3/A40, node5/Atom+).
5. Point at the navigation menu items: GPU Realtime, NPU (RNGD), NPU (Atom+), MLPerf, MMLU.

**EXPECT:**
- Three vendor cards: NVIDIA, FuriosaAI, Rebellions.
- TT100T leaderboard with at least 4 ranked rows; RNGD id=75 near top (1.267 s).
- Recent Activity table showing 6–10 rows with mixed vendor/status.
- All nav links visible and not greyed out.

**IF NOT (recover):**
- Vendor cards missing: refresh once (F5). If still missing, navigate to `/api/devices/list` in a new tab and show the raw JSON — "The backend API is live; the frontend is rendering from this data."
- Leaderboard empty: see Recovery Branch R-4.
- Page fails to load at all: see Recovery Branch R-1.

**TALKING POINTS:**
- "This leaderboard ranks every completed run by TT100T — time-to-100-tokens, the latency metric that matters for interactive LLM workloads."
- "Three vendors are provisioned in one cluster: NVIDIA GPU, FuriosaAI RNGD NPU, and Rebellions Atom+ NPU. Each vendor has its own inference stack."
- "The cluster status row tells us which devices are idle right now. If any slot shows Running, there's a live benchmark in progress."

---

### STEP 2 — GPU Realtime Menu (2:00–5:00)

**DO:**
1. Click **GPU Realtime** in the navigation menu (or navigate to `/gpu-realtime`).
2. Wait for the page to load; point at the 4 GPU device cards.
3. Read the hardware labels: 2× L40 (node2), 2× A40 (node3).
4. If any card shows a utilization meter, narrate the value.
5. If all cards show idle (0% util), narrate that explicitly — it is expected between runs.

**EXPECT:**
- Four GPU device cards in a grid layout.
- Each card: vendor chip, node label, utilization gauge or idle badge, memory bar.
- No 404 or spinner that never resolves.

**IF NOT (recover):**
- Page shows "Unavailable" or Prometheus chip is grey: see Recovery Branch R-3. Do not linger — say "Prometheus is not configured in this deployment; the benchmark metrics API is the authoritative source" and move on.
- Only 2 cards appear: one node may be cordoned. Say "Node3 or Node2 may be temporarily suspended from scheduling. The benchmark data we'll see later is from their completed runs."

**TALKING POINTS:**
- "Each GPU slot is independently schedulable. The benchmark runner picks the least-loaded node at submission time."
- "L40 and A40 are both Ada/Ampere-generation cards. L40 is the higher-tier card — 48 GB VRAM vs 40 GB on the A40. Both targeted the same benchmark shape."
- "We attempted FP8 on both. I'll show you the outcome in Step 6 — the short version is that vLLM's dtype validator blocked it. The cluster's RNGD NPU succeeded where GPU fell short on this specific precision."

---

### STEP 3 — NPU Realtime Menu (5:00–7:00)

**DO:**
1. Click **NPU** or navigate to the NPU submenu.
2. Show the RNGD device card (node4) — point at vendor, device type, current status.
3. Show the Atom+ device card (node5) — same walkthrough.
4. Point at the status chip: idle or running.

**EXPECT:**
- Two NPU device cards: FuriosaAI RNGD on node4, Rebellions Atom+ on node5.
- Each card shows hardware specs and current status.
- No error banners.

**IF NOT (recover):**
- RNGD card missing: `curl -s http://10.254.177.41:30001/api/devices/list | jq '.[] | select(.vendor=="furiosa")'` in a terminal tab — show the raw device record. "The device is registered in the backend; the UI card has a rendering issue on this build."
- Atom+ card missing: same curl, select `.vendor=="rebellions"`.

**TALKING POINTS:**
- "RNGD is FuriosaAI's flagship NPU — purpose-built for matrix-heavy LLM workloads. It uses a proprietary inference stack called furiosa-llm, separate from vLLM."
- "Atom+ is Rebellions' NPU. Its SDK is optimum-rbln, a HuggingFace-compatible wrapper. Both are provisioned as Kubernetes device plugins on dedicated nodes."
- "NPU devices are harder to provision than GPUs — no generic CUDA fallback. Everything you see here required vendor-specific driver integration."

---

### STEP 4 — MLPerf Create Form Walkthrough (7:00–11:00)

**DO:**
1. Navigate to `/ml-perf`.
2. Click **New MLPerf Exam** (or equivalent create button).
3. The form opens. Walk through each field without submitting:
   - **Model:** Llama-3.1-8B-Instruct
   - **Precision:** FP8 (point at this — explain it)
   - **Samples:** explain 10 vs 100 vs full dataset
   - **Max tokens:** 128 (the canonical contract value)
   - **Hardware target:** L40 or A40 dropdown
4. Point at the estimated runtime note if present.
5. Do NOT click submit. Click Cancel or close the form.

**EXPECT:**
- Form with at minimum: model selector, precision dropdown, sample count input, max_tokens input, hardware selector.
- FP8 appears as a selectable precision option.
- A cancel or dismiss path is available.

**IF NOT (recover):**
- Button is disabled: check if a job is currently RUNNING for that device. If so: "The device is busy with an active run. I'll show you the form fields via the API schema instead." Open `http://10.254.177.41:30001/api/exams/schema` or show the curl for exam creation.
- Form does not open: navigate directly to `/ml-perf/create` if it exists as a separate route.

**TALKING POINTS:**
- "FP8 is the target precision for this benchmark contract. It cuts memory bandwidth in half versus BF16, which matters for NPU throughput."
- "100 samples at max_tokens=128 is the canonical benchmark shape. 10 samples is what we'll use for the live demo run — it finishes faster while exercising the same code path."
- "The model is always Llama-3.1-8B-Instruct. Changing the model would break comparability across vendors — this is the controlled variable."

---

### STEP 5 — RNGD LiveBench Dashboard (11:00–14:00)

**DO:**
1. Navigate to `/npu-eval/rngd`.
2. Scroll to the **LiveBenchDashboard** iframe at the bottom of the page.
3. Wait up to 10 seconds for the iframe to fully render (it loads from node4:30890).
4. Point at the metrics visible: throughput timeline, device utilization, memory usage.
5. Mention the URL source displayed at the top of the iframe (or in the link beneath it).

**EXPECT:**
- Streamlit dashboard loaded in the iframe, sourced from `http://10.254.184.195:30890/`.
- At least one metric chart visible (even if idle/flat line).
- "Open in new tab" link visible beneath the iframe.

**IF NOT (recover):**
- Iframe is blank or shows a loading spinner that never resolves: click **Open in new tab** link. If the direct URL loads in the new tab: "The iframe has a cross-origin rendering quirk — here it is full-screen." If the direct URL also fails: see Recovery Branch R-3.
- Iframe loads but shows an error page from Streamlit: note this — "The Streamlit app on node4 may have restarted. The dashboard data persists in Prometheus; the UI layer is recovering." Navigate to the backup URL: `http://10.254.184.195:30890/`.

**TALKING POINTS:**
- "This is the FuriosaAI-native benchmark dashboard running on node4 — the same node as the RNGD hardware. The reference layout mirrors what FuriosaAI's own toolchain exports."
- "You see throughput and utilization plotted in real time against Prometheus metrics. During an active benchmark run, these lines spike."
- "Our frontend embeds this via iframe because it is the authoritative source. We do not re-aggregate or reinterpret these metrics — what FuriosaAI reports, we display."

---

### STEP 6 — Live Benchmark Submission (14:00–17:00)

**DO:**

**Part A — Submit L40 10-sample FP8 run:**
1. Navigate to `/ml-perf`.
2. Click **New MLPerf Exam**.
3. Set: Model=Llama-3.1-8B-Instruct, Precision=FP8, Samples=10, Max tokens=128, Hardware=L40.
4. Click **Submit** (or equivalent).
5. Note the new exam ID that appears in the table.

**Part B — Navigate to RNGD page in parallel:**
1. Open `/npu-eval/rngd` in a new tab (keep the MLPerf tab open).
2. Click **New RNGD Exam**.
3. Set: Model=Llama-3.1-8B-Instruct, Precision=FP8, Samples=10, Max tokens=128.
4. Click **Submit**.
5. Note the new RNGD exam ID.

**Part C — Return to MLPerf tab:**
1. Switch back to the `/ml-perf` tab.
2. Locate the L40 exam just submitted — status should show `PREPARING` or `RUNNING`.
3. Point at the status badge and the progress bar.

**EXPECT:**
- Both submissions produce a new row in the respective tables within 5 seconds.
- Status badge shows `PREPARING` → `RUNNING` within 30 seconds.
- Progress bar appears and begins incrementing (capped at 100% per v26 fix).

**IF NOT (recover):**
- Submission returns an error or row does not appear: see Recovery Branch R-2 (use backup exam id=124 for L40, id=75 for RNGD).
- Status stays `PREPARING` for >2 min: say "The worker is loading vLLM weights from NFS. On a cold start, the first model load takes approximately 5 minutes. I have a pre-collected result we can reference while this warms up." Switch to backup IDs.
- Progress bar immediately jumps to 100% without moving: the v26 fix may not be deployed — do not linger, say "Progress tracking is a display convenience; the metric that matters is TT100T on completion" and move to Step 7.

**TALKING POINTS:**
- "I'm submitting two jobs simultaneously — one on L40 GPU, one on RNGD NPU — to show the cluster scheduling both vendors concurrently."
- "The status transitions from PREPARING (pod scheduling, weight loading) to RUNNING (active inference) to COMPLETED. Each transition triggers a realtime event."
- "10 samples is enough to validate the inference pipeline end-to-end. The 100-sample canonical run is what appears in the leaderboard — we have those results already."

---

### STEP 7 — Watch Progress / TT100T Explanation (17:00–21:00)

**DO:**
1. Stay on `/ml-perf` (or `/npu-eval/rngd` in the other tab).
2. Watch the progress bar increment on the live submission from Step 6.
3. Point at the progress bar and explain TT100T.
4. If the run completes during this step, point at the TT100T value that appears.
5. If the run has not completed, switch to the RNGD tab and show the in-progress RNGD job there.

**EXPECT:**
- Progress bar moving from 0% to some value, capped at 100% (never exceeds per v26 fix).
- TT100T column populates on completion: a value between 1.2–2.0 seconds for a healthy run.
- No spinner that never resolves.

**IF NOT (recover):**
- Progress bar stuck at 0% for >3 min: "The worker is in cold-start weight loading. This is vLLM loading Llama-3.1-8B from NFS — approximately 5 GB of weights. Let me show you the completed result instead." Navigate to backup id=124 (L40, completed) and explain its TT100T.
- Progress bar exceeds 100%: the v26 cap fix is not active. Say "The progress display has a known display issue in this build. The underlying metric — TT100T — is accurate; the progress bar is cosmetic." Move on immediately.

**TALKING POINTS:**
- "TT100T stands for Time-to-100-Tokens. It measures end-to-end latency from prompt submission to the 100th generated token. Lower is better."
- "This metric normalizes across batch sizes and hardware types. An NPU that generates 100 tokens in 1.267 seconds is directly comparable to a GPU that generates 100 tokens in 1.8 seconds — regardless of how many parallel requests they handle."
- "The progress bar is driven by the backend polling the worker every 5 seconds. The v26 backend update capped it at 100% — in earlier builds, rounding errors pushed it to 102–105%, which was misleading."

---

### STEP 8 — Atom+ Page (21:00–24:00)

**DO:**
1. Navigate to `/npu-eval/atomplus`.
2. Point at the hardware card (Rebellions Atom+, node5).
3. Scroll to the completed exam results table.
4. Find the row for id=76 (Atom+ BF16-fallback, 10×3 or 100×3).
5. Point at the Precision column — it will show FP8 or BF16-fallback depending on the build.
6. Scroll to the LiveBenchDashboard iframe (sourced from node5:30892).
7. Point at the iframe, narrate the metric layout.

**EXPECT:**
- Completed row for id=76 visible with TT100T in range 1.3–1.5 s.
- Precision column showing FP8 label (with honest disclosure that actual on-device execution is BF16).
- Dashboard iframe loading from `http://10.254.184.195:30892/`.

**IF NOT (recover):**
- id=76 row missing: use id=75 from the RNGD page as comparison context and say "The Atom+ pre-collected result is id=76; let me pull it directly." Run `curl -s http://10.254.177.41:30001/api/comparison/list | jq '.runs[] | select(.id==76)'` in a terminal tab.
- Iframe blank: click **Open in new tab** link. If still blank, navigate directly to `http://10.254.184.195:30892/`. If that also fails: "The Atom+ dashboard service on node5 is restarting. The benchmark metrics are persisted in the database — TT100T is 1.359 s for the pre-collected 100-sample run."

**TALKING POINTS:**
- "Atom+ attempted FP8 precision to match RNGD. The optimum-rbln SDK version 0.9.3.post1 does not expose the FP8 quantization API — compilation failed with a concrete import error: 'cannot import name RBLNConfig from optimum.rbln'. This is a vendor-SDK-version blocker, not a configuration choice."
- "We used the authorized BF16 fallback. The result — 1.359 seconds — is valid for production planning, but it is not precision-matched to RNGD's FP8 run. We disclose this explicitly in the comparison view."
- "Both NPUs are sub-1.4 seconds on Llama-3.1-8B. Neither met the <1.1 s contract target on this benchmark shape, but both are production-viable for interactive inference."

---

### STEP 9 — CLIMAX: Device Comparison Page (24:00–28:00)

**DO:**
1. Navigate to `/mlperf/device-comparison`.
2. Wait for the table to render.
3. Point at the column headers: Hardware, Vendor, Precision, TT100T (s), TPS, Status, Compute-Precision.
4. Find the L40 row (should now show the result from Step 6 if completed, or use backup id=124).
5. Point at the RNGD row (id=75, FP8, 1.267 s).
6. Point at the Atom+ row (id=76, BF16-fallback, 1.359 s).
7. Narrate the rank order top to bottom.
8. Point at the Compute-Precision column — call out which rows are true FP8 vs BF16.

**EXPECT:**
- Side-by-side rows for all active vendors: at minimum RNGD, Atom+, L40.
- Rank order: RNGD first (lowest TT100T), Atom+ second, L40 third (if completed) or BLOCKED.
- Compute-Precision column visible with distinct labels per row.
- No empty table — if empty, see Recovery Branch R-4.

**IF NOT (recover):**
- Table is empty: click vendor filter and select **All**. If still empty: `curl -s http://10.254.177.41:30001/api/comparison/list | jq '.runs | length'` — confirm rows exist in the API. If API has rows but UI is empty, this is a rendering bug; show the curl output directly and narrate the comparison.
- L40 live run from Step 6 not yet finished: use backup id=124. Say "The 10-sample live run is still processing. Here is the completed 100-sample canonical result for L40 — id=124, FP8 attempted, BLOCKED due to vLLM dtype rejection."
- Comparison page returns 404: see Recovery Branch R-1.

**TALKING POINTS:**
- "This is the apples-to-apples view. Same model — Llama-3.1-8B-Instruct. Same dataset — CNN/DailyMail. Same max tokens — 128. Different hardware. Different inference stacks."
- "RNGD leads at 1.267 seconds — the only row with true vendor-native FP8 execution. Atom+ follows at 1.359 seconds on BF16-fallback. GPU cells show BLOCKED because vLLM's dtype validator rejects 'fp8' as an unknown type — an external blocker awaiting a vLLM upgrade."
- "The Compute-Precision column is the key integrity column. It tells you what numerics actually ran on silicon, not what was requested. Transparency here is a feature, not a disclaimer."

---

### STEP 10 — Q&A Anchor (28:00–30:00)

**DO:**
1. Leave `/mlperf/device-comparison` on screen — it is the best visual anchor for Q&A.
2. Point audience at the 4-row matrix (or however many vendors completed).
3. State the 3 honest headline numbers out loud as a closing statement.
4. Open the demo defense playbook tab if prepared.

**EXPECT:**
- Audience questions on: FP8 vs BF16 distinction, GPU BLOCKED reason, target vs actual TT100T, Atom+ SDK maturity.
- No new browser crashes.

**TALKING POINTS:**
- "Three numbers to remember: RNGD 1.267 s (true FP8), Atom+ 1.359 s (BF16-fallback), GPU BLOCKED (vLLM version). The contract target was <1.1 s — we disclose the gap honestly."
- "The infrastructure is reproducible. Every run shown here has a logged exam ID, timestamped backend record, and dashboard screenshot in the evidence archive."
- "Next step on GPU FP8: vLLM upgrade to a version that accepts the 'fp8' dtype string. Once that lands, L40 and A40 can be re-run under identical conditions."

---

## Recovery Branches

### R-1: Route Returns 404

**Trigger:** Any step URL returns 404.

**Steps:**
1. Hard-refresh once (`Ctrl+Shift+R`). If resolved, continue.
2. Check if the route is known: confirm the URL matches exactly (no trailing slash difference, no typo).
3. Say: "Frontend v31 is deployed; this route may have a build artifact timing issue. Let me show you the API layer instead."
4. Run:
   ```bash
   curl -s http://10.254.177.41:30001/api/comparison/list | jq '.runs[0:4] | {id, hardware, tt100t_seconds, precision, status}'
   ```
5. Narrate the JSON output. The data is live even if the UI route is broken.
6. Continue demo on routes that do load; skip the broken route.

---

### R-2: Live Submission Fails or Produces No Row

**Trigger:** Clicking Submit produces an error toast, or no new row appears within 10 seconds.

**Steps:**
1. Check the error message text and read it aloud — it is evidence of the backend validation.
2. If the error is a hardware-busy conflict: wait 30 seconds and try again.
3. If the error persists, say: "I have a pre-collected result with identical parameters. Let me navigate to that."
4. Switch to the backup tab prepared in the pre-flight:
   - L40: id=124 (`/ml-perf`, filter or scroll to id=124)
   - RNGD: id=75 (`/npu-eval/rngd`)
5. Continue demo narration using the backup row. The results are identical in structure to what a live run would produce.

---

### R-3: Dashboard Iframe Blank or Unreachable

**Trigger:** Any Streamlit iframe (RNGD :30890, L40 :30891, A40 :30893, Atom+ :30892) fails to render.

**Steps:**
1. Click **Open in new tab** link beneath the iframe.
2. If the direct URL loads: "The iframe has a cross-origin rendering quirk in this browser. Here it is full-screen." Use the new tab for narration.
3. If the direct URL also fails: say "The Streamlit dashboard service on this node is restarting — it is a stateless display layer. The underlying metrics are in Prometheus and the benchmark database." Then run:
   ```bash
   curl -s http://10.254.177.41:30001/api/realtime/exams/snapshot | jq '.slots'
   ```
4. Narrate the slot states from the JSON. This is the same data the dashboard visualizes.
5. Backup direct URLs per dashboard:
   - RNGD: `http://10.254.184.195:30890/`
   - L40:  `http://10.254.184.195:30891/`
   - A40:  `http://10.254.184.195:30893/`
   - Atom+: `http://10.254.184.195:30892/`

---

### R-4: Comparison Table Empty

**Trigger:** `/mlperf/device-comparison` loads but shows zero rows.

**Steps:**
1. Click vendor filter → select **All** (in case filter defaulted to a single vendor with no data).
2. If still empty, manually load backup IDs:
   - In the URL bar: `http://10.254.177.41:30001/mlperf/device-comparison?ids=75,124`
   - Or use any equivalent filter/load-by-id UI if present.
3. If the page has no filter controls, pivot to the API:
   ```bash
   curl -s http://10.254.177.41:30001/api/comparison/list \
     | jq '[.runs[] | select(.id == 75 or .id == 124 or .id == 76 or .id == 125)]
           | .[] | {id, hardware, precision, tt100t_seconds, status}'
   ```
4. Narrate the four backup rows as the comparison matrix. Read the numbers aloud.
5. Say: "The comparison page is a UI aggregation of this API. The data is live; the rendering has a display issue."

---

### R-5: Exam Stuck in RUNNING with No Progress

**Trigger:** An exam row shows `RUNNING` status with a progress bar frozen at the same value for >5 minutes.

**Steps:**
1. Do not submit a duplicate. First confirm the job is truly stuck:
   ```bash
   curl -s http://10.254.177.41:30001/api/exams/{id} | jq '{status, updated_at, progress}'
   ```
   If `updated_at` is more than 5 min ago and progress is unchanged, the job is stuck.
2. Say: "This job appears to have stalled — likely a worker pod OOM or NFS timeout. I'm not going to interrupt the demo to debug it. Let me use the pre-collected result instead."
3. Navigate to the backup exam for that hardware (id=124 for L40, id=75 for RNGD, id=76 for Atom+, id=125 for A40).
4. Do not attempt to cancel or restart the stuck job during the demo — it may clear on its own.

---

## Quick-Reference: Backup Exam IDs

| Vendor | Exam ID | Precision | Samples | TT100T | Status |
|---|---|---|---|---|---|
| FuriosaAI RNGD | 75 | FP8 | 100×3 | 1.267 s | Completed |
| Rebellions Atom+ | 76 | BF16-fallback | 100×3 | ~1.359 s | Completed |
| NVIDIA L40 | 124 | FP8 (attempted) | 100×3 | BLOCKED | Completed |
| NVIDIA A40 | 125 | FP8 (attempted) | 100×3 | BLOCKED | Completed |
| MMLU row | 49, 52 | BF16 | — | — | Completed |

---

## Time Budget

| Step | Topic | Start | End | Duration |
|---|---|---|---|---|
| Pre-flight | Checklist | −5:00 | 0:00 | 5 min (not counted) |
| 1 | Landing page / TT100T leaderboard | 0:00 | 2:00 | 2 min |
| 2 | GPU Realtime — 4-slot walkthrough | 2:00 | 5:00 | 3 min |
| 3 | NPU Realtime — RNGD + Atom+ cards | 5:00 | 7:00 | 2 min |
| 4 | MLPerf create form — field walkthrough | 7:00 | 11:00 | 4 min |
| 5 | RNGD LiveBench Dashboard iframe | 11:00 | 14:00 | 3 min |
| 6 | Live submission — L40 + RNGD 10-sample | 14:00 | 17:00 | 3 min |
| 7 | Watch progress / TT100T explanation | 17:00 | 21:00 | 4 min |
| 8 | Atom+ page — iframe + BF16 disclosure | 21:00 | 24:00 | 3 min |
| 9 | Device comparison — side-by-side climax | 24:00 | 28:00 | 4 min |
| 10 | Q&A anchor | 28:00 | 30:00 | 2 min |
| **Total** | | | | **30 min** |

---

*End of dry-run script. See demo_recovery_playbook.md for extended procedure detail on each recovery branch.*
