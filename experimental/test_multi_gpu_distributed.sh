#!/bin/bash

# MLPerf Multi-GPU Distributed Benchmark Test
# Uses both A30 GPUs across jw2 and jw3 with tensor parallelism

set -e

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
TEST_DIR="/home/jungwooshim/results/test_multi_gpu_${TIMESTAMP}"
BENCHMARK_DIR="/home/jungwooshim/official_mlperf/inference/language/llama3.1-8b"

echo "🔥 MLPerf Multi-GPU Distributed Test (20 samples)"
echo "================================================="
echo "Timestamp: $(date)"
echo "Test Directory: ${TEST_DIR}"
echo "Expected Duration: ~25-35 minutes"
echo "Configuration: 2x A30 GPUs with tensor parallelism"
echo ""
echo "GPU Setup:"
echo "  jw2 (129.254.202.252): Primary node + GPU 0"
echo "  jw3 (129.254.202.253): Worker node + GPU 1"
echo "  tensor_parallel_size: 2"
echo "  distributed_executor_backend: ray"
echo ""

mkdir -p "${TEST_DIR}"
cd "${TEST_DIR}"

# Create test log
exec > >(tee -a "multi_gpu_test_${TIMESTAMP}.log") 2>&1

echo "📊 Test Configuration:"
echo "- Sample Count: 20 (validation test)"
echo "- Performance Test: Server scenario with distributed inference"
echo "- Accuracy Test: ROUGE evaluation on distributed setup"
echo "- Hardware: 2x NVIDIA A30 GPUs (jw2 + jw3)"
echo "- Parallelism: tensor_parallel_size=2"
echo ""

# Function to check if nodes are available
check_nodes() {
    echo "🔍 Checking node availability..."
    
    echo "Testing jw2 connection..."
    if ! ssh 129.254.202.252 "echo 'jw2 connected'" 2>/dev/null; then
        echo "❌ Cannot connect to jw2"
        exit 1
    fi
    
    echo "Testing jw3 connection..."
    if ! ssh 129.254.202.253 "echo 'jw3 connected'" 2>/dev/null; then
        echo "❌ Cannot connect to jw3"
        exit 1
    fi
    
    echo "✅ Both nodes accessible"
}

# Function to check GPU memory availability
check_gpu_memory() {
    echo "🔍 Checking GPU memory availability..."
    
    jw2_memory=$(ssh 129.254.202.252 'nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits' 2>/dev/null | head -1)
    jw3_memory=$(ssh 129.254.202.253 'nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits' 2>/dev/null | head -1)
    
    echo "jw2 free memory: ${jw2_memory}MB"
    echo "jw3 free memory: ${jw3_memory}MB"
    
    # Need at least 10GB free for model loading
    if [ "${jw2_memory}" -lt 10240 ] || [ "${jw3_memory}" -lt 10240 ]; then
        echo "⚠️  Insufficient GPU memory for multi-GPU setup"
        echo "⚠️  Waiting for other benchmarks to complete..."
        return 1
    fi
    
    echo "✅ Sufficient GPU memory available"
    return 0
}

# Function to setup Ray cluster for distributed inference
setup_ray_cluster() {
    echo "🚀 Setting up Ray cluster for distributed inference..."
    
    # Kill any existing Ray processes
    echo "Cleaning up existing Ray processes..."
    ssh 129.254.202.252 "pkill -f ray || true" 2>/dev/null || true
    ssh 129.254.202.253 "pkill -f ray || true" 2>/dev/null || true
    sleep 5
    
    # Start Ray head node on jw2
    echo "Starting Ray head node on jw2..."
    ssh 129.254.202.252 "cd ${BENCHMARK_DIR} && ~/.local/bin/ray start --head --port=6379 --dashboard-host=0.0.0.0 --dashboard-port=8265" &
    sleep 10
    
    # Connect jw3 as worker
    echo "Connecting jw3 as Ray worker..."
    ssh 129.254.202.253 "cd ${BENCHMARK_DIR} && ~/.local/bin/ray start --address=129.254.202.252:6379" &
    sleep 10
    
    # Verify Ray cluster
    echo "Verifying Ray cluster status..."
    ssh 129.254.202.252 "cd ${BENCHMARK_DIR} && ~/.local/bin/ray status" 2>&1 | tee "${TEST_DIR}/ray_status.log"
    
    if grep -q "Active:" "${TEST_DIR}/ray_status.log" && [ $(grep -c "node_" "${TEST_DIR}/ray_status.log") -eq 2 ]; then
        echo "✅ Ray cluster setup successful (2 nodes detected)"
        return 0
    else
        echo "❌ Ray cluster setup failed"
        return 1
    fi
}

# Function to test multi-GPU performance
test_multi_gpu_performance() {
    echo "🎯 Phase 1: Multi-GPU Performance Test"
    echo "======================================"
    
    local results_dir="${TEST_DIR}/multi_gpu_results"
    mkdir -p "${results_dir}/performance"
    
    # Run distributed performance benchmark with IPv4 forced
    ssh 129.254.202.252 "cd ${BENCHMARK_DIR} && \
        export NCCL_SOCKET_IFNAME=eno1 && \
        export NCCL_DEBUG=INFO && \
        export GLOO_SOCKET_IFNAME=eno1 && \
        timeout 900 python3 -u main.py \
            --scenario Server \
            --model-path meta-llama/Llama-3.1-8B-Instruct \
            --batch-size 2 \
            --dtype float16 \
            --total-sample-count 20 \
            --dataset-path cnn_eval.json \
            --output-log-dir ${results_dir}/performance \
            --tensor-parallel-size 2 \
            --vllm \
            --user-conf user.conf" 2>&1 | tee "${TEST_DIR}/multi_gpu_performance.log"
    
    return $?
}

# Function to test multi-GPU accuracy
test_multi_gpu_accuracy() {
    echo "🎯 Phase 2: Multi-GPU Accuracy + ROUGE Test"
    echo "==========================================="
    
    local results_dir="${TEST_DIR}/multi_gpu_results"
    mkdir -p "${results_dir}/accuracy"
    
    # Run distributed accuracy benchmark
    ssh 129.254.202.252 "cd ${BENCHMARK_DIR} && \
        timeout 1200 python3 -u main.py \
            --scenario Server \
            --model-path meta-llama/Llama-3.1-8B-Instruct \
            --batch-size 2 \
            --dtype float16 \
            --total-sample-count 20 \
            --dataset-path cnn_eval.json \
            --output-log-dir ${results_dir}/accuracy \
            --tensor-parallel-size 2 \
            --accuracy \
            --vllm \
            --user-conf user.conf && \
        python3 evaluation.py \
            --mlperf-accuracy-file ${results_dir}/accuracy/mlperf_log_accuracy.json \
            --dataset-file cnn_eval.json \
            --dtype int32 \
            --total-sample-count 20" 2>&1 | tee "${TEST_DIR}/multi_gpu_accuracy.log"
    
    return $?
}

# Function to cleanup Ray cluster
cleanup_ray_cluster() {
    echo "🧹 Cleaning up Ray cluster..."
    ssh 129.254.202.252 "~/.local/bin/ray stop" 2>/dev/null || true
    ssh 129.254.202.253 "~/.local/bin/ray stop" 2>/dev/null || true
    sleep 5
}

# Main test execution
START_TIME=$(date +%s)

echo "🏁 Starting Multi-GPU Distributed Test"
echo "======================================"

# Pre-flight checks
check_nodes

if ! check_gpu_memory; then
    echo "⏳ Waiting for GPU memory to be available..."
    echo "⏳ This will happen automatically when single-GPU tests complete"
    echo "⏳ Monitor with: watch -n 30 ./monitor_all_tests.sh"
    echo ""
    echo "💡 Alternative: Run this script after single-GPU tests finish"
    exit 1
fi

# Setup distributed environment
if ! setup_ray_cluster; then
    echo "❌ Failed to setup Ray cluster"
    cleanup_ray_cluster
    exit 1
fi

# Run performance test
echo ""
test_multi_gpu_performance
PERF_EXIT=$?

if [ $PERF_EXIT -eq 0 ]; then
    echo "✅ Multi-GPU performance test completed"
    
    # Small delay for memory cleanup
    sleep 15
    
    # Run accuracy test
    echo ""
    test_multi_gpu_accuracy
    ACC_EXIT=$?
else
    echo "❌ Multi-GPU performance test failed"
    ACC_EXIT=1
fi

# Cleanup
cleanup_ray_cluster

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "🏁 Multi-GPU Distributed Test Complete"
echo "====================================="
echo "⏰ Total Duration: ${MINUTES}m ${SECONDS}s"
echo "📊 Performance Status: $([ $PERF_EXIT -eq 0 ] && echo "✅ SUCCESS" || echo "❌ FAILED")"
echo "📊 Accuracy Status: $([ $ACC_EXIT -eq 0 ] && echo "✅ SUCCESS" || echo "❌ FAILED")"

# Generate test report
cat > "${TEST_DIR}/multi_gpu_report.md" << EOF
# MLPerf Multi-GPU Distributed Test Results

**Test Date:** $(date)  
**Duration:** ${MINUTES}m ${SECONDS}s  
**Sample Count:** 20 (validation test)  
**Configuration:** 2x NVIDIA A30 GPUs with tensor parallelism

## Test Results Summary

### Multi-GPU Performance Test
- **Status:** $([ $PERF_EXIT -eq 0 ] && echo "✅ PASSED" || echo "❌ FAILED")
- **Configuration:** tensor_parallel_size=2, distributed_executor_backend=ray
- **Purpose:** Validate distributed inference throughput

### Multi-GPU Accuracy Test  
- **Status:** $([ $ACC_EXIT -eq 0 ] && echo "✅ PASSED" || echo "❌ FAILED")
- **Purpose:** Validate distributed accuracy and ROUGE evaluation
- **Hardware:** jw2 + jw3 A30 GPUs

## Performance Comparison

### Expected Benefits of Multi-GPU Setup
- **Throughput:** ~1.5-1.8x improvement over single GPU
- **Memory:** Distributed model weights across 2x24GB = 48GB total
- **Latency:** Potentially improved due to parallel tensor operations

## Validation Status

$([ $PERF_EXIT -eq 0 ] && [ $ACC_EXIT -eq 0 ] && echo "🎉 **MULTI-GPU VALIDATED**

✅ Distributed inference working
✅ Ray cluster coordination successful  
✅ Performance measurement working
✅ Accuracy evaluation working
✅ ROUGE scoring working

**Multi-GPU Configuration Ready for Full Benchmark**" || echo "⚠️  **MULTI-GPU ISSUES DETECTED**

Some distributed tests failed:
$([ $PERF_EXIT -ne 0 ] && echo "❌ Performance test failed")
$([ $ACC_EXIT -ne 0 ] && echo "❌ Accuracy test failed")

**Recommendation:** Use single-GPU setup for tonight's benchmark")

---
*Multi-GPU test completed at $(date)*
EOF

# Display summary
echo ""
echo "📊 Multi-GPU Test Summary:"
echo "========================="
if [ $PERF_EXIT -eq 0 ] && [ $ACC_EXIT -eq 0 ]; then
    echo "🎉 MULTI-GPU SETUP VALIDATED!"
    echo "✅ Distributed inference: Working"
    echo "✅ Performance measurement: Working"
    echo "✅ Accuracy evaluation: Working"
    echo ""
    echo "🚀 Multi-GPU configuration ready for full benchmark!"
    echo "💡 Expected ~1.5-1.8x throughput improvement vs single GPU"
else
    echo "⚠️  Multi-GPU setup had issues:"
    [ $PERF_EXIT -ne 0 ] && echo "❌ Performance test failed"
    [ $ACC_EXIT -ne 0 ] && echo "❌ Accuracy test failed"
    echo ""
    echo "💡 Recommendation: Use proven single-GPU setup for tonight's run"
fi

echo ""
echo "📁 Test results: ${TEST_DIR}/"
echo "📊 Report: ${TEST_DIR}/multi_gpu_report.md"

exit $((PERF_EXIT + ACC_EXIT))