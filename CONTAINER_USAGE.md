# MLPerf Llama Container Usage

## For Your Teammates 🤝

### What You Get
A **ready-to-run Docker container** that reproduces our **34.9 tokens/second** MLPerf benchmark on NVIDIA GPUs.

### Quick Start

#### 1. Load Container (if given as tar file)
```bash
docker load < mlperf-llama-latest.tar
```

#### 2. Run Benchmark
```bash
# Full benchmark (10 samples)
docker run --gpus all \
  -e HF_TOKEN=your_huggingface_token \
  -v ./results:/app/results \
  mlperf-llama:latest

# Quick test (3 samples)
docker run --gpus all \
  -e HF_TOKEN=your_huggingface_token \
  -v ./results:/app/results \
  mlperf-llama:latest test
```

#### 3. Check Results
```bash
cat results/summary.txt
cat results/benchmark_results.json
```

### Prerequisites
- **Docker with GPU support** (nvidia-container-runtime)
- **NVIDIA GPU** with 16GB+ VRAM (A30/A100/RTX 4090)
- **HuggingFace Token** with Llama-3.1-8B access

### Get HuggingFace Token
1. Visit: https://huggingface.co/settings/tokens
2. Create token with "Read" permission
3. Request access: https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct

### Expected Performance
| Hardware | Tokens/sec | Memory |
|----------|------------|--------|
| RTX 4090 | 35-45 | ~16GB |
| A30 | 30-40 | ~15GB |
| A100 | 50-70 | ~15GB |

### Troubleshooting
```bash
# Check GPU access
nvidia-smi
docker run --rm --gpus all nvidia/cuda:11.8-base-ubuntu22.04 nvidia-smi

# Interactive shell
docker run --gpus all -it mlperf-llama:latest bash
```

### Configuration Options
```bash
# Environment variables
-e HF_TOKEN=your_token       # Required: HuggingFace token
-e NUM_SAMPLES=10            # Optional: Number of test samples (default: 10)
-e MAX_TOKENS=64             # Optional: Max tokens per response (default: 64)
-e BATCH_SIZE=1              # Optional: Batch size (default: 1)
```

### Volume Mounts
```bash
-v ./results:/app/results    # Benchmark output
-v ./cache:/app/cache        # Model cache (speeds up subsequent runs)
```

### Complete Example
```bash
# Create directories
mkdir -p results cache

# Run benchmark with cache
docker run --gpus all \
  -e HF_TOKEN=hf_your_token_here \
  -e NUM_SAMPLES=10 \
  -e MAX_TOKENS=64 \
  -v $(pwd)/results:/app/results \
  -v $(pwd)/cache:/app/cache \
  mlperf-llama:latest

# View results
echo "=== SUMMARY ==="
cat results/summary.txt
echo "=== DETAILED RESULTS ==="
cat results/benchmark_results.json | jq .
```

### For Kubernetes Deployment
If you need to deploy on Kubernetes clusters, use the manifests in the GitHub repo:
```bash
git clone https://github.com/jshim0978/MLPerf_local_test.git
cd MLPerf_local_test
kubectl apply -f k8s/
```