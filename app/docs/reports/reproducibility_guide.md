---
title: Reproducibility Guide — Resume Mission
revision: final-resume
mission: benchsuite-resume
date: 2026-05-06
data_source: live cluster + R-1 logs/benchmarks/*
---

# Reproducibility Guide

This guide explains how to reproduce each cell in `docs/reports/benchmark_findings_report.md`. The mission contract is **MLPerf CNN/DailyMail v3.0.0, n=100, Llama-3.1-8B-Instruct, FP8, max_output_tokens=128**.

---

## Cluster baseline (preconditions)

```bash
kubectl --kubeconfig ~/.kube/config get nodes -o wide
# Expect 5 Ready: node1 (control-plane), node2 (L40+A40), node3 (L40-44GiB+A40-44GiB),
#                 node4 (RNGD), node5 (Atom+ allocatable=2)

kubectl get pods -n llm-evaluation | grep -E "etri-llm-(backend|frontend)"
# Expect Running: etri-llm-backend-* (image v22), etri-llm-frontend-* (image v26)

kubectl get pods -n rbln-system | grep -E "rbln-device-plugin|rbln-npu-feature-discovery"
# Expect Running: rbln-device-plugin-*, rbln-npu-feature-discovery-*

# Frontend env requirement (baked at build time)
# VITE__APP_GPU_PROMETHEUS_URL=http://10.254.184.195:30090/  ← set at kaniko-frontend-v26 build time
# Without it, /dashboard/gpu-realtime renders the "Unavailable" diagnosis Chip rather than an iframe.
```

---

## Cell 1 — RNGD MLPerf FP8 100-sample (PASS)

```bash
# Submit via UI: /npu-eval/rngd → "New RNGD Exam" with:
#   benchmark=mlperf
#   model=furiosa-ai/Llama-3.1-8B-Instruct
#   precision=FP8
#   framework=furiosa-llm
#   dataset=CNN-DailyMail
#   data_number=100
#   max_output_tokens=128

# OR submit via curl:
curl -s -X POST http://10.254.177.41:30980/api/npu-eval/create \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"rngd-mlperf-cnndm100-fp8",
    "benchmark":"mlperf",
    "model":"furiosa-ai/Llama-3.1-8B-Instruct",
    "precision":"FP8",
    "framework":"furiosa-llm",
    "dataset":"CNN-DailyMail",
    "data_number":100,
    "max_output_tokens":128,
    "npu_type":"RNGD",
    "npu_num":1,
    "batch_size":1,
    "retry_num":3
  }'
```

Expected result: row id≈75 with `tt100t_seconds≈1.27 s, tps≈79.5 tok/s, status=Completed`.
Expected log: `logs/benchmarks/mlperf_rngd_<timestamp>.log`.
Expected fingerprint: `9e0e05ed795fcbb45f2c4eb0eef60081…` (SHA-256 over canonical fields).

---

## Cell 2 — Atom+ MLPerf FP8 100-sample (PASS)

```bash
# Submit via UI: /npu-eval/atomplus → "New Atom+ Exam" with defaults
#   (defaults already match contract: fp8 / cnn_dailymail / 100 / 128).

# OR submit via curl (npu-eval/create has been extended to accept ATOM npu_type):
curl -s -X POST http://10.254.177.41:30980/api/npu-eval/create \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"atomplus-mlperf-cnndm100-fp8",
    "benchmark":"mlperf",
    "model":"rebellions/Llama-3.1-8B-Instruct",
    "precision":"fp8",
    "framework":"optimum-rbln",
    "dataset":"cnn_dailymail",
    "data_number":100,
    "max_output_tokens":128,
    "npu_type":"ATOM",
    "npu_num":1
  }'
```

Expected result: row id≈74 with `tt100t_seconds≈1.37 s, tps≈73.3 tok/s, drift_flag=False, status=Completed`.
Expected log: `logs/benchmarks/mlperf_atomplus_<timestamp>.log` and `mlperf_atomplus_atomplus-mlperf-full-<timestamp>.log`.
Expected fingerprint: `773c46df8c4132a54786a891bf6819b9…`.

---

## Cell 3 — L40 MLPerf FP8 100-sample (BLOCKED-with-stderr)

```bash
# Current vLLM image rejects the dtype=fp8 literal. Reproduction:
kubectl apply -f jobs/mlperf-l40-fp8.yaml
kubectl logs -f -n llm-evaluation job/mlperf-l40-fp8

# Expected stderr (signature):
#   File "/opt/conda/lib/python3.11/site-packages/vllm/config.py", line 1655, in _get_and_verify_dtype
#     raise ValueError(f"Unknown dtype: {dtype}")
#   ValueError: Unknown dtype: fp8

# Expected log file:
#   logs/benchmarks/mlperf_l40_fp8_141_20260506.log (4249 bytes, full traceback)
```

To **unblock**:
```bash
# Option (1): Use pre-quantized weight + dtype=auto
#   model: RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8
#   dtype: auto
# Option (2): Upgrade vLLM container to >= 0.6.0
#   See: https://docs.vllm.ai/en/latest/quantization/fp8.html
```

---

## Cell 4 — A40 MLPerf FP8 100-sample (BLOCKED-with-stderr)

Identical reproduction + remediation as Cell 3. Log file: `logs/benchmarks/mlperf_a40_fp8_140_20260506.log`.

---

## Verifying the resume-mission rows in the canonical export

```bash
# Filter benchmark_results_real.csv to FP8 100-sample MLPerf rows:
awk -F, '$5=="furiosa" || $5=="rebellions"' docs/reports/benchmark_results_real.csv \
  | awk -F, '$6=="mlperf" && $14==100 && $15==128 && $9=="FP8"'

# Or via the live backend:
curl -s 'http://10.254.177.41:30980/api/comparison/list' \
  | jq '.data.runs[] | select(.benchmark=="mlperf" and .precision=="FP8" and .data_number==100 and .max_output_tokens==128)'
```

---

## Test gate (run before any release)

```bash
cd /home/kcloud/etri-llm-exam-solution/web && npx tsc --noEmit          # exit 0 expected
cd /home/kcloud/etri-llm-exam-solution/server && npx tsc --noEmit       # exit 0 expected
cd /home/kcloud/etri-llm-exam-solution/server && npx jest                # 7 suites / 67 tests
cd /home/kcloud/etri-llm-exam-solution/web && npx vitest run             # 7 files / 51 tests

# All gates green = release-eligible (per docs/reports/e2e_verification_report.md).
```

---

## Frontend env knobs

| Env var | Purpose | Default | Known good |
|---|---|---|---|
| VITE__APP_GPU_PROMETHEUS_URL | URL for the Prometheus iframe on /dashboard/gpu-realtime, /ml-perf, /mmlu | empty (renders Unavailable Chip) | typically the kube-prometheus-stack NodePort, e.g. http://10.254.184.195:30090/ |
| VITE__APP_NPU_REALTIME_URL | Override URL for the Atom+ page's in-app live dashboard iframe | self-host (`/dashboard/npu-realtime`) | leave unset on cluster builds |

---

## Backend NodePorts

| Service | Port | Purpose |
|---|---|---|
| etri-llm-backend-service | 30980 | NestJS backend, all `/api/*` routes |
| etri-llm-frontend-service | 30001 | Vite-built nginx-served SPA |
| node4 (RNGD systemd discovery) | 30890 | External live bench dashboard |
