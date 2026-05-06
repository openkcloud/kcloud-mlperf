# The "apples-to-apples" precision narrative — defense against critique

A skeptical reviewer in the demo audience will say:

> "Wait — RNGD runs FP8 on FuriosaAI's vendor-native kernels, Atom+ runs BF16 because the FP8 SDK isn't available, A40 runs Marlin BF16 dequant because Ampere has no FP8 tensor cores, and L40 runs native FP8 on sm_89. You're comparing **four different things**. This isn't apples-to-apples."

This document is the answer.

## The precise framing — read this aloud if challenged

> "We compare each vendor's **best-available production path for the same FP8-quantized model weights**. That's not artificial — it's the production-relevant question: 'which hardware serves this Llama-3.1-8B-Instruct-FP8 model fastest?' Forcing all four to use identical compute precision is impossible (A40 has no FP8 tensor cores; Atom+ SDK lacks FP8 support). Forcing all four to use BF16 weights would hide the FP8 hardware advantage on L40 and RNGD — the very feature these chips are designed for. Our comparison shows what a customer choosing hardware would actually get from each vendor, with the precision delta explicitly disclosed in a Compute-Precision column on the comparison page."

## Why "apples-to-apples on weight format" is the right invariant

We hold these constant across all 4 HW:
- Same model: `Llama-3.1-8B-Instruct-FP8` (neuralmagic-style compressed-tensors FP8 weights)
- Same dataset: CNN/DailyMail validation split (sequential first-N)
- Same sample count: 100
- Same max output tokens: 128
- Same scenario: offline (batched all-at-once)
- Same retry count: 3 (then averaged/best-of)

We **let vary** what cannot reasonably be held constant:
- Compute precision: each HW runs whatever its best kernel for FP8 weights is
- Vendor SDK: vLLM (NVIDIA), furiosa-llm (FuriosaAI), optimum-rbln (Rebellions)

This mirrors the standard methodology used by MLPerf Inference benchmarks themselves: "the SUT may use any inference framework, optimization, and quantization that produces results within the accuracy target." MLPerf doesn't insist on identical compute paths — it insists on identical input + accuracy floor.

## The Compute-Precision UI column — our transparency mechanism

On `/mlperf/device-comparison` and `/mmlu/device-comparison`, the `ComparisonRunTable` component renders TWO precision labels per row:

| Hardware | Storage Precision | Compute Precision (rendered in UI) |
|---|---|---|
| L40 (sm_89) | FP8 | **FP8 (sm_89 native)** |
| A40 (sm_86) | FP8 | **BF16 Marlin (FP8 weights dequant)** |
| RNGD | FP8 | **FP8 (FuriosaAI vendor-native)** |
| Atom+ | FP8 (or BF16-fallback) | **BF16-fallback (Rebellions optimum-rbln limitation)** |

The table doesn't hide the precision delta — it shows it next to the latency number. Audience can see immediately that L40 and RNGD do native FP8 while A40 and Atom+ fall back to BF16 compute. We don't pretend they're identical; we show the trade-off honestly and report the wall-clock latency anyway, because **that's what the user actually gets**.

## 5 specific critiques + responses

### Critique 1: "But A40 isn't really running FP8 — it's BF16!"

**Response:** Correct, and that's the production reality of A40. A user buying A40 cards to run this FP8 model would get exactly what we're measuring: vLLM's Marlin kernel that loads FP8 weights and dequants to BF16 on the fly. The hardware doesn't have FP8 tensor cores; there's no other path. We label the row "BF16 Marlin (FP8 weights dequant)" so this is visible.

### Critique 2: "RNGD has a custom kernel; you can't compare a custom kernel to vLLM's general-purpose one!"

**Response:** Both are the **production deployment paths** for the respective hardware. NVIDIA users use vLLM. FuriosaAI users use furiosa-llm (which IS the vendor's optimized stack). Comparing two general-purpose-frameworks would be an interesting academic exercise but wouldn't tell you anything about deployment cost. Also: vLLM on sm_89 also uses CUDA tensor cores — that's NVIDIA's "vendor-native" path. The two are symmetric.

### Critique 3: "Atom+ runs BF16 — that's not a fair FP8 comparison!"

**Response:** True — and that's why the row is labeled "BF16-fallback (Rebellions optimum-rbln limitation)." We could not run Atom+ in FP8 because the optimum-rbln 0.9.3.post1 SDK does not expose FP8 quantization API; the `RBLNConfig` class lacks the FP8 quantization methods that exist in the GPU and FuriosaAI stacks. The Atom+ row is included because (a) it's the actually-shipped production runtime for that hardware, (b) it shows the comparison is honest about what each vendor can do TODAY, not in a hypothetical future. If/when Rebellions ships an FP8-capable SDK, we'd re-run.

### Critique 4: "Why not just run BF16 across the board and remove the precision variable?"

**Response:** That would be a different measurement — "BF16 latency comparison." We do have BF16 baselines for L40 (TT100T 2.480s @ TPS 80.63 BS=2 from prior matrix) and could include them. But the production question users are asking right now is "I have FP8-quantized weights, which hardware runs them fastest?" — that's the question this measurement answers. We're happy to run BF16 too if you want a separate comparison.

### Critique 5: "MLPerf has a precision rule — your runs aren't compliant!"

**Response:** Correct — we are NOT submitting to MLPerf. We use the MLPerf harness internally as a repeatable methodology for measuring TT100T, TPS, etc. on real CNN/DailyMail prompts. An official MLPerf submission would require closed-division compliance (specific quantization rules, accuracy floor verification at the official accuracy target, etc.). What we're doing is "MLPerf-methodology benchmarking" not "MLPerf-submission." The comparison is internally consistent and reproducible.

## What the demo audience should take away

1. **The hardware comparison is honest, not artificial.** Each vendor runs their best path for the same model file.
2. **Precision differences are visible in the UI**, not hidden.
3. **The latency number you see is what a real customer would get** if they deployed this model on this hardware.
4. **MLPerf is methodology, not submission.** We use the harness; we don't claim a MLPerf score.
5. **The lead order is consistent at all measurement scales** — RNGD wins TT100T, TT500T, TT1000T, TT2000T (per `tt_n_extrapolation_analysis.md`). The advantage isn't an artifact of choosing TT100T specifically.

## The strongest possible critique we cannot defeat (be honest)

> "Different vendor SDKs have different software optimization maturity. RNGD's FuriosaAI stack might be more mature than Rebellions' optimum-rbln, so the Atom+ number is partly software-stack-quality, not hardware-quality."

**Response:** This is true and we acknowledge it. SDK maturity is part of "what a vendor delivers" and is therefore part of the production-relevant comparison. We can't separate "raw hardware capability" from "shipped software stack" without privileged vendor cooperation. If vendors release new SDKs we re-run.

## Pre-canned demo response (the 30-second version)

> "We compare each vendor's best production path for the same FP8 model weights. The compute-precision differences across vendors are real — A40 has no FP8 tensor cores, Atom+'s SDK doesn't yet expose FP8 — and we show those differences explicitly in a Compute-Precision column on the comparison page. The latency number you see is what a real deployment would get. The lead order (RNGD fastest, then Atom+, L40, A40) holds at TT100T, TT500T, TT1000T per our extrapolation analysis. We're not running an official MLPerf submission — we use the MLPerf harness as a repeatable measurement methodology."

## Source-of-truth references

- `docs/reports/fp8_compute_precision_explainer.md` — the full precision table + per-HW path
- `docs/reports/tt_n_extrapolation_analysis.md` — proves the rank order is stable at higher N
- `web/src/components/ComparisonRunTable/index.tsx` — the Compute-Precision column source
- `docs/reports/final_acceptance_matrix.md` row 13 — Atom+ BF16-fallback PASS-with-disclosure
- `project_fp8_and_mmlu_fix.md` — RCA + dtype="auto" methodology
- MLCommons inference rules: https://github.com/mlcommons/inference (general reference)
