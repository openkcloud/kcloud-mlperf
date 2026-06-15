---
title: Demo Video Checklist — Final
revision: final-resume
mission: benchsuite-resume
date: 2026-05-06
purpose: pre-demo validation checklist; one-off recording day
---

# Demo Video Checklist

This checklist is the dry-run script. Each box must be physically verified before recording. The host must walk the cluster live, NOT the dev server.

## Pre-roll (10 minutes before recording)

- [ ] Kubeconfig loaded; `kubectl get nodes` shows 5 Ready (node1–node5)
- [ ] `kubectl get pods -n llm-evaluation | grep -E "frontend|backend"` shows both Running
- [ ] Frontend image is `jungwooshim/etri-llm-frontend:v26` (current)
- [ ] Backend image is `jungwooshim/etri-llm-backend:v22` (current)
- [ ] `curl http://10.254.177.41:30980/api/realtime/exams/snapshot` returns 200 with 7 slots
- [ ] `curl http://10.254.177.41:30980/api/comparison/list` returns 200 with `data.total >= 123`
- [ ] `curl http://10.254.177.41:30001/` returns the SPA index HTML
- [ ] Browser tab opened on `http://10.254.177.41:30001/` (NOT a deep-link path — nginx config does not currently fall through; deep-links return 404)

## Scene 1 — Home page (`/`)

- [ ] Vendor Cluster card shows 3 ready vendors with NPU/GPU counts
- [ ] TT100T Leaderboard shows at least 2 rows (RNGD 1.27 s and Atom+ 1.37 s)
- [ ] Recent Activity shows MLPerf rows from id=74, id=75 dated 2026-05-06
- [ ] Logo (top-left) → click navigates to `/`

## Scene 2 — RNGD (`/npu-eval/rngd`)

- [ ] Vendor purple identity card visible at top, model=RNGD, node=node4
- [ ] Run table shows id=75 with TT100T badge "1.267 s" and PASS verdict
- [ ] Run table shows id=73 with TT100T badge "1.378 s"
- [ ] **Live Bench Dashboard (node4 — RNGD)** iframe loads (height ~900 px)
- [ ] Active RNGD Benchmarks panel is HIDDEN (no jobs running) — this is correct empty state, NOT a defect

## Scene 3 — Atom+ (`/npu-eval/atomplus`)

- [ ] Vendor purple identity card visible at top, model=Atom+, node=node5, count=2
- [ ] **"New Atom+ Exam"** button is visible (NOT the disabled "exam creation disabled" Alert)
- [ ] Click "New Atom+ Exam" → form opens with FP8 / cnn_dailymail / 100 / max_tokens=128
- [ ] Cancel form → form collapses
- [ ] Run table shows id=74 with TT100T badge "1.375 s" and drift_flag=False
- [ ] **Live Bench Dashboard (node5 — Atom+)** iframe loads

## Scene 4 — MLPerf (`/ml-perf`)

- [ ] MLPerf v5.1 / Accuracy & Performance / Offline & Server chips visible
- [ ] Run table shows recent rows
- [ ] Hide-sweep toggle is checked by default (production mode)
- [ ] **Live GPU Dashboard (MLPerf)** Prometheus iframe present below the table
  - If env var VITE__APP_GPU_PROMETHEUS_URL is set: iframe loads, "Live" green chip
  - If not set: red "Unavailable" chip + diagnosis fallback message — acceptable but call out to viewer

## Scene 5 — MMLU-Pro (`/mmlu`)

- [ ] MMLU-Pro chips at top (Multi-Subject Accuracy, 14 Subject Categories)
- [ ] Results table renders
- [ ] **Live GPU Dashboard (MMLU-Pro)** Prometheus iframe present

## Scene 6 — Cross-vendor comparison (`/ml-perf/device-comparison`)

- [ ] Filter by precision=FP8, samples=100 → 2 rows visible (RNGD, Atom+)
- [ ] Both rows have TT100T values populated (RNGD id=75 = 1.267s [TRUE FP8], Atom+ id=76 = 1.359s [BF16-fallback])
- [ ] L40/A40 rows are NOT visible at this filter (they have null TT100T due to BLOCKED-with-stderr)
- [ ] Host states honestly: "Neither vendor met the <1.1s target on this canonical 8B + 128-token configuration. RNGD ran TRUE FP8 at 1.267s (15% over). Atom+ ran BF16 — FP8 was genuinely impossible per vendor SDK — at 1.359s (24% over). The TT100T comparison is NOT apples-to-apples on the precision axis."

## Scene 7 — Stale-state monitoring (`/dashboard/npu-realtime`)

- [ ] DeviceRealtimeDashboard card grid visible
- [ ] All 3 NPU slots (1 RNGD + 2 Atom+) shown as `idle` if no jobs running
- [ ] Refresh interval is ≤ 5 s (state polled live)

## Scene 8 — GPU realtime (`/dashboard/gpu-realtime`)

- [ ] PrometheusIframeDashboard renders (or fallback)
- [ ] Title is "Live GPU Dashboard"
- [ ] Status chip reflects iframe state (Live / Connecting / Unavailable / Error)

## Scene 9 — BLOCKED disclosure

- [ ] Have the L40 stderr from `mlperf_l40_fp8_141_20260506.log` ready to display:
  ```
  ValueError: Unknown dtype: fp8
  ```
- [ ] Have the A40 stderr from `mlperf_a40_fp8_140_20260506.log` ready
- [ ] Be prepared to point to `docs/reports/benchmark_findings_report.md` BLOCKED section

## Scene 10 — Reproducibility close

- [ ] Reference `docs/reports/reproducibility_guide.md` on screen briefly
- [ ] Show `docs/reports/benchmark_results_real.csv` first 3 lines (header + 2 rows)
- [ ] Mention W-10 export integrity: 0 mock/fake rows

## Post-recording verification

- [ ] Confirm video captured all 10 scenes
- [ ] Confirm BLOCKED stderr was on screen for at least 5 seconds
- [ ] Save artifact paths in this checklist for the post-mortem
- [ ] Run final tsc + jest + vitest on demo-day branch:
  ```
  cd web && npx tsc --noEmit       # 0 expected
  cd server && npx tsc --noEmit    # 0 expected
  cd server && npx jest             # 67/67 expected
  cd web && npx vitest run          # 51/51 expected
  ```
