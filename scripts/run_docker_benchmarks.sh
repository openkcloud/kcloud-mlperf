#!/bin/bash
# ============================================================================
# run_docker_benchmarks.sh - MLPerf Benchmark using Official MLCommons Library
# Runs benchmarks directly with Docker (no Kubernetes required)
# ============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MLCOMMONS_DIR="$PROJECT_DIR/mlcommons_inference"
LLAMA_DIR="$MLCOMMONS_DIR/language/llama3.1-8b"

# Configuration
IMAGE_NAME="kcloud-mlperf:latest"
CONTAINER_NAME="mlperf-benchmark"
HF_CACHE="${HF_CACHE:-$HOME/.cache/huggingface}"
HF_TOKEN="${HF_TOKEN:-}"
MODEL_PATH="${MODEL_PATH:-meta-llama/Llama-3.1-8B-Instruct}"

# Benchmark settings
SCENARIO="${SCENARIO:-Offline}"
BATCH_SIZE="${BATCH_SIZE:-16}"
DTYPE="${DTYPE:-bfloat16}"
TENSOR_PARALLEL="${TENSOR_PARALLEL:-1}"
ACCURACY_MODE=false
SMOKE_TEST=false
SAMPLE_COUNT=13368  # Full dataset

# Parse arguments
for arg in "$@"; do
    case $arg in
        --smoke)
            SMOKE_TEST=true
            SAMPLE_COUNT=100
            ;;
        --accuracy)
            ACCURACY_MODE=true
            ;;
        --build)
            BUILD_IMAGE=true
            ;;
        --server)
            SCENARIO="Server"
            ;;
        --offline)
            SCENARIO="Offline"
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --smoke       Quick smoke test (100 samples)"
            echo "  --accuracy    Run accuracy mode (generates accuracy logs)"
            echo "  --build       Rebuild Docker image before running"
            echo "  --server      Use Server scenario (default: Offline)"
            echo "  --offline     Use Offline scenario"
            echo ""
            echo "Environment variables:"
            echo "  HF_TOKEN           HuggingFace token (required)"
            echo "  HF_CACHE           HuggingFace cache directory"
            echo "  MODEL_PATH         Model path (default: meta-llama/Llama-3.1-8B-Instruct)"
            echo "  BATCH_SIZE         Batch size (default: 16)"
            echo "  TENSOR_PARALLEL    Tensor parallel size (default: 1)"
            exit 0
            ;;
    esac
done

# Validate HuggingFace token
if [ -z "$HF_TOKEN" ]; then
    echo "ERROR: HF_TOKEN environment variable is required"
    echo "Export it with: export HF_TOKEN=your_huggingface_token"
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║   MLPerf Inference Benchmark - Official MLCommons Implementation         ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Configuration:"
echo "  Model:           $MODEL_PATH"
echo "  Scenario:        $SCENARIO"
echo "  Batch Size:      $BATCH_SIZE"
echo "  Data Type:       $DTYPE"
echo "  Sample Count:    $SAMPLE_COUNT"
echo "  Accuracy Mode:   $ACCURACY_MODE"
echo "  Smoke Test:      $SMOKE_TEST"
echo "  Tensor Parallel: $TENSOR_PARALLEL"
echo ""

# Build Docker image if requested or if it doesn't exist
if [ "$BUILD_IMAGE" = true ] || ! docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${IMAGE_NAME}$"; then
    echo "[1/3] Building Docker image..."
    docker build -t "$IMAGE_NAME" -f "$PROJECT_DIR/Dockerfile.mlperf" "$PROJECT_DIR"
    echo "✓ Docker image built: $IMAGE_NAME"
else
    echo "[1/3] Using existing Docker image: $IMAGE_NAME"
fi

# Prepare output directory
RUN_ID="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="$PROJECT_DIR/results/$RUN_ID"
mkdir -p "$OUTPUT_DIR"
echo "[2/3] Output directory: $OUTPUT_DIR"

# Build the benchmark command
BENCHMARK_CMD="python -u main.py \
    --scenario $SCENARIO \
    --model-path $MODEL_PATH \
    --batch-size $BATCH_SIZE \
    --dtype $DTYPE \
    --user-conf user.conf \
    --total-sample-count $SAMPLE_COUNT \
    --output-log-dir /output \
    --tensor-parallel-size $TENSOR_PARALLEL \
    --vllm"

if [ "$ACCURACY_MODE" = true ]; then
    BENCHMARK_CMD="$BENCHMARK_CMD --accuracy"
fi

echo "[3/3] Running MLPerf benchmark..."
echo "Command: $BENCHMARK_CMD"
echo ""
echo "════════════════════════════════════════════════════════════════════════════"

# Run the benchmark in Docker
docker run --rm \
    --gpus all \
    --name "$CONTAINER_NAME" \
    --shm-size=16g \
    -e HF_TOKEN="$HF_TOKEN" \
    -e HF_HOME=/cache \
    -e TRANSFORMERS_CACHE=/cache \
    -e VLLM_WORKER_MULTIPROC_METHOD=spawn \
    -v "$HF_CACHE:/cache" \
    -v "$OUTPUT_DIR:/output" \
    -v "$LLAMA_DIR/dataset:/workspace/mlcommons_inference/language/llama3.1-8b/dataset" \
    "$IMAGE_NAME" \
    bash -c "$BENCHMARK_CMD"

BENCHMARK_EXIT=$?

echo ""
echo "════════════════════════════════════════════════════════════════════════════"

# Parse and display results
if [ $BENCHMARK_EXIT -eq 0 ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════════╗"
    echo "║                           BENCHMARK RESULTS                              ║"
    echo "╠══════════════════════════════════════════════════════════════════════════╣"
    
    # Parse LoadGen summary
    if [ -f "$OUTPUT_DIR/mlperf_log_summary.txt" ]; then
        echo "║  LoadGen Summary:                                                        ║"
        # Extract key metrics
        SAMPLES_PER_SEC=$(grep "Samples per second" "$OUTPUT_DIR/mlperf_log_summary.txt" 2>/dev/null | awk -F': ' '{print $2}' || echo "N/A")
        RESULT=$(grep "Result is" "$OUTPUT_DIR/mlperf_log_summary.txt" 2>/dev/null | awk -F': ' '{print $2}' || echo "N/A")
        printf "║    Samples/sec: %-58s ║\n" "$SAMPLES_PER_SEC"
        printf "║    Result: %-63s ║\n" "$RESULT"
    fi
    
    # Run accuracy evaluation if in accuracy mode
    if [ "$ACCURACY_MODE" = true ] && [ -f "$OUTPUT_DIR/mlperf_log_accuracy.json" ]; then
        echo "║                                                                          ║"
        echo "║  Running accuracy evaluation...                                          ║"
        
        docker run --rm \
            -v "$OUTPUT_DIR:/output" \
            -v "$LLAMA_DIR:/workspace/mlcommons_inference/language/llama3.1-8b" \
            "$IMAGE_NAME" \
            python evaluation.py \
                --mlperf-accuracy-file /output/mlperf_log_accuracy.json \
                --dataset-file /workspace/mlcommons_inference/language/llama3.1-8b/dataset/cnn_eval.json \
                --dtype int32 \
            | tee "$OUTPUT_DIR/accuracy_results.txt"
        
        # Parse accuracy results
        if [ -f "$OUTPUT_DIR/accuracy_results.txt" ]; then
            ROUGE1=$(grep "rouge1" "$OUTPUT_DIR/accuracy_results.txt" 2>/dev/null | awk -F': ' '{print $2}' || echo "N/A")
            ROUGE2=$(grep "rouge2" "$OUTPUT_DIR/accuracy_results.txt" 2>/dev/null | awk -F': ' '{print $2}' || echo "N/A")
            ROUGEL=$(grep "rougeL" "$OUTPUT_DIR/accuracy_results.txt" 2>/dev/null | awk -F': ' '{print $2}' || echo "N/A")
            printf "║    ROUGE-1: %-62s ║\n" "$ROUGE1"
            printf "║    ROUGE-2: %-62s ║\n" "$ROUGE2"
            printf "║    ROUGE-L: %-62s ║\n" "$ROUGEL"
        fi
    fi
    
    echo "╠══════════════════════════════════════════════════════════════════════════╣"
    printf "║  Run ID: %-65s ║\n" "$RUN_ID"
    printf "║  Results saved to: %-55s ║\n" "$OUTPUT_DIR"
    echo "╚══════════════════════════════════════════════════════════════════════════╝"
    
    echo ""
    echo "Generated files:"
    ls -la "$OUTPUT_DIR"
else
    echo "✗ Benchmark FAILED with exit code: $BENCHMARK_EXIT"
    exit $BENCHMARK_EXIT
fi
