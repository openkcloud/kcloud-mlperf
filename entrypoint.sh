#!/bin/bash
set -e

# MLPerf LLaMA3.1-8B Benchmark Entrypoint
# Runs complete benchmark pipeline with accuracy evaluation

echo "🚀 MLPerf LLaMA3.1-8B Automated Benchmark Suite"
echo "================================================"

# Default values
MODEL_NAME=${MODEL_NAME:-"llama3_1-8b"}
SCENARIO=${SCENARIO:-"_all-scenarios"}
CATEGORY=${CATEGORY:-"datacenter"}
FRAMEWORK=${FRAMEWORK:-"vllm"}
DEVICE=${DEVICE:-"cuda"}
EXECUTION_MODE=${EXECUTION_MODE:-"valid"}
IMPLEMENTATION=${IMPLEMENTATION:-"reference"}
MLPerf_VERSION=${MLPerf_VERSION:-"r5.1-dev"}
OUTPUT_DIR=${OUTPUT_DIR:-"/app/results"}
HF_TOKEN=${HF_TOKEN:-""}
GPU_NAME=${GPU_NAME:-"A30"}

# Function to show help
show_help() {
    cat << EOF
MLPerf LLaMA3.1-8B Benchmark Container

Usage: docker run [OPTIONS] llama3-benchmark:latest [COMMAND]

Commands:
    benchmark       Run all scenarios with accuracy (default)
    all-scenarios   Run all MLPerf scenarios (Offline, Server, SingleStream)
    offline         Run Offline scenario only
    server          Run Server scenario only  
    singlestream    Run SingleStream scenario only
    help           Show this help message

Environment Variables:
    HF_TOKEN        HuggingFace token for model access (required)
    MODEL_NAME      Model to benchmark (default: llama3_1-8b)
    SCENARIO        MLPerf scenario (default: _all-scenarios)
    CATEGORY        Benchmark category (default: datacenter)
    FRAMEWORK       Inference framework (default: vllm)
    DEVICE          Target device (default: cuda)
    GPU_NAME        GPU model for optimization (default: A30)
    OUTPUT_DIR      Results directory (default: /app/results)

Examples:
    # All scenarios with datacenter category (A30 GPU optimized)
    docker run --gpus all -v \$(pwd)/results:/app/results \\
        -e HF_TOKEN=your_token llama3-benchmark:latest all-scenarios

    # Server scenario only
    docker run --gpus all -v \$(pwd)/results:/app/results \\
        -e HF_TOKEN=your_token -e SCENARIO=Server llama3-benchmark:latest server

    # Custom datacenter configuration
    docker run --gpus all -v \$(pwd)/results:/app/results \\
        -e HF_TOKEN=your_token -e CATEGORY=datacenter -e GPU_NAME=A30 \\
        llama3-benchmark:latest benchmark

Volume Mounts:
    /app/results    Benchmark results and reports
    /app/data       Optional: Pre-downloaded datasets

EOF
}

# Function to check prerequisites
check_prerequisites() {
    echo "🔍 Checking prerequisites..."
    
    # Check HuggingFace token
    if [ -z "$HF_TOKEN" ]; then
        echo "❌ Error: HF_TOKEN environment variable is required for model access"
        echo "   Set it with: -e HF_TOKEN=your_huggingface_token"
        exit 1
    fi
    
    # Check GPU availability if using CUDA
    if [ "$DEVICE" = "cuda" ]; then
        if ! python3 -c "import torch; assert torch.cuda.is_available()"; then
            echo "❌ Error: CUDA not available but DEVICE=cuda specified"
            echo "   Use DEVICE=cpu for CPU-only benchmarking"
            exit 1
        fi
        echo "✅ CUDA available: $(python3 -c "import torch; print(torch.cuda.get_device_name(0))")"
    fi
    
    # Check MLCommons CLI
    if ! command -v mlcr &> /dev/null; then
        echo "❌ Error: mlcr (MLCommons CLI) not found"
        exit 1
    fi
    echo "✅ MLCommons CLI available"
    
    # Create output directory
    mkdir -p "$OUTPUT_DIR"
    echo "✅ Output directory: $OUTPUT_DIR"
}

# Function to run MLPerf benchmark
run_benchmark() {
    local mode=$1
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local run_dir="$OUTPUT_DIR/mlperf_${mode}_${timestamp}"
    
    echo "🎯 Running MLPerf $mode benchmark..."
    echo "   Model: $MODEL_NAME"
    echo "   Scenario: $SCENARIO"
    echo "   Category: $CATEGORY"
    echo "   Framework: $FRAMEWORK"
    echo "   Device: $DEVICE"
    echo "   Output: $run_dir"
    
    mkdir -p "$run_dir"
    cd "$run_dir"
    
    # Set HuggingFace token
    export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
    
    # Build MLCommons CLI command
    local mlcr_cmd="mlcr run-mlperf,inference,_full,_${MLPerf_VERSION}"
    
    # Add all-scenarios flag if specified
    if [[ "$SCENARIO" == "_all-scenarios" ]]; then
        mlcr_cmd="$mlcr_cmd,_all-scenarios"
    fi
    
    mlcr_cmd="$mlcr_cmd --model=$MODEL_NAME"
    mlcr_cmd="$mlcr_cmd --implementation=$IMPLEMENTATION"
    mlcr_cmd="$mlcr_cmd --framework=$FRAMEWORK"
    mlcr_cmd="$mlcr_cmd --category=$CATEGORY"
    
    # Only add scenario if not using all-scenarios
    if [[ "$SCENARIO" != "_all-scenarios" ]]; then
        mlcr_cmd="$mlcr_cmd --scenario=$SCENARIO"
    fi
    
    mlcr_cmd="$mlcr_cmd --execution_mode=$EXECUTION_MODE"
    mlcr_cmd="$mlcr_cmd --device=$DEVICE"
    mlcr_cmd="$mlcr_cmd --quiet"
    
    echo "🚀 Executing: $mlcr_cmd"
    
    # Run the benchmark
    if eval "$mlcr_cmd"; then
        echo "✅ Benchmark completed successfully"
        
        # Generate report
        python3 /app/report_generator.py --input-dir "$run_dir" --output-dir "$run_dir"
        
        return 0
    else
        echo "❌ Benchmark failed"
        return 1
    fi
}

# Function to run Python benchmark runner (fallback)
run_python_benchmark() {
    echo "📊 Running Python benchmark automation..."
    python3 /app/benchmark_runner.py \
        --model "$MODEL_NAME" \
        --scenario "$SCENARIO" \
        --output-dir "$OUTPUT_DIR" \
        --hf-token "$HF_TOKEN" \
        --device "$DEVICE"
}

# Main execution
case "${1:-benchmark}" in
    "help"|"--help"|"-h")
        show_help
        ;;
    "benchmark"|"full"|"all-scenarios")
        check_prerequisites
        if ! run_benchmark "all-scenarios"; then
            echo "⚠️  MLCommons CLI failed, trying Python fallback..."
            run_python_benchmark
        fi
        ;;
    "offline")
        check_prerequisites
        export SCENARIO="Offline"
        run_benchmark "offline"
        ;;
    "server")
        check_prerequisites
        export SCENARIO="Server"
        run_benchmark "server"
        ;;
    "singlestream")
        check_prerequisites
        export SCENARIO="SingleStream"
        run_benchmark "singlestream"
        ;;
    "performance")
        check_prerequisites
        export EXECUTION_MODE="performance"
        run_benchmark "performance"
        ;;
    "accuracy")
        check_prerequisites
        export EXECUTION_MODE="accuracy"
        run_benchmark "accuracy"
        ;;
    *)
        echo "❌ Unknown command: $1"
        show_help
        exit 1
        ;;
esac

echo "🎉 MLPerf benchmark pipeline completed!"
echo "📊 Results available in: $OUTPUT_DIR"