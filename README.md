# MLPerf Llama-3.1-8B Benchmark

A containerized MLPerf inference benchmark for Meta's Llama-3.1-8B-Instruct model, designed for Kubernetes deployment and reproducible performance evaluation.

## 🎯 Project Overview

This project provides a complete setup for benchmarking Llama-3.1-8B model performance using MLPerf standards. It includes containerization support for easy deployment across different environments and Kubernetes clusters.

## 📊 Benchmark Results

**Latest Results (NVIDIA A30):**
- **Throughput:** 1.02 samples/second
- **Token Generation:** 34.9 tokens/second  
- **Average Latency:** 984ms
- **GPU Memory Usage:** 14.99GB (62% efficiency)
- **Success Rate:** 100%

## 🚀 Quick Start

### Local Setup
```bash
# Clone repository
git clone <your-repo-url>
cd mlperf-llama-benchmark

# Follow setup guide
cat Complete_Setup_Guide.md
```

### Docker Container
```bash
# Build container
docker build -t mlperf-llama:latest .

# Run benchmark
docker run --gpus all -v ./results:/app/results mlperf-llama:latest
```

### Kubernetes Deployment
```bash
# Deploy to cluster
kubectl apply -f k8s/
```

## 📁 Project Structure

```
mlperf-llama-benchmark/
├── README.md                              # This file
├── Complete_Setup_Guide.md                # Step-by-step setup instructions
├── Simple_Benchmark_Results.md            # Latest benchmark results
├── MLPerf_Llama3.1-8B_Benchmark_Report.md # Detailed performance report
├── mlperf_llama7b_benchmark.md           # Complete documentation log
├── Dockerfile                            # Container definition
├── requirements.txt                      # Python dependencies
├── benchmark_scripts/                    # Benchmark code
│   ├── containerized_benchmark.py        # Main benchmark script
│   └── test_llama_mlperf.py             # Local test script
├── k8s/                                  # Kubernetes manifests
│   ├── benchmark-job.yaml               # Benchmark job
│   ├── configmap.yaml                   # Configuration
│   └── secret.yaml.example              # Secrets template
└── docs/                                 # Additional documentation
    └── troubleshooting.md               # Common issues and solutions
```

## 🔧 Requirements

### Hardware
- **GPU:** NVIDIA A30/A100/H100 or RTX 4090 (16GB+ VRAM)
- **RAM:** 32GB+ system memory
- **Storage:** 50GB+ free space
- **OS:** Ubuntu 22.04 (recommended)

### Software
- **Docker:** 20.10+ with GPU support
- **Kubernetes:** 1.25+ (for cluster deployment)
- **NVIDIA Drivers:** 535.247.01+
- **CUDA:** 12.1+

## 🏗️ Setup Options

### 1. Local Development
Follow the [Complete Setup Guide](Complete_Setup_Guide.md) for manual installation and testing.

### 2. Container Deployment
Use Docker for isolated, reproducible benchmarks:
```bash
docker build -t mlperf-llama:latest .
docker run --gpus all -e HF_TOKEN=your_token mlperf-llama:latest
```

### 3. Kubernetes Cluster
Deploy across multiple nodes for scale testing:
```bash
kubectl apply -f k8s/benchmark-job.yaml
kubectl logs -f job/mlperf-llama-benchmark
```

## 🔐 Authentication

The benchmark requires HuggingFace authentication for Llama model access:

1. **Get HF Token:** Visit https://huggingface.co/settings/tokens
2. **Request Access:** https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct  
3. **Set Token:** Export as `HF_TOKEN` environment variable

## 📊 Performance Metrics

The benchmark measures:
- **Throughput:** Samples processed per second
- **Latency:** Average response time per sample  
- **Token Generation Rate:** Tokens generated per second
- **Resource Utilization:** GPU memory and compute usage
- **Success Rate:** Percentage of successful inferences

## 🐳 Container Configuration

Environment variables for container deployment:
- `HF_TOKEN`: HuggingFace authentication token (required)
- `NUM_SAMPLES`: Number of test samples (default: 10)
- `MAX_TOKENS`: Maximum tokens per response (default: 64)
- `BATCH_SIZE`: Inference batch size (default: 1)

## ☸️ Kubernetes Features

- **GPU Scheduling:** Automatic GPU node selection
- **Resource Limits:** Memory and compute constraints
- **Result Persistence:** Output saved to persistent volumes
- **Multi-node Support:** Distributed benchmarking
- **Auto-scaling:** Based on workload demands

## 📈 Interpreting Results

**Good Performance Indicators:**
- Tokens/sec: 25-40+ (8B model on A30/A100)
- Latency: <1500ms for real-time use
- GPU Memory: <20GB (efficiency headroom)
- Success Rate: 100%

**Performance Comparison:**
| Hardware | Expected Tokens/sec | Memory Usage |
|----------|-------------------|--------------|
| RTX 4090 | 35-45 | ~16GB |
| A30 | 30-40 | ~15GB |
| A100 | 50-70 | ~15GB |
| H100 | 100-150 | ~15GB |

## 🔧 Troubleshooting

Common issues and solutions:

**GPU Memory Error:**
- Reduce batch size or use model quantization
- Check GPU memory with `nvidia-smi`

**Authentication Failed:**
- Verify HF token permissions
- Ensure Llama model access approval

**Container Issues:**
- Check NVIDIA container runtime
- Verify GPU device access

See [docs/troubleshooting.md](docs/troubleshooting.md) for detailed solutions.

## 📚 Documentation

- **[Complete Setup Guide](Complete_Setup_Guide.md)** - Step-by-step installation
- **[Benchmark Results](Simple_Benchmark_Results.md)** - Latest performance data  
- **[Detailed Report](MLPerf_Llama3.1-8B_Benchmark_Report.md)** - Comprehensive analysis
- **[Process Log](mlperf_llama7b_benchmark.md)** - Complete setup documentation

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/improvement`)
3. Commit changes (`git commit -am 'Add new feature'`)
4. Push to branch (`git push origin feature/improvement`)  
5. Create Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **MLCommons** for the MLPerf benchmark framework
- **Meta** for the Llama-3.1-8B model
- **HuggingFace** for model hosting and transformers library
- **NVIDIA** for GPU compute and container support

## 📞 Support

For questions and support:
- Create an issue in this repository
- Review the troubleshooting guide
- Check the complete setup documentation

---

**Note:** This benchmark is designed for research and evaluation purposes. Ensure compliance with model licenses and usage policies.