
## L40 Exam #141 — FP8 BLOCKED (2026-05-06, R-1 run)

**Status:** BLOCKED  
**Hardware:** NVIDIA L40 (node2)  
**Target:** RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8, precision=FP8, cnn_dailymail 3.0.0, 100 samples, max_tokens=128  
**Root cause:** vllm image `vllm/vllm-openai:v0.6.6` rejects `--dtype fp8` string. Pre-quantized FP8 model requires vllm >= v0.8.x with `--dtype auto`.  
**Stderr proof** (`logs/benchmarks/mlperf_l40_fp8_141_20260506.log`):
```
File "/opt/conda/lib/python3.11/site-packages/vllm/config.py", line 1655, in _get_and_verify_dtype
    raise ValueError(f"Unknown dtype: {dtype}")
ValueError: Unknown dtype: fp8
```
**Retry:** Job `mlperf-cnndm100-fp8-l40-20260506` with vllm:v0.8.4 + RedHatAI FP8 model + dtype=auto submitted; image pull exceeded 33min; user instructed stop. L40 FP8 result unavailable.

---

## A40 Exam #140 — FP8 BLOCKED (2026-05-06, R-1 run)

**Status:** BLOCKED  
**Hardware:** NVIDIA A40 (node3)  
**Target:** RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8, precision=FP8, cnn_dailymail 3.0.0, 100 samples, max_tokens=128  
**Root cause:** Same as L40 — vllm/vllm-openai:v0.6.6 rejects `--dtype fp8`.  
**Stderr proof** (`logs/benchmarks/mlperf_a40_fp8_140_20260506.log`):
```
File "/opt/conda/lib/python3.11/site-packages/vllm/config.py", line 1655, in _get_and_verify_dtype
    raise ValueError(f"Unknown dtype: {dtype}")
ValueError: Unknown dtype: fp8
```
**Retry:** Job `mlperf-cnndm100-fp8-a40-20260506` with vllm:v0.8.4 submitted; same image-pull timeout as L40; user instructed stop.

---

## Atom+ — FP8 COMPILE BLOCKED, BF16 fallback used (2026-05-06, R-1 run)

**Status:** COMPLETED with BF16 (FP8 genuinely impossible, fallback authorized)  
**Hardware:** Rebellions Atom+ (node5, 2x ATOM NPUs)  
**FP8 attempt:** optimum-rbln 0.9.3.post1 does not expose `RBLNConfig` or any FP8 quantization API.  
**Stderr proof** (`logs/benchmarks/mlperf_atomplus_fp8_<ts>.log`):
```
FP8 compile setup failed: cannot import name 'RBLNConfig' from 'optimum.rbln'
(/usr/local/lib/python3.10/dist-packages/optimum/rbln/__init__.py)
```
**Fallback:** BF16 compiled model. Results: exam ids 74, 76.

---

## RNGD — PASS FP8 confirmed (2026-05-06, R-1 run)

**Status:** PASS  
**Hardware:** FuriosaAI RNGD (node4)  
**Model:** furiosa-ai/Llama-3.1-8B-Instruct-FP8 revision=v2025.3.0  
**FP8 confirmation:** Server log: `Loading LLM from artifact: furiosa-ai/Llama-3.1-8B-Instruct-FP8`. Results: exam ids 75, 77.

---

## L40 Exam #135 — FP8 dtype rejected by vllm

**Time:** 2026-05-06T02:09Z
**Exam ID:** 135
**Error:** `ValueError: Unknown dtype: fp8` in vllm engine arg parsing
**Root cause:** The benchmark container's vllm version does not accept `precision=fp8` as dtype string. The FP8 model (Llama-3.1-8B-Instruct-FP8) must be loaded with `dtype=bfloat16` or `dtype=auto`; the FP8 quantization is encoded in the model weights, not the dtype arg.
**Fix:** Resubmit with `precision=bfloat16` — this matches proven run #129 (completed, VALID, 62.608 TPS).
**Retry exam ID:** 137 (submitted 2026-05-06T02:14Z)
**Stderr:**
```
ValueError: Unknown dtype: fp8
```
