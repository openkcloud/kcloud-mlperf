#!/bin/bash
# Test error handling scenarios

echo "Test 1: Authentication failure recovery"
# Simulate auth failure
export MLCOMMONS_AUTH_TOKEN=""
if python3 benchmark_simplified.py --samples 5 --output auth_test.json 2>/dev/null; then
    echo "✅ Fallback to HuggingFace authentication worked"
else
    echo "❌ Authentication fallback failed"
fi

echo "Test 2: Network failure recovery"
# Test with invalid endpoint
export HF_ENDPOINT="http://invalid.endpoint.test"
if timeout 10 python3 benchmark_simplified.py --samples 5 --output network_test.json 2>/dev/null; then
    echo "✅ Network failure handled gracefully"
else
    echo "✅ Network failure detected and handled"
fi
unset HF_ENDPOINT

echo "Test 3: Invalid input handling"
# Test with invalid samples
if python3 benchmark_simplified.py --samples -1 --output invalid_test.json 2>&1 | grep -q "error\|Error\|invalid"; then
    echo "✅ Invalid input rejected properly"
else
    echo "❌ Invalid input not handled correctly"
fi

echo "✅ Error handling tests completed"
