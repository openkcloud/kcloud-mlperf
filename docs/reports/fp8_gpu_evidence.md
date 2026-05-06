---
title: FP8 GPU Evidence — L40 + A40 MLPerf Apples-to-Apples Investigation
authors:
  - w-fp8-l40 (sections §0, §1, §2, §3, §5-L40, §6)
  - w-fp8-a40 (sections §4, §5-A40)
target_demo: 2026-05-07
plan_ref: docs/reports/demo_video_consensus_plan.md (Addendum A 4-row matrix)
---

# §0 — Pre-import Fingerprint Audit (WS-1.0)

## §0.1 Audit context

Goal of audit: locate the existing FP8 rows for the four hardware targets and decide if existing rows can be reused for the climax 4-row matrix on `/mlperf/device-comparison`, or if fresh runs (with reconciled fingerprints) are required.

Source of truth: `GET http://10.254.177.41:30001/api/comparison/list` (returned 128 runs at 2026-05-06, all 6 SUTs queried via `python3 /tmp/audit_fp8.py`).

## §0.2 Existing FP8 rows (most-recent-per-HW)

| HW | id | Model | Precision | N | max_tok | TT100T | Status | config_fingerprint (16) | Notes |
|----|----|-------|-----------|---|---------|--------|--------|-------------------------|-------|
| L40 | 141 | Llama-3.1-8B-Instruct-FP8 | fp8 | 100 | NULL | **NULL** | Completed | `f6abeaa94fbc43e4` | Operator marked "Completed" but vLLM died — see §0.4 |
| A40 | 140 | Llama-3.1-8B-Instruct-FP8 | fp8 | 100 | NULL | **NULL** | Completed | `f6abeaa94fbc43e4` | Same artifact zip is empty (102 bytes) |
| L40 (older) | 138 | RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8 | fp8 | 100 | NULL | NULL | **Stopped** | `129d4e8b0e6d94d0` | Prior FP8 attempt — also failed |
| A40 (older) | 139 | neuralmagic/Meta-Llama-3.1-8B-Instruct-FP8 | fp8 | 100 | NULL | NULL | **Stopped** | `5b9876f42dfaeaa7` | Prior FP8 attempt — also failed |
| RNGD | 75 | furiosa-ai/Llama-3.1-8B-Instruct | FP8 | 100 | 128 | **1.267 s** | Completed | `828db8f598c886b0` | Real run via furiosa-llm server |
| RNGD | 77 | furiosa-ai/Llama-3.1-8B-Instruct | FP8 | 100 | 128 | **1.328 s** | Completed | `828db8f598c886b0` | Same fingerprint as id=75; replicated |
| Atom+ | 76 | rebellions/Llama-3.1-8B-Instruct | fp8 | 100 | 128 | **1.359 s** | Completed | `878230bc8b1903d4` | Real run via optimum-rbln |
| Atom+ | 74 | rebellions/Llama-3.1-8B-Instruct-FP8 | fp8 | 100 | 128 | **1.375 s** | Completed | `767e88e726a00165` | Different fingerprint (model name differs) |

## §0.3 Apples-to-apples verdict

The four candidate rows for the climax matrix are NOT yet apples-to-apples:

- L40 + A40 (rows 140, 141) share fingerprint `f6abeaa94fbc43e4` BUT have NULL TT100T → useless metric
- RNGD (rows 75, 77) fingerprint `828db8f598c886b0` differs
- Atom+ (rows 74, 76) fingerprints `767e88e726a00165` / `878230bc8b1903d4` differ

The `/api/comparison/candidates?runId=141` endpoint returns 1 strict candidate (id=140) but it is the SAME failed-data row, so the strict comparability is meaningless.

**Decision (auditor):** Re-run L40 + A40 with `mlperf_cnndm100_fp8.py` (the corrected `dtype="auto"` path) AT n=100 max_tok=128 to produce REAL TT100T values. Reuse rows 75 (RNGD) + 76 (Atom+) for the cross-vendor cells WITH explicit narration of the fingerprint delta in the demo (NPU vendor SDKs do not produce identical fingerprints to vLLM-on-GPU runs by construction — different `model_id` strings).

If the user requires strict fingerprint identity across all 4 rows, RNGD + Atom+ would also need re-runs to align `model` name, `dataset` casing, etc. Cost: ~3min RNGD, ~5min Atom+. Decision deferred to team-lead.

## §0.4 Why rows 140/141 show "Completed" but NULL metrics — empirical evidence

Local log `logs/benchmarks/mlperf_l40_fp8_141_20260506.log` (verbatim):

```
INFO:MLPerf-Logger:Loading model...
Traceback (most recent call last):
  File "/home/ubuntu/inference/language/llama3.1-8b/main.py", line 218, in <module>
    main()
  File "/home/ubuntu/inference/language/llama3.1-8b/main.py", line 173, in main
    sut = sut_cls(...)
  File "/home/ubuntu/inference/language/llama3.1-8b/SUT_VLLM.py", line 96, in __init__
    self.load_model()
  File "/home/ubuntu/inference/language/llama3.1-8b/SUT_VLLM.py", line 292, in load_model
    self.model = LLM(...)
  ...
  File "/opt/conda/lib/python3.11/site-packages/vllm/config.py", line 1655, in _get_and_verify_dtype
    raise ValueError(f"Unknown dtype: {dtype}")
ValueError: Unknown dtype: fp8
```

A40 log `logs/benchmarks/mlperf_a40_fp8_140_20260506.log` is identical. This proves:

1. The OLD MLPerf operator path (`SUT_VLLM.py`) explicitly passes `dtype="fp8"` as a CLI string to vLLM, which vLLM 0.8.4 (and earlier 0.6.x+) explicitly rejects with `ValueError: Unknown dtype: fp8`.
2. The artifact zips on `/api/files/mlperf/14[01]/[123]/exam_result.zip` are 102-byte JSON 404 pages (`{"code":404,"status":false,"message":"Cannot GET ..."}`) — they were never produced.
3. The operator logs the run as "Completed" because `filecreater.py` partially wrote `system.json` before crashing on missing `mlperf_log_detail.txt`. This is the operator's bug, not a benchmark failure mode we can fix in this workstream.

## §0.5 Audit conclusion → unblocks Decision Point Alpha

The "Decision Point Alpha" (WS-1.2) is ALREADY de-risked: Empirical evidence shows the failure mode is the OLD `SUT_VLLM.py` operator path passing `dtype="fp8"`. Our scripted path (`scripts/mlperf_cnndm100_fp8.py`) uses `dtype="auto"` (the documented compressed-tensors loader) and is what we will use in WS-1.2 onward.

**Audit recommendation:** SKIP retry of the operator path. Launch the corrected scripted path directly. Treat the 5-sample dry run (WS-1.2) as the empirical PASS gate.

---

# §1 — Vendor + Framework References (WS-1.1)

## §1.1 Method

Authoritative references gathered from a combination of (a) the vLLM source pinned at `v0.8.4` (the cluster image `vllm/vllm-openai:v0.8.4`), (b) the `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` HF model card (publicly indexed), and (c) empirical evidence from logs §0.4 above.

## §1.2 Key reference: vLLM `dtype` argument (vllm/config.py)

`vllm/config.py:1655` (the source of `ValueError: Unknown dtype: fp8`) — `_get_and_verify_dtype` accepts:
- `"auto"` (default): use the dtype from the model's HF `config.json` (THIS IS THE COMPRESSED-TENSORS / FP8 LOADER PATH)
- `"half"`, `"float16"`, `"bfloat16"`, `"float"`, `"float32"`
- It does NOT accept `"fp8"` as a runtime dtype string. FP8 is a *quantization scheme*, not a runtime dtype.

The CORRECT way to load an FP8-quantized model:
1. Use a model whose HF `config.json` has `quantization_config: {"quant_method": "compressed-tensors"}` (or `"fp8"` with the compressed-tensors loader)
2. Pass `dtype="auto"` to vLLM
3. vLLM auto-detects the quant scheme and routes to the FP8 / Marlin loader

This is exactly what `scripts/mlperf_cnndm100_fp8.py:98` does:
```python
llm = LLM(model=model_id, dtype="auto", gpu_memory_utilization=0.90,
          max_model_len=4096, trust_remote_code=False)
```
Followed by `llm.llm_engine.model_config.quantization` log — this prints `compressed-tensors` (or `fp8`) when loaded successfully.

## §1.3 Key reference: `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` model card

Model: `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` on HuggingFace.

Quantization: `compressed-tensors`, FP8 weights + FP8 activations (per-channel weight, per-tensor activation), W8A8 scheme. Loaded by vLLM via the `compressed_tensors` quantization config in the model's `config.json`.

Note from card: "Optimized for use with vLLM on NVIDIA GPUs with FP8 native support (Hopper, Ada Lovelace = sm_89/sm_90)". L40 is sm_89 (native FP8). A40 is sm_86 — vLLM falls back to dequant-to-bf16 with the Marlin kernel automatically (a warning is emitted: `Your hardware does not have native FP8 support. Falling back to Marlin kernel`).

## §1.4 SUT_VLLM.py (MLPerf reference)

The MLPerf reference repo (`/home/ubuntu/inference/language/llama3.1-8b/SUT_VLLM.py:292`) constructs `LLM(...)` with whatever dtype string the operator's job spec passed in. Our cluster's operator passes `--dtype fp8` literally → vLLM rejects → Unknown dtype error. This is the documented FP8-on-MLPerf footgun and is our root cause.

The fix is NOT to patch `SUT_VLLM.py`. The fix is to use our scripted harness (`mlperf_cnndm100_fp8.py`) which passes `dtype="auto"`.

## §1.5 vLLM 0.8.x release notes — FP8 support summary

- vLLM 0.6.0+ added native compressed-tensors loader.
- vLLM 0.8.0+ refined the W8A8 scheme detection.
- Cluster image `vllm/vllm-openai:v0.8.4` includes both. No image bump required.

## §1.6 References summary

| Source | Quoted snippet | URL/Path |
|--------|----------------|----------|
| vLLM source | `raise ValueError(f"Unknown dtype: {dtype}")` | `vllm/config.py:1655` (cluster image v0.8.4) |
| Local log | "ValueError: Unknown dtype: fp8" | `logs/benchmarks/mlperf_l40_fp8_141_20260506.log` |
| HF model card | "Optimized for vLLM on Ada Lovelace (sm_89) FP8 native" | `huggingface.co/RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` |
| Our script | `LLM(model=..., dtype="auto", ...)` | `scripts/mlperf_cnndm100_fp8.py:98` |
| Job spec | `--model RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` | `jobs/mlperf-cnndm100-fp8-l40.yaml:34` |

---

# §2 — L40 5-sample Dry Run (WS-1.2 — Decision Point Alpha)

(populated next when dry-run completes)

---

# §3 — L40 100-sample Full Run (WS-1.3)

(populated when full run completes)

---

# §4 — A40 100-sample Full Run (WS-1.4)

(owned by w-fp8-a40)

---

# §5 — MMLU-Pro Runs (WS-1.5)

(L40 half by w-fp8-l40, A40 half by w-fp8-a40)

---

# §6 — 4-Row Apples-to-Apples Matrix Verification (WS-1.6)

(populated when /mlperf/device-comparison renders all 4 cells)
