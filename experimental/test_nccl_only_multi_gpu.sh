#!/bin/bash

# Test NCCL-only distributed multi-GPU setup
# Bypasses Gloo communication issues

set -e

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
TEST_DIR="/home/jungwooshim/results/test_nccl_only_${TIMESTAMP}"
BENCHMARK_DIR="/home/jungwooshim/official_mlperf/inference/language/llama3.1-8b"

echo "🔥 NCCL-Only Multi-GPU Distributed Test (20 samples)"
echo "=================================================="
echo "Timestamp: $(date)"
echo "Test Directory: ${TEST_DIR}"
echo "Approach: NCCL backend only, bypassing Gloo"
echo ""

mkdir -p "${TEST_DIR}"
cd "${TEST_DIR}"

# Create test log
exec > >(tee -a "nccl_only_test_${TIMESTAMP}.log") 2>&1

echo "📊 NCCL-Only Configuration:"
echo "- Backend: NCCL for GPU communication"
echo "- Skip Gloo: Force NCCL-only distributed setup"
echo "- Network: Direct NCCL over eno1 interface"
echo "- Sample Count: 20 (validation test)"
echo ""

# Function to test NCCL-only setup
test_nccl_only() {
    echo "🚀 Testing NCCL-Only Multi-GPU Setup"
    echo "===================================="
    
    local results_dir="${TEST_DIR}/nccl_only_results"
    mkdir -p "${results_dir}/performance"
    
    # Run with NCCL environment variables to force NCCL-only
    ssh 129.254.202.252 "cd ${BENCHMARK_DIR} && \
        export NCCL_SOCKET_IFNAME=eno1 && \
        export NCCL_DEBUG=INFO && \
        export NCCL_IB_DISABLE=1 && \
        export NCCL_P2P_DISABLE=1 && \
        export TORCH_DISTRIBUTED_DEBUG=INFO && \
        export CUDA_VISIBLE_DEVICES=0 && \
        timeout 900 python3 -c '
import os
import torch
import torch.distributed as dist
from vllm import LLM

print(\"Testing NCCL-only distributed setup...\")

# Force NCCL backend only
os.environ[\"MASTER_ADDR\"] = \"129.254.202.252\"
os.environ[\"MASTER_PORT\"] = \"29500\"
os.environ[\"RANK\"] = \"0\"
os.environ[\"WORLD_SIZE\"] = \"2\"

try:
    # Initialize NCCL process group
    dist.init_process_group(backend=\"nccl\", rank=0, world_size=2)
    print(\"NCCL process group initialized on rank 0\")
    
    # Test VLLM with distributed setup
    llm = LLM(
        model=\"meta-llama/Llama-3.1-8B-Instruct\",
        tensor_parallel_size=2,
        distributed_executor_backend=\"ray\",
        dtype=\"float16\"
    )
    print(\"VLLM NCCL-only setup successful!\")
    
except Exception as e:
    print(f\"NCCL-only test failed: {e}\")
    exit(1)
'" &
    
    # Run worker on jw3
    ssh 129.254.202.253 "cd ${BENCHMARK_DIR} && \
        export NCCL_SOCKET_IFNAME=eno1 && \
        export NCCL_DEBUG=INFO && \
        export NCCL_IB_DISABLE=1 && \
        export NCCL_P2P_DISABLE=1 && \
        export TORCH_DISTRIBUTED_DEBUG=INFO && \
        export CUDA_VISIBLE_DEVICES=0 && \
        timeout 900 python3 -c '
import os
import torch
import torch.distributed as dist

print(\"Starting NCCL worker on rank 1...\")

# Force NCCL backend only
os.environ[\"MASTER_ADDR\"] = \"129.254.202.252\"
os.environ[\"MASTER_PORT\"] = \"29500\"
os.environ[\"RANK\"] = \"1\"
os.environ[\"WORLD_SIZE\"] = \"2\"

try:
    # Initialize NCCL process group
    dist.init_process_group(backend=\"nccl\", rank=1, world_size=2)
    print(\"NCCL process group initialized on rank 1\")
    
    # Keep worker alive
    import time
    time.sleep(60)
    
except Exception as e:
    print(f\"NCCL worker failed: {e}\")
    exit(1)
'" &
    
    wait
    
    return $?
}

# Start test
START_TIME=$(date +%s)

echo "🏁 Starting NCCL-Only Test"
echo "========================="
test_nccl_only
NCCL_EXIT=$?

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "🏁 NCCL-Only Test Complete"
echo "=========================="
echo "⏰ Duration: ${MINUTES}m ${SECONDS}s"
echo "📊 NCCL Status: $([ $NCCL_EXIT -eq 0 ] && echo "✅ SUCCESS" || echo "❌ FAILED")"

if [ $NCCL_EXIT -eq 0 ]; then
    echo "🎉 NCCL-only distributed setup working!"
    echo "💡 Can proceed with NCCL-based MLPerf benchmark"
else  
    echo "⚠️  NCCL-only approach also has issues"
    echo "💡 Will try alternative approaches"
fi

echo ""
echo "📁 Test results: ${TEST_DIR}/"

exit $NCCL_EXIT