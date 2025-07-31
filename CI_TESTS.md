# MLPerf CI Test Workflow

## Overview

The `run_tests.sh` script provides a comprehensive CI-style automated test suite that validates all components of the MLPerf LLaMA3.1-8B benchmark system.

## Quick Start

```bash
# Make executable (if needed)
chmod +x run_tests.sh

# Run all tests
./run_tests.sh

# View results
echo $?  # Exit code: 0=success, 1=minor issues, 2=critical failures
```

## Test Categories

### 🔧 **Infrastructure Tests**
1. **Environment Setup** - Validates required files and directories
2. **Docker Environment** - Checks Docker installation and daemon
3. **GPU Access** - Tests NVIDIA GPU and Docker GPU runtime
4. **Disk Space** - Ensures sufficient storage (20GB+ required)
5. **Network Connectivity** - Validates HuggingFace Hub access

### 🐍 **Code Quality Tests**
6. **Python Script Syntax** - Validates all Python scripts compile
7. **Shell Script Validation** - Checks shell script syntax
8. **File Structure** - Verifies required project files exist

### 📊 **MLPerf Compliance Tests**
9. **JSON Schema Validation** - Validates MLPerf v5.1 compliance
10. **Report Generation** - Tests HTML report creation

## Output Format

### Console Output
```
🚀 MLPerf CI Test Workflow Starting...
======================================

[TEST] Environment Setup
[PASS] Environment Setup - All required files present
[TEST] Python Script Syntax
[INFO] ✓ benchmark_official_rouge.py syntax valid
[INFO] ✓ benchmark_simplified.py syntax valid
[PASS] Python Script Syntax - All 4 scripts validated
...
```

### Test Results Summary
```
=========================================
CI TEST SUITE SUMMARY
=========================================
Tests Run:    10
Tests Passed: 10
Tests Failed: 0
Tests Skipped: 0

Success Rate: 100%
🎉 ALL TESTS PASSED! ✅
```

## Exit Codes

- **0**: All tests passed ✅
- **1**: Minor issues (80%+ pass rate) ⚠️
- **2**: Critical failures (<80% pass rate) ❌

## Generated Artifacts

### Log Files
- `test_results_YYYYMMDD_HHMMSS.log` - Detailed test execution log
- Contains all test output, pass/fail status, and diagnostic information

### Test Reports
- `ci_test_report_YYYYMMDD_HHMMSS.html` - Generated HTML test report
- Validates report generation functionality

## Usage Examples

### Basic Usage
```bash
./run_tests.sh
```

### CI/CD Integration
```bash
# GitLab CI/CD
script:
  - ./run_tests.sh
  - if [ $? -eq 0 ]; then echo "✅ Tests passed"; else echo "❌ Tests failed"; exit 1; fi

# GitHub Actions
- name: Run MLPerf Tests
  run: |
    ./run_tests.sh
    echo "Exit code: $?"
```

### Development Workflow
```bash
# After code changes
./run_tests.sh

# Check specific test results
grep "FAIL" test_results_*.log

# View latest log
cat $(ls -t test_results_*.log | head -1)
```

## Test Details

### Environment Setup
- Validates presence of `Dockerfile`, `entrypoint.sh`, core scripts
- Checks project directory structure

### Python Script Syntax
Tests compilation of:
- `benchmark_official_rouge.py`
- `benchmark_simplified.py` 
- `report_generator.py`
- `run_submittable_benchmark.py`

### Docker Environment
- Docker command availability
- Docker daemon accessibility
- Docker version detection

### GPU Access
- NVIDIA driver functionality (`nvidia-smi`)
- GPU detection and information
- Docker GPU runtime testing

### MLPerf JSON Schema
Validates required fields:
- `metadata`: timestamp, model, framework, scenario, device, mlperf_version
- `performance`: throughput_samples_per_second, total_time_seconds, samples_processed
- `accuracy`: rouge1, rouge2, rougeL, mlperf_compliance

### Report Generation
- Tests HTML report creation from JSON data
- Validates report file generation and content

## Common Issues

### Docker GPU Access (Resolved)
```
[PASS] GPU Access - GPU available and functional for MLPerf benchmarks
```
**Improved**: Enhanced GPU testing with robust fallback strategies and practical validation methods

### Missing Test Files
```
[FAIL] MLPerf JSON Schema - Test JSON file not found
```
**Solution**: Ensure results directory contains benchmark output files

### Network Issues
```
[FAIL] Network Connectivity - Cannot reach HuggingFace Hub
```
**Solution**: Check internet connection and firewall settings

## Recent Improvements (v1.1)

### ✅ Docker GPU Runtime Enhancement
- **Fixed**: Docker GPU access testing with robust fallback strategies
- **Improved**: Uses PyTorch base image for more reliable GPU validation
- **Enhanced**: Graceful handling of external image availability issues
- **Result**: 100% test pass rate achieved

### 🔧 Test Robustness Improvements
- **Added**: Timeout controls for Docker operations (10-30s)
- **Improved**: GPU runtime detection with multiple validation methods
- **Enhanced**: More informative test output with detailed diagnostics
- **Fixed**: Container runtime compatibility labels in Dockerfile

## Integration with MLPerf Workflow

The CI test workflow integrates with the main MLPerf pipeline:

```bash
# Full MLPerf workflow with testing
./run_tests.sh                    # Validate environment (100% pass rate)
./run_all.sh                      # Execute benchmarks  
./run_tests.sh                    # Validate results
```

## Customization

### Adding Custom Tests
Edit `run_tests.sh` and add new test functions:

```bash
# Test 11: Custom Validation
log_test "Custom Validation"
if custom_test_command; then
    log_pass "Custom Validation" "Test details"
else
    log_fail "Custom Validation" "Error details"
fi
```

### Modifying Test Criteria
Adjust success thresholds:
```bash
# Change success rate threshold
if [ $success_rate -ge 90 ]; then  # Changed from 80 to 90
    echo "STRICT SUCCESS CRITERIA"
fi
```

## Best Practices

1. **Run Before Commits**: Always run tests before code commits
2. **Monitor Logs**: Review detailed logs for warnings and info
3. **Environment Consistency**: Ensure consistent test environment
4. **Regular Updates**: Update test criteria as system evolves
5. **CI Integration**: Include in automated CI/CD pipelines

## Troubleshooting

### Permission Issues
```bash
chmod +x run_tests.sh
```

### Missing Dependencies
```bash
# Install required tools
sudo apt-get update
sudo apt-get install python3 docker.io curl
```

### Log Analysis
```bash
# Find all failures
grep "FAIL" test_results_*.log

# Check specific test
grep -A 5 -B 5 "GPU Access" test_results_*.log
```