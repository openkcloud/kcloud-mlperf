# Expected Benchmark Outputs

This document shows exactly what outputs you can expect when running the MLPerf framework.

## 🎯 Quick Overview

When you run `python3 bin/run_benchmark.py --samples 10`, you'll get:

1. **Real-time progress** in the console
2. **MLPerf results** in `results/` directory  
3. **Analysis reports** in `reports/` directory
4. **Visualizations** (when using visualization tools)

## 📁 Output Structure

```
your-benchmark-run/
├── results/
│   └── local_benchmark_YYYYMMDD_HHMMSS/
│       ├── mlperf_log_summary.txt      # Key metrics (0.34 samples/sec)
│       ├── mlperf_log_detail.txt       # Complete MLPerf log
│       ├── mlperf_log_accuracy.json    # Token outputs (accuracy runs)
│       └── mlperf_log_trace.json       # Execution trace
└── reports/
    ├── local_benchmark_YYYYMMDD_HHMMSS.md    # Human-readable report
    ├── local_benchmark_YYYYMMDD_HHMMSS.json  # Machine-readable data
    └── benchmark_results_visualization.png   # Charts (if generated)
```

## 📊 Sample Performance Results

Based on **NVIDIA A30 + Llama-3.1-8B-Instruct**:

### Console Output
```
🔧 MLPerf Universal Benchmark Runner
=== MLPerf Configuration ===
Username: your_username
Model: meta-llama/Llama-3.1-8B-Instruct
Local Run: True

Environment Status:
  ✅ cuda_available: True
  ✅ gpu_available: True
  ✅ mlperf_installed: True
  ✅ dataset_available: True
  ✅ model_cached: True

🚀 Running local benchmark...
Configuration:
  Samples: 10
  Accuracy: False
  Output: results/local_benchmark_20250728_093243

✅ Benchmark completed in 163.2s
📑 Report generated: reports/local_benchmark_20250728_093809.md
🏆 Benchmark completed successfully!
```

### MLPerf Summary (mlperf_log_summary.txt)
```
================================================
MLPerf Results Summary
================================================
SUT name : PySUT
Scenario : Server
Mode     : PerformanceOnly
Completed samples per second    : 0.34
Completed tokens per second: 44.52
Result is : INVALID
  Performance constraints satisfied : NO
  Min duration satisfied : Yes
  Min queries satisfied : Yes
  Early stopping satisfied: NO

================================================
Additional Stats
================================================
Min latency (ns)                : 2838342370
Max latency (ns)                : 100776895345
Mean latency (ns)               : 53175389991
50.00 percentile latency (ns)   : 58540142913
90.00 percentile latency (ns)   : 85899538971
99.00 percentile latency (ns)   : 100776895345

Completed tokens per second     : 44.52
Mean First Token latency (ns)   : 50385872554
Mean Time to Output Token (ns)  : 21964703
```

### Analysis Report (local_benchmark_*.md)
```markdown
# MLPerf Benchmark Report - LOCAL

**Generated**: 2025-07-28 09:38:09

## Configuration
- **Node**: local
- **Samples**: 20
- **Accuracy**: Disabled
- **Duration**: 326.0 seconds
- **Model**: meta-llama/Llama-3.1-8B-Instruct

## Generated Files
- `mlperf_log_accuracy.json` (4 bytes)
- `mlperf_log_detail.txt` (38,094 bytes)
- `mlperf_log_summary.txt` (3,354 bytes)
- `mlperf_log_trace.json` (0 bytes)
```

## 🚀 Performance Expectations

### Typical Performance (NVIDIA A30)
- **Throughput**: 0.34 samples/second
- **Token Generation**: 44.52 tokens/second
- **Mean Latency**: ~53 seconds per request
- **First Token**: ~50 seconds
- **Per Token**: ~22 milliseconds

### Scaling Estimates
- **10 samples**: ~30 seconds
- **100 samples**: ~5 minutes  
- **1,000 samples**: ~50 minutes
- **Full dataset (13,368)**: ~11 hours

## 📈 Visualization Outputs

When running `python3 benchmark_results_report.py`:

### 4-Panel Chart
1. **Throughput Performance**: Samples/sec and Tokens/sec bars
2. **Latency Breakdown**: First token, per token, and total latency
3. **Test Comparison**: Sample counts vs duration
4. **Key Metrics Summary**: Configuration and performance text

### File Outputs
- `reports/benchmark_results_visualization.png` (442KB)
- `reports/MLPerf_Benchmark_Complete_Report.md` (3KB)

## 🔍 What "INVALID" Results Mean

- **Normal for development**: MLPerf has strict latency requirements for official submissions
- **Still useful**: All performance metrics are accurate and meaningful
- **Focus on throughput**: Samples/sec and tokens/sec are the key metrics
- **Latency targets**: Can be adjusted in `user.conf` if needed

## 💡 Interpreting Your Results

### Good Performance Indicators
- ✅ No errors in logs
- ✅ Consistent token generation rate
- ✅ GPU utilization >90%
- ✅ Reasonable latency for your use case

### Optimization Opportunities
- 🔧 **Batch size**: Increase for higher throughput
- 🔧 **Model length**: Reduce `max_model_len` if memory limited
- 🔧 **GPU memory**: Adjust `gpu_memory_utilization`
- 🔧 **Multiple GPUs**: Use `tensor_parallel_size > 1`

## 📝 Example Files

See the `reports/examples/` and `results/examples/` directories for complete sample outputs from actual benchmark runs.

---

**Ready to run your first benchmark?**
```bash
python3 bin/run_benchmark.py --samples 5
```