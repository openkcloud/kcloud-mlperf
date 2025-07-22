# MLPerf Inference Benchmark Suite

**Official MLCommons Llama-3.1-8B inference benchmarking with automatic visual reporting**

## Overview

This repository contains the **official MLCommons MLPerf inference implementation** for Llama-3.1-8B benchmarking with enhanced visual reporting capabilities. All benchmarks use the genuine MLPerf loadgen with the complete CNN DailyMail dataset (13,368 samples).

## Key Features

- ✅ **Official Implementation**: Uses genuine MLCommons reference code
- ✅ **Complete Dataset**: Full CNN DailyMail dataset (13,368 samples, not synthetic)
- ✅ **Auto Visual Reports**: Comprehensive charts generated automatically when benchmarks complete
- ✅ **Multi-GPU Support**: Distributed benchmarking across NVIDIA A30 GPUs
- ✅ **Production Ready**: VLLM optimization with proper MLPerf compliance

## Quick Start

### 1. Run Benchmarks
```bash
# Start benchmarks on distributed GPUs
cd official_mlperf
./run_official_benchmarks.sh

# Monitor progress with auto-reporting
cd ..
./monitor_official_benchmarks.sh watch
```

### 2. Generate Visual Reports
```bash
# Generate reports for existing results
python3 generate_visual_reports.py results

# View results
open sample_visual_reports/mlperf_interactive_dashboard.html
```

## Repository Structure

```
├── official_mlperf/              # Official MLCommons implementation
│   ├── main.py                   # MLPerf benchmark entry point
│   ├── SUT_VLLM.py              # VLLM System Under Test
│   ├── dataset.py               # CNN DailyMail data loader
│   ├── loadgen/                 # Official MLPerf loadgen
│   └── run_official_benchmarks.sh
├── generate_visual_reports.py   # Visual report generator
├── monitor_official_benchmarks.sh # Benchmark monitoring with auto-reports
├── sample_visual_reports/        # Example visual reports
└── results/                     # Benchmark outputs (auto-generated)
```

## Benchmark Results

### Current Status
- **Implementation**: Official MLCommons reference
- **Model**: meta-llama/Llama-3.1-8B-Instruct  
- **Dataset**: CNN DailyMail (13,368 samples)
- **Scenario**: Server
- **Hardware**: 2x NVIDIA A30 24GB GPUs

### Visual Reports Generated
1. **Static Charts** (`mlperf_static_report.png`)
   - Performance comparison across runs
   - Latency distribution histograms
   - Throughput timeline analysis
   - ROUGE accuracy comparisons

2. **Interactive Dashboard** (`mlperf_interactive_dashboard.html`)
   - Web-based charts with hover details
   - Zoom, pan, and filter capabilities
   - Real-time data exploration

3. **Summary Report** (`README.md`)
   - Comprehensive analysis overview
   - Data source breakdown
   - Technical implementation details

## Automatic Report Generation

Visual reports are **automatically generated** when benchmarks complete:

```bash
# Enhanced monitoring with auto-reporting
./monitor_official_benchmarks.sh results

# Manual generation anytime
python3 generate_visual_reports.py results
```

Reports are saved to timestamped directories: `results/visual_reports_TIMESTAMP/`

## Technical Details

### MLPerf Compliance
- **Official loadgen**: `mlperf_loadgen.cpython-310-x86_64-linux-gnu.so`
- **Server scenario**: FirstTokenComplete callbacks with proper token reporting
- **Accuracy validation**: ROUGE scoring with 99% targets
- **Performance constraints**: Official MLPerf requirements

### Visualization Stack
- **Base Framework**: Official MLCommons trace analysis tools
- **Static Charts**: Matplotlib + Seaborn (publication quality)
- **Interactive Charts**: Plotly (web-based, interactive)
- **Data Processing**: Pandas + NumPy

### Hardware Configuration
- **GPUs**: 2x NVIDIA A30 24GB
- **Memory Optimization**: `gpu_memory_utilization=0.8, max_model_len=4096`
- **Distributed**: Kubernetes cluster (jw1 control, jw2/jw3 workers)

## Installation

```bash
# Clone repository
git clone https://github.com/jshim0978/MLPerf_local_test.git
cd MLPerf_local_test

# Setup environment
./setup_environment.sh

# Install visualization dependencies
pip install matplotlib seaborn plotly pandas numpy

# Download dataset (if needed)
cd official_mlperf
python3 download_cnndm.py
```

## Usage Examples

### Example 1: Single GPU Benchmark
```bash
cd official_mlperf
python3 main.py --scenario Server --model-path meta-llama/Llama-3.1-8B-Instruct
```

### Example 2: Multi-GPU Distributed
```bash
cd official_mlperf
./run_official_benchmarks.sh  # Runs on both jw2 and jw3
```

### Example 3: Live Monitoring with Auto-Reports
```bash
./monitor_official_benchmarks.sh watch
# Visual reports auto-generated when benchmarks complete
```

## Results Format

### Performance Results (`mlperf_log_summary.txt`)
```
Completed samples per second: 0.41
Completed tokens per second: 41.23
50.00 percentile latency (ns): 42000000000
99.00 percentile latency (ns): 96000000000
```

### Accuracy Results (`mlperf_log_accuracy.json`)
```json
{
  "metadata": {
    "rouge_scores": {
      "rouge1": 38.45,
      "rouge2": 15.67,
      "rougeL": 24.23
    },
    "accuracy_target": "99% of baseline ROUGE scores"
  }
}
```

## Contributing

This repository implements the **official MLCommons MLPerf inference reference** with enhanced visualization. To contribute:

1. Ensure changes maintain MLPerf compliance
2. Test with the complete CNN DailyMail dataset
3. Verify visual report generation functionality
4. Follow official MLCommons contribution guidelines

## License

This project uses the official MLCommons MLPerf inference code. See [LICENSE](LICENSE) for details.

---

**🎯 Results**: Professional MLPerf benchmarking with automatic visual reporting that transforms complex text outputs into intuitive, interactive dashboards.