# What's actually happening when I pick "FP8 model" + precision="bf16" on the GPU MLPerf form?

This is the answer to your question. Two separate things are encoded by those two fields, and the UI lets you mix them in ways that are not always equivalent. Here's the plain-language picture, then the technical detail, then what to tell people.

## The two precision dimensions

| Dimension | Where it lives | What it is |
|---|---|---|
| **Storage precision** | The model file on disk under `/mnt/models/` | The dtype of the weights as serialized. `Llama-3.1-8B-Instruct-FP8` stores weights in compressed-tensors FP8 format (8-bit mantissa+exponent). `Llama-3.1-8B-Instruct` stores them in BF16. |
| **Compute precision** | vLLM's `dtype=` flag at process start | The dtype of the matmul kernels and the activations during inference. Picked by what tensor cores you actually run on. On L40 (sm_89) FP8 tensor cores exist; on A40 (sm_86) they do not. |

The UI's **Model** dropdown picks the storage precision (because it picks which weights file to load).
The UI's **Precision** dropdown picks the compute precision (it's piped into vLLM's `dtype=`).

These don't have to match. The interesting question is what vLLM does at the boundary.

## The 6-cell truth table

| Storage (Model) | Compute (Precision) | What vLLM actually does | Speed vs FP8-native | Accuracy vs BF16 |
|---|---|---|---|---|
| BF16 | `bf16` | The "vanilla" path. Loads BF16 weights, runs BF16 matmuls on BF16 tensor cores. | baseline | baseline |
| BF16 | `auto` | vLLM picks the best fit; with BF16 weights → BF16 compute. Same as above on L40+A40. | baseline | baseline |
| FP8 | `bf16` | **THIS IS THE ONE YOU ASKED ABOUT.** vLLM loads FP8-quantized weights, **dequantizes them to BF16 in memory at load time**, then runs BF16 matmuls. The FP8 compression bought you nothing at runtime. | ≈ baseline (no win) | very slightly worse than BF16 (FP8 quantization noise persists in the weights even after dequant) |
| FP8 | `auto` | The right way to use FP8. vLLM detects the compressed-tensors quantization config in the weights file and **uses native FP8 matmuls on sm_89 (L40)**. On sm_86 (A40), no native FP8 → vLLM falls back to the **Marlin** kernel which dequants weights to BF16 *per layer* but keeps them packed in memory (saves VRAM, gets some speedup from bandwidth). | **L40: faster** (native FP8 tensor cores) / **A40: slightly faster** (Marlin) | within ~1% of BF16 (sample noise floor) |
| FP8 | `fp16` | Same dequant-at-load trick as `bf16` but to FP16. Marginally different numerical behavior; ~same speed. | ≈ baseline | ≈ same as FP8+bf16 |
| FP8 | `fp8` | **Rejected by vLLM 0.8.4.** `ValueError: Unknown dtype: fp8` from `vllm/config.py:1655`. `fp8` is not a valid runtime dtype name — vLLM expects you to pick the activation dtype (`bf16`/`fp16`/`auto`) and let it derive FP8 *inside* the kernel from the compressed-tensors metadata. This was the failure mode that bit MLPerf SUT_VLLM.py for a while. |  — | — |

## So… "FP8 model + bf16 precision" specifically:

**It loads FP8 weights and immediately dequantizes them to BF16, then computes at BF16.** You pay the cost of FP8 quantization noise in the weights (which is small — about 1% of accuracy or less, well inside sample noise on n=100 evals) without getting any of the speedup that the FP8 hardware path on the L40 would give you. From a *throughput* perspective it is indistinguishable from running the BF16 model. From an *accuracy* perspective you should expect a tiny but real degradation (because the weights are noisier).

You're effectively benchmarking BF16 compute with FP8-degraded weights. It's not a "wrong" benchmark — it's just an oddly-shaped one. People in the LLM-serving community sometimes do this on purpose to A/B-test the quantization quality at fixed compute precision.

## How to explain it to people

> "The model dropdown picks how the weights are *stored* on disk. The precision dropdown picks how the GPU *computes* with them at runtime. They don't have to match. Right now we have FP8 weights but BF16 compute, which means vLLM is decompressing the FP8 weights to BF16 in memory and running everything on BF16 tensor cores. We get BF16 speed and slightly worse accuracy than running BF16 weights directly. To get the actual FP8 speedup on L40, the precision should be `auto`, not `bf16` — that lets vLLM use the native FP8 tensor cores on sm_89."

If they ask the follow-up "what about A40?":

> "A40 (sm_86) doesn't have FP8 tensor cores at all, so vLLM uses the Marlin kernel which still dequantizes to BF16 internally — just per-layer instead of all-at-once at load time. You get a small bandwidth win from the smaller weights file, but nowhere near what the L40 gets."

## Bottom-line recommendations

- For an apples-to-apples FP8 comparison across HW, use **FP8 model + precision=auto**. That gives L40 the native FP8 path; A40 gets the Marlin path; RNGD gets vendor-native FP8; Atom+ gets BF16 fallback (FP8 SDK unavailable per `optimum-rbln 0.9.3.post1`). Label the **compute precision** column on the comparison page accordingly (which we already do — see `ComparisonRunTable` Compute Precision column added in v28).
- For a BF16 baseline on L40/A40, use **BF16 model + precision=bf16** (or `auto`, which resolves the same way). Don't use FP8 model + BF16 precision unless you specifically want to A/B the quantization quality at matched compute precision — and label that intent in the run name.
- The MLPerf harness invocation in `scripts/mlperf_cnndm100_fp8.py:98` correctly uses `dtype="auto"` — this is the right path. The `Unknown dtype: fp8` failure documented in `gpu_mmlu_pro_failure_fix.md` was from a different SUT path passing `--dtype fp8` literally; we don't hit it via the proper script.

## References

- vLLM 0.8.4 `LLM(...)` constructor `dtype` parameter — accepts `auto | bfloat16 | half | float16 | float32` (no `fp8`).
- compressed-tensors quantization config — vLLM auto-detects via `quantization=compressed-tensors` line on model load. Verified live in mp-exam #144 (L40) where vLLM stdout printed `quantization=compressed-tensors`.
- neuralmagic / RedHatAI Llama-3.1-8B-Instruct-FP8 model card: weights are W8A8 FP8 with per-tensor scales; activations remain at the runtime dtype (your `precision` field).
- `docs/reports/fp8_gpu_evidence.md` §1 — empirical research from prior ralph session confirming `dtype="auto"` is the canonical path for this model on vLLM 0.8.4.
