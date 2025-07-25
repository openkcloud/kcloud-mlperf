# Quick Start Guide

**For Junior Developers: How to run MLPerf benchmarks in 3 simple steps**

## 🎯 What This Project Does
This project runs AI model benchmarks across multiple GPUs to measure performance and accuracy.

## 📁 Project Structure (Simple!)
```
mlperf-distributed/
├── bin/                    # ← Run these scripts!
│   ├── run_single_benchmark.py    # Test one GPU
│   └── run_parallel_benchmark.py  # Test both GPUs
├── tools/                  # ← Analyze results
│   ├── analyze_results.py         # Generate performance analysis
│   └── generate_charts.py         # Create visual charts
├── scripts/                # ← Setup files
│   ├── requirements.txt           # Python dependencies
│   ├── Dockerfile                 # Container setup
│   └── run_benchmarks.sh          # Basic runner
├── docs/                   # ← Read for details
│   ├── README.md                  # Full documentation
│   └── CLAUDE.md                  # Development notes
├── examples/               # ← You are here!
└── reports/                # ← Results appear here
```

## 🚀 3-Step Quick Start

### Step 1: Run a Simple Test
```bash
# Test one GPU (takes ~10 minutes for 100 samples)
python3 bin/run_single_benchmark.py --node jw2 --samples 100
```

### Step 2: Run Parallel Test
```bash
# Test both GPUs simultaneously (faster!)
python3 bin/run_parallel_benchmark.py
```

### Step 3: See Your Results
```bash
# Generate charts and analysis
python3 tools/analyze_results.py
python3 tools/generate_charts.py --results-dir reports/

# View results
ls reports/          # See result files
ls reports/charts/   # See performance charts
```

## 📊 Understanding Results

**Performance Files:**
- `jw2_performance.txt` - GPU 2 benchmark results
- `jw3_performance.txt` - GPU 3 benchmark results  
- `*.json` - Accuracy validation data

**Charts:**
- `performance_analysis.png` - Complete performance breakdown
- `scaling_analysis.png` - How well multiple GPUs work together
- `throughput_comparison.png` - Speed comparison

## 🎯 Real Results You Can Expect
- **Single GPU**: ~0.2 samples/second (20.6 hours for full dataset)
- **Parallel GPUs**: ~0.36 samples/second (10.4 hours for full dataset)
- **Speedup**: 4.3x faster with parallel processing!

## 🆘 Need Help?
1. Check `docs/README.md` for full documentation
2. Look at result files in `reports/` directory
3. Run with smaller `--samples 10` for quick tests

**That's it! You're now benchmarking AI models like a pro! 🎉**