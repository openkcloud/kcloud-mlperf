---
title: 1-Hour Presentation Outline — ETRI LLM Cluster
revision: final-resume
mission: benchsuite-resume
date: 2026-05-06
target_audience: ETRI stakeholders, vendor reps (FuriosaAI, Rebellions, NVIDIA)
duration: 60 minutes
---

# 1-Hour Presentation Outline — Resume Mission

## 0:00 — Hello & cluster topology (5 min)

- 5 nodes Ready: node1 (control-plane), node2 (L40+A40 GPU), node3 (L40+A40 secondary GPU), node4 (FuriosaAI RNGD NPU), node5 (Rebellions Atom+ NPU, allocatable=2).
- 3 vendors live: NVIDIA, FuriosaAI, Rebellions.
- Open the home page (`/`) → Vendor Cluster card shows 3 ready vendors. TT100T leaderboard is the headline.

## 0:05 — The contract & why FP8 100-sample (5 min)

- Resume-mission contract: CNN/DailyMail v3.0.0, n=100, Llama-3.1-8B-Instruct, FP8, max_output_tokens=128, MLPerf inference.
- Why 100 samples: bound the demo to ~30 minutes of HW time across 4 platforms while preserving statistical power for TT100T mean.
- Why FP8: vendor-native quantization is where each NPU/GPU vendor differentiates; this is the "production deployment" precision.
- Show `docs/reports/benchmark_comparability_contract.md` briefly; emphasize the fingerprint scheme that prevents apples-to-oranges.

## 0:10 — RNGD live demo (10 min)

- Open `/npu-eval/rngd`. The vendor purple identity card tops the page.
- Point to the **Live Bench Dashboard (node4 — RNGD)** iframe at `10.254.202.114:30890/`.
- The Run table shows id=75 / id=77 / id=73 with TT100T badges (1.267 s / 1.328 s / 1.378 s).
- Click the row for id=75 → result detail.
- Headline: **RNGD FP8 TT100T = 1.267 s, TPS = 79.5 tok/s** on the canonical contract — **15% over the <1.1 s target**. State this plainly: the cluster does not yet meet the target on this 8B + 128-token configuration. Confirmatory id=77 at 1.328s independently corroborates.
- Compare to old Qwen2.5-0.5B sweep numbers ONLY if asked — explicitly call them "different model, not comparable".

## 0:20 — Atom+ live demo (10 min)

- Open `/npu-eval/atomplus`. Vendor purple identity card; "New Atom+ Exam" button is now ENABLED (per the device-plugin discovery).
- Click "New Atom+ Exam" → form opens with FP8 / cnn_dailymail / 100 samples / max_output_tokens=128 pre-filled (form intent).
- Don't actually submit (we already have the data). Cancel and look at the **Active Atom+ Benchmarks** card OR the Run table.
- Show best canonical row id=76: **Atom+ TT100T = 1.359 s, TPS ≈ 74 tok/s** with **BF16 (NOT FP8) precision**.
- **HONEST DISCLOSURE — load-bearing:** Atom+ FP8 compile is genuinely impossible with the current vendor SDK. optimum-rbln 0.9.3.post1 does not expose `RBLNConfig` (stderr screenshot ready: `cannot import name 'RBLNConfig' from 'optimum.rbln'`). R-1 used BF16 fallback (authorized per external-blocker rule). The DB row's `precision=fp8` label is a normalization artifact; on-device numerics are BF16.
- State plainly: Atom+ is **24% over the <1.1 s target** on the canonical contract, and ran BF16 — NOT directly comparable to RNGD's TRUE FP8 result on the precision axis.

## 0:30 — GPU FP8: BLOCKED-with-stderr (8 min)

- Open `/ml-perf`. The MLPerf page now embeds a **Live GPU Dashboard (MLPerf)** Prometheus iframe.
- L40 / A40 FP8 100-sample is BLOCKED with concrete stderr proof:
  ```
  File "vllm/config.py", line 1655, in _get_and_verify_dtype
    raise ValueError(f"Unknown dtype: {dtype}")
  ValueError: Unknown dtype: fp8
  ```
  Source: `mlperf_l40_fp8_141_20260506.log:37`. Show the stderr screenshot for 5 seconds.
- Explain the retry path that was tried: vLLM v0.8.4 + pre-quantized `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8`. The retry cleared the dtype-validator hurdle but hung at "weights loaded" for 20+ minutes without progressing to MLPerf samples. User terminated. The MLPerf SUT integration on this GPU image needs further work.
- Honest framing: this is BLOCKED-with-stderr, not "didn't work" — concrete error from the dtype validator + retry hang. Per redo rule, BLOCKED is acceptable with stderr proof. No silent fallback to BF16.

## 0:38 — Cross-vendor comparison (8 min)

- Open `/ml-perf/device-comparison`. Filter by precision=FP8, samples=100.
- Show the 2 PASS cells side-by-side (best canonical row per vendor):
  - **RNGD 1.267 s [TRUE FP8] vs Atom+ 1.359 s [BF16-fallback]** — RNGD ~7% faster on TT100T, but **on different precision arms** (precision-axis caveat is load-bearing).
  - **Neither vendor met the <1.1 s target.** RNGD is 15% over, Atom+ is 24% over. Honest disclosure: the cluster does not yet achieve the goal on this 8B + 128-token configuration.
  - **Mixed-precision caveat:** Atom+ ran BF16 because optimum-rbln 0.9.3.post1 lacks the FP8 quantization API (vendor-SDK-version blocker). RNGD ran TRUE FP8 via furiosa-llm 2025.3.3. The TT100T comparison is NOT apples-to-apples on precision.
  - Both vendors are viable for production trade-offs (cost / power / form-factor) within ~25% of target.
- Note: filter explicitly excludes pre-contract sweeps (drift_flag=True for non-resume cells).

## 0:46 — Stale-state monitoring (5 min)

- Open `/dashboard/npu-realtime`. The DeviceRealtimeDashboard polls `/api/realtime/exams/snapshot` every 2 s.
- Snapshot shape: 7 slots (4 GPU + 1 RNGD + 2 Atom+).
- Stale TTL: 120 s. If a job goes RUNNING but produces no metric for 120 s, the slot status flips to `stale`. Backed by 67/67 server unit tests + 51/51 web vitest.

## 0:51 — Reproducibility (5 min)

- Reference `docs/reports/reproducibility_guide.md`.
- Each PASS row's exact command is in `logs/benchmarks/mlperf_*.log`.
- Show `docs/reports/benchmark_results_real.csv` (115 rows, 0 mock/fake) — point to the `config_fingerprint` and `is_canonical_comparable` columns as the audit trail.

## 0:56 — Q&A & next steps (4 min)

- Next: ship the vLLM upgrade so L40/A40 FP8 unblocks; then publish all 4 cells.
- Open question for vendors: does a pre-quantized RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8 reproduce on Hopper as well as Ada?

## Cite-only-from sources

This outline cites ONLY:
- Live `/api/comparison/list` rows id=74, id=75 (resume-mission FP8 PASS cells)
- Live `/api/realtime/exams/snapshot` for the slot count
- `logs/benchmarks/mlperf_*.log` for the BLOCKED stderr proofs
- `docs/reports/benchmark_results_real.csv` (W-10 canonical export, no mock rows)

It does NOT cite the historical Qwen2.5-0.5B 0.76 s figure (wrong model) or any drift-flagged sweep.
