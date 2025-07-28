#!/usr/bin/env python3
"""
Simple MLPerf benchmark test for universal compatibility
Tests the benchmark with minimal samples for verification
"""

import os
import sys
import subprocess
import time
from pathlib import Path

def test_benchmark():
    """Run a simple benchmark test"""
    print("🚀 Testing MLPerf Benchmark Framework")
    print("=" * 50)
    
    # Set minimal configuration for quick test
    os.environ['HF_TOKEN'] = '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'
    os.environ['MAX_TOKENS'] = '32'  # Smaller for faster test
    os.environ['SERVER_TARGET_QPS'] = '0.1'  # Very low for testing
    
    # Check GPU availability
    try:
        result = subprocess.run(['nvidia-smi'], capture_output=True, text=True)
        if result.returncode == 0:
            print("✅ GPU detected")
            print(f"GPU Info: {result.stdout.split('|')[1].split('|')[0].strip()}")
        else:
            print("❌ No GPU detected - running CPU-only test")
    except FileNotFoundError:
        print("❌ nvidia-smi not found - running CPU-only test")
    
    # Run benchmark with timeout
    print("\n🔄 Running benchmark test...")
    try:
        cmd = [sys.executable, 'mlperf_datacenter_benchmark.py', '--node', 'test_local']
        process = subprocess.Popen(
            cmd, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE, 
            text=True,
            universal_newlines=True
        )
        
        # Wait for process with timeout
        try:
            stdout, stderr = process.communicate(timeout=300)  # 5 minute timeout
            
            if process.returncode == 0:
                print("✅ Benchmark completed successfully!")
                print("\n📊 Checking results...")
                
                # Check if results were generated
                results_dir = Path("results")
                if results_dir.exists():
                    result_files = list(results_dir.rglob("*.json"))
                    if result_files:
                        print(f"✅ Found {len(result_files)} result files")
                        latest_result = max(result_files, key=lambda x: x.stat().st_mtime)
                        print(f"📄 Latest result: {latest_result}")
                        
                        # Check if reports were generated
                        reports_dir = Path("reports")
                        if reports_dir.exists():
                            report_files = list(reports_dir.rglob("*.md"))
                            if report_files:
                                print(f"✅ Found {len(report_files)} report files")
                            else:
                                print("⚠️  No report files found")
                        else:
                            print("⚠️  Reports directory not found")
                    else:
                        print("❌ No result files found")
                else:
                    print("❌ Results directory not found")
                    
            else:
                print(f"❌ Benchmark failed with return code: {process.returncode}")
                print(f"Error output: {stderr}")
                
        except subprocess.TimeoutExpired:
            print("⏰ Benchmark timed out after 5 minutes")
            process.kill()
            stdout, stderr = process.communicate()
            
    except Exception as e:
        print(f"❌ Error running benchmark: {e}")
    
    print("\n✅ Test completed!")

if __name__ == "__main__":
    test_benchmark()