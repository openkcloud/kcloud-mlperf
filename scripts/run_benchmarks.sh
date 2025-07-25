#!/bin/bash
set -e

echo "🚀 MLPerf Distributed Benchmarking Platform"
echo "=========================================="

# Test setup first
echo "📋 Testing setup..."
python3 test_setup.py

if [ $? -eq 0 ]; then
    echo "✅ Setup test passed! Proceeding with benchmarks..."
    
    # Run benchmarks with 100 samples
    echo "🎯 Running benchmarks with 100 samples..."
    python3 src/mlperf_controller.py --mode both --samples 100
    
    if [ $? -eq 0 ]; then
        echo "✅ 100-sample benchmarks completed!"
        echo "📊 Reports should be available in reports/ directory"
        
        # Show report files
        echo "Generated reports:"
        ls -la reports/ 2>/dev/null || echo "No reports directory found yet"
        
        echo ""
        echo "🎯 Ready to run full dataset benchmarks?"
        echo "To run full dataset: python3 src/mlperf_controller.py --mode both --samples 13368 --accuracy"
    else
        echo "❌ Benchmarks failed"
        exit 1
    fi
else
    echo "❌ Setup test failed"
    exit 1
fi