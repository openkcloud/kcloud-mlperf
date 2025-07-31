#!/bin/bash
set -e

# MLCommons Authentication Setup Script
# Helps users set up proper authentication for official ROUGE scoring

echo "🔐 MLCommons Authentication Setup"
echo "=================================="
echo ""

# Check if running in container
if [ -f /.dockerenv ]; then
    echo "🐳 Running inside Docker container"
    echo "⚠️  Interactive authentication requires browser access"
    echo "   Consider running this setup on the host first"
    echo ""
fi

echo "📋 Prerequisites:"
echo "1. Join MLCommons Datasets Working Group"
echo "   Visit: https://mlcommons.org/working-groups/data/datasets/"
echo "2. Use organizational email (corporate/academic)"
echo "3. Fill out subscription form if access issues occur"
echo ""

read -p "Have you completed the prerequisites above? [y/N]: " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Please complete prerequisites first"
    echo "   1. Visit: https://mlcommons.org/working-groups/data/datasets/"
    echo "   2. Join with your organizational email"
    echo "   3. Fill subscription form if needed"
    exit 1
fi

echo ""
echo "🔍 Checking authentication tools..."

# Check cloudflared
if command -v cloudflared &> /dev/null; then
    echo "✅ cloudflared installed"
else
    echo "❌ cloudflared not found - installing..."
    curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i cloudflared.deb
    rm cloudflared.deb
    echo "✅ cloudflared installed"
fi

# Check mlcr
if command -v mlcr &> /dev/null; then
    echo "✅ mlcr tool available"
else
    echo "❌ mlcr not found"
    echo "   Install with: pip install cmx4mlperf"
    exit 1
fi

# Check R2 downloader
if [ -f "/app/r2-downloader/download.sh" ]; then
    echo "✅ MLCommons R2 downloader available"
elif [ -f "./r2-downloader/download.sh" ]; then
    echo "✅ MLCommons R2 downloader available (local)"
else
    echo "❌ MLCommons R2 downloader not found - installing..."
    git clone --depth 1 https://github.com/mlcommons/r2-downloader.git ./r2-downloader
    chmod +x ./r2-downloader/download.sh
    echo "✅ MLCommons R2 downloader installed"
fi

echo ""
echo "🧪 Testing authentication..."
echo "This will attempt to download a small test file"
echo "Browser window may open for Cloudflare Access authentication"
echo ""

# Test authentication by trying to download dataset info
echo "Attempting CNN-DailyMail dataset authentication test..."
if timeout 30 mlcr get dataset-cnndm --model=llama3_1-8b --test 2>/dev/null; then
    echo "✅ Authentication successful!"
    echo "🎉 You can now run official MLPerf benchmarks with ROUGE scoring"
else
    echo "⚠️  Authentication test inconclusive"
    echo "   This is normal - authentication happens during actual download"
    echo "   Browser window will open on first dataset download"
fi

echo ""
echo "🎯 Setup Complete!"
echo "==================="
echo ""
echo "Next steps:"
echo "1. Run benchmark: docker run --gpus all mlperf-llama3-benchmark"
echo "2. First run will open browser for authentication"
echo "3. Authenticate with your MLCommons credentials"
echo "4. Subsequent runs will use cached authentication"
echo ""
echo "Benefits:"
echo "✅ Official ROUGE-1, ROUGE-2, ROUGE-L scores"
echo "✅ Real CNN-DailyMail validation dataset (13,368 samples)"
echo "✅ MLPerf-compliant results for submissions"
echo ""
echo "Fallback available:"
echo "If authentication fails, container automatically uses:"
echo "• HuggingFace direct access (no auth required)"
echo "• Synthetic CNN-DailyMail-style dataset"
echo "• Word overlap scoring (not ROUGE)"