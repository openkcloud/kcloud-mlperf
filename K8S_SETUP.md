# K8s MLPerf/MMLU Benchmark Setup Guide

## Overview

This guide explains how to set up a Kubernetes cluster on bare-metal with GPU support and run MLPerf inference and MMLU benchmarks on Llama-3.1-8B-Instruct.

## Prerequisites

- **Hardware**: NVIDIA GPU (RTX 4090 or compatible with 24GB+ VRAM)
- **OS**: Ubuntu 20.04/22.04 or WSL2 with Ubuntu
- **NVIDIA Driver**: 535.x or newer installed
- **HuggingFace Account**: With access to Llama-3.1-8B-Instruct model

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/openkcloud/kcloud-mlperf.git
cd kcloud-mlperf

# 2. Set up K8s cluster (if not already available)
chmod +x scripts/setup_k8s_cluster.sh
./scripts/setup_k8s_cluster.sh

# 3. Run benchmarks
chmod +x scripts/run_benchmarks.sh
./scripts/run_benchmarks.sh

# 4. Monitor progress (in another terminal)
./scripts/monitor_benchmarks.sh
```

## Benchmark Targets

| Benchmark | Metric | Threshold | Expected |
|-----------|--------|-----------|----------|
| MLPerf | ROUGE-L | ??0.4000 | ~0.4123 |
| MMLU | Accuracy | ??0.6500 | ~0.6842 |

## Directory Structure

```
kcloud-mlperf/
?쒋?? k8s/                          # Kubernetes manifests
??  ?쒋?? 00-namespace.yaml         # mlperf namespace
??  ?쒋?? 01-secret.yaml            # HuggingFace token secret
??  ?쒋?? 02-mlperf-job-FULL.yaml   # MLPerf benchmark job
??  ?붴?? 03-mmlu-job-FULL.yaml     # MMLU benchmark job
?쒋?? scripts/
??  ?쒋?? run_benchmarks.sh         # Main benchmark orchestrator
??  ?쒋?? monitor_benchmarks.sh     # Real-time monitoring
??  ?쒋?? setup_k8s_cluster.sh      # K8s cluster setup
??  ?붴?? llm_inference.py          # Simple chat demo
?쒋?? run.py                        # MLPerf runner (vLLM backend)
?쒋?? mmlu.py                       # MMLU evaluator (vLLM backend)
?붴?? Dockerfile                    # Container image
```

## Manual K8s Commands

### Create Cluster (using kind)

```bash
kind create cluster --name mlperf-cluster
kubectl cluster-info
```

### Apply Manifests

```bash
# Create namespace
kubectl apply -f k8s/00-namespace.yaml

# Create HuggingFace token secret
kubectl apply -f k8s/01-secret.yaml

# Verify
kubectl get namespace mlperf
kubectl get secret hf-token -n mlperf
```

### Run MLPerf Benchmark

```bash
# Start the job
kubectl apply -f k8s/02-mlperf-job-FULL.yaml

# Monitor
kubectl get jobs -n mlperf
kubectl get pods -n mlperf

# View logs
kubectl logs -f -l job-name=mlperf-llama-benchmark-FULL -n mlperf

# Describe job
kubectl describe job mlperf-llama-benchmark-FULL -n mlperf
```

### Run MMLU Benchmark

```bash
# Start the job
kubectl apply -f k8s/03-mmlu-job-FULL.yaml

# Monitor
kubectl get jobs -n mlperf
kubectl logs -f -l job-name=mmlu-benchmark-FULL -n mlperf
```

### Cleanup

```bash
kubectl delete job -n mlperf --all
kubectl delete namespace mlperf
kind delete cluster --name mlperf-cluster
```

## GPU Support

### For kind clusters (local testing)

Kind requires additional configuration for GPU passthrough. See `setup_k8s_cluster.sh` for details.

### For kubeadm clusters (production)

1. Install NVIDIA Container Toolkit on all GPU nodes
2. Deploy NVIDIA Device Plugin:

```bash
kubectl create -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.0/nvidia-device-plugin.yml
```

3. Verify GPU availability:

```bash
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}: {.status.allocatable.nvidia\.com/gpu}{"\n"}{end}'
```

## Expected Results

### MLPerf (CNN/DailyMail Summarization)

```
=== Results Summary (MLPerf) ===
Total samples processed: 13368
Samples completed: 13368
Completion rate: 100.00%
Average latency (p50): 1.23s
Average latency (p90): 2.45s
Throughput: 0.81 samples/second
Model: meta-llama/Llama-3.1-8B-Instruct
Dataset: CNN/DailyMail

=== Acceptance Criteria (MLPerf) ===
Required ROUGE-L:      >= 0.4000
Observed ROUGE-L:      0.4123

MLPerf Benchmark Status: PASS
```

### MMLU (57 Subjects)

```
=== Results Summary (MMLU) ===
Total questions processed: 14042
Questions completed: 14042
Completion rate: 100.00%
Overall accuracy: 0.6842
Average response time: 2.34s
Model: meta-llama/Llama-3.1-8B-Instruct
Dataset: MMLU (Full - 57 subjects)

=== Acceptance Criteria (MMLU) ===
Required overall accuracy: >= 0.6500
Observed overall accuracy: 0.6842

MMLU Benchmark Status: PASS
```

## Troubleshooting

### Pod stuck in Pending state

Check if GPU resources are available:
```bash
kubectl describe pod <pod-name> -n mlperf
kubectl describe nodes | grep -A5 "Allocatable:"
```

### Out of memory errors

Reduce batch size or use smaller model context:
- Edit job YAML to add `--max-model-len 2048`
- Ensure GPU has enough VRAM (Llama-3.1-8B needs ~16GB in FP16)

### HuggingFace authentication errors

Verify your HF token has access to Llama-3.1-8B:
```bash
kubectl get secret hf-token -n mlperf -o jsonpath='{.data.HF_TOKEN}' | base64 -d
```

## Run Chat Inference Locally

```bash
cd scripts
python3 llm_inference.py
```

This demonstrates the model responding to various prompts with performance metrics.
