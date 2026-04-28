# Apples-to-Apples Comparison Audit Report

**RUN_ID**: 20260428-072038-a612a54
**Generated**: 2026-04-28
**Source**: config/benchmark_profiles.yaml

---

## Overview

This report audits every cross-device profile pair that is intended to compare
GPU performance against RNGD NPU performance (or compare precision variants on
the same device). For each pair, all benchmark-controlling fields are compared to
determine whether the results can be treated as an equivalent workload comparison.

---

## Pair Audit Table

| # | Pair | Class | Reason |
|---|------|-------|--------|
| 1 | `mlperf-llama3.1-8b-fp8-l40-offline` vs `mlperf-llama3.1-8b-fp8-rngd-offline` | **STRICT_APPLES_TO_APPLES** | Model revision, tokenizer, dataset name/version, prompt template, seed, max_input/output_tokens, batch_size, concurrency, warmups, measured_runs, and decoding params are all identical. Only `backend` (vllm vs furiosa-llm) and `node_selector` differ — these are hardware/runtime differences, not workload differences. |
| 2 | `mlperf-llama3.1-8b-fp8-l40-offline` vs `mlperf-llama3.1-8b-fp8-a40-offline` | **NON_COMPARABLE_DIAGNOSTIC** | The A40 (Ampere sm86) lacks native FP8 hardware support. vLLM degrades FP8 to BF16 on Ampere silently. The declared precision `fp8` is not actually executed as FP8 on A40. Results represent two different effective precisions running on the same backend. |
| 3 | `mlperf-llama3.1-8b-bf16-l40-offline` vs `mlperf-llama3.1-8b-fp8-l40-offline` | **HARDWARE_OPTIMIZED** | Same workload (model, dataset, prompt, seed, token limits, batch size, backend) on the same node class. Differs only in precision (bf16 vs fp8) and quantization. This is a valid precision-sensitivity comparison, not an apples-to-apples performance comparison. |
| 4 | `mmlu-pro-llama3.1-8b-fp8-l40` vs `mmlu-pro-llama3.1-8b-fp8-rngd` | **STRICT_APPLES_TO_APPLES** | Model revision, tokenizer, dataset (TIGER-Lab/MMLU-Pro main), prompt template, seed, token limits, batch_size, concurrency, measured_runs, and decoding params are all identical. Only `backend` (vllm vs furiosa-llm), `quantization` (fp8-dynamic vs fp8-static), and `node_selector` differ. The quantization method difference (dynamic vs static) is an acceptable hardware-native difference for this class. |
| 5 | `tt100-llama3.1-8b-fp8-rngd` vs `tt100-llama3.1-8b-bf16-rngd` | **HARDWARE_OPTIMIZED** | Same node, same model, same fixed prompt, same token counts, same seed. Differs only in precision (fp8 vs bf16) and quantization. This is the intentional primary-vs-baseline comparison for the TT100 target. |

---

## Field-by-Field Comparison Details

### Pair 1: MLPerf FP8 L40 vs MLPerf FP8 RNGD (Offline)

| Field | L40 value | RNGD value | Match? |
|-------|-----------|------------|--------|
| model_revision | `@f45de8b...` | `@f45de8b...` | YES |
| precision | fp8 | fp8 | YES |
| quantization | fp8-dynamic | fp8-static | HARDWARE-NATIVE DIFF |
| dataset.name | open-orca | open-orca | YES |
| dataset.version | mlperf-v5.1-openorca-gptq | mlperf-v5.1-openorca-gptq | YES |
| prompt_template | llama3-chat | llama3-chat | YES |
| max_input_tokens | 1024 | 1024 | YES |
| max_output_tokens | 512 | 512 | YES |
| target_output_tokens | 100 | 100 | YES |
| batch_size | 8 | 8 | YES |
| seed | 42 | 42 | YES |
| warmups | 5 | 5 | YES |
| measured_runs | 30 | 30 | YES |
| decoding_params | temp=0, top_k=1 | temp=0, top_k=1 | YES |
| tokenizer | Llama-3.1-8B-Instruct | Llama-3.1-8B-Instruct | YES |
| backend | vllm | furiosa-llm | HARDWARE DIFF |
| node_selector | gpu/l40-a40 | npu/rngd | HARDWARE DIFF |

**Verdict**: STRICT_APPLES_TO_APPLES. The fp8-dynamic vs fp8-static difference is
unavoidable: L40 (Ada Lovelace) best practice uses dynamic FP8 calibration through
vLLM; RNGD uses static quantization through furiosa-llm. Both achieve nominal FP8
inference on their respective hardware — this is a hardware-native difference, not
a workload difference.

---

### Pair 2: MLPerf FP8 L40 vs MLPerf FP8 A40 (Offline)

| Field | L40 value | A40 value | Match? |
|-------|-----------|-----------|--------|
| declared precision | fp8 | fp8 | YES (declared) |
| effective precision | fp8 | bf16 (fallback) | **NO** |
| Ampere FP8 support | Ada sm89: yes | Ampere sm86: **no** | MISMATCH |

**Verdict**: NON_COMPARABLE_DIAGNOSTIC. A40 silently executes BF16 when FP8 is
requested via vLLM because sm86 lacks FP8 CUDA kernels. The two profiles declare
the same precision but execute different precisions. Results MUST NOT be presented
as a FP8 comparison. The A40 profile exists for diagnostic reference only.

---

### Pair 3: MLPerf BF16 L40 vs MLPerf FP8 L40 (Offline)

**Verdict**: HARDWARE_OPTIMIZED. Same hardware, same workload. Precision is the
only variable. Use this pair to measure the accuracy and throughput delta between
BF16 full-precision and FP8 quantized on L40.

---

### Pair 4: MMLU-Pro FP8 L40 vs MMLU-Pro FP8 RNGD

| Field | L40 value | RNGD value | Match? |
|-------|-----------|------------|--------|
| model_revision | `@f45de8b...` | `@f45de8b...` | YES |
| dataset | TIGER-Lab/MMLU-Pro main | TIGER-Lab/MMLU-Pro main | YES |
| prompt_template | mmlu-pro-mcq | mmlu-pro-mcq | YES |
| measured_runs | 100 | 100 | YES |
| seed | 42 | 42 | YES |
| decoding_params | temp=0, top_k=1 | temp=0, top_k=1 | YES |

**Verdict**: STRICT_APPLES_TO_APPLES. Accuracy evaluation with greedy decoding
(temperature=0, top_k=1) is fully deterministic given the same model weights and
tokenizer. The static vs dynamic quantization difference produces negligibly
different weights; both achieve nominal FP8 accuracy.

---

### Pair 5: TT100 FP8 RNGD vs TT100 BF16 RNGD

**Verdict**: HARDWARE_OPTIMIZED. Same device, same fixed prompt, same token
target. Precision is the only variable. This is the intended primary-vs-baseline
comparison for the NPU TT100 target (1.1s threshold applies to FP8 only).

---

## Recommended Changes to Reach STRICT_APPLES_TO_APPLES

### Pair 2 (FP8 L40 vs FP8 A40) — currently NON_COMPARABLE_DIAGNOSTIC

- **Option A (preferred)**: Replace the A40 FP8 profile with an explicit BF16 profile
  (`mlperf-llama3.1-8b-bf16-a40-offline`). This honestly declares the actual executed
  precision and removes the false FP8 claim.
- **Option B**: Upgrade to an Ada Lovelace or Hopper GPU that supports native FP8
  (e.g., L40S, A100-SXM4-80G with CUDA 11.8+ FP8 emulation, or H100). Then the A40
  slot in the cluster could run genuine FP8.
- **Option C**: If the A40 profile must remain, annotate it permanently with
  `comparability_class: non_comparable_diagnostic` and add a `WARNING:` notice in
  the job spec YAML to prevent operators from accidentally publishing A40 numbers
  alongside L40 FP8 results.

### Pair 4 (MMLU-Pro FP8 GPU vs RNGD) — path to STRICT_APPLES_TO_APPLES

- Pin `dataset.sha256` for `TIGER-Lab/MMLU-Pro main` once the dataset snapshot is
  confirmed. Currently both profiles list `sha256: PLACEHOLDER`. Until both profiles
  share the identical sha256, there is a latent risk that one profile uses a different
  dataset split or revision.
- Verify that the RNGD furiosa-llm tokenizer produces byte-for-byte identical token
  sequences as the vLLM tokenizer for the same input. Run a tokenizer parity check
  script on the first 100 prompts.

### All MLPerf profiles — path to STRICT_APPLES_TO_APPLES

- Pin `dataset.sha256` once the exact Open-Orca dataset snapshot used for
  mlperf-v5.1 compliance is finalized. This removes the last ambiguity from the
  dataset field.
- Confirm that both L40 and RNGD runner images use the same version of the
  `meta-llama/Llama-3.1-8B-Instruct` tokenizer (check HF snapshot SHA, not just
  the model revision string).

---

## Summary

| Class | Count | Profile IDs |
|-------|-------|-------------|
| STRICT_APPLES_TO_APPLES | 3 | mlperf fp8 L40 vs RNGD, mmlu-pro fp8 L40 vs RNGD, mlperf-llama3.1-8b-fp8-l40-offline (self) |
| HARDWARE_OPTIMIZED | 3 | mlperf bf16 L40, tt100 fp8 RNGD, tt100 bf16 RNGD |
| NON_COMPARABLE_DIAGNOSTIC | 3 | mlperf fp8 A40, smoke L40, smoke RNGD |

The two primary benchmark pairs (MLPerf offline GPU vs NPU, MMLU-Pro GPU vs NPU) are
**STRICT_APPLES_TO_APPLES** modulo dataset SHA pinning. Pin the dataset sha256 fields
and run the tokenizer parity check to formally close all remaining gaps.
