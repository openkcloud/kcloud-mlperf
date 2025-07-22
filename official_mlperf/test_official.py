#!/usr/bin/env python3
"""
Test script to verify official MLPerf implementation works
Uses a small dataset subset to validate setup
"""
import os
import subprocess
import sys

def test_official_implementation():
    """Test the official MLPerf implementation with minimal samples"""
    
    print("🔍 Testing Official MLPerf Implementation")
    print("=" * 50)
    
    # Check if dataset exists
    dataset_path = "/home/jungwooshim/official_mlperf/cnn_eval.json"
    if not os.path.exists(dataset_path):
        print(f"❌ Dataset not found at {dataset_path}")
        return False
    
    print(f"✅ Dataset found: {dataset_path}")
    
    # Set environment variables
    os.environ['HF_TOKEN'] = os.getenv('HF_TOKEN', '')
    
    # Test command - using meta-llama model path directly with minimal samples
    cmd = [
        "python3", "-u", "main.py",
        "--scenario", "Offline",
        "--model-path", "meta-llama/Llama-3.1-8B-Instruct",
        "--batch-size", "1",
        "--dtype", "float16",
        "--user-conf", "user.conf",
        "--total-sample-count", "5",  # Only test 5 samples
        "--dataset-path", dataset_path,
        "--output-log-dir", "test_output",
        "--vllm"
    ]
    
    print(f"Running command: {' '.join(cmd)}")
    print("-" * 50)
    
    try:
        result = subprocess.run(cmd, cwd="/home/jungwooshim/official_mlperf", 
                              capture_output=True, text=True, timeout=600)
        
        print("STDOUT:")
        print(result.stdout)
        print("\nSTDERR:")
        print(result.stderr)
        print(f"\nReturn code: {result.returncode}")
        
        if result.returncode == 0:
            print("✅ Official implementation test PASSED")
            return True
        else:
            print("❌ Official implementation test FAILED")
            return False
            
    except subprocess.TimeoutExpired:
        print("❌ Test timed out after 10 minutes")
        return False
    except Exception as e:
        print(f"❌ Test failed with exception: {e}")
        return False

if __name__ == "__main__":
    success = test_official_implementation()
    sys.exit(0 if success else 1)