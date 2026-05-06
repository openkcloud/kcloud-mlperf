---
title: Demo Video Segment Storyboard
version: 1.0
prepared_by: w-video-record
task: WS-5 (#12)
based_on: demo_script_tomorrow.md + demo_video_consensus_plan.md §WS-5 + ADDENDUM A
---

# Demo Video Segment Storyboard

5 segments, each atomic. Failure of one does not invalidate others.
CLIMAX = Segment 4, step 6: 4-row apples-to-apples TT100T matrix on /mlperf/device-comparison.

---

## Segment 1 — Home Page + Leaderboard
**URL start:** http://10.254.177.41:30001/
**Target duration:** 2 minutes
**File:** segments/segment-1.{mp4,webm}

### Steps

| # | Action | Expected Visible Result | Pause |
|---|--------|------------------------|-------|
| 1.1 | Load http://10.254.177.41:30001/ | Home page renders; 3 vendor cards visible (NVIDIA, FuriosaAI, Rebellions) | 4s |
| 1.2 | Point to NVIDIA card | "NVIDIA" label visible with GPU hardware info | 2s |
| 1.3 | Point to FuriosaAI card | "FuriosaAI RNGD" label visible | 2s |
| 1.4 | Point to Rebellions card | "Rebellions Atom+" label visible | 2s |
| 1.5 | Scroll down to TT100T Leaderboard | Leaderboard table visible with at minimum: RNGD (1.267s) and Atom+ (1.375s) rows | 3s |
| 1.6 | Highlight RNGD row | TT100T=1.267s, precision=FP8 visible | 3s |
| 1.7 | Highlight Atom+ row | TT100T=1.375s visible | 3s |
| 1.8 | Scroll to Recent Activity | Table shows recent benchmark executions across vendors | 3s |
| 1.9 | Scroll to Quick Links | All 6 navigation links visible | 2s |

### Narration cues
- 1.1: "Welcome to the ETRI LLM benchmark suite. This system evaluates Llama-3.1-8B-Instruct
  inference across three vendor platforms: NVIDIA GPU, FuriosaAI RNGD NPU, and Rebellions Atom+ NPU."
- 1.5: "The TT100T leaderboard shows canonical results. RNGD achieves 1.267 seconds per 100 tokens
  with native FP8. Atom+ delivers 1.375 seconds."
- 1.8: "The recent activity feed reflects live benchmark executions across all vendors."

### Fallback if X breaks
- Leaderboard empty: curl http://10.254.177.41:30980/api/comparison/list in a terminal, show the
  JSON response. Say: "API returns live data; the UI is rendering from this endpoint."
- 404 on home page: Do NOT record. Send [ESCALATION REQUIRED] — home page 404 means frontend is down.

---

## Segment 2 — RNGD NPU Evaluation
**URL start:** http://10.254.177.41:30001/npu-eval/rngd
**Target duration:** 5 minutes
**File:** segments/segment-2.{mp4,webm}

### Steps

| # | Action | Expected Visible Result | Pause |
|---|--------|------------------------|-------|
| 2.1 | Navigate to /npu-eval/rngd | Page loads; "RNGD" header + "New RNGD Exam" button visible | 4s |
| 2.2 | Show hardware card | FuriosaAI RNGD on node4 | 3s |
| 2.3 | Show completed exam results table | Row id=75: furiosa/RNGD, mlperf, Llama-3.1-8B-Instruct, FP8, 100 samples, 128 max_tokens, TT100T=1.267s | 4s |
| 2.4 | Highlight precision column | "FP8" label in the precision cell | 3s |
| 2.5 | Highlight TT100T column | 1.267 visible | 3s |
| 2.6 | Scroll to LiveBenchDashboard | Streamlit iframe from http://10.254.202.114:30890/ loading | 5s |
| 2.7 | Wait for iframe to load | Dashboard content visible inside iframe | 5s |
| 2.8 | Click "RNGD vs GPU Comparison" button | Navigates to /npu-eval/rngd/device-comparison | 4s |
| 2.9 | Show comparison table | RNGD row side-by-side with GPU rows | 4s |

### Narration cues
- 2.1: "RNGD evaluation page. FuriosaAI's NPU is provisioned on node4 in the cluster."
- 2.3: "This is our canonical benchmark result: Llama-3.1-8B-Instruct FP8, CNN/DailyMail
  100 samples, max_tokens=128. TT100T of 1.267 seconds — that is genuine vendor-native FP8
  inference on the NPU."
- 2.6: "The live dashboard pulls directly from the RNGD device's systemd metrics endpoint."
- 2.9: "The comparison view aligns RNGD against other hardware on the same benchmark fingerprint."

### Fallback if X breaks
- Streamlit iframe blank after 30s: Say "The RNGD systemd dashboard is temporarily unreachable;
  the device metrics are collected at http://10.254.202.114:30890/." Show a curl to that URL in
  a side terminal. Do NOT retake for iframe-only issue if the rest of the page is clean.
- Comparison table shows GPU cells as BLOCKED-with-stderr: That is correct and expected. Narrate:
  "GPU cells show BLOCKED status due to vLLM FP8 dtype rejection — this is an honest disclosure
  of the GPU stack's current limitation. WS-1 may have resolved this; if the cells are now
  populated with real TT100T values, highlight them instead."

---

## Segment 3 — Atom+ NPU Evaluation
**URL start:** http://10.254.177.41:30001/npu-eval/atomplus
**Target duration:** 5 minutes
**File:** segments/segment-3.{mp4,webm}

### Steps

| # | Action | Expected Visible Result | Pause |
|---|--------|------------------------|-------|
| 3.1 | Navigate to /npu-eval/atomplus | Page loads; "Atom+" header + "New Atom+ Exam" button visible | 4s |
| 3.2 | Show hardware card | Rebellions Atom+ on nodeX; device Ready state | 3s |
| 3.3 | Show completed exam results table | Row id=74 or id=76: rebellions/Atom+, mlperf, Llama-3.1-8B-Instruct, precision label, 100 samples, 128 max_tokens, TT100T≈1.375s | 4s |
| 3.4 | Highlight precision column | Label shows FP8-fallback or BF16; hover for tooltip if available | 4s |
| 3.5 | Highlight TT100T column | ~1.375s visible | 3s |
| 3.6 | Scroll to LiveBenchDashboard | Atom+ realtime dashboard iframe | 5s |
| 3.7 | Wait for iframe to load | Dashboard content or "Idle" placeholder visible | 4s |

### Narration cues
- 3.3: "Atom+ delivers the same benchmark shape: Llama-3.1-8B-Instruct, 100 samples, max_tokens=128."
- 3.4: "Precision disclosure: the optimum-rbln SDK 0.9.3.post1 does not expose the FP8 quantization
  API — RBLNConfig is not importable at this SDK version. We used the authorized BF16 fallback.
  The on-device numerics are BF16, not FP8. TT100T of 1.375 seconds — about 8% slower than RNGD's
  FP8 result. This is an honest comparison, not an apple-to-apple FP8 match."
- 3.6: "Atom+ device realtime metrics — same dashboard architecture as RNGD."

### Fallback if X breaks
- Atom+ page 404: Do NOT record. Send [ESCALATION REQUIRED] — Atom+ page missing means
  frontend v28 may not be deployed.
- "New Atom+ Exam" button disabled: Acceptable. Say: "Button is gated on device Ready state.
  The device may be temporarily unavailable; completed results are still accessible."
- If node5 is not joined: Mention it in narration as expected: "node5 is in pending state;
  the Atom+ device plugin integration is documented and the benchmark results are already collected."

---

## Segment 4 — GPU MLPerf + MMLU + CLIMAX: 4-row Device Comparison
**URL start:** http://10.254.177.41:30001/ml-perf
**Target duration:** 7 minutes
**File:** segments/segment-4.{mp4,webm}

THIS IS THE CLIMAX SEGMENT. The final step (4.8) MUST show the 4-row apples-to-apples matrix.
If step 4.8 fails, DO NOT release this segment. Send [ESCALATION REQUIRED].

### Steps

| # | Action | Expected Visible Result | Pause |
|---|--------|------------------------|-------|
| 4.1 | Navigate to /ml-perf | MLPerf page loads; header visible | 4s |
| 4.2 | Show Prometheus iframe or idle placeholder | If WS-2 deployed: "Idle — no MLPerf jobs running" placeholder shown when no GPU MLPerf job is active; or live Prometheus if a job IS running | 4s |
| 4.3 | Show MLPerf exam results table | L40 and A40 rows visible; if WS-1 succeeded: real TT100T values; if BLOCKED: BLOCKED-with-stderr cells | 4s |
| 4.4 | Highlight precision / Compute-Precision column | If REV-1 deployed: "Storage Precision" + "Compute Precision" columns visible | 4s |
| 4.5 | Navigate to /mmlu | MMLU page loads; table with subject breakdown visible | 4s |
| 4.6 | Show MMLU results table | Historical MMLU-Pro rows visible | 3s |
| 4.7 | Navigate to /mlperf/device-comparison | Page loads | 5s |
| 4.8 | **[CLIMAX]** Show 4-row apples-to-apples comparison matrix | ALL FOUR rows visible: L40, A40, RNGD, Atom+ — same model/dataset/samples/max_tokens fingerprint — TT100T values in each cell — Compute-Precision column showing per-HW precision label | 8s |
| 4.9 | Scroll through the matrix slowly | All 4 rows fully visible at some point in the recording | 5s |

### Narration cues
- 4.3 (if WS-1 succeeded): "L40 achieves [TT100T]ms with FP8 native inference on sm_89 tensor cores.
  A40 shows [TT100T]ms using FP8 weights with BF16 Marlin dequant compute — sm_86 lacks native
  FP8 tensor cores."
- 4.3 (if BLOCKED): "L40 and A40 cells show BLOCKED due to a vLLM dtype validator rejecting
  the 'fp8' string at runtime — vLLM config.py line 1655. This is an external build constraint,
  not a benchmark configuration issue."
- 4.4: "The Compute-Precision column is a new disclosure column showing the actual compute
  numerics separate from the storage format. This is part of our P-1 apples-to-apples commitment."
- 4.8: "And here is our main result: the 4-row apples-to-apples comparison. Same model,
  same dataset, same 100 samples, same 128 max_tokens — across all four hardware platforms.
  L40, A40, RNGD, and Atom+. The TT100T metric allows direct performance comparison
  normalized per 100 output tokens."

### Fallback if X breaks
- /mlperf/device-comparison shows <4 rows: Do NOT record step 4.8. Send [ESCALATION REQUIRED]
  with: which rows are missing, screenshot, task IDs that should have populated the missing rows.
- Compute-Precision column missing: If WS-3/REV-1 not deployed, narrate around it. Do not lie.
  Say: "The precision disclosure is visible in the existing precision column."
- MMLU page 404: Skip step 4.5-4.6, go directly from 4.4 to 4.7. Note in post: MMLU skipped.

---

## Segment 5 — Concurrent 6-Device Run + Home Leaderboard Live Update
**URL start:** http://10.254.177.41:30001/
**Target duration:** 5 minutes
**File:** segments/segment-5.{mp4,webm}

NOTE: For this recording segment, use n_samples=5 (not 100) to keep recording brisk.
The storyboard narration acknowledges this is a demo-speed run.

### Steps

| # | Action | Expected Visible Result | Pause |
|---|--------|------------------------|-------|
| 5.1 | Start at home page | Home page visible | 2s |
| 5.2 | Open "New Exam" modals (or use API) to queue 2x L40, 2x A40, 1x RNGD, 1x Atom+ jobs | Jobs queued/launched | 5s |
| 5.3 | Navigate to home page Recent Activity | Multiple jobs showing "RUNNING" or "PREPARING" status | 5s |
| 5.4 | Wait 15-30 seconds, refresh / let realtime update | Status chips updating live; multiple hardware rows visible simultaneously | 10s |
| 5.5 | Navigate to /npu-eval/rngd | RNGD dashboard showing active job if RNGD is running | 4s |
| 5.6 | Navigate to /ml-perf | MLPerf dashboard showing live iframe (WS-2 filter should make iframe visible since MLPerf job is running on GPU) | 4s |
| 5.7 | Navigate back to home | Leaderboard begins to show new results as jobs complete | 4s |
| 5.8 | Show Recent Activity with multiple completed rows | 3+ vendors shown with completed status | 5s |

### Narration cues
- 5.2: "We are now launching benchmark jobs across all 6 devices simultaneously. For demo speed,
  we are using 5-sample runs — production runs use 100 samples as shown in the comparison matrix."
- 5.4: "The home page realtime feed shows all 6 devices active concurrently — this is the
  concurrent stability result from WS-4: operator v1.0.3 handling parallel scheduling without
  race conditions."
- 5.6: "Notice the MLPerf dashboard now shows the live Prometheus iframe — it activates only
  when a MLPerf job is actually running on the GPU. Idle pages show a placeholder instead."
- 5.8: "Concurrent multi-vendor benchmarking without errors. All four hardware types, simultaneously."

### Fallback if X breaks
- Jobs fail with errors during recording: Stop recording. This is a segment 5 retake scenario.
  Check kubectl logs for the operator before retaking.
- Realtime not updating: curl http://10.254.177.41:30980/api/realtime/exams/snapshot in a terminal.
  If data is stale, check the realtime gateway logs.
- Atom+ device unavailable: Proceed with 5-device run (2x L40, 2x A40, 1x RNGD). Narrate:
  "Atom+ device is currently in maintenance state; we are demonstrating 5-device concurrent
  scheduling." Per ADDENDUM D triage cut #4 — pre-authorized.

---

## Quick Rehearsal Checklist (run before ANY recording)

```
[ ] Segment 1: Home renders, leaderboard shows RNGD 1.267s + Atom+ 1.375s
[ ] Segment 2: /npu-eval/rngd loads, id=75 row visible, Streamlit iframe loads
[ ] Segment 3: /npu-eval/atomplus loads, id=74 or id=76 row visible
[ ] Segment 4: /ml-perf loads, /mmlu loads, /mlperf/device-comparison shows 4 rows
[ ] Segment 5: 6-device concurrent launch completes without error toasts
[ ] Zero console.error messages on any page (use browser DevTools before recording)
```

If rehearsal finds a defect: DO NOT record. File the defect to the responsible workstream
worker and send [ESCALATION REQUIRED] to team-lead.
