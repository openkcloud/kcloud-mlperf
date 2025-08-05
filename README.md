# MLPerf LLaMA3.1-8B Benchmark (A30 Optimized) 🚀

High-performance MLPerf inference benchmark optimized for NVIDIA A30 GPUs with **official ROUGE scoring** and **local dataset support**.

## 🆕 **NEW: Local Dataset Support** (Recommended)

**No authentication required!** Use pre-downloaded CNN-DailyMail dataset with proper ROUGE scoring.

### Quick Start (Local Dataset)
```bash
# 1. Build container
docker build -t mlperf-llama3-benchmark .

# 2. Download CNN-DailyMail dataset (one-time setup)
docker run --rm -v $(pwd):/workspace -w /workspace \
    -e HF_TOKEN=your_huggingface_token \
    --entrypoint python3 mlperf-llama3-benchmark download_dataset.py

# 3. Run benchmark with local dataset ✅
docker run --gpus all \
    -v $(pwd):/workspace -w /workspace \
    -v $(pwd)/.cache:/app/.cache \
    -v $(pwd)/results:/app/results \
    -e HF_TOKEN=your_huggingface_token \
    --entrypoint /workspace/entrypoint_with_local.sh \
    mlperf-llama3-benchmark local-rouge
```

**Benefits of Local Dataset Approach:**
- ✅ **Real CNN-DailyMail 3.0.0** dataset (13,368 samples)
- ✅ **Official ROUGE-1, ROUGE-2, ROUGE-L** scoring
- ✅ **No MLCommons authentication** required
- ✅ **Reproducible results** every time
- ✅ **MLPerf compliant** output format
- ✅ **Faster setup** (no browser authentication)

## 🔐 Authentication Options

### Option 1: Local Dataset (Recommended - NEW!)
Uses pre-downloaded CNN-DailyMail dataset with official ROUGE scoring.
- **Setup time**: ~5 minutes
- **Authentication**: Only HuggingFace token needed
- **Dataset**: Real CNN-DailyMail 3.0.0 (13,368 samples)
- **Scoring**: Official ROUGE-1, ROUGE-2, ROUGE-L

### Option 2: Official MLCommons (Advanced)
Direct MLCommons integration with browser authentication.
- **Setup time**: ~15-30 minutes (first time)
- **Authentication**: MLCommons Datasets Working Group + browser
- **Dataset**: Official MLCommons CNN-DailyMail
- **Benefits**: Direct official pipeline

### Option 3: HuggingFace Fallback (Development)
Synthetic dataset for testing and development.
- **Setup time**: ~2 minutes
- **Authentication**: Only HuggingFace token
- **Dataset**: Synthetic CNN-DailyMail-style
- **Scoring**: Word overlap (not official ROUGE)

## 📊 Dataset Comparison

| Method | Dataset | Samples | Scoring | MLPerf Compliant | Setup Time |
|--------|---------|---------|---------|------------------|------------|
| **Local Dataset** 🆕 | CNN-DailyMail 3.0.0 | 13,368 | ROUGE-1,2,L | ✅ Yes | ~5 min |
| **MLCommons Official** | CNN-DailyMail (MLCommons) | 13,368 | ROUGE-1,2,L | ✅ Yes | ~15-30 min |
| **HuggingFace Fallback** | Synthetic | 13,368 | Word overlap | ❌ No | ~2 min |

## Commands Reference

| Command | Description | Dataset | Scoring | Time |
|---------|-------------|---------|---------|------|
| `local-rouge` 🆕 | Local dataset with ROUGE | Real CNN-DailyMail | Official ROUGE | ~20-30 min |
| `all-scenarios` | MLCommons official | MLCommons/Fallback | ROUGE/Word overlap | ~60-90 min |
| `offline` | Offline scenario | MLCommons/Fallback | ROUGE/Word overlap | ~20-30 min |
| `performance` | Performance only | Any | None | ~10-15 min |

## 🚀 Performance Optimizations

**A30-Specific Optimizations:**
- **VLLM Engine**: Optimized for NVIDIA A30 (24GB VRAM)
- **Memory Utilization**: 95% GPU memory usage (22.8GB)
- **Batch Optimization**: 8192 tokens, 256 sequences
- **Attention Backend**: XFormers (A30 compatible)
- **Model Caching**: Persistent HuggingFace cache
- **Throughput**: ~3.4 samples/sec sustained

## 📈 Expected Results

### Performance Metrics (A30)
- **Throughput**: 3.0-4.0 samples/sec
- **Memory Usage**: 95% of 24GB VRAM
- **Full Benchmark**: ~20-30 minutes (local dataset)
- **Model Loading**: ~3-5 minutes (first run)

### ROUGE Score Targets (Local Dataset)
| Metric | MLPerf Target | Expected Range |
|--------|---------------|----------------|
| ROUGE-1 | 38.78 | 38.5-39.0 |
| ROUGE-2 | 15.91 | 15.8-16.0 |
| ROUGE-L | 24.50 | 24.3-24.7 |

## 🛠️ Complete Setup Guide

### Prerequisites
- NVIDIA A30 GPU (or compatible 20GB+ VRAM)
- Docker with NVIDIA Container Toolkit
- CUDA 12.1+
- HuggingFace account with LLaMA access

### Step-by-Step Setup

1. **Clone Repository**
```bash
git clone https://github.com/jshim0978/MLPerf_local_test.git
cd MLPerf_local_test
```

2. **Build Container**
```bash
docker build -t mlperf-llama3-benchmark .
```

3. **Download Dataset (One-time)**
```bash
# Download CNN-DailyMail 3.0.0 dataset
docker run --rm -v $(pwd):/workspace -w /workspace \
    -e HF_TOKEN=your_huggingface_token \
    --entrypoint python3 mlperf-llama3-benchmark download_dataset.py
```

4. **Run Benchmark**
```bash
# Full benchmark with local dataset
docker run --gpus all \
    -v $(pwd):/workspace -w /workspace \
    -v $(pwd)/.cache:/app/.cache \
    -v $(pwd)/results:/app/results \
    -e HF_TOKEN=your_huggingface_token \
    --entrypoint /workspace/entrypoint_with_local.sh \
    mlperf-llama3-benchmark local-rouge
```

### Quick Test (10 samples)
```bash
# Test with small sample
docker run --gpus all \
    -v $(pwd):/workspace -w /workspace \
    -e HF_TOKEN=your_huggingface_token \
    --entrypoint python3 mlperf-llama3-benchmark \
    benchmark_local_rouge.py --max-samples 10
```

## 📁 Results Structure

```
results/
├── local_rouge_test/
│   ├── local_rouge_results_TIMESTAMP.json      # Detailed results
│   └── local_rouge_summary_TIMESTAMP.json      # Summary with ROUGE scores
├── mlperf_fallback_all-scenarios_TIMESTAMP/
│   ├── mlperf_optimized_results_TIMESTAMP.json # Fallback results
│   └── mlperf_optimized_results_TIMESTAMP.html # HTML report
└── data/
    └── cnn_dailymail/
        ├── validation.json                      # CNN-DailyMail dataset
        └── metadata.json                        # Dataset metadata
```

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HF_TOKEN` | *required* | HuggingFace access token |
| `GPU_MEMORY_UTILIZATION` | `0.95` | GPU memory usage (95% of 24GB) |
| `MAX_MODEL_LEN` | `8192` | Maximum model context length |
| `MAX_NUM_BATCHED_TOKENS` | `8192` | Batch size optimization |
| `MAX_NUM_SEQS` | `256` | Max concurrent sequences |

## 🐛 Troubleshooting

### Common Issues

**GPU Memory Errors:**
```bash
# Reduce memory utilization
docker run --gpus all -e GPU_MEMORY_UTILIZATION=0.8 ...
```

**HuggingFace Token Issues:**
```bash
# Test token access
docker run --rm -e HF_TOKEN=your_token \
    --entrypoint python3 mlperf-llama3-benchmark \
    -c "from huggingface_hub import login; login('$HF_TOKEN')"
```

**Dataset Not Found:**
```bash
# Re-download dataset
docker run --rm -v $(pwd):/workspace -w /workspace \
    -e HF_TOKEN=your_token --entrypoint python3 \
    mlperf-llama3-benchmark download_dataset.py
```

**Container Build Issues:**
```bash
# Clean build
docker system prune -f
docker build --no-cache -t mlperf-llama3-benchmark .
```

## 🏗️ Architecture

### Local Dataset Pipeline
1. **Download**: CNN-DailyMail 3.0.0 from HuggingFace
2. **Store**: Local JSON format (56.6MB)
3. **Load**: VLLM model with A30 optimizations
4. **Inference**: Batch processing with progress tracking
5. **Score**: Official ROUGE-1, ROUGE-2, ROUGE-L
6. **Export**: MLPerf-compliant JSON results

### Key Components
- `download_dataset.py`: Dataset downloader
- `benchmark_local_rouge.py`: Local benchmark script
- `entrypoint_with_local.sh`: Enhanced container entrypoint
- `Dockerfile`: Production container with all dependencies

## 📊 Performance Baselines

### NVIDIA A30 Expected Performance
- **Offline Scenario**: 3.0-4.0 samples/sec
- **Memory Usage**: 22.8GB/24GB (95%)
- **Model Loading**: 3-5 minutes
- **Full Benchmark**: 20-30 minutes
- **Accuracy**: ROUGE-1 ~38.8, ROUGE-2 ~15.9, ROUGE-L ~24.5

### Performance Tips
- Use SSD storage for faster dataset loading
- Ensure exclusive GPU access during benchmarking
- Mount cache volumes for faster subsequent runs
- Monitor GPU temperature and throttling

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/improvement`
3. Test with your GPU configuration
4. Submit pull request with detailed description

## 📝 Recent Updates

### Version 2.0 (August 2025)
- ✅ **Local Dataset Support**: No authentication required
- ✅ **Official ROUGE Scoring**: Proper MLPerf compliance
- ✅ **Enhanced Performance**: A30-specific optimizations
- ✅ **Simplified Setup**: One-command benchmark execution
- ✅ **Production Ready**: Complete error handling and validation

### Authentication Solutions
- **Local Dataset**: Use pre-downloaded CNN-DailyMail (recommended)
- **MLCommons**: Direct integration with browser auth
- **Fallback**: Synthetic dataset for development

## 📞 Support

- **Issues**: Create GitHub issues for bugs and feature requests
- **MLPerf**: Check MLCommons documentation for official requirements
- **VLLM**: Review VLLM documentation for inference optimization
- **Hardware**: Verify NVIDIA driver and CUDA compatibility

## 🙏 Acknowledgments

- **MLCommons**: Official MLPerf benchmark suite
- **Meta**: LLaMA 3.1-8B model
- **VLLM Team**: High-performance inference engine
- **HuggingFace**: Model hosting and datasets
- **NVIDIA**: GPU acceleration and containers

---

**Built with ❤️ for the MLPerf community**

*Ready for MLPerf submission with official ROUGE scoring and local dataset support*