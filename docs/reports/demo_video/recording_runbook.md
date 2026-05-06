---
title: Demo Video Recording Runbook
version: 1.0
prepared_by: w-video-record
task: WS-5 (#12)
cluster_url: http://10.254.177.41:30001/
rngd_streamlit: http://10.254.202.114:30890/
---

# Demo Video Recording Runbook

## 1. Pre-Flight Gate Checklist

All items must be GREEN before any recording begins.

### 1.1 Dependency Completion Gate (hard blocks)
- [ ] Task #7 COMPLETED — WS-1.6 4-row apples-to-apples matrix verified on /mlperf/device-comparison
- [ ] Task #8 COMPLETED — WS-2 dashboard leak fix deployed (frontend v28+)
- [ ] Task #9 COMPLETED — WS-3 dashboard parity + Compute-Precision column deployed
- [ ] Task #11 COMPLETED — WS-4.2 concurrent matrix soak pass certificate exists

### 1.2 Cluster Health Gate
```bash
# Verify frontend is responding
curl -s -o /dev/null -w "%{http_code}" http://10.254.177.41:30001/
# Expected: 200

# Verify backend API is responding
curl -s http://10.254.177.41:30980/api/comparison/list | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK: {len(d)} rows')"

# Verify RNGD Streamlit is responding
curl -s -o /dev/null -w "%{http_code}" http://10.254.202.114:30890/
# Expected: 200

# Verify 4-row matrix endpoint
curl -s "http://10.254.177.41:30980/api/mlperf/device-comparison" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2))" | head -30
```

### 1.3 Data Gate (DB rows must exist)
```bash
# Verify RNGD row (id=75 or equivalent)
curl -s http://10.254.177.41:30980/api/comparison/list | python3 -c "
import sys, json
rows = json.load(sys.stdin)
rngd = [r for r in rows if 'furiosa' in str(r).lower() or 'rngd' in str(r).lower()]
gpu_l40 = [r for r in rows if 'l40' in str(r).lower()]
gpu_a40 = [r for r in rows if 'a40' in str(r).lower()]
atom = [r for r in rows if 'rebellions' in str(r).lower() or 'atom' in str(r).lower()]
print(f'RNGD rows: {len(rngd)}, L40 rows: {len(gpu_l40)}, A40 rows: {len(gpu_a40)}, Atom+ rows: {len(atom)}')
"
```

### 1.4 Browser Setup
- Browser: Chromium (use the playwright-installed chromium, or Chrome/Chromium on the demo machine)
- Zoom level: 90% (Ctrl+- once from 100%)
- Viewport: 1280x900 minimum; 1920x1080 preferred for recording
- Open browser DevTools console HIDDEN during recording
- Have these tabs pre-loaded before recording each segment:
  - Tab 1: http://10.254.177.41:30001/ (home)
  - Tab 2: http://10.254.177.41:30001/npu-eval/rngd
  - Tab 3: http://10.254.177.41:30001/npu-eval/atomplus
  - Tab 4: http://10.254.177.41:30001/ml-perf
  - Tab 5: http://10.254.177.41:30001/mlperf/device-comparison

---

## 2. Recording Tools

### Option A: Playwright Automated Recording (PREFERRED for headless environment)

Playwright is installed at:
`/home/kcloud/etri-llm-exam-solution/web/node_modules/.bin/playwright`

Playwright supports `video: 'on'` in the test context. A video-recording Playwright spec
is authored at `docs/reports/demo_video/playwright_video_record.spec.ts`.

Run command (from web/ directory):
```bash
cd /home/kcloud/etri-llm-exam-solution/web
E2E_BASE_URL=http://10.254.177.41:30001 \
  PWVIDEO_DIR=/home/kcloud/etri-llm-exam-solution/docs/reports/demo_video/segments \
  npx playwright test \
  ../docs/reports/demo_video/playwright_video_record.spec.ts \
  --reporter=line \
  --video=on \
  --output=/home/kcloud/etri-llm-exam-solution/docs/reports/demo_video/segments
```

Output: One `.webm` video per test block, placed in the segments/ directory.

### Option B: ffmpeg + Xvfb (if display available)

**Install (requires team-lead authorization):**
```bash
sudo apt-get install -y ffmpeg xvfb
```

**Run with virtual display:**
```bash
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
# Open Chromium pointing to the demo URL
chromium-browser --no-sandbox --window-size=1920,1080 http://10.254.177.41:30001/ &
# Record
ffmpeg -video_size 1920x1080 -framerate 30 -f x11grab -i :99.0 \
  /home/kcloud/etri-llm-exam-solution/docs/reports/demo_video/segments/segment-1.mp4
# Stop with Ctrl+C when done with that segment
```

### Option C: OBS Studio (requires physical display + team-lead authorization)

**Install:**
```bash
sudo apt-get install -y obs-studio
```

OBS requires a graphical display (Wayland or X11). Not viable in headless SSH sessions.
Use only when recording from the demo presenter's workstation directly.

**OBS Scene Setup:**
- Scene: "ETRI Demo"
- Source: Screen Capture (select the browser window)
- Output: MP4, H.264, 1920x1080, 30fps, CRF 18
- Audio: Microphone (built-in or USB) — enable noise suppression
- Output path: docs/reports/demo_video/segments/segment-N.mp4

### Option D: asciinema (terminal-only fallback)

Only useful if the demo degrades to a pure CLI walkthrough. Not suitable for browser UI demo.

---

## 3. Recording Protocol

### Per-Segment Rules
1. **Rehearse first** — navigate the full segment path once WITHOUT recording. Validate every
   expected element loads. If anything is broken, do NOT record. File ESCALATION.
2. **Clean slate** — before recording each segment, clear browser history/cookies if needed,
   return to segment start URL.
3. **Cut on error** — if a visible toast/error banner appears during recording, stop immediately,
   retake from the segment start. Never continue recording through an error.
4. **Max 3 retakes** per segment. If still failing after 3 retakes, send [ESCALATION REQUIRED]
   to team-lead with: segment number, visible error text, URL, screenshot.
5. **Pause between actions** — at each "screenshot moment" in the storyboard, pause 3 seconds
   to let the UI fully render before advancing.
6. **Do NOT trigger large benchmarks** — for any "launch a benchmark" demo step, use
   n_samples=5 (not 100) to keep recording brisk. Annotate the narration accordingly.

### Segment Timing Budget
| Segment | Target Duration | Max Retake Budget |
|---------|----------------|-------------------|
| 1 — Home + Leaderboard | 2 min | 3 retakes |
| 2 — RNGD Evaluation | 5 min | 3 retakes |
| 3 — Atom+ Evaluation | 5 min | 3 retakes |
| 4 — GPU MLPerf + MMLU + Climax | 7 min | 3 retakes |
| 5 — Concurrent 6-device run | 5 min | 3 retakes |
| **Total** | **~24 min** | |

---

## 4. Post-Recording

### Combine segments (if ffmpeg available)
```bash
cd /home/kcloud/etri-llm-exam-solution/docs/reports/demo_video

# Create a file list
cat > /tmp/segment_list.txt << 'EOF'
file 'segments/segment-1.mp4'
file 'segments/segment-2.mp4'
file 'segments/segment-3.mp4'
file 'segments/segment-4.mp4'
file 'segments/segment-5.mp4'
EOF

ffmpeg -f concat -safe 0 -i /tmp/segment_list.txt -c copy etri_demo_v1.mp4
```

For Playwright .webm files:
```bash
ffmpeg -i segments/segment-1.webm -c:v libx264 -c:a aac segments/segment-1.mp4
# repeat for each, then concat
```

### SHA-256 Manifest
```bash
cd /home/kcloud/etri-llm-exam-solution/docs/reports/demo_video
sha256sum segments/segment-*.{mp4,webm} etri_demo_v1.mp4 2>/dev/null > manifest.txt
cat manifest.txt
```

---

## 5. Acceptance Gate

Before declaring WS-5 COMPLETE, verify ALL:
- [ ] 5 segment files exist in docs/reports/demo_video/segments/
- [ ] Zero error toasts/banners visible in any segment
- [ ] Segment 4 shows the 4-row apples-to-apples TT100T matrix on /mlperf/device-comparison
- [ ] Segment 5 shows at least 4 devices running concurrently on the home leaderboard
- [ ] manifest.txt exists with SHA-256 hashes
- [ ] etri_demo_v1.mp4 exists (combined) OR all 5 segment files are individually deliverable

---

## 6. Escalation Triggers (send [ESCALATION REQUIRED] to team-lead)

| Trigger | Message to Include |
|---------|-------------------|
| /mlperf/device-comparison shows <4 rows | Matrix row count, which HW is missing, blocking task# |
| RNGD Streamlit iframe blank after 30s | curl status code to :30890, screenshot |
| Any page returns 404 or 502 | URL, HTTP status, pod status output |
| Segment fails >3 retakes | Segment#, error text, screenshot |
| Recording tool unavailable | Which options were tried, install commands needed |
