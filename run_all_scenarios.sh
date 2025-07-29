#!/bin/bash

# MLPerf All-Scenarios Benchmark Runner
# =====================================
# 
# This script runs all MLPerf scenarios (Offline, Server, SingleStream) 
# with datacenter configuration optimized for A30 GPU.

set -e

# Configuration
IMAGE_NAME="llama3-benchmark:latest"
HF_TOKEN="${HF_TOKEN:-}"
RESULTS_DIR="$(pwd)/results_all_scenarios"
GPU_NAME="${GPU_NAME:-A30}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "🚀 MLPerf LLaMA3.1-8B All-Scenarios Benchmark"
    echo "=============================================="
    echo "📊 Model: meta-llama/Llama-3.1-8B-Instruct"
    echo "🖥️  GPU: ${GPU_NAME} (24GB)"
    echo "📁 Results: ${RESULTS_DIR}"
    echo "🔧 Configuration: Datacenter/Server optimized"
    echo -e "${NC}"
}

check_prerequisites() {
    echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker not found. Please install Docker first.${NC}"
        exit 1
    fi
    
    # Check NVIDIA Docker
    if ! docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi &> /dev/null; then
        echo -e "${RED}❌ NVIDIA Docker support not available.${NC}"
        echo "   Please install nvidia-container-toolkit"
        exit 1
    fi
    
    # Check HF Token
    if [ -z "$HF_TOKEN" ]; then
        echo -e "${RED}❌ HF_TOKEN environment variable required${NC}"
        echo -e "${YELLOW}   Set it with: export HF_TOKEN=your_huggingface_token${NC}"
        exit 1
    fi
    
    # Check if image exists
    if ! docker image inspect "$IMAGE_NAME" &> /dev/null; then
        echo -e "${YELLOW}⚠️  Docker image $IMAGE_NAME not found.${NC}"
        echo -e "${YELLOW}   Building image now...${NC}"
        docker build -t "$IMAGE_NAME" .
    fi
    
    echo -e "${GREEN}✅ All prerequisites satisfied${NC}"
}

run_all_scenarios() {
    echo -e "${BLUE}🎯 Starting all-scenarios benchmark...${NC}"
    
    # Create results directory
    mkdir -p "$RESULTS_DIR"
    
    # Run Docker container with all scenarios
    docker run --rm --gpus all \
        -v "$RESULTS_DIR:/app/results" \
        -e HF_TOKEN="$HF_TOKEN" \
        -e SCENARIO="_all-scenarios" \
        -e CATEGORY="datacenter" \
        -e GPU_NAME="$GPU_NAME" \
        -e FRAMEWORK="vllm" \
        -e DEVICE="cuda" \
        --name mlperf-all-scenarios \
        "$IMAGE_NAME" all-scenarios
    
    echo -e "${GREEN}✅ All-scenarios benchmark completed!${NC}"
}

show_results() {
    echo -e "${BLUE}📊 Benchmark Results Summary${NC}"
    echo "================================"
    
    if [ -d "$RESULTS_DIR" ]; then
        echo -e "${GREEN}📁 Results directory: $RESULTS_DIR${NC}"
        
        # Count result files
        result_files=$(find "$RESULTS_DIR" -name "*.json" -o -name "*.html" | wc -l)
        echo -e "${GREEN}📋 Generated files: $result_files${NC}"
        
        # Show HTML reports
        html_reports=$(find "$RESULTS_DIR" -name "*.html")
        if [ -n "$html_reports" ]; then
            echo -e "${YELLOW}📋 HTML Reports:${NC}"
            echo "$html_reports" | while read -r report; do
                echo "   • $(basename "$report")"
            done
        fi
        
        # Show JSON reports  
        json_reports=$(find "$RESULTS_DIR" -name "*report*.json")
        if [ -n "$json_reports" ]; then
            echo -e "${YELLOW}📋 JSON Reports:${NC}"
            echo "$json_reports" | while read -r report; do
                echo "   • $(basename "$report")"
            done
        fi
        
        echo ""
        echo -e "${BLUE}🔍 To view results:${NC}"
        echo "   • Open HTML reports in a web browser"
        echo "   • Check JSON files for detailed metrics"
        echo "   • All MLPerf logs are in the results directory"
        
    else
        echo -e "${RED}❌ No results directory found${NC}"
    fi
}

cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up...${NC}"
    # Stop any running containers
    docker stop mlperf-all-scenarios 2>/dev/null || true
}

# Set up cleanup trap
trap cleanup EXIT

# Main execution
main() {
    print_banner
    check_prerequisites
    run_all_scenarios
    show_results
    
    echo -e "${GREEN}🎉 MLPerf all-scenarios benchmark completed successfully!${NC}"
}

# Show help
show_help() {
    echo "MLPerf All-Scenarios Benchmark Runner"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Environment Variables:"
    echo "  HF_TOKEN     HuggingFace token for model access (required)"
    echo "  GPU_NAME     GPU model name (default: A30)"
    echo ""
    echo "Examples:"
    echo "  export HF_TOKEN=hf_your_token"
    echo "  $0"
    echo ""
    echo "  # Custom GPU name"
    echo "  export GPU_NAME=RTX4090"
    echo "  $0"
}

# Parse command line arguments
case "${1:-run}" in
    "help"|"--help"|"-h")
        show_help
        ;;
    "run"|"")
        main
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        show_help
        exit 1
        ;;
esac