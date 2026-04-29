# Atom+ TT100T — First-result Analysis

**RUN_ID**: 20260429-071649-46d82f8
**Mode**: host-mode smoke on node5 (`/home/kcloud/results/.../atomplus/tt100t/`)
**Driver**: `python3 /tmp/tt100t_smoke.py` (script also at `/home/kcloud/build-rbln-smoke/tt100t_smoke.py`)
**NPU usage**: 1× RBLN-CA22 ATOM+ (rbln0 or rbln1, single-device, no tensor parallelism)
**Stack**: optimum-rbln 0.9.3.post1 + rebel-compiler 0.9.3.post1 + transformers 4.57.1 + torch 2.8.0 (host-installed wheels)
**Target**: TT100T < 1.1s (PASS / FAIL / UNKNOWN / INVALID)

## Headline result

| Metric | Value |
|---|---|
| **Verdict** | ✅ **PASS** |
| Output tokens per run | 100 (enforced via `min_new_tokens=OUTPUT_TOKENS`) |
| Invalid runs (< 100 tokens) | 0 / 5 |
| **Mean elapsed** | **0.727 s** |
| Stddev | 0.059 s |
| Min | 0.641 s |
| Max | 0.787 s |
| p50 | 0.758 s |
| p90 | 0.787 s |
| p95 | 0.787 s |
| p99 | 0.787 s |
| Mean throughput | **~137 tok/s** |
| Range | 127 – 156 tok/s per run |

The 0.727 s mean clears the 1.1 s target by **34 %**. No outliers, no invalid runs.

## Per-run raw measurements

| Run | Elapsed (s) | Output tokens | Tokens/s |
|---|---|---|---|
| measured-1 | 0.641 | 100 | 156.06 |
| measured-2 | 0.673 | 100 | 148.51 |
| measured-3 | 0.787 | 100 | 127.09 |
| measured-4 | 0.778 | 100 | 128.60 |
| measured-5 | 0.758 | 100 | 131.86 |

Files: `results/20260429-071649-46d82f8/atomplus/tt100t/{tt100t_raw.jsonl, tt100t_summary.json, host-smoke.log}`.

## Settings

- Model: `Qwen/Qwen2.5-0.5B-Instruct` (494 M params, open weights, no HF gate)
- Prompt: `"Explain how a transformer model generates text, step by step."` (~12 input tokens)
- Decoding: deterministic greedy (`do_sample=False`), `max_new_tokens=100`, `min_new_tokens=100`
- Compile shape: `rbln_batch_size=1, rbln_max_seq_len=1024, rbln_tensor_parallel_size=1`
- Warmup runs: 2 (excluded from stats)
- Measured runs: 5
- Compile time (first load): ~88 s for graph generation + optimization (cached at `/home/kcloud/cache/rbln-compiled/Qwen__Qwen2.5-0.5B-Instruct/`)

## Comparability vs. RNGD

| Aspect | Atom+ (this run) | RNGD (helm rev 16 production) | Same? |
|---|---|---|---|
| Model | Qwen2.5-0.5B-Instruct (~0.5 B params, BF16) | meta-llama/Llama-3.1-8B-Instruct-FP8 (~8 B params, FP8) | ❌ |
| Output tokens | 100 | 100 | ✅ |
| Tensor parallelism | 1 | 1 (RNGD has 1 chip) | ✅ |
| Decoding | greedy | greedy | ✅ |
| Mean TT100T | 0.727 s | 1.260 s | n/a (different model size) |

**Crucially: this is NOT a fair Atom+-vs-RNGD comparison.** The RNGD baseline is 8 B; Atom+ here is 0.5 B. The smaller model is naturally faster. Lane D will run a comparably-sized model (Qwen2.5-7B-Instruct, no HF gate) so the comparison is fair.

## Honest verdict labelling

- The RUN_ID's TT100T number for Atom+ is honest: the script enforces ≥100 output tokens (`min_new_tokens`) and reports `INVALID` if fewer, `PASS` if mean < 1.1 s, `FAIL` otherwise. No best-only reporting; all 5 measured runs included.
- The verdict applies to **this exact configuration** (Qwen2.5-0.5B / 1 NPU / greedy / 1024 max_seq_len). It does not generalize to all Atom+ workloads.

## Next runs needed (planned)

1. **Atom+ on Qwen2.5-7B-Instruct, 1 NPU** — closer to RNGD baseline (model-size-comparable), no HF gate.
2. **Atom+ on Qwen2.5-7B-Instruct, 2 NPUs (TP=2)** — matches the readiness report's example Job and the 2-NPU advertised allocatable.
3. **Atom+ on Llama-3.1-8B-Instruct, 1 NPU** — direct RNGD comparison (requires HF token via secret).
4. **K8s-mode** of #1–#3 once `jungwooshim/etri-llm-rbln-smoke:v1` finishes building (Job template at `infra/k8s/benchmark-jobs/atomplus-tt100t-job.yaml.template`).

## Reproducibility

```bash
# On node5 host
ssh node5 'RUN_ID=$(date -u +%Y%m%d-%H%M%S) \
  MODEL_ID=Qwen/Qwen2.5-0.5B-Instruct \
  OUTPUT_TOKENS=100 \
  WARMUP_RUNS=2 \
  MEASURED_RUNS=5 \
  OUTPUT_DIR=/home/kcloud/results/$RUN_ID/atomplus/tt100t \
  COMPILE_DIR=/home/kcloud/cache/rbln-compiled \
  python3 /tmp/tt100t_smoke.py'
```
