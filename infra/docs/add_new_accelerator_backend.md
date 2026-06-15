# Operator Runbook: Adding a New Accelerator Backend

## Overview

This runbook describes how to extend the ETRI LLM benchmark cluster to support a new accelerator family (e.g., AMD MI300, Intel Gaudi, Graphcore IPU). It covers Kubernetes device plugin setup, benchmark script integration, and model profile configuration.

## Step 1: Define Accelerator Type in cluster.yaml

Add the new accelerator family to config/cluster.yaml:

```yaml
workers:
  - name: node7
    role: worker
    accelerator: { type: gpu, vendor: amd, model: "MI300", count: 2 }  # NEW
    ssh: { host: 10.254.184.200, port: 122 }
    labels:
      accelerator-type: gpu
      gpu-vendor: amd
      gpu-model: mi300

# Define accelerator capabilities (global reference):
accelerator_specs:
  amd-mi300:
    name: "AMD MI300X"
    memory_gb: 192
    peak_bw_gbs: 5120
    compute_units: 150
    tensor_ops_fp8: true
    tensor_ops_fp16: true
    tensor_ops_bf16: true
```

## Step 2: Create Kubernetes Device Plugin

Write a daemonset that exposes the accelerator to Kubernetes.

**File**: `k8s/device-plugins/amd-mi300-device-plugin.yaml`

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: amd-mi300-device-plugin
  namespace: kube-system
spec:
  selector:
    matchLabels:
      k8s-app: amd-mi300-device-plugin
  template:
    metadata:
      labels:
        k8s-app: amd-mi300-device-plugin
    spec:
      tolerations:
        - key: node-role.kubernetes.io/master
          effect: NoSchedule
      nodeSelector:
        gpu-vendor: amd
      containers:
        - name: amd-mi300-device-plugin
          image: rocm/amd-gpu-device-plugin:latest
          securityContext:
            privileged: true
          volumeMounts:
            - name: device
              mountPath: /dev
            - name: sys
              mountPath: /sys
      volumes:
        - name: device
          hostPath:
            path: /dev
        - name: sys
          hostPath:
            path: /sys
```

Deploy the device plugin:

```bash
kubectl apply -f k8s/device-plugins/amd-mi300-device-plugin.yaml
```

Verify it's running:

```bash
kubectl get ds -n kube-system amd-mi300-device-plugin
kubectl logs -n kube-system -l k8s-app=amd-mi300-device-plugin --tail=50
```

Test resource visibility:

```bash
kubectl describe node node7 | grep "amd.com/mi300"
# Expected: amd.com/mi300: 2
```

## Step 3: Prepare Nodes with New Accelerator

Update bootstrap script or create a new one for AMD hardware:

**File**: `scripts/bootstrap-node-amd.sh` (copy and modify bootstrap-node.sh)

```bash
#!/bin/bash
set -euo pipefail

echo "=== AMD MI300 Node Bootstrap ==="

# Install ROCm runtime and drivers:
apt-get update
apt-get install -y rocm-hip-libraries rocm-device-libs

# Install AMD GPU device plugin binaries:
wget https://github.com/RadeonOpenCompute/k8s-device-plugin/releases/download/v1.0.0/amd-gpu-device-plugin-amd64
chmod +x amd-gpu-device-plugin-amd64

# Continue with standard Kubernetes bootstrap:
# (See original bootstrap-node.sh for kubeadm, containerd setup)

echo "=== Bootstrap Complete ==="
```

Run on the new node:

```bash
scp scripts/bootstrap-node-amd.sh kcloud@<node7-ip>:/tmp/
ssh -p 122 kcloud@<node7-ip> sudo /tmp/bootstrap-node-amd.sh
```

## Step 4: Add Benchmark Script for New Accelerator

Create a new benchmark script to run inference on the new accelerator:

**File**: `scripts/15_run_amd_mi300_benchmark.sh`

```bash
#!/bin/bash
set -euo pipefail

source ../config/.env
source common.sh

ACCELERATOR_TYPE="amd_mi300"
BENCHMARK_NAME="AMD MI300 Inference"
MODEL="meta-llama/Llama-3.1-8B-Instruct"
PRECISION="fp8"
OUTPUT_TOKENS=100

echo "=== Running $BENCHMARK_NAME ==="

# Create Kubernetes job:
kubectl create job benchmark-amd-mi300-$(date +%s) \
  --image=jungwooshim/etri-llm-backend:latest \
  --from=cronjob/benchmark-template \
  -n llm-evaluation \
  -- python /workspace/runner.py \
    --accelerator-type $ACCELERATOR_TYPE \
    --model $MODEL \
    --precision $PRECISION \
    --output-tokens $OUTPUT_TOKENS \
    --output-dir /mnt/nfs/results/$(date +%Y%m%d)/amd_mi300/

# Monitor job:
JOB_NAME=$(kubectl get jobs -n llm-evaluation | grep amd-mi300 | tail -1 | awk '{print $1}')
kubectl wait --for=condition=complete job/$JOB_NAME -n llm-evaluation --timeout=300s

echo "=== Benchmark Complete ==="
```

## Step 5: Create Backend Runner Adapter

The runner (runner.py) must support the new accelerator. Add a backend adapter:

**File**: `server/src/runner/backends/amd-mi300-backend.ts` (or `.py` if using Python)

```typescript
import { BaseBackend } from './base-backend';

export class AMDMI300Backend extends BaseBackend {
  name = 'amd-mi300';
  
  async initialize(modelPath: string, precision: 'fp8' | 'bf16' | 'fp16') {
    // Initialize ROCm runtime
    const { rocm } = await import('rocm-node');
    this.device = rocm.getDevice(0);
    
    // Load model using vLLM or similar (vLLM has AMD MI300 support)
    this.model = await vllm.loadModel(modelPath, {
      dtype: this.precisionToRocmDtype(precision),
      device_type: 'rocm',
    });
  }

  async generate(prompt: string, outputTokens: number): Promise<GenerateResult> {
    const startTime = Date.now();
    const result = await this.model.generate(prompt, {
      max_new_tokens: outputTokens,
    });
    const endTime = Date.now();

    return {
      text: result.text,
      tokens_generated: result.token_count,
      latency_ms: endTime - startTime,
      throughput_tps: result.token_count / ((endTime - startTime) / 1000),
    };
  }

  async cleanup() {
    this.model.unload();
    rocm.freeMemory();
  }
}
```

Register in runner:

```typescript
// server/src/runner/runner.ts
import { AMDMI300Backend } from './backends/amd-mi300-backend';

const BACKENDS = {
  'amd_mi300': AMDMI300Backend,
  'nvidia_l40': NVIDIAGPUBackend,
  'furiosa_rngd': FuriosaNPUBackend,
};

export function getBackend(type: string): BaseBackend {
  if (!(type in BACKENDS)) throw new Error(`Unknown backend: ${type}`);
  return new BACKENDS[type]();
}
```

## Step 6: Build and Push Docker Image

The Docker image must include the new accelerator runtime (ROCm, Gaudi SDK, etc.):

**File**: `Dockerfile` (update)

```dockerfile
FROM nvidia/cuda:12.0-devel-ubuntu22.04

# Install base dependencies
RUN apt-get update && apt-get install -y python3.11 python3-pip

# Install NVIDIA CUDA (existing)
RUN apt-get install -y cuda-toolkit-12-0

# Install AMD ROCm (NEW)
RUN apt-get install -y rocm-hip-libraries rocm-device-libs

# Install Intel Gaudi (if also adding Gaudi support)
# RUN pip install habana-torch

# Install inference engines
RUN pip install vllm

COPY ./server /workspace
WORKDIR /workspace
RUN pip install -r requirements.txt

ENTRYPOINT ["python", "dist/src/main.js"]
```

Build:

```bash
./scripts/build-and-push.sh v14 --accelerators cuda,rocm,habana
```

## Step 7: Update Model Profiles

Add support for models on the new accelerator in config/model_profiles.yaml:

```yaml
models:
  - name: llama-3.1-8b-fp8
    # ... existing fields ...
    accelerator_compatibility:
      # ... existing entries ...
      - type: gpu
        vendor: amd
        models: [MI300, MI300X]
        min_device_count: 1
        min_vram_per_device_gb: 32
        notes: "MI300X (192GB) provides ample headroom for FP8 8B"
        tensor_parallel_recommended: 0

  - name: llama-3.1-70b-fp8
    # ... existing fields ...
    accelerator_compatibility:
      # ... existing entries ...
      - type: gpu
        vendor: amd
        models: [MI300X]
        min_device_count: 4
        min_vram_per_device_gb: 192
        notes: "TP=4 across 4 MI300X: ~17.5GB weights + 1GB KV per device. Comfortable fit."
```

## Step 8: Benchmark Profile Configuration

Create benchmark-specific profiles for the new accelerator:

**File**: `config/benchmark_profiles.yaml` (new entry)

```yaml
accelerator_profiles:
  amd_mi300:
    name: "AMD MI300X"
    vendor: amd
    memory_gb: 192
    peak_fp8_throughput_tflops: 500  # approximate
    recommended_batch_size: 32
    recommended_seq_length: 2048
    tensor_parallel_strategies: [1, 2, 4]  # can use 1, 2, or 4 devices
    supports_models:
      - llama-3.1-8b
      - llama-3.1-70b
    notes: "Excellent for inference; ROCm ecosystem mature for LLMs"
```

## Step 9: Create Benchmark Preset

Add a preset that automatically uses the new accelerator:

**File**: `config/benchmark_presets.yaml` (new)

```yaml
presets:
  amd_mi300_standard:
    name: "Standard MI300X Benchmark"
    benchmarks:
      - name: mlperf_inference
        model: llama-3.1-8b-fp8
        accelerator: amd_mi300
        repetitions: 3
      - name: mmlu_pro
        model: llama-3.1-8b-fp8
        accelerator: amd_mi300
        repetitions: 1
```

## Step 10: Test with a Small Benchmark

Run a quick test to verify everything is integrated:

```bash
# Deploy a test pod:
kubectl run test-amd-mi300 \
  --image=jungwooshim/etri-llm-backend:v14 \
  --rm -it --restart=Never \
  -n llm-evaluation \
  --overrides='{"spec":{"nodeSelector":{"gpu-vendor":"amd"},"containers":[{"name":"test","image":"jungwooshim/etri-llm-backend:v14","resources":{"limits":{"amd.com/mi300":"1"}}}]}}' \
  -- python -c "
from runner import getBackend
backend = getBackend('amd_mi300')
backend.initialize('meta-llama/Llama-3.1-8B-Instruct', 'fp8')
result = backend.generate('Hello, world!', 10)
print(f'TPS: {result.throughput_tps:.2f}')
"
```

Expected output:
```
TPS: 150.32
```

## Step 11: Update Documentation and CI/CD

Update cluster documentation:

```bash
# docs/runbook.md:
# Add AMD MI300 to the benchmark scripts list

# .github/workflows/benchmark.yml (if using GitHub Actions):
# Add:
# - name: AMD MI300 Benchmark
#   run: bash scripts/15_run_amd_mi300_benchmark.sh
```

## Step 12: Run Full Benchmark Cycle

Once everything is tested, run the full benchmark suite:

```bash
cd scripts
bash 15_run_amd_mi300_benchmark.sh
bash 16_generate_reports.sh
```

Verify results:

```bash
ls -la results/$(date +%Y%m%d)/amd_mi300/
# Should contain results.json with latency, throughput, accuracy metrics
```

## Troubleshooting: New Accelerator Integration

| Symptom | Likely Cause | Fix |
|---|---|---|
| Device plugin shows 0 devices | Accelerator not detected by system | Check `rocm-smi` (AMD) or equivalent; verify drivers installed |
| Backend can't load model | vLLM or inference engine doesn't support accelerator | Install correct backend library; check vLLM docs for AMD support |
| Pod can't find `amd.com/mi300` resource | Device plugin not running or misconfigured | Verify daemonset is deployed; check logs in kube-system namespace |
| Benchmark hangs during inference | ROCm runtime deadlock or out-of-memory | Monitor with `rocm-smi`; check memory usage; reduce batch size |
| Results show 0 throughput | Latency measurement not working | Check backend adapter's timing code; verify it matches inference engine's latency API |
| Performance is lower than expected | Inference engine not using AMT or tensor cores | Update vLLM to latest; enable ROCm optimizations; profile with rocprof |

## Future Extensions

Once the new accelerator is stable, consider:

1. **Multi-accelerator TP**: Combine AMD MI300 with NVIDIA GPUs in same benchmark
   ```bash
   # runner.py supports mixed backends in one inference cluster
   ```

2. **Quantization optimization**: Tune FP8/INT4 precision per accelerator
   ```bash
   # Different backends may have different optimal precisions
   ```

3. **Cost analysis**: Compare $/TFLOP across accelerators
   ```bash
   # Add cost metrics to benchmark results
   ```
