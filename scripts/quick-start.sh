#!/bin/bash
# Quick Start Script for MLPerf Benchmarks
# One-command deployment for different environments

set -euo pipefail

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}"
cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀 MLPerf Datacenter Benchmark - Quick Start             ║
║                                                              ║
║   Universal deployment for any hardware environment         ║
║   Supports: NVIDIA GPU, Furiosa NPU, AMD ROCm, Intel, CPU  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Check if we're in the right directory
if [[ ! -f "mlperf_datacenter_benchmark.py" ]]; then
    echo -e "${YELLOW}⚠️  Please run this script from the mlperf-benchmark directory${NC}"
    echo ""
    echo "If you need to clone the repository:"
    echo "  git clone https://github.com/jshim0978/MLPerf_local_test.git"
    echo "  cd MLPerf_local_test"
    echo "  ./scripts/quick-start.sh"
    exit 1
fi

echo -e "${GREEN}🔍 Auto-detecting your environment...${NC}"

# Run environment detection
python3 environment_detector.py

echo ""
echo -e "${GREEN}🚀 Starting automated deployment...${NC}"

# Run deployment script
if [[ -f "scripts/deploy.sh" ]]; then
    chmod +x scripts/deploy.sh
    scripts/deploy.sh "$@"
else
    echo -e "${YELLOW}⚠️  deploy.sh not found, running direct deployment${NC}"
    
    # Direct deployment
    echo "Setting up environment..."
    python3 -m venv venv --system-site-packages || python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip
    
    if [[ -f "requirements.universal.txt" ]]; then
        pip install -r requirements.universal.txt
    elif [[ -f "requirements.txt" ]]; then
        pip install -r requirements.txt
    fi
    
    echo ""
    echo -e "${GREEN}🏃‍♂️ Running MLPerf benchmark...${NC}"
    python3 mlperf_datacenter_benchmark.py
fi

echo ""
echo -e "${GREEN}🎉 Quick start completed!${NC}"
echo ""
echo "📊 Results are available in:"
echo "   - ./results/ directory"
echo "   - ./environment_config.json (environment details)"
echo ""
echo "📚 For more options, run: ./scripts/deploy.sh --help"