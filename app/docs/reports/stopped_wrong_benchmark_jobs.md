# Stopped Wrong Benchmark Jobs — Strict Resume

**Stopped at:** 2026-05-06T02:20Z (prior session) and verified clean at 2026-05-06T05:40Z (resume)

## State at resume (2026-05-06T05:40Z)

| Source | State |
|---|---|
| `kubectl get jobs -n llm-evaluation` | no MLPerf/MMLU jobs running (all kaniko Completed; benchmark Jobs deleted) |
| `kubectl get pods -n llm-evaluation` | no benchmark pods running |
| node5 `ssh ... ps -eo cmd grep mlperf|mmlu|llama|vllm|optimum` | empty (no benchmark processes) |
| Logs from prior killed runs | preserved at logs/benchmarks/ |

## Jobs killed during prior session (2026-05-06T02:20Z)

| Job | HW target | Why stopped | Stop command |
|---|---|---|---|
| k8s Job `mlperf-135-1-1` | L40 | wrong precision (vllm rejected fp8 dtype string; superseded by 137 with bf16 — but contract demands fp8) | `kubectl delete job mlperf-135-1-1 -n llm-evaluation` |
| k8s Job `mlperf-136-1-1` (pod `mlperf-136-1-1-bqp4c`) | A40 | running BF16 (contract requires FP8) | `kubectl delete job mlperf-136-1-1 -n llm-evaluation` |
| k8s Job `mlperf-137-1-1` (pod `mlperf-137-1-1-t4dqb`) | L40 | running BF16 with FP8-tagged model — drift; contract requires FP8 | `kubectl delete job mlperf-137-1-1 -n llm-evaluation` |
| k8s Job `mmlu-pro-a40-20260506-020458` | A40 | superseded by MLPerf priority + new contract | `kubectl delete job mmlu-pro-a40-20260506-020458 -n llm-evaluation` |
| k8s Job `mmlu-pro-l40-20260506-020458` | L40 | same | `kubectl delete job mmlu-pro-l40-20260506-020458 -n llm-evaluation` |
| k8s Job `mmlu-pro-rngd-20260506-020458` | RNGD | same | `kubectl delete job mmlu-pro-rngd-20260506-020458 -n llm-evaluation` |
| Host PID 1130314 `python3 atomplus_mlperf_full.py` | Atom+ (node5) | running BF16 meta model; contract requires FP8; full-13368 sample count contradicts new 100-sample contract | `ssh node5 pkill -9 -f atomplus` |
| Host PID 1143393 (poll monitor) | node5 | dependent on PID 1130314 | same pkill |

## Logs preserved

`logs/benchmarks/` retains:
- `mlperf_a40_136_snapshot.log` (114KB) — partial BF16 run
- `mlperf_a40_20260506-020906.log` (149KB) — partial BF16 run
- `mlperf_a40_fp8_140_20260506.log` (4KB) — FP8 attempt that didn't get far
- `mlperf_atomplus_*.log` (20-22KB) — partial Atom+ BF16 run (non-canonical)
- `mlperf_l40_137_snapshot.log` + `mlperf_l40_20260506-020906.log` — L40 BF16 partials
- `mlperf_l40_fp8_141_20260506.log` (4KB) — FP8 attempt
- `mlperf_rngd_20260506-020906.log` (5.3MB) — RNGD BF16 partial; very large because vllm RNGD startup is verbose

These logs are kept for forensic comparison but **excluded from the final canonical comparison** because they violate the contract (BF16 instead of FP8, OpenORCA-era dataset, full sample count vs 100-sample subset).

## Infrastructure NOT stopped

| Component | State |
|---|---|
| `etri-llm-frontend` deployment | preserved (v25 live) |
| `etri-llm-backend` deployment | preserved (v21 live) |
| Prometheus (monitoring ns) | preserved |
| RBLN device plugin (rbln-system ns) | preserved (running) |
| Furiosa device plugin (furiosa-system ns) | preserved |
| GPU operator (gpu-operator ns) | preserved |
| Kubernetes/etcd/kubelet | not touched |

## Confirmation

`kubectl get pods -n llm-evaluation | grep -iE "mlperf|mmlu" | grep -v Completed` returns empty. No wrong benchmark job remains running.

## What will be relaunched

Per the new contract (v1.3.0+):
- benchmark: mlperf-inference
- dataset: CNN/DailyMail v3.0.0
- n_samples: 100
- precision: FP8 STRICT
- model: vendor-specific FP8 variant of Llama-3.1-8B-Instruct
- max_tokens: 128
- hardware: L40, A40, RNGD, Atom+ (parallel where independent)

Logs will be written to `logs/benchmarks/mlperf_cnndm100_<hw>_<ts>.log` per the strict-resume contract.
