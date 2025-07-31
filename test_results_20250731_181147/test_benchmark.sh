#!/bin/bash
# Test benchmark execution
cd /app

# Check if run_benchmark.sh exists
if [ ! -f "run_benchmark.sh" ]; then
    echo "Creating run_benchmark.sh for testing..."
    cat > run_benchmark.sh << 'BENCHMARK_SCRIPT'
#!/bin/bash
# Simulated benchmark for testing
echo "Running MLPerf benchmark..."
python3 benchmark_simplified.py --samples 100 --output benchmark_results.json
BENCHMARK_SCRIPT
    chmod +x run_benchmark.sh
fi

# Execute benchmark
./run_benchmark.sh
