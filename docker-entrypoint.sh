#!/bin/bash
# ============================================================================
# docker-entrypoint.sh - Benchmark Container Entrypoint
# ============================================================================

set -e

# Display banner
echo "============================================================================"
echo "  K-Cloud MLPerf/MMLU Benchmark Runner"
echo "  Model: Llama-3.1-8B-Instruct"
echo "============================================================================"
echo ""

# Check GPU
if command -v nvidia-smi &> /dev/null; then
    echo "GPU Status:"
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
    echo ""
else
    echo "WARNING: nvidia-smi not found. GPU may not be available."
    echo ""
fi

# Check HuggingFace token
if [ -z "$HF_TOKEN" ]; then
    echo "WARNING: HF_TOKEN not set. Model download may fail."
    echo ""
else
    echo "HuggingFace token: configured"
    # Login to HuggingFace
    python -c "from huggingface_hub import login; login(token='$HF_TOKEN', add_to_git_credential=False)" 2>/dev/null || true
    echo ""
fi

cd /app/kcloud-mlperf

# Parse command
case "$1" in
    mlperf|--mlperf)
        shift
        echo "Running MLPerf Benchmark..."
        echo ""
        python run.py \
            --model meta-llama/Llama-3.1-8B-Instruct \
            --category datacenter \
            --scenario offline \
            --mode accuracy \
            --precision bf16 \
            --tensor-parallel-size auto \
            --max-model-len 4096 \
            --total-sample-count "${MLPERF_SAMPLES:-13368}" \
            --results-dir /cache/results/mlperf \
            "$@"
        ;;
    
    mmlu|--mmlu)
        shift
        echo "Running MMLU Benchmark..."
        echo ""
        python mmlu.py \
            --model meta-llama/Llama-3.1-8B-Instruct \
            --precision bf16 \
            --max-model-len 4096 \
            --gpu-memory-utilization 0.9 \
            --results-dir /cache/results/mmlu \
            --details 1 \
            "$@"
        ;;
    
    chat|--chat)
        shift
        echo "Running Chat Inference Demo..."
        echo ""
        python scripts/llm_inference.py "$@"
        ;;
    
    shell|--shell|bash)
        exec /bin/bash
        ;;
    
    --help|-h|help)
        echo "Usage: docker run [options] <image> <command> [args]"
        echo ""
        echo "Commands:"
        echo "  mlperf    Run MLPerf benchmark (CNN/DailyMail summarization)"
        echo "  mmlu      Run MMLU benchmark (57 subjects evaluation)"
        echo "  chat      Run interactive chat demo"
        echo "  shell     Start bash shell"
        echo ""
        echo "Environment variables:"
        echo "  HF_TOKEN          HuggingFace API token (required)"
        echo "  MLPERF_SAMPLES    Number of samples for MLPerf (default: 13368)"
        echo ""
        echo "Example:"
        echo "  docker run --gpus all -e HF_TOKEN=xxx kcloud-mlperf:latest mlperf"
        echo ""
        ;;
    
    *)
        # Pass through to python or bash
        exec "$@"
        ;;
esac