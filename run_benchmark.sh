#!/bin/bash

# MLPerf Benchmark Automation Script
# Provides simple interface for running benchmarks with automatic report generation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE} MLPerf Benchmark Automation Suite${NC}"
    echo -e "${BLUE}========================================${NC}"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS] [BENCHMARK_TYPE]

BENCHMARK_TYPE:
    single      - Single GPU benchmark
    coordinated - Multi-GPU coordinated benchmark (default)
    distributed - Distributed multi-node benchmark
    datacenter  - MLPerf datacenter benchmark

OPTIONS:
    -s, --samples NUM       Number of samples to process (default: 10)
    -o, --output DIR        Output directory (default: results/latest)
    -n, --nodes LIST        Comma-separated node list (for coordinated)
    -w, --world-size NUM    World size for distributed (default: 2)
    --no-reports           Skip automatic report generation
    --list-configs         List available configuration files
    -h, --help             Show this help message

EXAMPLES:
    $0 coordinated                    # Run coordinated benchmark with defaults
    $0 single -s 20                   # Run single GPU with 20 samples
    $0 distributed -w 4               # Run distributed with world size 4
    $0 coordinated --no-reports       # Run without generating reports
    $0 --list-configs                 # List available configurations

TEAM USAGE:
    This script automatically generates professional reports after each benchmark
    for consistent documentation and analysis across the team.
EOF
}

# Default values
BENCHMARK_TYPE="coordinated"
SAMPLES=10
OUTPUT_DIR="results/latest"
NODES=""
WORLD_SIZE=2
NO_REPORTS=false
LIST_CONFIGS=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--samples)
            SAMPLES="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -n|--nodes)
            NODES="$2"
            shift 2
            ;;
        -w|--world-size)
            WORLD_SIZE="$2"
            shift 2
            ;;
        --no-reports)
            NO_REPORTS=true
            shift
            ;;
        --list-configs)
            LIST_CONFIGS=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        single|coordinated|distributed|datacenter)
            BENCHMARK_TYPE="$1"
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Show header
print_header

# Handle list configs
if [ "$LIST_CONFIGS" = true ]; then
    print_status "Listing available configurations..."
    python3 src/mlperf_benchmark.py --list-configs
    exit 0
fi

# Build command
CMD="python3 src/mlperf_benchmark.py --type $BENCHMARK_TYPE --samples $SAMPLES --output-dir $OUTPUT_DIR"

if [ -n "$NODES" ]; then
    CMD="$CMD --nodes $NODES"
fi

if [ "$BENCHMARK_TYPE" = "distributed" ]; then
    CMD="$CMD --world-size $WORLD_SIZE"
fi

if [ "$NO_REPORTS" = true ]; then
    CMD="$CMD --no-reports"
fi

# Show configuration
print_status "Benchmark Configuration:"
echo "  Type: $BENCHMARK_TYPE"
echo "  Samples: $SAMPLES"
echo "  Output: $OUTPUT_DIR"
if [ -n "$NODES" ]; then
    echo "  Nodes: $NODES"
fi
if [ "$BENCHMARK_TYPE" = "distributed" ]; then
    echo "  World Size: $WORLD_SIZE"
fi
echo "  Reports: $([ "$NO_REPORTS" = true ] && echo "Disabled" || echo "Enabled")"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is not installed or not in PATH"
    exit 1
fi

# Check if benchmark script exists
if [ ! -f "src/mlperf_benchmark.py" ]; then
    print_error "Benchmark script not found: src/mlperf_benchmark.py"
    print_error "Please run this script from the mlperf-benchmark directory"
    exit 1
fi

# Run the benchmark
print_status "Starting benchmark execution..."
echo ""

if eval "$CMD"; then
    echo ""
    print_status "Benchmark completed successfully!"
    
    if [ "$NO_REPORTS" = false ]; then
        print_status "Reports generated in: reports/"
        echo "  - reports/benchmark-execution-report.md"
        echo "  - reports/performance-analysis.md"
        echo "  - reports/infrastructure-health.md"
    fi
    
    echo ""
    print_status "Results saved in: $OUTPUT_DIR"
    
else
    echo ""
    print_error "Benchmark execution failed!"
    exit 1
fi