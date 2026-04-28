# TT100 NPU Benchmark Report

**RUN_ID**: 20260428-072038-a612a54
**Date**: 2026-04-28
**Primary profile**: `tt100-llama3.1-8b-fp8-rngd` (threshold: 1.1 s)
**Baseline profile**: `tt100-llama3.1-8b-bf16-rngd` (no threshold)

> **IMPORTANT**: No actual TT100 measurements have been taken in this autopilot run.
> The furiosa-llm runner requires RNGD hardware and the furiosa-llm runtime installed
> in the benchmark Job image — neither is available in the current pipeline environment.
> All sections below describe scaffolding and protocol, not measured results.
> When real measurements are available they will populate
> `results/20260428-072038-a612a54/tt100_raw.jsonl` and `tt100_summary.csv`.

---

## 1. Framework Status

| Component | Status | Location |
|-----------|--------|----------|
| Benchmark profile YAML | Scaffolded | `config/benchmark_profiles.yaml` |
| TT100 runner script | Scaffolded | `results/20260428-072038-a612a54/tt100_runner.py` |
| Raw output path | Ready (empty) | `results/20260428-072038-a612a54/tt100_raw.jsonl` |
| Summary CSV path | Ready (empty) | `results/20260428-072038-a612a54/tt100_summary.csv` |
| k8s Job spec | Referenced | `k8s/benchmark-jobs/tt100-npu-job.yaml` |

---

## 2. Backend Availability

| Backend | Status | Notes |
|---------|--------|-------|
| `furiosa-llm` | **UNKNOWN** — depends on runner image | Required for RNGD. Import guard in runner.py exits with code 78 if unavailable. |
| `vllm` | Available on GPU nodes | Not used for RNGD TT100. |
| `transformers` | Available if installed | CPU/GPU reference only; not the target backend. |

The runner script uses a hard import guard:

```python
try:
    import furiosa_llm
except ImportError:
    print("BACKEND UNAVAILABLE — operator must install furiosa-llm in the runner image")
    sys.exit(78)
```

Exit code 78 (config error) is distinct from exit code 1 (threshold failed), allowing
the k8s Job controller and CI gates to distinguish "not installed" from "ran but slow".

---

## 3. Measurement Protocol

The runner (`tt100_runner.py`) implements the following protocol:

### Parameters

All parameters are injected via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_PATH` | (required) | HuggingFace model ID or local path |
| `PRECISION` | `fp8` | Inference precision |
| `BACKEND` | `furiosa-llm` | Backend adapter to use |
| `WARMUPS` | `5` | Warm-up runs (excluded from stats) |
| `MEASURED_RUNS` | `30` | Measured runs (included in stats) |
| `OUTPUT_TOKENS` | `100` | Target output token count (the N in TT-N) |
| `PROMPT` | fixed Turing-test prompt | Same string across all devices |
| `SEED` | `42` | RNG seed for reproducibility |
| `THRESHOLD_SEC` | `1.1` (fp8), empty (bf16) | Pass/fail threshold |

### Per-run procedure

For each of the `WARMUPS + MEASURED_RUNS` iterations:

1. Call `backend.reset_kv_cache()` to clear any residual KV state.
2. Record wall-clock start (`time.perf_counter()`).
3. Call `backend.generate(prompt, max_new_tokens=OUTPUT_TOKENS)`.
4. Record wall-clock end.
5. Collect per-token timing breakdown where the backend exposes it:
   - **TTFT** (time-to-first-token)
   - **Prefill latency** (first forward pass)
   - **Decode latencies** (per-token after first)
   - **TT-N** (time to N output tokens = total generation wall time)
   - **E2E latency** (same as TT-N for batch_size=1)
   - **Output tokens/sec** (tokens_generated / e2e_latency)
6. Verify `tokens_generated == OUTPUT_TOKENS`. If the model produced fewer tokens
   (EOS hit early or max_output_tokens truncated), mark run as `FAILED` and record
   the reason. Failed runs are included in the JSONL but excluded from statistics.

### Output files

**`tt100_raw.jsonl`**: One JSON object per run (warmup and measured). Fields:
```json
{
  "run_index": 0,
  "phase": "warmup|measured",
  "status": "OK|FAILED",
  "failure_reason": "",
  "tokens_generated": 100,
  "target_tokens": 100,
  "ttft_sec": 0.123,
  "prefill_latency_sec": 0.123,
  "decode_latencies_sec": [0.011, 0.010, ...],
  "tt_n_sec": 1.05,
  "e2e_latency_sec": 1.05,
  "output_tokens_per_sec": 95.2,
  "synthetic": false
}
```

**`tt100_summary.csv`**: One row with aggregated statistics. Columns include:
`run_id`, `model_path`, `precision`, `backend`, `total_measured`, `passed_runs`,
`failed_runs`, `failure_rate`,
`tt_n_min/max/mean/stddev/p50/p90/p95/p99`,
`ttft_min/max/mean/p50/p90/p99`,
`e2e_min/max/mean/p99`,
`tps_mean/p50/p99`.

### Statistics computed

For each metric over successful measured runs:
- min, max, mean, stddev
- p50, p90, p95, p99

---

## 4. Threshold Check

The pass condition for the primary profile (`tt100-llama3.1-8b-fp8-rngd`) is:

```
p99(tt_n_sec) < 1.1 s
```

where `tt_n_sec` is the wall-clock time from the first input token to the 100th
output token (TT100). This threshold is defined in:
- `config/benchmark_profiles.yaml` → `metrics.threshold_seconds: 1.1`
- `config/cluster.yaml` → `targets.primary.threshold_seconds: 1.1`

The runner prints `RESULT: PASS` or `RESULT: FAIL` and exits with code 0 or 1
respectively. The k8s Job should be configured with `restartPolicy: Never` and
CI gates should check exit code 0 for a clean pass.

**Current status**: THRESHOLD CHECK WILL BE EXECUTED WHEN THE JOB IS APPLIED.
No result is available until `k8s/benchmark-jobs/tt100-npu-job.yaml` is applied
on a node4-targeted Job and the pod completes.

---

## 5. Required Follow-Up Actions

- **(a) Build and push the furiosa-llm runner image**
  Run `scripts/08_build_and_push_images.sh` after adding `furiosa-llm` to the
  Dockerfile for the benchmark runner image. The image must include:
  - `furiosa-llm` (version compatible with RNGD firmware on node4)
  - `transformers >= 4.43` (for Llama-3.1 tokenizer)
  - `tt100_runner.py` copied to `/app/tt100_runner.py`
  - `MODEL_PATH` either baked in or mounted via PVC

- **(b) Apply the k8s Job after node4 setup is verified**
  Confirm node4 labels (`npu-vendor=furiosa`, `npu-model=rngd`) are set and
  the RNGD device plugin is healthy before applying the Job. Run:
  ```
  kubectl get node node4 --show-labels
  kubectl get pods -n kube-system | grep furiosa
  ```

- **(c) Populate tt100_summary.csv**
  After the Job completes, copy the output from the pod:
  ```
  kubectl cp llm-bench/<tt100-pod-name>:/results/20260428-072038-a612a54/tt100_summary.csv \
    results/20260428-072038-a612a54/tt100_summary.csv
  kubectl cp llm-bench/<tt100-pod-name>:/results/20260428-072038-a612a54/tt100_raw.jsonl \
    results/20260428-072038-a612a54/tt100_raw.jsonl
  ```

- **(d) Re-run validate_legitimacy.sh**
  After populating the summary CSV, re-run the legitimacy validator to confirm
  the run is complete and the threshold verdict is recorded in the audit trail.

- **(e) Run bf16 baseline**
  Apply the `tt100-llama3.1-8b-bf16-rngd` profile Job to collect the baseline
  BF16 timing for the `HARDWARE_OPTIMIZED` comparison pair. No threshold applies
  to this run, but the data is required to compute the FP8 speedup ratio.

---

## 6. Reproducibility Notes

- The fixed prompt (`"Explain the significance of the Turing test in the context of
  modern artificial intelligence research."`) is identical across all TT100 profiles
  and devices. This is a deliberate design choice to eliminate prompt-length variance
  from the comparison.
- `seed=42` is set in all profiles. Note that for `furiosa-llm`, seed injection may
  behave differently than for `vllm`; verify that the backend honors the seed for
  any stochastic decode path (not applicable for greedy decode with `temperature=0`).
- With `temperature=0.0` and `top_k=1`, decoding is fully deterministic given
  identical model weights and tokenizer. Run-to-run variance in TT100 reflects
  hardware scheduling, memory bandwidth fluctuation, and thermal state — not model
  stochasticity.

---

*This report was generated by the BENCHMARKS lane of the autopilot run for RUN_ID 20260428-072038-a612a54. No measurement data was fabricated. All data fields in tt100_raw.jsonl will be real measurements when the Job runs on node4.*
