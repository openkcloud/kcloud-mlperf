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

## Update — frontend v32 default change (post-audit reconciliation)

The "should we change the default?" section above suggested 60000ms. The actual frontend v32 fix went further: **default = 0** (no min-duration enforcement at all for new submissions).

Reasoning for going to 0 instead of 60000:
- A demo audience watching a 30s smoke run will be confused if they see "running 60 seconds for 10 samples done in 5s" — the default-60000 still produces dead air.
- A user who wants compliance can type `600000` into the form input.
- An accuracy-mode run completely ignores min_duration anyway.

Tradeoff: a user who *forgets* to set min_duration for a real MLPerf-compliance run won't get the expected 600000 floor. Mitigation: form should add a tooltip "Set to 600000 for MLPerf compliance" — flagged as future work.

## Per-mode summary table (refined)

| Mode | min_duration default (post-v32) | What it means | When to use |
|---|---|---|---|
| accuracy | 0 (ignored anyway) | Run all N samples once; report accuracy | Smoke + compliance accuracy runs |
| performance | 0 (was 600000) | Run for at least max(N samples, 0ms) — effectively just N samples | Smoke runs, demos |
| performance + manual 600000 | 600000 | MLCommons compliance — at least 10min runtime | Official-style runs |
| performance + manual 60000 | 60000 | 1-min sanity check | Mid-length validation |

## Backend v26 + v27 interaction

Backend v26 added the `min(samples_done/N, elapsed/min_duration)` clamp in `getMpExamStatus`. With the v32 form fix (min_duration=0 default), the elapsed-ratio cap is `elapsed/0 = ∞` which the code's `Math.min(1, ratio)` clamps to 1.0 (100%). So when min_duration=0, the new clamp is a no-op and progress is purely sample-based — exactly what a smoke user wants.

Backend v27 added auto-refresh in list endpoints: any Running row triggers a grpc status poll on each list call (capped at 5 concurrent, sub-second). So the "exam Completed but DB still says Running" stale-state bug is also fixed for the list view.

## Full pipeline of fixes

| Layer | Fix | Version | What it does |
|---|---|---|---|
| Backend DTO | accept max_output_tokens / max_tokens | v24 | unblocks form submission with new fields |
| Backend status | clamp values to data_number | v25 | sane ETA for short N |
| Backend status | clamp progress to min(samples, time) | v26 | progress reflects time when min_duration > 0 |
| Backend list | auto-refresh Running rows | v27 | DB stays in sync without per-row polling |
| Frontend form | minDuration default = 0 | v32 | smoke runs don't auto-loop for 10 min |
