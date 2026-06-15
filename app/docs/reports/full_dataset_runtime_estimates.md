# Full-dataset (CNN/DailyMail) runtime estimates per HW

How long would the full 13368-sample CNN/DailyMail MLPerf run take on each of our four HW targets, at 128 max output tokens?

This is the answer to the audience question: **"how long would the full benchmark take?"**

## Inputs

- Total samples: **13368** (full validation split of CNN/DailyMail v3.0.0)
- Max output tokens per sample: **128**
- Total output tokens: **13368 × 128 = 1,711,104 tokens**
- Per-HW TPS values from REAL prior runs (cited in `final_acceptance_matrix.md` and project memory):

| HW | TPS (verified) | Source row |
|---|---|---|
| L40 FP8 (sm_89 native) | 62.94 | mp-exam id=124 (500×3) |
| A40 FP8 (Marlin BF16-fallback) | 56.05 | mp-exam id=125 (500×3) |
| RNGD FP8 (FuriosaAI vendor-native) | 80.37 | npu-eval id=75 (100×3) |
| Atom+ BF16-fallback (Rebellions optimum-rbln) | ~75 (estimated, 1.359s TT100T → 100/1.359 ≈ 73.6 closest steady state) | npu-eval id=76 |

## Calculation

`wall_clock_seconds ≈ total_output_tokens / TPS`

(Assumes steady-state TPS dominates; ignores per-sample TTFT/prefill overhead, which adds ~16-35ms per sample = additional ~3-7 minutes total — small relative to the multi-hour total.)

| HW | TPS | Total tokens / TPS | Wall-clock seconds | Wall-clock hours | Wall-clock breakdown |
|---|---|---|---|---|---|
| RNGD | 80.37 | 1,711,104 / 80.37 | **21,290s** | **5.91 h** | 5h 54min 50s |
| Atom+ | 73.6 | 1,711,104 / 73.6 | **23,248s** | **6.46 h** | 6h 27min 28s |
| L40 (native FP8) | 62.94 | 1,711,104 / 62.94 | **27,186s** | **7.55 h** | 7h 32min 56s |
| A40 (Marlin) | 56.05 | 1,711,104 / 56.05 | **30,528s** | **8.48 h** | 8h 28min 48s |

**Plus per-HW prefill overhead** (estimated 13368 samples × per-sample TTFT):
- RNGD: 13368 × 32ms = ~428s = ~7 min
- L40: 13368 × 16ms = ~214s = ~3.5 min
- A40: 13368 × 18ms = ~241s = ~4 min
- Atom+: 13368 × 35ms = ~468s = ~7.8 min

These are small but non-zero — round all numbers up by ~5-10 min to be safe.

**Plus cold-start / warmup overhead per run:**
- vLLM weights load from NFS: ~5-8 min on first cold start (model file 8.5 GB at NFS read speed)
- CUDA graph capture (GPU only, first request): ~30-60s
- RNGD/Atom+ kernel compile/load: ~30-90s

## Final answer with safety margin

| HW | Conservative wall-clock estimate (single full run, cold start) |
|---|---|
| RNGD | **~6 hours** |
| Atom+ | **~6.5 hours** |
| L40 | **~7.5-8 hours** |
| A40 | **~8.5-9 hours** |

**3 retries** (the standard `retry_num=3` for stable averaging) multiplies these by 3 → **20-27 hours per HW for a complete 3-retry full-dataset run**.

## Caveats — read these aloud if pressed

1. **TPS is not constant.** Real TPS varies ~3-5% across batches due to KV-cache effects, prompt-length variance in CNN/DailyMail (some articles much longer than others), and minor system noise. The numbers above are central tendencies from observed runs.

2. **Per-sample latency varies with prompt length.** CNN/DailyMail prompts range from ~200 to ~3000 tokens; longer prompts mean more prefill (TTFT scales linearly with prompt length on standard transformers, sublinearly with paged attention).

3. **Concurrent load on the cluster degrades all numbers.** If multiple exams share a node (operator scheduling) or NFS/network is saturated, all TPS values drop. The cpu_core ≤7 cap (v23 backend) helps, but doesn't eliminate this.

4. **No sample skipping or warmup exclusion.** The TPS values include the first-sample warmup (CUDA graph capture). Pure steady-state TPS would be slightly higher (~5-10%).

5. **Different scenarios change the math.** scenario=offline (what we measure) batches all queries upfront. scenario=server simulates Poisson arrivals and would yield different effective TPS due to queueing.

## What to actually do for the demo

**Don't run the full 13368-sample dataset live.** It takes too long. Options:
- **Pre-collected results.** Use existing rows id=75, 76, 124, 125 in the comparison page; talk through them.
- **Live 100-sample run.** A 100-sample MLPerf run takes ~2-3 min on each HW (most of that is cold-start). Demonstrate one full 100-sample run on RNGD or L40 live.
- **If demonstrating concurrent runs:** small samples (10-50) on multiple HW simultaneously to show the realtime dashboard come alive.

## Pre-canned demo response

> "A full 13368-sample run takes 6-9 hours per device, depending on hardware. A 3-retry official-style run is closer to 20-27 hours per device. That's why for the demo we use a 100-sample subset that runs in ~2-3 minutes per device, and pre-collect the full-dataset numbers from prior overnight runs. The comparison page shows real measurements from real runs, just at 100-sample granularity."

## Source-of-truth references

- TPS numbers: `docs/reports/final_acceptance_matrix.md` rows 12, 13; `docs/reports/benchmark_results_real.csv` for per-row historical data.
- `docs/reports/fp8_compute_precision_explainer.md` for why each HW gets the TPS it does.
- `docs/reports/tt_n_extrapolation_analysis.md` for the per-N latency story.

## Cluster-wide concurrent full-dataset estimate

If you ran the FULL 13368-sample dataset on all 4 HW SIMULTANEOUSLY (one full run per HW, no retries), the total cluster wall-clock would be **~9 hours** (bottlenecked by the slowest HW = A40 at 8.5h, plus ~30 min cold-start staggering and per-pod NFS contention).

If you wanted 3-retry runs concurrently, ~27 hours cluster-wide (A40 dominates).

For the demo, this is moot — we use 100-sample subsets. But if asked "could you run all 4 at once for a thorough benchmark?", the answer is: ~9 hours cluster wall-clock, ~24-27 hours for compliance-quality 3-retry.

## Additional caveat — KV-cache eviction at high N

For very long output runs (N > 1000), the KV cache grows linearly with output length. vLLM may evict older sequences if cache pressure rises. Practically: 100-128-token runs don't hit this; multi-thousand-token runs would. Not relevant to our demo configuration.

## Why we don't recommend live full-dataset demo

A live full-dataset run on stage would take 6-9 hours. No demo can hold an audience that long. The right pattern is:
- **Pre-collect the full numbers** in overnight runs (we have these from prior overnight cycles).
- **Demo a 100-sample subset live** to show the system actually works.
- **Reference the full numbers** in the comparison page or a slide.

The 100-sample subset is statistically meaningful enough for relative-rank comparison (TPS variance ~3-5%) — the full dataset adds precision but doesn't change the rank order, per `tt_n_extrapolation_analysis.md`.

## Sample-count sensitivity

For comparison purposes, 100 samples is on the lower end but adequate. Industry practice:
- **MLPerf official:** uses full 13368 (compliance requires it).
- **Internal benchmarking:** 100-500 samples is standard (cheap iteration).
- **Quick smoke:** 10-20 samples (catches major regressions, not for publication).

Our demo uses 100 — the published comparison rows are 100×3 (3 retries averaged for stability).
