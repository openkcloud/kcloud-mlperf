#!/bin/bash
# Basic MLPerf Benchmark Commands
# ================================
# Copy and paste these commands to get started quickly!

echo "🚀 MLPerf Benchmarking - Basic Commands"
echo "========================================"

# 1. QUICK TEST (10 samples, ~1 minute)
echo "1. Quick test on GPU 2:"
echo "python3 bin/run_single_benchmark.py --node jw2 --samples 10"
echo ""

# 2. NORMAL TEST (100 samples, ~10 minutes) 
echo "2. Normal test on GPU 2:"
echo "python3 bin/run_single_benchmark.py --node jw2 --samples 100"
echo ""

# 3. TEST WITH ACCURACY (100 samples + validation, ~10 minutes)
echo "3. Test with accuracy validation:"
echo "python3 bin/run_single_benchmark.py --node jw2 --samples 100 --accuracy"
echo ""

# 4. PARALLEL TEST (both GPUs, ~6 minutes for 100 samples each)
echo "4. Parallel test on both GPUs:"
echo "python3 bin/run_parallel_benchmark.py"
echo ""

# 5. GENERATE ANALYSIS
echo "5. Generate performance analysis:"
echo "python3 tools/analyze_results.py"
echo ""

# 6. CREATE CHARTS
echo "6. Create performance charts:"
echo "python3 tools/generate_charts.py --results-dir reports/"
echo ""

# 7. VIEW RESULTS
echo "7. View your results:"
echo "ls reports/                    # List all result files"
echo "ls reports/charts/             # List performance charts" 
echo "cat reports/*.md               # Read analysis report"
echo ""

echo "💡 TIP: Start with command #1 for a quick test!"
echo "💡 TIP: Use --samples 50 for faster testing during development"
echo ""
echo "📁 Results will appear in the 'reports/' directory"
echo "📊 Charts will appear in the 'reports/charts/' directory"