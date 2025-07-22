# MLPerf Llama-3.1-8B Benchmark

A streamlined, reproducible MLPerf inference benchmark for Meta's Llama-3.1-8B-Instruct model, designed for multi-GPU evaluation and team deployment.

## 🎯 Quick Start

### 1. Setup Environment
```bash
# Clone repository
git clone https://github.com/jshim0978/MLPerf_local_test.git
cd MLPerf_local_test

# Configure environment
cp .env.example .env
# Edit .env with your HuggingFace token and node IPs

# Automated setup
./setup_environment.sh
```

### 2. Run Benchmark
```bash
# Set HuggingFace token
export HF_TOKEN=your_token_here

# Single node datacenter benchmark
python3 mlperf_datacenter_benchmark.py

# Multi-GPU coordinated benchmark (from controller node)
python3 run_datacenter_benchmark.py
```

### 3. View Results
```bash
# Generate comprehensive reports
python3 report_generator.py

# View latest results
cat reports/latest_summary.md
cat FINAL_BENCHMARK_SUMMARY.md
```

## 📊 Latest Performance Results

**Infrastructure:** 2× NVIDIA A30 GPUs (jw2 + jw3)  
**Model:** Llama-3.1-8B-Instruct  
**Samples:** 20 server + 30 offline per GPU

| GPU | Server QPS | Offline QPS | Throughput | Accuracy | MLPerf Valid |
|-----|------------|-------------|------------|----------|--------------|
| **jw2** | 0.495 | 0.546 | 32.2 tok/sec | 100% | ✅ Server |
| **jw3** | 0.536 | 0.563 | 34.8 tok/sec | 100% | ✅ Server |
| **Total** | **1.031** | **1.109** | **67.0 tok/sec** | **100%** | **✅ Both** |

## 🏗️ Repository Structure

```
MLPerf_local_test/
├── config.py                           # Environment-agnostic configuration
├── mlperf_datacenter_benchmark.py      # Main benchmark (single GPU)
├── run_datacenter_benchmark.py         # Multi-GPU coordinator
├── report_generator.py                 # Automated report generation
├── setup_environment.sh                # Environment setup
├── requirements.txt                    # Python dependencies
├── .env.example                        # Configuration template
├── README.md                           # This file
├── FINAL_BENCHMARK_SUMMARY.md          # Executive summary
├── Dockerfile                          # Container support
└── LICENSE                             # MIT License
```

## ⚙️ Configuration

### Environment Variables (.env)
```bash
HF_TOKEN=your_huggingface_token
MLPERF_USERNAME=your_username
JW2_IP=node2_ip_address
JW3_IP=node3_ip_address
MAX_TOKENS=64
SERVER_TARGET_QPS=1.0
```

### Hardware Requirements
- **GPUs:** NVIDIA A30/A100/H100 with 16GB+ VRAM
- **Memory:** 32GB+ system RAM
- **Storage:** 50GB+ free space
- **Network:** SSH access between nodes

## 🌐 Reproducibility Features

- **No hardcoded paths** - works on any infrastructure
- **Centralized configuration** - easy teammate deployment
- **Automated setup** - one script installation
- **Self-contained reports** - all outputs within project
- **Environment agnostic** - supports various node configurations

## 📈 MLPerf Compliance

- ✅ **MLPerf v5.0 Inference Datacenter** specifications
- ✅ **Server scenario validation** on both GPUs
- ✅ **99%+ accuracy requirement** (achieved 100%)
- ✅ **Latency constraints** met for server scenarios
- ✅ **Extended sample testing** (20-30 samples per scenario)

## 🚀 Team Deployment

Your teammates can deploy this anywhere by:

1. **Clone repository** to their infrastructure
2. **Copy .env.example to .env** and configure IPs/tokens
3. **Run ./setup_environment.sh** for automated setup
4. **Execute benchmarks** with single command
5. **Generate reports** with consistent formatting

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **MLCommons** for MLPerf benchmark framework
- **Meta** for Llama-3.1-8B model
- **HuggingFace** for model hosting and transformers
- **NVIDIA** for GPU compute infrastructure