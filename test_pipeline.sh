#!/bin/bash
set -e

echo "🧪 MLPerf Pipeline Automated Tests"
echo "================================="
echo ""

# Colors for output  
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    print_test "$test_name"
    TESTS_RUN=$((TESTS_RUN + 1))
    
    if eval "$test_command" >/dev/null 2>&1; then
        print_pass "$test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        print_fail "$test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Test 1: Docker availability
test_docker() {
    print_test "Docker Installation"
    
    if command -v docker &> /dev/null; then
        print_pass "Docker command available"
        
        # Test Docker daemon
        if docker info >/dev/null 2>&1; then
            print_pass "Docker daemon running"
            return 0
        else
            print_fail "Docker daemon not accessible"
            return 1
        fi
    else
        print_fail "Docker not installed"
        return 1
    fi
}

# Test 2: GPU access
test_gpu() {
    print_test "GPU Access"
    
    if nvidia-smi >/dev/null 2>&1; then
        print_pass "nvidia-smi available"
        
        # Test Docker GPU access
        if docker run --rm --gpus all nvidia/cuda:12.1-base-ubuntu20.04 nvidia-smi >/dev/null 2>&1; then
            print_pass "Docker GPU access confirmed"
            return 0
        else
            print_fail "Docker GPU access failed"
            return 1
        fi
    else
        print_fail "NVIDIA drivers not available"
        return 1
    fi
}

# Test 3: Environment variables
test_environment() {
    print_test "Environment Variables"
    
    if [ -n "$HF_TOKEN" ]; then
        print_pass "HF_TOKEN provided"
        
        # Test token validity (basic format check)
        if [[ "$HF_TOKEN" =~ ^hf_[a-zA-Z0-9]{34}$ ]]; then
            print_pass "HF_TOKEN format valid"
            return 0
        else
            print_warn "HF_TOKEN format may be invalid"
            return 0  # Non-critical for basic test
        fi
    else
        print_fail "HF_TOKEN not set"
        return 1
    fi
}

# Test 4: File permissions and structure
test_file_structure() {
    print_test "File Structure"
    
    local files_to_check=(
        "Dockerfile"
        "entrypoint.sh"
        "benchmark_official_rouge.py"
        "run_all.sh"
    )
    
    local all_present=true
    
    for file in "${files_to_check[@]}"; do
        if [ -f "$file" ]; then
            print_pass "$file exists"
        else
            print_fail "$file missing"
            all_present=false
        fi
    done
    
    # Check execute permissions
    local exec_files=("entrypoint.sh" "run_all.sh")
    for file in "${exec_files[@]}"; do
        if [ -x "$file" ]; then
            print_pass "$file executable"
        else
            print_warn "$file not executable"
        fi
    done
    
    return $([ "$all_present" = true ] && echo 0 || echo 1)
}

# Test 5: Docker build (dry run)
test_docker_build() {
    print_test "Docker Build Test"
    
    # Check if container already exists
    if docker images mlperf-llama3 --format "{{.Repository}}" | grep -q "mlperf-llama3"; then
        print_pass "Container already built"
        return 0
    fi
    
    print_test "Testing Docker build syntax..."
    
    # Dockerfile syntax validation
    if docker build --dry-run -t mlperf-llama3-test . >/dev/null 2>&1; then
        print_pass "Dockerfile syntax valid"
        return 0
    else
        print_fail "Dockerfile has syntax errors"
        return 1
    fi
}

# Test 6: Python script syntax
test_python_syntax() {
    print_test "Python Script Syntax"
    
    local python_files=(
        "benchmark_official_rouge.py"
        "benchmark_simplified.py"
        "report_generator.py"
        "run_submittable_benchmark.py"
    )
    
    local all_valid=true
    
    for file in "${python_files[@]}"; do
        if [ -f "$file" ]; then
            if python3 -m py_compile "$file" 2>/dev/null; then
                print_pass "$file syntax valid"
            else
                print_fail "$file has syntax errors"
                all_valid=false
            fi
        else
            print_warn "$file not found"
        fi
    done
    
    return $([ "$all_valid" = true ] && echo 0 || echo 1)
}

# Test 7: Directory structure
test_directories() {
    print_test "Directory Structure"
    
    local dirs=("results" ".cache")
    local all_created=true
    
    for dir in "${dirs[@]}"; do
        if mkdir -p "$dir" 2>/dev/null; then
            print_pass "$dir directory ready"
        else
            print_fail "Cannot create $dir directory"
            all_created=false
        fi
    done
    
    return $([ "$all_created" = true ] && echo 0 || echo 1)
}

# Test 8: Disk space
test_disk_space() {
    print_test "Disk Space"
    
    # Check available space (need ~50GB for full benchmark)
    local available_gb=$(df . | awk 'NR==2 {printf "%.0f", $4/1024/1024}')
    
    if [ "$available_gb" -gt 50 ]; then
        print_pass "Sufficient disk space (${available_gb}GB available)"
        return 0
    elif [ "$available_gb" -gt 20 ]; then
        print_warn "Limited disk space (${available_gb}GB available, 50GB+ recommended)"
        return 0
    else
        print_fail "Insufficient disk space (${available_gb}GB available, 50GB+ required)"
        return 1
    fi
}

# Test 9: Network connectivity
test_network() {
    print_test "Network Connectivity"
    
    # Test HuggingFace Hub connectivity
    if curl -s --max-time 10 https://huggingface.co >/dev/null; then
        print_pass "HuggingFace Hub accessible"
        return 0
    else
        print_fail "Cannot reach HuggingFace Hub"
        return 1
    fi
}

# Test 10: Quick container functionality
test_container_quick() {
    print_test "Container Quick Test"
    
    # Build minimal test if needed
    if ! docker images mlperf-llama3 --format "{{.Repository}}" | grep -q "mlperf-llama3"; then
        print_test "Building container for testing..."
        if docker build -t mlperf-llama3 . >/dev/null 2>&1; then
            print_pass "Container built successfully"
        else
            print_fail "Container build failed"
            return 1
        fi
    fi
    
    # Test basic container functionality
    if docker run --rm mlperf-llama3 help >/dev/null 2>&1; then
        print_pass "Container help command works"
        return 0
    else
        print_fail "Container basic functionality failed"
        return 1
    fi
}

# Run all tests
main() {
    echo "Starting comprehensive pipeline tests..."
    echo ""
    
    # Run tests
    test_docker
    test_gpu  
    test_environment
    test_file_structure
    test_directories
    test_disk_space
    test_network
    test_python_syntax
    test_docker_build
    
    # Skip container test if no HF_TOKEN
    if [ -n "$HF_TOKEN" ]; then
        test_container_quick
    else
        print_warn "Skipping container test (no HF_TOKEN)"
    fi
    
    # Summary
    echo ""
    echo "========================================="
    echo "TEST SUMMARY"
    echo "========================================="
    echo "Tests Run:    $TESTS_RUN"
    echo "Tests Passed: $TESTS_PASSED"
    echo "Tests Failed: $TESTS_FAILED"
    echo ""
    
    if [ $TESTS_FAILED -eq 0 ]; then
        print_pass "ALL TESTS PASSED! ✅"
        echo ""
        echo "Your MLPerf pipeline is ready to run:"
        echo "  HF_TOKEN=your_token ./run_all.sh"
        echo ""
        return 0
    else
        print_fail "SOME TESTS FAILED! ❌"
        echo ""
        echo "Please fix the failed tests before running the pipeline."
        echo ""
        return 1
    fi
}

# Handle arguments
case "${1:-test}" in
    "test"|"")
        main
        ;;
    "help"|"--help"|"-h")
        echo "Usage: $0 [test]"
        echo ""
        echo "Runs comprehensive tests to validate MLPerf pipeline setup."
        echo ""
        echo "Tests performed:"
        echo "  - Docker installation and GPU access"
        echo "  - Environment variables (HF_TOKEN)"
        echo "  - File structure and permissions"
        echo "  - Python script syntax"
        echo "  - Disk space and network connectivity"
        echo "  - Container build and basic functionality"
        echo ""
        ;;
    *)
        echo "Unknown command: $1"
        echo "Use '$0 help' for usage information."
        exit 1
        ;;
esac