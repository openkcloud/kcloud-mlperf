#!/usr/bin/env python3
"""
Simple test monitor
"""

import subprocess
import time

def check_test_progress():
    cmd = ["ssh", "jungwooshim@129.254.202.253", 
           "cd ~/official_mlperf/inference/language/llama3.1-8b && tail -3 jw3_test_20_samples.log | grep 'Added request' | tail -1 || echo 'No recent requests'"]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            output = result.stdout.strip()
            if "Added request" in output:
                request_num = output.split("Added request")[1].strip().replace(".", "")
                print(f"🧪 Test Progress: Processing request {request_num}/20")
                return int(request_num) if request_num.isdigit() else 0
            else:
                print("🧪 Test Status: Loading or completing...")
                return 0
    except:
        print("🧪 Test Status: Checking...")
        return 0

if __name__ == "__main__":
    print("🧪 MLPerf Test Monitor (20 samples)")
    print("=" * 40)
    
    while True:
        progress = check_test_progress()
        
        if progress >= 20:
            print("✅ Test completed! All 20 samples processed")
            break
        
        time.sleep(10)