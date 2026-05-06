# Demo Video Recording Checklist
**Date:** May 7, 2026  
**Duration:** ~15 minutes  
**Purpose:** Live cluster demonstration for stakeholders

---

## Pre-Recording Setup (30 min before)

- [ ] **Network Connectivity**
  - Verify dashboard accessible: `curl -s http://10.254.177.41:30001 | head -10`
  - Expected: HTML response (not connection refused)
  - Backup: Ensure cellular hotspot available if WiFi fails

- [ ] **Browser Setup**
  - Open incognito window (clean cache)
  - Clear cookies: `chrome://settings/content/cookies`
  - Zoom level: 110% (readable but fits in frame)
  - Disable extensions: Settings → Extensions → toggle off all

- [ ] **Dashboard Refresh**
  - Navigate to http://10.254.177.41:30001
  - Hard refresh: Ctrl+Shift+R (clear cache)
  - Wait for data to load (should take <3 sec)
  - Verify: Node count shows 6, status colors match

- [ ] **Display & Audio**
  - Monitor resolution: 1920x1080 (or native, no scaling)
  - Audio: Mic working → record test sound
  - Screen recording tool ready: OBS, ScreenFlow, or built-in

- [ ] **Tabs & Windows**
  - Tab 1: Dashboard (http://10.254.177.41:30001)
  - Tab 2: CSV export (ready to download)
  - Tab 3: Terminal (pre-positioned for curl commands)
  - Tab 4: Markdown report (benchmark_findings_report.md)
  - Close all other tabs

- [ ] **Terminal Readiness**
  - Font size: 18pt (readable on video)
  - Background: Dark terminal (good contrast)
  - Pre-load commands: `history | tail -20` should show benchmark commands
  - Test SSH: `ssh node5 hostname` (should return "node5")

- [ ] **Cluster State Check**
  - Verify at least 1 running/pending job: `curl -s http://10.254.177.41:30001/api/comparison/list?limit=500 | grep -c "Running"`
  - Expected: ≥1 (for "live run" demo point)
  - If none running, schedule quick RNGD run before recording

---

## Recording Script (15 min total)

### SEGMENT 1: Dashboard Overview (2 min)

**Shot 1: Wide View of Dashboard**
- [ ] Record START
- [ ] Narrate: "This is the ETRI LLM Benchmark Dashboard. It aggregates results from our 6-node k8s cluster across 110 benchmark runs."
- [ ] Pan across node list (left sidebar)
  - Point: "6 nodes: 2 L40s (GPU latency), 2 A40s (GPU throughput), 1 RNGD (NPU latency), 1 ATOM+ (compact NPU)"
- [ ] Highlight status indicators
  - Point: "Green = healthy, Yellow = working, Red = error"

**Shot 2: Summary Stats**
- [ ] Click on "Summary" or wait for top-of-page stats to appear
- [ ] Narrate: "Total 110 runs: 103 completed, 2 failed on A40 (2% error rate), 1 running on RNGD"
- [ ] Show TT100T range: "Best TT100T: 0.00s (RNGD), Worst: 3,521s (A40)"
- [ ] Show MMLU range: "MMLU accuracy ranges from 0% to 49%, with GPU showing ~45% average"
- [ ] Record duration: 2 min

---

### SEGMENT 2: Comparison UI (4 min)

**Shot 3: Filter Setup**
- [ ] Click "Filter" or "Advanced Search"
- [ ] Narrate: "Let's compare L40 vs. RNGD on the MLPerf benchmark"
- [ ] Set filters:
  - [ ] Benchmark = "mlperf"
  - [ ] Hardware = "NVIDIA-L40" (click to select)
  - [ ] Status = "Completed"
  - [ ] Click "Apply"
- [ ] Wait for UI to update (should be <2 sec)
- [ ] Record duration: 1 min

**Shot 4: L40 Results View**
- [ ] Narrate: "Here are the 20 completed L40 MLPerf runs"
- [ ] Point out columns:
  - "TT100T (time-to-100-tokens) in seconds — this is our latency metric"
  - "TPS (tokens per second) — this is throughput"
  - "Status shows all completed; artifacts link to detailed logs"
- [ ] Note the range: "All L40 runs between 1,082 and 2,679 seconds"
- [ ] Record duration: 1 min

**Shot 5: Switch to RNGD Filter**
- [ ] Click "Clear Filters" or modify Hardware selection
- [ ] Change Hardware = "RNGD"
- [ ] Click "Apply"
- [ ] Wait for refresh
- [ ] Narrate: "Now look at the 40 RNGD runs"
- [ ] Point out: "All TT100T values between 0 and 2.1 seconds — massive difference"
- [ ] Highlight: "Every single run meets the <1.1s goal (shown in green)"
- [ ] Record duration: 1.5 min

**Shot 6: Comparison View (Optional Advanced Feature)**
- [ ] If UI has "Compare" mode: click it
- [ ] Select L40 and RNGD side-by-side
- [ ] Narrate: "3,223× faster on latency. RNGD wins decisively."
- [ ] Record duration: 0.5 min (skip if UI doesn't support)

---

### SEGMENT 3: Data Export & Verification (3 min)

**Shot 7: CSV Export**
- [ ] Click "Export" or "Download CSV"
- [ ] Narrate: "Let's verify the data by exporting to CSV"
- [ ] Wait for download to complete
- [ ] Observe: "benchmark_results.csv saved to downloads"
- [ ] Record duration: 0.5 min

**Shot 8: Terminal Verification**
- [ ] Switch to terminal window
- [ ] Command: `head -3 ~/Downloads/benchmark_results.csv`
- [ ] Narrate: "Opening the CSV, we see columns: ID, benchmark, hardware, TT100T, accuracy, etc."
- [ ] Show output (should display header row and 2 data rows)
- [ ] Record duration: 1 min

**Shot 9: Count Verification**
- [ ] Command: `grep -c "mlperf" ~/Downloads/benchmark_results.csv`
- [ ] Expected output: ~90 (MLPerf runs)
- [ ] Narrate: "90 MLPerf runs in the export — matches our 103 total (remaining are MMLU)"
- [ ] Record duration: 0.5 min

**Shot 10: CURL Verification (Live API)**
- [ ] Command: `curl -s http://10.254.177.41:30001/api/comparison/list?limit=500 | python -m json.tool | head -20`
- [ ] Narrate: "Calling the live API endpoint directly — same data, JSON format"
- [ ] Show JSON structure: "Each run has ID, hardware, status, metrics (TT100T, accuracy)"
- [ ] Record duration: 1 min

---

### SEGMENT 4: Detailed Run Drill-Down (3 min)

**Shot 11: Single Run Details**
- [ ] Go back to Dashboard
- [ ] Click on any RNGD MLPerf run (e.g., first one in the list)
- [ ] Narrate: "Let's examine one RNGD run in detail"
- [ ] Show metadata:
  - "ID: [run ID], Status: Completed"
  - "Hardware: RNGD, Model: Llama-3.1-8B-Instruct"
  - "Precision: BF16, Dataset: CNN-DailyMail"
  - "Metrics: TT100T=0.54s, TPS=185.2 tokens/sec"
- [ ] Record duration: 1.5 min

**Shot 12: Artifacts & Logs**
- [ ] Show Artifacts section (if available)
- [ ] Narrate: "Each run has artifacts: logs, result zip file with detailed metrics"
- [ ] Click on artifact (if allowed): "This would open the exam_result.zip containing tokenization logs, latency histograms, etc."
- [ ] Record duration: 0.5 min

**Shot 13: A40 Error Run (Optional, for transparency)**
- [ ] Filter: Hardware = "NVIDIA-A40", Status = "Error"
- [ ] Click on error run
- [ ] Narrate: "We had 2 failed runs on A40. Here's the error message..."
- [ ] Show error details (e.g., "CUDA out of memory" or "timeout")
- [ ] Narrate: "This was isolated to early testing; later A40 runs completed successfully."
- [ ] Record duration: 1 min (optional)

---

### SEGMENT 5: Closing Narration (1 min)

**Shot 14: Summary Slide or Dashboard Overview**
- [ ] Show full dashboard one more time
- [ ] Narrate closing statement:
  > "In summary, we've benchmarked 110 runs across 6 hardware targets. The data shows RNGD NPU is 3,223× faster than L40 GPU on latency (0.54s vs 1,741s TT100T). GPUs and NPUs achieve similar accuracy on knowledge benchmarks (~45% MMLU). This supports a hybrid deployment strategy: NPUs for latency-critical workloads, GPUs for accuracy-critical ones."
- [ ] Record duration: 1 min

---

## Recording Quality Checklist

**During Recording:**
- [ ] Audio: Clear narration, no background noise
- [ ] Video: Smooth scrolling, no jerky movements
- [ ] Timing: Pauses to let viewers digest data (3–5 sec per point)
- [ ] Clarity: Font large enough (18pt+), colors distinct
- [ ] Focus: Stay on relevant UI elements; minimize off-screen clicks

**After Recording:**
- [ ] Playback: Watch 5–10 min segment to check quality
- [ ] Audio: No clipping, volume normalized (~-3dB peak)
- [ ] Sync: Video and narration in sync (no lag)
- [ ] Completeness: All shots captured; no missing segments

---

## Post-Recording Editing (if needed)

**Suggested Edits:**
- [ ] Add title card (0–3 sec): "ETRI LLM Benchmark Demo — May 7, 2026"
- [ ] Add timestamps to each segment (corner overlay)
- [ ] Zoom in on terminal output for clarity (1.2x zoom)
- [ ] Add captions for key metrics (e.g., "RNGD: 0.54s TT100T")
- [ ] Speed up repetitive scrolling (1.5x speed)
- [ ] Add background music (optional, low volume)
- [ ] End card (last 5 sec): Contact info, GitHub link

**File Output:**
- [ ] Format: MP4 (H.264 codec)
- [ ] Resolution: 1920x1080 (Full HD)
- [ ] Frame rate: 30 fps
- [ ] Bitrate: 8–12 Mbps (high quality)
- [ ] File size: ~150–200 MB for 15 min video

---

## Backup Plan (if live demo fails)

- [ ] **No Network Access:**
  - Use pre-recorded screenshots (saved in `reports/20260506-presentation/screenshots/`)
  - Transition via "Here's what the dashboard looks like..." narration
  - Play pre-made video clips of API responses

- [ ] **Dashboard Offline:**
  - Fall back to CSV export demonstration in terminal
  - Show JSON API response from curl (pre-recorded if needed)
  - Narrate: "The API is currently being refreshed; here's the data from 30 seconds ago..."

- [ ] **Recording Software Crashes:**
  - Have backup recording tool ready (OBS + ScreenFlow, or two browsers)
  - Resume recording from last checkpoint
  - Edit segments together in post-production

- [ ] **Cluster Issue (Running Job Disappeared):**
  - Show historical data instead
  - Narrate: "Earlier today we had a run in progress; here's the real-time view..."
  - Focus on completed runs (more stable for demo)

---

## Timing Breakdown

| Segment | Duration | Cumulative |
|---------|----------|-----------|
| Setup & Network check | 5 min | 5 min |
| Dashboard overview | 2 min | 7 min |
| Comparison filters | 4 min | 11 min |
| CSV export & terminal | 3 min | 14 min |
| Detail drill-down | 3 min | 17 min |
| Closing narration | 1 min | 18 min |
| **Total Recording** | **~15 min** | — |
| Buffer time (retakes) | +10 min | 25 min |

---

## Day-Of Checklist (May 7, 2026)

**Morning (before demo):**
- [ ] 2 hours before: Test cluster connectivity
- [ ] 1 hour before: Prepare terminal (clear history if needed)
- [ ] 30 min before: Run pre-recording setup checklist
- [ ] 15 min before: Record intro/outro
- [ ] 10 min before: Start main recording

**During Recording:**
- [ ] Monitor audio levels (should stay in green)
- [ ] Watch screen for errors/popups (minimize distractions)
- [ ] Pace narration: speak clearly, leave pauses

**After Recording:**
- [ ] Save file with timestamp: `demo_20260507_ETRI_LLM_benchmark.mp4`
- [ ] Backup to two locations (local + cloud)
- [ ] Preview a 2–3 min segment before sending to stakeholders

---

## Delivery

- [ ] Upload to: [Video hosting platform, e.g., internal SharePoint, Google Drive]
- [ ] Send link to: [Stakeholder emails]
- [ ] Include: Benchmark findings report, CSV data, and reproducibility guide
- [ ] Message: "Demo video ready for review. Data and full reproducibility guide attached."

---

**Demo Video Status:** READY TO RECORD  
**Last Updated:** May 6, 2026, 01:00 UTC  
**Recorder:** [Name]  
**Equipment:** [Laptop model, OS, software versions]
