# `min_duration_ms` UX audit — why your 10-sample run took 10 minutes

This is the post-mortem on the bug that bit your demo recording: exam #150 (10 samples on L40) showed 100% but didn't end, and you recorded a hiccup. Here's the full story so it doesn't surprise anyone again.

## The bug, in one sentence

MLPerf "performance" mode has a `min_duration_ms` parameter (compliance rule from MLCommons inference v4.x) that requires the harness to keep submitting requests until **BOTH** N samples have been served **AND** elapsed time ≥ `min_duration_ms`. With the default `min_duration_ms = 600000` (10 minutes) and only 10 samples, the harness loops the 10 samples for 10 minutes; Loki reports `10/10` immediately, but the K8s job stays Running until 10 minutes elapse.

## Where the 600000 default comes from

The form's default `min_duration` value is set in `web/src/pages/mlperf/main/exam-form/index.tsx` (or its form-defaults file). The 600000ms = 600s = 10min figure is the standard MLCommons Inference benchmark suite minimum-duration requirement so latency statistics are statistically stable (n=tens-of-thousands of samples within the window for a real submission).

For a 10-sample smoke run, this default is wildly inappropriate.

## What the user sees (pre-fix)

- Frontend progress bar: jumps to 100% in ~30s (after 10 samples done)
- ETA: showed "0s left" or "—"
- Status badge: `Running`
- K8s job: `0/1 Completed` — still running
- Confused user records "100% but doesn't end"

## What the user sees (post-fix, backend v26)

The clamp now reports progress as `min(samples_done/N, elapsed/min_duration_ms)`. For exam #150 at 8m59s elapsed of 600s and 10/10 samples:
- Sample ratio: 10/10 = 1.0 (100%)
- Time ratio: 539/600 = 0.898 (89.8%)
- **Effective progress: 8/10 = 89.8%** ← what the bar shows

The bar now correctly reflects the "actual time remaining" rather than misleadingly saying 100%.

## The MLPerf semantics (what min_duration actually means)

From MLCommons Inference Rules (paraphrased):

> "The system under test must process queries continuously for at least min_duration_ms milliseconds AND at least min_query_count queries. The benchmark result is reported only after both criteria are met. This ensures that latency percentiles (especially p99 tail) have statistical significance."

In our codebase:
- **`mode = performance`** (mp_exam_mode_enum value) → enforces `min_duration_ms`
- **`mode = accuracy`** → runs all `data_number` samples ONCE (no looping), reports accuracy. No `min_duration_ms` enforcement.

So the workaround for short smoke runs is **either**:
1. Set `mode = accuracy` (no min_duration enforcement, runs N samples once)
2. Set `min_duration = 0` or `min_duration = 10000` (10s) for performance mode but with a short floor

## Recommended values per use case

| Use case | mode | data_number | min_duration_ms | Expected wall-clock |
|---|---|---|---|---|
| Accuracy smoke (10 samples) | accuracy | 10 | (ignored) | ~30s on L40 |
| Performance smoke (compliance-loose) | performance | 10 | 10000 (10s) | ~30s |
| Quick demo (audience watch) | performance | 100 | 60000 (60s) | ~2 min |
| Real MLPerf-style perf run | performance | 100 | 600000 (10min) | ~10 min |
| Official MLPerf submission scope | performance | 13368 (full) | 600000 | ~6-8 hours per HW |

## How to set it in the UI

1. Open `/mlperf` page
2. Click "Create New Test" accordion
3. The form has a `min_duration` numeric input (in milliseconds). Default `600000`.
4. Override it to whatever your scenario needs (see table above).
5. Submit.

(If the form doesn't expose `min_duration` editing, you'd need to use the API directly — `POST /api/mp-exam/create` accepts the field per the DTO.)

## Should we change the default?

**Probably yes** — recommend changing form default `min_duration` to `60000` (60s) for the demo configuration, and adding a tooltip "Increase to 600000 for MLPerf compliance." This is a one-line change to the form-defaults file. NOT done yet (out of scope for this overnight QA — flagging for future work).

## What MMLU does (different)

MMLU-Pro doesn't have a min_duration concept. The `mm-exam` DTO has no `min_duration` field. MMLU runs all `data_number` samples once and reports accuracy per subject. So the equivalent bug doesn't exist for MMLU runs.

## Pre-canned demo response

> "MLPerf's `performance` mode requires the harness to run for at least 10 minutes — that's an MLCommons compliance rule for stable latency statistics. So a 10-sample run still takes 10 minutes wall-clock; the harness just loops the 10 samples until min_duration elapses. The progress bar correctly tracks elapsed time as well as sample count now (post backend v26 fix). For a quick smoke run, you can either switch to `accuracy` mode or set `min_duration` to 10000ms (10s)."

## Source-of-truth references

- Backend clamp: `server/src/mp-exam/mp-exam.service.ts:336+` (after `clampLokiValuesToCap`, the new min_duration block computes effective progress = min(samples_done/N, elapsed/min_duration))
- Mode enum: `server/src/enums/mp-exam-mode.enum.ts` (`accuracy` | `performance`)
- DTO: `server/src/mp-exam/dto/create-mp-exam.dto.ts` (defines `min_duration: number @IsInt @Min(0)`)
- Loki reporter: scrapes `vllm:request_success_total` per pod — reports raw cumulative count, no awareness of min_duration
- Frontend ETA: `web/src/helpers/calculate-remaining-time.helper.ts` (uses `(a/b)` ratio from backend → divide-by-zero / over-estimate without backend clamp)
- Live evidence: exam #150 served `8/10` (89.8%) at ~9 min elapsed — verified post v26 deploy
