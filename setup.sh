#!/bin/bash
set -e

echo "🚀 MLPerf Benchmarking Setup"
echo "============================"

# Check Python version
echo "🐍 Checking Python version..."
python3 --version

# Install dependencies
echo "📦 Installing Python dependencies..."
pip install -r scripts/requirements.txt

# Generate test dataset
echo "📊 Generating test dataset..."
cd official_mlperf
python3 generate_test_dataset.py
cd ..

# Test SSH connectivity
echo "🔗 Testing SSH connectivity..."
if ssh -o ConnectTimeout=5 jungwooshim@129.254.202.252 "echo 'JW2 connected'" > /dev/null 2>&1; then
    echo "✅ JW2 connection: OK"
else
    echo "❌ JW2 connection: FAILED"
    echo "   Run: ssh-copy-id jungwooshim@129.254.202.252"
fi

if ssh -o ConnectTimeout=5 jungwooshim@129.254.202.253 "echo 'JW3 connected'" > /dev/null 2>&1; then
    echo "✅ JW3 connection: OK"
else
    echo "❌ JW3 connection: FAILED"
    echo "   Run: ssh-copy-id jungwooshim@129.254.202.253"
fi

# Check GPU availability
echo "🎮 Checking GPU availability..."
if ssh -o ConnectTimeout=5 jungwooshim@129.254.202.252 "nvidia-smi --query-gpu=name --format=csv,noheader" 2>/dev/null; then
    echo "✅ JW2 GPU: Available"
else
    echo "❌ JW2 GPU: Not accessible"
fi

if ssh -o ConnectTimeout=5 jungwooshim@129.254.202.253 "nvidia-smi --query-gpu=name --format=csv,noheader" 2>/dev/null; then
    echo "✅ JW3 GPU: Available"
else
    echo "❌ JW3 GPU: Not accessible"
fi

echo ""
echo "🎯 Setup complete! Try running:"
echo "   python3 bin/run_single_benchmark.py --node jw2 --samples 10"
echo ""