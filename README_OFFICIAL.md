# Official MLCommons MLPerf Benchmark for Llama-3.1-8B

This repository provides a **fully automated, Docker-containerized implementation** of the official MLCommons MLPerf inference benchmark for Llama-3.1-8B that produces **results comparable to official submissions**.

## 🎯 Key Features

- ✅ **Official MLCommons Implementation** - Uses the exact same codebase as official submissions
- ✅ **Automated Pipeline** - Complete benchmark execution with one command
- ✅ **Docker Distribution** - Easy deployment across different environments
- ✅ **Comprehensive Reporting** - Detailed performance and accuracy analysis
- ✅ **Submission-Comparable Results** - Results that match official MLPerf methodology

## 🚀 Quick Start

### Prerequisites
- Docker with GPU support (nvidia-container-toolkit)
- NVIDIA GPU with CUDA support
- HuggingFace account and token

### 1. Clone and Setup
```bash
git clone https://github.com/jshim0978/MLPerf_local_test.git
cd MLPerf_local_test
```

### 2. Configure Environment
```bash
# Copy and edit environment file
cp .env.example .env
# Edit .env and add your HuggingFace token
```

### 3. Run Official Benchmark
```bash
# Full benchmark (performance + accuracy)
docker compose -f docker-compose.official.yml up mlperf-official-benchmark

# Performance only
docker compose -f docker-compose.official.yml --profile performance up

# Accuracy only  
docker compose -f docker-compose.official.yml --profile accuracy up
```

## 📊 Benchmark Scenarios

### Offline Scenario
The primary scenario for throughput measurement:
```bash
python3 run_official_benchmark.py --samples 100
```

### Custom Sample Counts
```bash
# Quick test (10 samples)
python3 run_official_benchmark.py --samples 10

# Full dataset (13,368 samples) - matches official submissions
python3 run_official_benchmark.py --samples 13368
```

## 🏗️ Architecture

```
mlperf-official/
├── official_mlperf_benchmark/    # Official MLCommons code
│   ├── main.py                   # Official benchmark entry point
│   ├── SUT_VLLM.py              # System Under Test implementation
│   ├── evaluation.py            # Official accuracy evaluation
│   └── loadgen/                 # MLPerf LoadGen library
├── run_official_benchmark.py    # Automation pipeline
├── Dockerfile.official          # Container definition
└── docker-compose.official.yml  # Multi-scenario orchestration
```

## 📈 Results and Reports

### Automated Report Generation
The pipeline automatically generates:

1. **Performance Metrics**
   - Throughput (samples/second)
   - Latency percentiles
   - GPU utilization
   - LoadGen compliance logs

2. **Accuracy Evaluation**
   - ROUGE-1, ROUGE-2, ROUGE-L scores
   - Model-specific accuracy metrics
   - Official evaluation methodology

3. **System Information**
   - Hardware specifications
   - Software versions
   - Configuration parameters

### Output Structure
```
results/
├── official_offline_YYYYMMDD_HHMMSS/
│   ├── mlperf_log_summary.txt
│   ├── mlperf_log_detail.txt
│   └── mlperf_log_trace.json
└── official_accuracy_YYYYMMDD_HHMMSS/
    ├── mlperf_log_accuracy.json
    └── accuracy_results.json

reports/
└── official_mlperf_report_YYYYMMDD_HHMMSS.json
```

## 🔧 Configuration

### Environment Variables
```bash
HF_TOKEN=your_huggingface_token    # Required for model access
SAMPLES=100                        # Number of samples to benchmark
MODEL_NAME=meta-llama/Llama-3.1-8B-Instruct
CUDA_VISIBLE_DEVICES=0            # GPU selection
```

### Hardware Requirements
- **GPU**: NVIDIA GPU with 24GB+ memory (A30, V100, A100)
- **CPU**: Multi-core processor for data loading
- **Memory**: 32GB+ system RAM recommended
- **Storage**: 50GB+ for model and dataset

## 🐳 Docker Usage

### Build Official Container
```bash
docker build -f Dockerfile.official -t mlperf-official:latest .
```

### Run with Custom Parameters
```bash
docker run --gpus all -it \
  -v $(pwd)/results:/app/results \
  -v $(pwd)/reports:/app/reports \
  -e HF_TOKEN=your_token \
  mlperf-official:latest \
  python3 run_official_benchmark.py --samples 100
```

## 📋 Official MLPerf Compliance

This implementation follows the official MLPerf inference rules:

### ✅ Compliance Features
- Uses official MLCommons reference implementation
- Implements proper LoadGen integration
- Follows accuracy evaluation methodology
- Generates standard MLPerf log formats
- Supports required scenarios (Offline)

### 📊 Submission Equivalence
Results from this benchmark are:
- Generated using the same code as official submissions
- Compliant with MLPerf inference rules v5.0
- Comparable to results in official MLPerf database
- Suitable for understanding system performance

## 🚨 Important Notes

### Reference Implementation Limitations
As stated in the [official documentation](https://docs.mlcommons.org/inference/benchmarks/language/llama3_1-8b/):

> "MLCommons reference implementations are only meant to provide a rules compliant reference implementation and are not best performing."

This means:
- Results are **compliant** but not **optimized**
- For peak performance, use vendor-specific implementations
- This implementation is ideal for **baseline measurements** and **compliance testing**

### Use Cases
Perfect for:
- Understanding MLPerf methodology
- Establishing performance baselines
- Academic research and education
- Hardware capability assessment
- Pre-submission validation

## 🛠️ Development

### Local Development Setup
```bash
# Install loadgen
cd official_mlperf_benchmark/loadgen
python3 setup.py install --user

# Install benchmark requirements
cd ../
pip3 install -r requirements.txt

# Run benchmark
cd ../../
python3 run_official_benchmark.py
```

### Adding Custom Evaluations
The pipeline supports custom evaluation scripts by extending the `evaluate_accuracy()` method in `run_official_benchmark.py`.

## 📚 References

- [MLCommons Inference Benchmark](https://github.com/mlcommons/inference)
- [Llama-3.1-8B Official Documentation](https://docs.mlcommons.org/inference/benchmarks/language/llama3_1-8b/)
- [MLPerf Inference Rules](https://github.com/mlcommons/inference_policies)

## 🤝 Contributing

This project provides an automated wrapper around the official MLCommons benchmark. For benchmark-specific issues, please refer to the [official MLCommons repository](https://github.com/mlcommons/inference).

---

**🤖 Generated with [Claude Code](https://claude.ai/code)**