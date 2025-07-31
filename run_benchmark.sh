#!/bin/bash
# MLPerf Benchmark Runner
set -e

echo "Starting MLPerf benchmark run..."
echo "Dataset: CNN-DailyMail"
echo "Model: LLaMA 3.1-8B"

# Check for HF token
if [ -z "$HF_TOKEN" ]; then
    echo "Warning: HF_TOKEN not set, using fallback authentication"
fi

# Run benchmark
if [ -f "benchmark_simplified.py" ]; then
    python3 benchmark_simplified.py \
        --samples ${SAMPLES:-100} \
        --output benchmark_results_${SAMPLES:-100}_samples.json
elif [ -f "benchmark_official_rouge.py" ]; then
    python3 benchmark_official_rouge.py \
        --samples ${SAMPLES:-100} \
        --output benchmark_results_${SAMPLES:-100}_samples.json
else
    echo "Error: No benchmark script found"
    exit 1
fi

echo "Benchmark completed!"
