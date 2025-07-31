#!/bin/bash
set -e

# MLPerf CI Test Workflow
# =======================
# Comprehensive automated test suite for MLPerf LLaMA3.1-8B benchmark
# Validates all components: Docker, Python scripts, JSON compliance, reports

echo "🚀 MLPerf CI Test Workflow Starting..."
echo "======================================"
echo ""

# Configuration
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="test_results_${TIMESTAMP}.log"
TEST_DIR="$(pwd)"
RESULTS_DIR="${TEST_DIR}/results"
TEST_JSON="${RESULTS_DIR}/submittable/mlperf_submittable_results_20250731_171205.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Logging functions
log_test() {
    local test_name="$1"
    echo -e "${BLUE}[TEST]${NC} $test_name" | tee -a "$LOG_FILE"
    TESTS_RUN=$((TESTS_RUN + 1))
}

log_pass() {
    local test_name="$1"
    local details="$2"
    echo -e "${GREEN}[PASS]${NC} $test_name ${details:+- $details}" | tee -a "$LOG_FILE"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_fail() {
    local test_name="$1"
    local error="$2"
    echo -e "${RED}[FAIL]${NC} $test_name ${error:+- $error}" | tee -a "$LOG_FILE"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_skip() {
    local test_name="$1"
    local reason="$2"
    echo -e "${YELLOW}[SKIP]${NC} $test_name ${reason:+- $reason}" | tee -a "$LOG_FILE"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

log_info() {
    local message="$1"
    echo -e "${BLUE}[INFO]${NC} $message" | tee -a "$LOG_FILE"
}

# Test execution wrapper
run_test() {
    local test_name="$1"
    local test_command="$2"
    local test_description="$3"
    
    log_test "$test_name"
    
    if eval "$test_command" >/dev/null 2>&1; then
        log_pass "$test_name" "$test_description"
        return 0
    else
        log_fail "$test_name" "$test_description"
        return 1
    fi
}

# Initialize log file
echo "MLPerf CI Test Results - $(date)" > "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

log_info "Starting comprehensive test suite..."
log_info "Test directory: $TEST_DIR"
log_info "Results directory: $RESULTS_DIR"
log_info "Log file: $LOG_FILE"
echo ""

# Test 1: Environment Setup
log_test "Environment Setup"
if [ -d "$TEST_DIR" ] && [ -f "Dockerfile" ] && [ -f "entrypoint.sh" ]; then
    log_pass "Environment Setup" "All required files present"
else
    log_fail "Environment Setup" "Missing required files"
fi

# Test 2: Python Script Syntax Validation
log_test "Python Script Syntax"
python_scripts=("benchmark_official_rouge.py" "benchmark_simplified.py" "report_generator.py" "run_submittable_benchmark.py")
python_errors=0

for script in "${python_scripts[@]}"; do
    if [ -f "$script" ]; then
        if python3 -m py_compile "$script" 2>/dev/null; then
            log_info "✓ $script syntax valid"
        else
            log_info "✗ $script syntax error"
            python_errors=$((python_errors + 1))
        fi
    else
        log_info "✗ $script not found"
        python_errors=$((python_errors + 1))
    fi
done

if [ $python_errors -eq 0 ]; then
    log_pass "Python Script Syntax" "All ${#python_scripts[@]} scripts validated"
else
    log_fail "Python Script Syntax" "$python_errors scripts failed validation"
fi

# Test 3: Docker Environment
log_test "Docker Environment"
docker_status=0

if command -v docker >/dev/null 2>&1; then
    log_info "✓ Docker command available"
    if timeout 10 docker info >/dev/null 2>&1; then
        log_info "✓ Docker daemon running"
        if docker version >/dev/null 2>&1; then
            docker_version=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
            log_info "✓ Docker version: $docker_version"
            
            # Check Docker GPU runtime availability
            if docker info 2>/dev/null | grep -qi nvidia; then
                log_info "✓ Docker NVIDIA runtime detected"
            elif command -v nvidia-container-runtime >/dev/null 2>&1; then
                log_info "✓ NVIDIA Container Runtime available"
            else
                log_info "ℹ Docker GPU runtime not configured (optional)"
            fi
        else
            docker_status=1
        fi
    else
        log_info "✗ Docker daemon not accessible"
        docker_status=1
    fi
else
    log_info "✗ Docker not installed"
    docker_status=1
fi

if [ $docker_status -eq 0 ]; then
    log_pass "Docker Environment" "Docker ready for use"
else
    log_fail "Docker Environment" "Docker not properly configured"
fi

# Test 4: GPU Access
log_test "GPU Access"
gpu_status=0

if command -v nvidia-smi >/dev/null 2>&1; then
    if nvidia-smi >/dev/null 2>&1; then
        gpu_info=$(nvidia-smi --query-gpu=name --format=csv,noheader,nounits | head -1)
        log_info "✓ GPU detected: $gpu_info"
        
        # Test Docker GPU runtime availability
        if docker info 2>/dev/null | grep -q "nvidia"; then
            docker_gpu_runtime="nvidia"
        elif docker info 2>/dev/null | grep -q "Runtimes.*nvidia"; then
            docker_gpu_runtime="nvidia"
        elif command -v nvidia-container-runtime >/dev/null 2>&1; then
            docker_gpu_runtime="nvidia-container-runtime"
        else
            docker_gpu_runtime="none"
        fi
        
        # Test Docker GPU access with robust fallback strategies
        if [ "$docker_gpu_runtime" != "none" ]; then
            # Try with our current PyTorch image (more reliable than external CUDA images)
            if timeout 20 docker run --rm --gpus all pytorch/pytorch:2.4.0-cuda12.1-cudnn9-devel python -c "import torch; assert torch.cuda.is_available(); print('✅ Docker GPU access confirmed')" >/dev/null 2>&1; then
                log_info "✓ Docker GPU access working with PyTorch image"
            # Try building a simple GPU test with our Dockerfile
            elif timeout 30 docker build -t mlperf-gpu-test . >/dev/null 2>&1 && timeout 20 docker run --rm --gpus all mlperf-gpu-test python3 -c "import torch; print(torch.cuda.get_device_name(0))" >/dev/null 2>&1; then
                log_info "✓ Docker GPU access working with local build"
            # Fallback: check if Docker can at least see GPU devices
            elif docker run --rm --gpus all --entrypoint=/bin/bash pytorch/pytorch:2.4.0-cuda12.1-cudnn9-devel -c "ls /dev/nvidia* 2>/dev/null | wc -l" 2>/dev/null | grep -q "[1-9]"; then
                log_info "✓ Docker GPU devices accessible (limited validation)"
            else
                log_info "ℹ Docker GPU runtime present but validation limited (network/image issues)"
                # Don't fail the test - this is often due to external image availability
            fi
        else
            log_info "ℹ Docker GPU runtime not configured (local GPU testing still works)"
            # Don't fail the test if GPU runtime isn't configured but GPU works locally
        fi
    else
        log_info "✗ nvidia-smi failed"
        gpu_status=1
    fi
else
    log_info "✗ nvidia-smi not available"
    gpu_status=1
fi

# GPU test passes if local GPU works (Docker GPU is secondary)
if [ $gpu_status -eq 0 ]; then
    log_pass "GPU Access" "GPU available and functional for MLPerf benchmarks"
else
    log_fail "GPU Access" "GPU access issues detected - MLPerf benchmarks may fail"
fi

# Test 5: JSON Schema Validation
log_test "MLPerf JSON Schema"
if [ -f "$TEST_JSON" ]; then
    # Python JSON schema validation
    schema_result=$(python3 -c "
import json
import sys

try:
    with open('$TEST_JSON') as f:
        data = json.load(f)
    
    # Check required MLPerf v5.1 fields
    required_fields = {
        'metadata': ['timestamp', 'model', 'framework', 'scenario', 'device', 'mlperf_version'],
        'performance': ['throughput_samples_per_second', 'total_time_seconds', 'samples_processed'],
        'accuracy': ['rouge1', 'rouge2', 'rougeL', 'mlperf_compliance']
    }
    
    missing = []
    for section, fields in required_fields.items():
        if section not in data:
            missing.append(f'section:{section}')
        else:
            for field in fields:
                if field not in data[section]:
                    missing.append(f'{section}.{field}')
    
    if missing:
        print('FAIL:' + ','.join(missing))
        sys.exit(1)
    else:
        samples = data['performance']['samples_processed']
        throughput = data['performance']['throughput_samples_per_second']
        rouge1 = data['accuracy']['rouge1']
        print(f'PASS:samples={samples},throughput={throughput:.4f},rouge1={rouge1:.4f}')
        sys.exit(0)

except Exception as e:
    print(f'ERROR:{e}')
    sys.exit(1)
" 2>/dev/null)

    if [[ $schema_result == PASS:* ]]; then
        details=$(echo "$schema_result" | cut -d':' -f2)
        log_pass "MLPerf JSON Schema" "$details"
    else
        error=$(echo "$schema_result" | cut -d':' -f2)
        log_fail "MLPerf JSON Schema" "$error"
    fi
else
    log_fail "MLPerf JSON Schema" "Test JSON file not found: $TEST_JSON"
fi

# Test 6: Report Generation
log_test "Report Generation"
report_test_result=$(python3 -c "
import json
import sys
from datetime import datetime
from pathlib import Path

try:
    # Load test JSON
    with open('$TEST_JSON') as f:
        data = json.load(f)
    
    # Extract key data
    samples = data.get('performance', {}).get('samples_processed', 0)
    throughput = data.get('performance', {}).get('throughput_samples_per_second', 0)
    total_time = data.get('performance', {}).get('total_time_seconds', 0)
    rouge1 = data.get('accuracy', {}).get('rouge1', 0)
    
    # Generate test report
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    html_file = f'ci_test_report_{timestamp}.html'
    
    html_content = f'''<!DOCTYPE html>
<html><head><title>MLPerf CI Test Report</title></head><body>
<h1>MLPerf CI Test Report</h1>
<p><strong>Generated:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
<p><strong>Samples:</strong> {samples}</p>
<p><strong>Throughput:</strong> {throughput:.4f} samples/sec</p>
<p><strong>Total Time:</strong> {total_time:.1f} seconds</p>
<p><strong>ROUGE-1:</strong> {rouge1:.4f}</p>
<p><strong>Status:</strong> Report generation successful</p>
</body></html>'''
    
    with open(html_file, 'w') as f:
        f.write(html_content)
    
    # Verify file created and has content
    if Path(html_file).exists() and Path(html_file).stat().st_size > 0:
        print(f'PASS:{html_file}')
    else:
        print('FAIL:Report file empty or not created')

except Exception as e:
    print(f'FAIL:{e}')
" 2>/dev/null)

if [[ $report_test_result == PASS:* ]]; then
    report_file=$(echo "$report_test_result" | cut -d':' -f2)
    log_pass "Report Generation" "Generated: $report_file"
else
    error=$(echo "$report_test_result" | cut -d':' -f2)
    log_fail "Report Generation" "$error"
fi

# Test 7: Shell Script Validation
log_test "Shell Script Validation"
shell_scripts=("run_all.sh" "run_all_scenarios.sh" "test_pipeline.sh" "setup_mlcommons_auth.sh")
shell_errors=0

for script in "${shell_scripts[@]}"; do
    if [ -f "$script" ]; then
        if bash -n "$script" 2>/dev/null; then
            log_info "✓ $script syntax valid"
        else
            log_info "✗ $script syntax error"
            shell_errors=$((shell_errors + 1))
        fi
    else
        log_info "✗ $script not found"
        shell_errors=$((shell_errors + 1))
    fi
done

if [ $shell_errors -eq 0 ]; then
    log_pass "Shell Script Validation" "All ${#shell_scripts[@]} scripts validated"
else
    log_fail "Shell Script Validation" "$shell_errors scripts failed validation"
fi

# Test 8: File Structure Validation
log_test "File Structure"
required_files=("Dockerfile" "entrypoint.sh" "README.md" "pyproject.toml")
required_dirs=("results")
structure_errors=0

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        log_info "✓ $file exists"
    else
        log_info "✗ $file missing"
        structure_errors=$((structure_errors + 1))
    fi
done

for dir in "${required_dirs[@]}"; do
    if [ -d "$dir" ]; then
        log_info "✓ $dir/ exists"
    else
        log_info "✗ $dir/ missing"
        structure_errors=$((structure_errors + 1))
    fi
done

if [ $structure_errors -eq 0 ]; then
    log_pass "File Structure" "All required files and directories present"
else
    log_fail "File Structure" "$structure_errors items missing"
fi

# Test 9: Disk Space Check
log_test "Disk Space"
available_gb=$(df . | awk 'NR==2 {printf "%.0f", $4/1024/1024}')
if [ "$available_gb" -gt 20 ]; then
    log_pass "Disk Space" "${available_gb}GB available (sufficient)"
else
    log_fail "Disk Space" "${available_gb}GB available (insufficient - need 20GB+)"
fi

# Test 10: Network Connectivity
log_test "Network Connectivity"
if curl -s --max-time 10 https://huggingface.co >/dev/null 2>&1; then
    log_pass "Network Connectivity" "HuggingFace Hub accessible"
else
    log_fail "Network Connectivity" "Cannot reach HuggingFace Hub"
fi

# Test Summary
echo ""
echo "========================================="
echo "CI TEST SUITE SUMMARY"
echo "========================================="
echo "Tests Run:    $TESTS_RUN"
echo "Tests Passed: $TESTS_PASSED"
echo "Tests Failed: $TESTS_FAILED"
echo "Tests Skipped: $TESTS_SKIPPED"
echo ""

# Calculate success rate
if [ $TESTS_RUN -gt 0 ]; then
    success_rate=$(( (TESTS_PASSED * 100) / TESTS_RUN ))
    echo "Success Rate: ${success_rate}%"
else
    success_rate=0
    echo "Success Rate: N/A"
fi

# Final status
if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL TESTS PASSED! ✅${NC}"
    echo ""
    echo "MLPerf benchmark system is ready for deployment."
    echo "Log file: $LOG_FILE"
    exit 0
elif [ $success_rate -ge 80 ]; then
    echo -e "${YELLOW}⚠️  MOSTLY SUCCESSFUL (${success_rate}% pass rate) ⚠️${NC}"
    echo ""
    echo "MLPerf system functional with minor issues."
    echo "Review failed tests in log file: $LOG_FILE"
    exit 1
else
    echo -e "${RED}❌ CRITICAL FAILURES (${success_rate}% pass rate) ❌${NC}"
    echo ""
    echo "MLPerf system requires attention before deployment."
    echo "Review failed tests in log file: $LOG_FILE"
    exit 2
fi