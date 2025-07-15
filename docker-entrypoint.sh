#!/bin/bash
set -e

echo "🐳 MLPerf Llama-3.1-8B Benchmark Container Starting..."

# Check environment
echo "📊 Environment Check:"
echo "  Python: $(python3 --version)"
echo "  PyTorch: $(python3 -c 'import torch; print(torch.__version__)')"
echo "  CUDA Available: $(python3 -c 'import torch; print(torch.cuda.is_available())')"
if python3 -c 'import torch; torch.cuda.is_available()' 2>/dev/null; then
    echo "  GPU: $(python3 -c 'import torch; print(torch.cuda.get_device_name(0))' 2>/dev/null || echo 'Unknown')"
fi

# Create required directories
mkdir -p /app/results /app/cache

# Set working directory
cd /app

case "$1" in
    "benchmark")
        echo "🚀 Starting MLPerf benchmark..."
        python3 /app/containerized_benchmark.py
        ;;
    "test")
        echo "🧪 Running test mode..."
        export NUM_SAMPLES=3
        export MAX_TOKENS=32
        python3 /app/containerized_benchmark.py
        ;;
    "bash")
        echo "💻 Starting interactive shell..."
        exec /bin/bash
        ;;
    *)
        echo "📖 Usage: docker run [options] mlperf-llama [benchmark|test|bash]"
        echo "  benchmark - Run full benchmark (default)"
        echo "  test      - Run quick test with 3 samples"
        echo "  bash      - Interactive shell"
        exit 1
        ;;
esac