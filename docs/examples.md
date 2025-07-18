# MLPerf Benchmark Examples

## Quick Examples

### 1. Basic Single GPU Test
```bash
# Simple test with default settings
python src/mlperf_benchmark.py

# With custom sample count
python src/mlperf_benchmark.py --type single --samples 25
```

### 2. Multi-GPU Coordinated Test
```bash
# Test across multiple GPUs
python src/mlperf_benchmark.py --type coordinated --samples 50

# With custom output directory
python src/mlperf_benchmark.py --type coordinated --output-dir results/my-test
```

### 3. Distributed Benchmark
```bash
# 2-node distributed test
python src/mlperf_benchmark.py --type distributed --world-size 2

# 4-node distributed test
python src/mlperf_benchmark.py --type distributed --world-size 4
```

### 4. MLPerf Datacenter Benchmark
```bash
# Standard datacenter benchmark
python src/mlperf_benchmark.py --type datacenter
```

## Advanced Usage

### Using Configuration Files
```bash
# List available configurations
python src/mlperf_benchmark.py --list-configs

# Use specific configuration
python src/mlperf_benchmark.py --type single --config configs/benchmark-configs/single-gpu.yaml
```

### Environment Variables
```bash
# Set HuggingFace token
export HF_TOKEN="hf_your_token_here"

# Limit GPU memory usage
export CUDA_VISIBLE_DEVICES="0"

# Custom token limits
export MAX_TOKENS="64"
export NUM_SAMPLES="20"

# Run benchmark
python src/mlperf_benchmark.py --type coordinated
```

### Docker Usage
```bash
# Build container
docker build -t mlperf-benchmark .

# Run single GPU test
docker run --gpus all -e HF_TOKEN="$HF_TOKEN" mlperf-benchmark

# Run with volume mount for results
docker run --gpus all -v $(pwd)/results:/app/results mlperf-benchmark
```

### Kubernetes Deployment
```bash
# Create secret for HF token
kubectl create secret generic hf-token --from-literal=token="$HF_TOKEN"

# Deploy benchmark job
kubectl apply -f configs/kubernetes/

# Check status
kubectl get pods -l app=mlperf-benchmark

# View logs
kubectl logs -l app=mlperf-benchmark
```

## Results Analysis

### Viewing Results
```bash
# Latest results are always in:
ls results/latest/

# View aggregated results
cat results/latest/aggregated_results.json

# View benchmark logs
cat results/latest/*.log
```

### Reports
```bash
# View performance analysis
cat reports/performance-analysis.md

# View infrastructure health
cat reports/infrastructure-health.md

# View execution summary
cat reports/benchmark-execution-report.md
```

## Common Workflows

### Development Testing
```bash
# Quick test
python src/mlperf_benchmark.py --samples 5

# Performance test
python src/mlperf_benchmark.py --type coordinated --samples 100
```

### Production Benchmarking
```bash
# Full datacenter benchmark
python src/mlperf_benchmark.py --type datacenter

# Multi-node distributed test
python src/mlperf_benchmark.py --type distributed --world-size 4 --samples 1000
```

### Debugging
```bash
# Single sample test
python src/mlperf_benchmark.py --samples 1

# With verbose logging
export PYTHONPATH=. && python -v src/mlperf_benchmark.py --samples 1
```