#!/usr/bin/env python3
"""
Quick Performance Check - 2 samples each node
Fast verification of driver update impact
"""

import subprocess
import time
from datetime import datetime

def quick_test(node_name, ip):
    """Quick 2-sample test"""
    print(f"🧪 Quick test on {node_name}")
    
    cmd = f"""
    ssh jungwooshim@{ip} 'cd ~/official_mlperf/inference/language/llama3.1-8b && 
    timeout 120 python3 main.py 
    --scenario Server 
    --model-path meta-llama/Llama-3.1-8B-Instruct 
    --total-sample-count 2 
    --dataset-path cnn_eval.json 
    --vllm 
    --tensor-parallel-size 1 
    --dtype bfloat16 
    --output-log-dir {node_name}_quick_check 
    > {node_name}_quick.log 2>&1'
    """
    
    start = time.time()
    result = subprocess.run(cmd, shell=True)
    elapsed = time.time() - start
    
    # Get performance
    perf_cmd = f"""
    ssh jungwooshim@{ip} 'cd ~/official_mlperf/inference/language/llama3.1-8b/{node_name}_quick_check && 
    grep "result_completed_tokens_per_second" mlperf_log_detail.txt 2>/dev/null | 
    tail -1'
    """
    
    perf_result = subprocess.run(perf_cmd, shell=True, capture_output=True, text=True)
    
    tokens_per_sec = "N/A"
    if perf_result.returncode == 0 and perf_result.stdout.strip():
        try:
            import json
            log_line = perf_result.stdout.strip()
            if ":::MLLOG" in log_line:
                json_part = log_line.split(":::MLLOG ")[1]
                data = json.loads(json_part)
                tokens_per_sec = f"{data['value']:.2f}"
        except:
            pass
    
    print(f"  ⏱️  Time: {elapsed:.1f}s")
    print(f"  🚀 Performance: {tokens_per_sec} tokens/sec")
    
    return tokens_per_sec

def main():
    print("⚡ QUICK PERFORMANCE CHECK - Driver 575")
    print("=" * 50)
    print("Testing 2 samples each node for speed")
    print()
    
    nodes = [
        ("jw2", "129.254.202.252"), 
        ("jw3", "129.254.202.253")
    ]
    
    results = {}
    
    for node_name, ip in nodes:
        results[node_name] = quick_test(node_name, ip)
        print()
    
    print("📊 COMPARISON:")
    print(f"  jw2: {results['jw2']} tokens/sec")  
    print(f"  jw3: {results['jw3']} tokens/sec")
    
    if results['jw2'] != "N/A" and results['jw3'] != "N/A":
        try:
            jw2_perf = float(results['jw2'])
            jw3_perf = float(results['jw3'])
            diff = ((jw3_perf - jw2_perf) / jw2_perf) * 100
            print(f"  Difference: {diff:+.1f}%")
            
            if abs(diff) < 10:
                print("  ✅ Performance gap resolved!")
            else:
                print(f"  ⚠️  Still {abs(diff):.1f}% difference")
        except:
            pass

if __name__ == "__main__":
    main()