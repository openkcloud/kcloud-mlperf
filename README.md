# 🚀 MLPerf LLaMA3.1-8B Automated Benchmark Suite

A fully automated, Docker-containerized MLPerf inference benchmark for LLaMA3.1-8B with comprehensive accuracy evaluation and reporting.

## 🎯 Features

- **🏆 Official MLCommons Integration**: Uses `mlcr` (MLCommons CLI) for official benchmark execution
- **📊 All Scenarios Support**: Offline, Server, and SingleStream scenarios
- **🎯 Full Accuracy Evaluation**: Complete ROUGE score calculation on 13,368 CNN-DailyMail samples
- **🔄 Automated Pipeline**: Single-command execution with comprehensive error handling
- **📋 Rich Reporting**: HTML and JSON reports with detailed metrics and visualizations
- **🐳 Docker Containerized**: Self-contained execution environment with GPU support
- **⚡ Performance Optimized**: Configured for datacenter/server workloads on A30 GPU

## 🏗️ Architecture

```
MLPerf Benchmark Suite
├── 🐳 Docker Container (NVIDIA PyTorch 24.07)
│   ├── 🛠️ MLCommons CLI (mlcr)
│   ├── 🤖 VLLM Inference Engine
│   ├── 📊 Dataset Processing (CNN-DailyMail)
│   └── 📋 Report Generation
├── 🎯 Dual Execution Strategy
│   ├── Primary: mlcr official benchmarks
│   └── Fallback: Python VLLM implementation
└── 📊 Comprehensive Results
    ├── Performance metrics (throughput, latency)
    ├── Accuracy scores (ROUGE-1, ROUGE-2, ROUGE-L)
    └── Detailed HTML/JSON reports
```

## 🚀 Quick Start

### Prerequisites

- Docker with NVIDIA GPU support
- NVIDIA A30 GPU (24GB+ memory)
- HuggingFace account with Llama access
- 50GB+ disk space

### 1. Setup Environment

```bash
# Clone repository
git clone https://github.com/jshim0978/MLPerf_local_test.git
cd MLPerf_local_test

# Set HuggingFace token
export HF_TOKEN="your_huggingface_token_here"
```

### 2. Run All Scenarios Benchmark

```bash
# Run complete benchmark suite (all scenarios)
./run_all_scenarios.sh
```

### 3. Run Specific Scenarios

```bash
# Build Docker image
docker build -t llama3-benchmark:latest .

# Run specific scenarios
docker run --gpus all -v $(pwd)/results:/app/results \
  -e HF_TOKEN=$HF_TOKEN llama3-benchmark:latest offline

docker run --gpus all -v $(pwd)/results:/app/results \
  -e HF_TOKEN=$HF_TOKEN llama3-benchmark:latest server

docker run --gpus all -v $(pwd)/results:/app/results \
  -e HF_TOKEN=$HF_TOKEN llama3-benchmark:latest singlestream
```

## 📊 Benchmark Configurations

### Default Configuration
- **Model**: meta-llama/Llama-3.1-8B-Instruct
- **Dataset**: CNN-DailyMail (13,368 validation samples)
- **Framework**: VLLM
- **Category**: Datacenter
- **Device**: CUDA (A30 GPU)
- **Precision**: Float16
- **Max Sequence Length**: 8192 tokens

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HF_TOKEN` | *required* | HuggingFace token for model access |
| `MODEL_NAME` | `llama3_1-8b` | Model identifier |
| `SCENARIO` | `_all-scenarios` | Benchmark scenario |
| `CATEGORY` | `datacenter` | MLPerf category |
| `FRAMEWORK` | `vllm` | Inference framework |
| `DEVICE` | `cuda` | Target device |
| `GPU_NAME` | `A30` | GPU model for optimization |

## 📋 Available Commands

### Docker Container Commands

```bash
# Show help
docker run llama3-benchmark:latest help

# Run all scenarios (default)
docker run --gpus all -v $(pwd)/results:/app/results \
  -e HF_TOKEN=$HF_TOKEN llama3-benchmark:latest

# Run specific scenario
docker run --gpus all -v $(pwd)/results:/app/results \
  -e HF_TOKEN=$HF_TOKEN llama3-benchmark:latest offline

# Performance-only benchmark
docker run --gpus all -v $(pwd)/results:/app/results \
  -e HF_TOKEN=$HF_TOKEN llama3-benchmark:latest performance

# Accuracy-only benchmark  
docker run --gpus all -v $(pwd)/results:/app/results \
  -e HF_TOKEN=$HF_TOKEN llama3-benchmark:latest accuracy
```

### Direct Python Execution

```bash
# Test with small sample (5 samples)
export HF_TOKEN="your_token"
python3 test_benchmark.py

# Full benchmark with Python fallback
python3 benchmark_runner.py --hf-token $HF_TOKEN --samples 13368

# Generate reports from existing results
python3 report_generator.py --input-dir ./results --output-dir ./reports
```

## 📊 Results and Reports

### Output Structure
```
results/
├── mlperf_all-scenarios_TIMESTAMP/
│   ├── mlperf_log_summary.txt      # Performance metrics
│   ├── mlperf_log_accuracy.json    # Raw accuracy data
│   ├── mlperf_log_detail.txt       # Detailed execution log
│   ├── mlperf_report_TIMESTAMP.html # Interactive HTML report
│   └── mlperf_report_TIMESTAMP.json # Structured JSON report
└── benchmark_results_TIMESTAMP.json   # Python fallback results
```

### Performance Metrics
- **Throughput**: Samples per second
- **Latency**: P50, P90, P99 percentiles
- **GPU Utilization**: Memory and compute usage
- **Total Execution Time**: End-to-end benchmark duration

### Accuracy Metrics
- **ROUGE-1**: Unigram overlap F1-score
- **ROUGE-2**: Bigram overlap F1-score  
- **ROUGE-L**: Longest common subsequence F1-score
- **Sample Coverage**: Number of samples evaluated

## 🔧 Advanced Configuration

### Custom Docker Build

```bash
# Build with specific base image
docker build --build-arg BASE_IMAGE=nvcr.io/nvidia/pytorch:24.07-py3 \
  -t llama3-benchmark:custom .

# Build for different GPU
docker build --build-arg GPU_ARCH=sm_86 \
  -t llama3-benchmark:rtx4090 .
```

### MLCommons CLI Configuration

The benchmark uses the official MLCommons CLI with the following command structure:

```bash
mlcr run-mlperf,inference,_full,_r5.1-dev,_all-scenarios \
  --model=llama3_1-8b \
  --implementation=reference \
  --framework=vllm \
  --category=datacenter \
  --execution_mode=valid \
  --device=cuda \
  --quiet
```

### VLLM Configuration (Fallback)

```python
LLM(
    model="meta-llama/Llama-3.1-8B-Instruct",
    dtype="float16",
    tensor_parallel_size=1,
    gpu_memory_utilization=0.9,
    max_model_len=8192
)
```

## 🐛 Troubleshooting

### Common Issues

#### GPU Memory Errors
```bash
# Reduce GPU memory utilization
export GPU_MEMORY_UTILIZATION=0.8
docker run --gpus all -e GPU_MEMORY_UTILIZATION=0.8 ...
```

#### HuggingFace Authentication
```bash
# Verify token access
python3 -c "from huggingface_hub import login; login('$HF_TOKEN')"
```

#### Docker GPU Support
```bash
# Test NVIDIA Docker
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
```

#### Build Timeouts
```bash
# Build with extended timeout
docker build --timeout=3600 -t llama3-benchmark:latest .
```

### Debug Mode

```bash
# Run with debug output
docker run --gpus all -v $(pwd)/results:/app/results \
  -e HF_TOKEN=$HF_TOKEN -e DEBUG=1 \
  llama3-benchmark:latest benchmark
```

## 📈 Performance Baselines

### A30 GPU Expected Performance
- **Offline Scenario**: ~2-4 samples/sec
- **Server Scenario**: ~1-2 samples/sec  
- **SingleStream Scenario**: ~0.5-1 samples/sec
- **Accuracy Targets**: ROUGE-1 > 0.44, ROUGE-2 > 0.21, ROUGE-L > 0.28

### Optimization Tips
- Ensure exclusive GPU access during benchmarking
- Use fast NVMe storage for dataset caching
- Set CPU governor to performance mode
- Disable unnecessary system services

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Test thoroughly with your hardware configuration  
4. Submit a pull request with detailed description

## 📝 License

This project is licensed under the terms specified in the LICENSE file.

## 🙏 Acknowledgments

- **MLCommons**: Official MLPerf benchmark suite
- **VLLM Team**: High-performance LLM inference engine
- **HuggingFace**: Model hosting and tokenization libraries
- **NVIDIA**: GPU acceleration and PyTorch containers

## 📞 Support

For issues and questions:
- Create GitHub issues for bugs and feature requests
- Check MLCommons documentation for official benchmark details
- Review VLLM documentation for inference optimization

---

*Built with ❤️ for the MLPerf community*