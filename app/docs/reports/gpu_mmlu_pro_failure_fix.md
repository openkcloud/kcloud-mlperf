# GPU MMLU-Pro A40 FP8 Failure — RCA & Fix

**Author:** w-mmlu-pro-backend  
**Date:** 2026-05-06  
**Task:** #2 — GPU MMLU-Pro A40 failure: full RCA + fix

---

## Reproduction Command

```bash
# This was the failing exam (ID=55), submitted via backend API:
curl -s http://10.254.177.41:30001/api/mm-exam/list
# Exam #55: name=pretotype_00, model=Llama-3.1-8B-Instruct, precision=bfloat16,
#   gpu_type=NVIDIA-A40, cpu_core=8, ram_capacity=16, data_number=100
# Status: Error — "Exam in error state, resetting to error"
```

---

## Exact Operator stderr (from `kubectl logs deployment/etri-llm-operator -n llm-evaluation`)

```
2026-05-06T06:14:29Z  INFO  Pod using GPU on node  {"node": "node3", "pod": "mlperf-cnndm100-fp8-a40-20260506-rvzlr", "gpuUsed": 1}
2026-05-06T06:14:29Z  INFO  Node used resources    {"node": "node3", "usedCPU": "8", "usedMemory": "32Gi", "usedGPU": 1}
2026-05-06T06:14:29Z  INFO  Node available resources {"node": "node3", "availableCPU": "7900m", "availableMemory": "229789172Ki", "availableGPU": 1}
2026-05-06T06:14:29Z  INFO  Node has insufficient CPU {"node": "node3", "available": "7900m", "required": "8"}
2026-05-06T06:14:29Z  ERROR Failed to select node for exam {"exam": "mmlu-55", "error": "no nodes have enough resources for the exam"}
2026-05-06T06:14:29Z  INFO  Phase updated ExamAllNodeNotAvailable
2026-05-06T06:14:29Z  DEBUG events  Failed to schedule exam: no nodes have enough resources for the exam {"reason": "ExamAllNodeNotAvailable"}
2026-05-06T06:14:33Z  INFO  Exam: Reconcile(mmlu-55) - Move to ReconcileError
2026-05-06T06:14:33Z  INFO  Phase updated ExamErrorOccured
2026-05-06T06:14:33Z  DEBUG events  Exam in error state, resetting to error {"reason": "ExamErrorOccured"}
```

---

## Root Cause Analysis

### Primary cause: CPU starvation (transient resource contention)

- **Exam #55** requested `cpu_core=8` (8000m) on node3 (the only NVIDIA-A40 node)
- At submission time (2026-05-06T06:14:29Z), the MLPerf job `mlperf-cnndm100-fp8-a40-20260506-rvzlr` was already running on node3 and had consumed all 8 of node3's available CPU cores (node3 allocatable: 15900m, used: 8000m → available: 7900m)
- The operator's node scheduler requires strict `available >= required` for CPU — 7900m < 8000m fails
- Operator immediately transitions to `ExamAllNodeNotAvailable` → `ExamErrorOccured`
- The error message "Exam in error state, resetting to error" is the operator's generic error phase message, not a vLLM or model error

### Secondary finding: FP8 precision on A40 is NOT the failure cause

The task brief referenced `ValueError: Unknown dtype: fp8` from `logs/benchmarks/mlperf_a40_fp8_140_20260506.log`. That error is in the **MLPerf harness** (`SUT_VLLM.py`) which passes `dtype=fp8` as a raw string to vLLM's `LLM()` constructor — a code path that does not accept `fp8` as a dtype string in vLLM v0.6.3.

The MMLU-Pro harness uses a different path: it loads `Llama-3.1-8B-Instruct-FP8` with `dtype=bfloat16` (the precision field), which causes vLLM to detect the model's `compressed-tensors` quantization config and use the **Marlin kernel** for weight-only FP8 dequantization. This works on Ampere (A40) with a performance warning but no failure:

```
WARNING marlin_utils_fp8.py:50] Your GPU does not have native support for FP8 computation
but FP8 quantization is being used. Weight-only FP8 compression will be used leveraging
the Marlin kernel. This may degrade performance for compute-heavy workloads.
```

Prior successful runs confirm this: exams #49 (A40, FP8, 100 samples, Completed) and #52 (A40, FP8, 12102 samples, Completed).

### The `data_number=0 → ''` fix status

The fix IS already applied in `server/src/mm-exam/mm-exam.service.ts` line 163:
```typescript
maxTestSamples: `${data.data_number === 0 ? '' : data.data_number}`,
```
No action needed.

---

## Fix Applied

**No code change required.** The failure was a transient infrastructure condition (CPU contention from a concurrent MLPerf job on the only A40 node).

**Operational fix:** submitted exam #56 (`mmlu-a40-fp8-rca-test`) after the competing MLPerf job completed. Node3 CPU allocation dropped from 8000m to 405m. Exam #56 was scheduled successfully.

### Verification evidence (exam #56)

```
kubectl get exam mmlu-56 -n llm-evaluation -o jsonpath='{.status.phase}'
→ {"type":"Running","reason":"ExamRunning","message":"Exam job created and running on node node3","status":"True"}

kubectl logs mmlu-56-1-1-q8b2c -n llm-evaluation (excerpt):
  INFO llm_engine.py:237] dtype=torch.bfloat16, quantization=compressed-tensors
  WARNING marlin_utils_fp8.py:50] Weight-only FP8 compression will be used leveraging the Marlin kernel.
  INFO model_runner.py:1067] Loading model weights took 8.4927 GB
  INFO gpu_executor.py:122] # GPU blocks: 13033, # CPU blocks: 2048
  Total samples to process: 1400 (100/subject × 14 subjects)
  INFO:mmlu-logger:1/1400   [actively processing at ~57 tok/s]
```

Model loaded, benchmark running, no errors.

---

## Verdict

| Issue | Status |
|---|---|
| Exam #55 failure cause | CPU starvation (transient): MLPerf job held node3 CPUs at submission time |
| FP8 on A40 (MMLU-Pro path) | WORKS — Marlin kernel fallback, warning only, not an error |
| FP8 on A40 (MLPerf path) | BLOCKED — `ValueError: Unknown dtype: fp8` in MLPerf SUT_VLLM.py (separate scope) |
| `data_number=0 → ''` fix | Already applied, no action needed |
| Code fix required | None — infrastructure/timing issue only |
| Redeploy required | NO |

---

## Recommendations

1. **For production scheduling:** reduce MMLU-Pro cpu_core from 8 to 7 to provide 1-core headroom on node3 (15900m allocatable, other daemons use ~500m). This prevents recurrence if another job overlaps.
2. **For the MLPerf FP8 failure** (separate task): the fix is in `SUT_VLLM.py` — change `dtype=fp8` to `dtype=bfloat16` and let vLLM detect quantization from model config, same as MMLU-Pro does.

---

## Log Paths

- Operator log: `kubectl logs deployment/etri-llm-operator -n llm-evaluation` (captured 2026-05-06T06:14:29Z)
- Reference MLPerf FP8 error: `logs/benchmarks/mlperf_a40_fp8_140_20260506.log`
- Verification run: exam #56, pod `mmlu-56-1-1-q8b2c`, node3
