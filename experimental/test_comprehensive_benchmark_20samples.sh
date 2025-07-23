#!/bin/bash

# Test Comprehensive MLPerf Benchmark with 20 Samples
# Quick validation of performance + accuracy + ROUGE evaluation

set -e

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
TEST_DIR="/home/jungwooshim/results/test_comprehensive_${TIMESTAMP}"
BENCHMARK_DIR="/home/jungwooshim/official_mlperf/inference/language/llama3.1-8b"

echo "🧪 Testing Comprehensive MLPerf Benchmark (20 samples)"
echo "====================================================="
echo "Timestamp: $(date)"
echo "Test Directory: ${TEST_DIR}"
echo "Expected Duration: ~20-30 minutes"
echo "Purpose: Validate performance + accuracy + ROUGE pipeline"
echo ""

mkdir -p "${TEST_DIR}"
cd "${TEST_DIR}"

# Create test log
exec > >(tee -a "test_run_${TIMESTAMP}.log") 2>&1

echo "📊 Test Configuration:"
echo "- Sample Count: 20 (quick test)"
echo "- Performance Test: Server scenario throughput"
echo "- Accuracy Test: ROUGE evaluation"
echo "- Hardware: Single A30 GPU (jw2)"
echo ""

# Test on jw2 only for faster validation
NODE="jw2"
NODE_IP="129.254.202.252"
RESULTS_DIR="${TEST_DIR}/jw2_test_results"

echo "🎯 Starting comprehensive test on ${NODE}"
mkdir -p "${RESULTS_DIR}/performance"
mkdir -p "${RESULTS_DIR}/accuracy"

START_TIME=$(date +%s)

echo ""
echo "🚀 Phase 1: Performance Benchmark (20 samples)"
echo "=============================================="

ssh ${NODE_IP} "cd ${BENCHMARK_DIR} && \
    timeout 600 python3 -u main.py \
        --scenario Server \
        --model-path meta-llama/Llama-3.1-8B-Instruct \
        --batch-size 1 \
        --dtype float16 \
        --total-sample-count 20 \
        --dataset-path cnn_eval.json \
        --output-log-dir ${RESULTS_DIR}/performance \
        --tensor-parallel-size 1 \
        --vllm \
        --user-conf user.conf" 2>&1 | tee "${TEST_DIR}/performance_test.log"

PERF_EXIT=$?

if [ $PERF_EXIT -eq 0 ]; then
    echo "✅ Performance test completed successfully"
else
    echo "⚠️  Performance test failed or timed out (exit: $PERF_EXIT)"
fi

# Small delay to ensure GPU memory is cleared
echo "⏳ Clearing GPU memory..."
sleep 15

echo ""
echo "🎯 Phase 2: Accuracy Benchmark with ROUGE (20 samples)"
echo "====================================================="

ssh ${NODE_IP} "cd ${BENCHMARK_DIR} && \
    timeout 900 python3 -u main.py \
        --scenario Server \
        --model-path meta-llama/Llama-3.1-8B-Instruct \
        --batch-size 1 \
        --dtype float16 \
        --total-sample-count 20 \
        --dataset-path cnn_eval.json \
        --output-log-dir ${RESULTS_DIR}/accuracy \
        --tensor-parallel-size 1 \
        --accuracy \
        --vllm \
        --user-conf user.conf" 2>&1 | tee "${TEST_DIR}/accuracy_test.log"

ACC_EXIT=$?

if [ $ACC_EXIT -eq 0 ]; then
    echo "✅ Accuracy test completed successfully"
    
    echo ""
    echo "📊 Phase 3: ROUGE Score Calculation"
    echo "=================================="
    
    ssh ${NODE_IP} "cd ${BENCHMARK_DIR} && \
        python3 evaluation.py \
            --mlperf-accuracy-file ${RESULTS_DIR}/accuracy/mlperf_log_accuracy.json \
            --dataset-file cnn_eval.json \
            --dtype int32 \
            --total-sample-count 20" 2>&1 | tee "${TEST_DIR}/rouge_test.log"
    
    ROUGE_EXIT=$?
    if [ $ROUGE_EXIT -eq 0 ]; then
        echo "✅ ROUGE evaluation completed successfully"
    else
        echo "❌ ROUGE evaluation failed"
    fi
else
    echo "⚠️  Accuracy test failed or timed out (exit: $ACC_EXIT)"
    ROUGE_EXIT=1
fi

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "🏁 Test Comprehensive Benchmark Complete"
echo "========================================"
echo "⏰ Total Duration: ${MINUTES}m ${SECONDS}s"
echo "📊 Performance Status: $([ $PERF_EXIT -eq 0 ] && echo "✅ SUCCESS" || echo "❌ FAILED")"
echo "📊 Accuracy Status: $([ $ACC_EXIT -eq 0 ] && echo "✅ SUCCESS" || echo "❌ FAILED")"
echo "📊 ROUGE Status: $([ $ROUGE_EXIT -eq 0 ] && echo "✅ SUCCESS" || echo "❌ FAILED")"

# Copy results back
echo ""
echo "📁 Collecting test results..."
scp -r ${NODE_IP}:${RESULTS_DIR}/* "${TEST_DIR}/collected_results/" 2>/dev/null || true

# Generate test report
echo ""
echo "📋 Generating Test Report..."

cat > "${TEST_DIR}/test_report.md" << EOF
# MLPerf Comprehensive Benchmark Test Results

**Test Date:** $(date)  
**Duration:** ${MINUTES}m ${SECONDS}s  
**Sample Count:** 20 (validation test)  
**Node:** ${NODE} (${NODE_IP})

## Test Results Summary

### Phase 1: Performance Benchmark
- **Status:** $([ $PERF_EXIT -eq 0 ] && echo "✅ PASSED" || echo "❌ FAILED")
- **Purpose:** Validate throughput and latency measurement
- **Log:** \`performance_test.log\`

### Phase 2: Accuracy Benchmark  
- **Status:** $([ $ACC_EXIT -eq 0 ] && echo "✅ PASSED" || echo "❌ FAILED")
- **Purpose:** Generate summaries for ROUGE evaluation
- **Log:** \`accuracy_test.log\`

### Phase 3: ROUGE Evaluation
- **Status:** $([ $ROUGE_EXIT -eq 0 ] && echo "✅ PASSED" || echo "❌ FAILED")
- **Purpose:** Calculate ROUGE-1, ROUGE-2, ROUGE-L scores
- **Log:** \`rouge_test.log\`

## Performance Metrics Preview
EOF

# Extract key performance metrics if available
if [ -f "${TEST_DIR}/performance_test.log" ]; then
    echo "```" >> "${TEST_DIR}/test_report.md"
    echo "Performance Highlights:" >> "${TEST_DIR}/test_report.md"
    grep -E "(Avg prompt throughput|Avg generation throughput)" "${TEST_DIR}/performance_test.log" | tail -5 >> "${TEST_DIR}/test_report.md" 2>/dev/null || echo "Performance metrics collection in progress..." >> "${TEST_DIR}/test_report.md"
    echo "```" >> "${TEST_DIR}/test_report.md"
fi

cat >> "${TEST_DIR}/test_report.md" << EOF

## ROUGE Scores (20 samples)
EOF

# Extract ROUGE scores if available
if [ -f "${TEST_DIR}/rouge_test.log" ]; then
    echo "```" >> "${TEST_DIR}/test_report.md"
    grep -E -A10 -B5 "(rouge|ROUGE)" "${TEST_DIR}/rouge_test.log" >> "${TEST_DIR}/test_report.md" 2>/dev/null || echo "ROUGE scores calculation in progress..." >> "${TEST_DIR}/test_report.md"
    echo "```" >> "${TEST_DIR}/test_report.md"
else
    echo "⏳ ROUGE evaluation not completed" >> "${TEST_DIR}/test_report.md"
fi

cat >> "${TEST_DIR}/test_report.md" << EOF

## Validation Status

### ✅ Pipeline Validation
$([ $PERF_EXIT -eq 0 ] && [ $ACC_EXIT -eq 0 ] && [ $ROUGE_EXIT -eq 0 ] && echo "🎉 **ALL TESTS PASSED** - Ready for full 13,368 sample run" || echo "⚠️  Some tests failed - Review logs before full run")

### Files Generated
- \`test_report.md\` - This summary
- \`performance_test.log\` - Performance benchmark output
- \`accuracy_test.log\` - Accuracy benchmark output  
- \`rouge_test.log\` - ROUGE evaluation output
- \`collected_results/\` - MLPerf result files

### Next Steps
$([ $PERF_EXIT -eq 0 ] && [ $ACC_EXIT -eq 0 ] && [ $ROUGE_EXIT -eq 0 ] && echo "✅ System validated - Tonight's 7pm full benchmark will execute successfully" || echo "❌ Fix issues before running full benchmark")

---
*Test completed at $(date)*
EOF

# Display summary
echo ""
echo "📊 Test Summary:"
echo "==============="
if [ $PERF_EXIT -eq 0 ] && [ $ACC_EXIT -eq 0 ] && [ $ROUGE_EXIT -eq 0 ]; then
    echo "🎉 ALL TESTS PASSED!"
    echo "✅ Performance measurement: Working"
    echo "✅ Accuracy evaluation: Working"  
    echo "✅ ROUGE scoring: Working"
    echo ""
    echo "🚀 System ready for tonight's full 13,368 sample benchmark!"
else
    echo "⚠️  Some tests failed:"
    [ $PERF_EXIT -ne 0 ] && echo "❌ Performance test failed"
    [ $ACC_EXIT -ne 0 ] && echo "❌ Accuracy test failed"
    [ $ROUGE_EXIT -ne 0 ] && echo "❌ ROUGE evaluation failed"
    echo ""
    echo "🔧 Review logs before running full benchmark"
fi

echo ""
echo "📁 Test results: ${TEST_DIR}/"
echo "📊 Report: ${TEST_DIR}/test_report.md"

exit $((PERF_EXIT + ACC_EXIT + ROUGE_EXIT))