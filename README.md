# MLPerf Local Test - Simplified

A streamlined MLPerf benchmark suite for testing GPU cluster performance with Llama models.

## Quick Start

### 1. Setup
```bash
# Install dependencies
pip install -r requirements.txt

# Set your HuggingFace token
export HF_TOKEN="your_token_here"
```

### 2. Run Benchmarks

**Single GPU Benchmark:**
```bash
python src/mlperf_benchmark.py --type single --samples 10
```

**Multi-GPU Coordinated Benchmark:**
```bash
python src/mlperf_benchmark.py --type coordinated --samples 20
```

**Distributed Benchmark:**
```bash
python src/mlperf_benchmark.py --type distributed --world-size 2
```

**MLPerf Datacenter Benchmark:**
```bash
python src/mlperf_benchmark.py --type datacenter
```

### 3. View Results
Results are automatically saved to `results/latest/`

## Directory Structure

```
├── src/                          # All source code
│   ├── mlperf_benchmark.py       # Main benchmark runner
│   ├── environment_detector.py   # Hardware detection
│   ├── hardware_manager.py       # GPU management
│   └── adapters/                 # Hardware adapters
├── configs/                      # Configuration files
│   ├── kubernetes/               # K8s deployments
│   ├── benchmark-configs/        # Benchmark settings
│   └── docker-compose.yml        # Container setup
├── docs/                         # Documentation
│   ├── setup-guide.md            # Detailed setup
│   ├── deployment-guide.md       # K8s deployment
│   └── troubleshooting.md        # Common issues
├── reports/                      # Latest benchmark reports
│   ├── benchmark-execution-report.md
│   ├── performance-analysis.md
│   └── infrastructure-health.md
└── results/latest/               # Latest benchmark results
```

## Configuration

### Available Configurations
```bash
# List available configs
python src/mlperf_benchmark.py --list-configs

# Use specific config
python src/mlperf_benchmark.py --type single --config configs/benchmark-configs/single-gpu.yaml
```

### Environment Variables
- `HF_TOKEN` - HuggingFace authentication token (required)
- `NUM_SAMPLES` - Number of samples to process (default: 10)
- `MAX_TOKENS` - Maximum output tokens (default: 32)
- `CUDA_VISIBLE_DEVICES` - GPU selection (default: 0)

## Latest Results

**Performance Summary:**
- **Multi-GPU Efficiency:** 2.05x scaling with 2 GPUs
- **Combined Throughput:** 2.05 samples/sec
- **Token Generation:** 66.8 tokens/sec total
- **Average Latency:** 980ms
- **Infrastructure Health:** 72/100

For detailed analysis, see reports in the `reports/` directory.

## Kubernetes Deployment

```bash
# Deploy to Kubernetes
kubectl apply -f configs/kubernetes/

# Check status  
kubectl get pods -l app=mlperf-benchmark
```

## Support

- **Setup Issues:** See `docs/setup-guide.md`
- **Deployment Problems:** See `docs/deployment-guide.md`  
- **Common Errors:** See `docs/troubleshooting.md`

## Model Support

- **Primary:** meta-llama/Llama-3.1-8B-Instruct
- **Hardware:** NVIDIA GPUs with CUDA support
- **Memory:** Minimum 16GB GPU memory recommended

---

**Quick Commands Reference:**
```bash
# Single GPU test
python src/mlperf_benchmark.py

# Multi-GPU test with custom samples
python src/mlperf_benchmark.py --type coordinated --samples 50

# Check configuration options
python src/mlperf_benchmark.py --help

# List available configs
python src/mlperf_benchmark.py --list-configs
```