#!/usr/bin/env python3
"""
Controlled Performance Test to isolate performance differences
Tests identical workloads on both nodes with detailed monitoring
"""

import subprocess
import time
import json
from datetime import datetime
from pathlib import Path

def run_controlled_test(node_name, node_ip, test_id):
    """Run controlled test on a single node"""
    print(f"🧪 Running controlled test on {node_name}")
    
    # Create results directory
    results_dir = f"{node_name}_controlled_test_{test_id}"
    
    # Test parameters - identical for both nodes
    test_cmd = [
        "ssh", f"jungwooshim@{node_ip}",
        f"cd ~/official_mlperf/inference/language/llama3.1-8b && "
        f"python3 main.py "
        f"--scenario Server "
        f"--model-path meta-llama/Llama-3.1-8B-Instruct "
        f"--total-sample-count 5 "  # Very small for controlled test
        f"--dataset-path cnn_eval.json "
        f"--vllm "
        f"--tensor-parallel-size 1 "
        f"--dtype bfloat16 "
        f"--output-log-dir {results_dir} "
        f"> {node_name}_controlled_{test_id}.log 2>&1"
    ]
    
    print(f"📝 Command: {' '.join(test_cmd[2:])}")
    
    start_time = time.time()
    
    try:
        result = subprocess.run(test_cmd, timeout=300)  # 5 minute timeout
        elapsed = time.time() - start_time
        
        if result.returncode == 0:
            print(f"✅ {node_name} controlled test - SUCCESS ({elapsed:.1f}s)")
            return True, elapsed
        else:
            print(f"❌ {node_name} controlled test - FAILED ({elapsed:.1f}s)")
            return False, elapsed
            
    except subprocess.TimeoutExpired:
        print(f"⏰ {node_name} controlled test - TIMEOUT")
        return False, 300
    except Exception as e:
        print(f"❌ {node_name} controlled test - ERROR: {e}")
        return False, 0

def extract_performance_metrics(node_name, node_ip, test_id):
    """Extract performance metrics from completed test"""
    results_dir = f"{node_name}_controlled_test_{test_id}"
    
    try:
        # Get detailed results
        cmd = f"ssh jungwooshim@{node_ip} 'cd ~/official_mlperf/inference/language/llama3.1-8b/{results_dir} && grep \"result_completed_tokens_per_second\" mlperf_log_detail.txt'"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        
        if result.returncode == 0:
            # Parse JSON result
            line = result.stdout.strip()
            if line:
                import json
                log_entry = json.loads(line.split(':::MLLOG ')[1])
                tokens_per_sec = log_entry['value']
                
                # Get system info during test
                sys_cmd = f"ssh jungwooshim@{node_ip} 'nvidia-smi --query-gpu=temperature.gpu,power.draw,utilization.gpu --format=csv,noheader,nounits'"
                sys_result = subprocess.run(sys_cmd, shell=True, capture_output=True, text=True)
                
                temp, power, util = sys_result.stdout.strip().split(', ')
                
                return {
                    "tokens_per_second": float(tokens_per_sec),
                    "temperature": float(temp),
                    "power_draw": float(power),
                    "gpu_utilization": float(util)
                }
        
        return None
        
    except Exception as e:
        print(f"❌ Failed to extract metrics for {node_name}: {e}")
        return None

def main():
    print("🔬 CONTROLLED PERFORMANCE TEST")
    print("=" * 50)
    print("Testing identical workloads on both nodes")
    print("Purpose: Isolate hardware/software performance differences")
    print()
    
    test_id = datetime.now().strftime("%H%M%S")
    
    nodes = [
        ("jw2", "129.254.202.252"),
        ("jw3", "129.254.202.253")
    ]
    
    results = {}
    
    # Run tests sequentially for fair comparison
    for node_name, node_ip in nodes:
        print(f"\n{'='*20} {node_name.upper()} TEST {'='*20}")
        
        success, elapsed = run_controlled_test(node_name, node_ip, test_id)
        
        if success:
            # Extract performance metrics
            metrics = extract_performance_metrics(node_name, node_ip, test_id)
            
            results[node_name] = {
                "success": True,
                "elapsed_time": elapsed,
                "metrics": metrics
            }
        else:
            results[node_name] = {
                "success": False,
                "elapsed_time": elapsed,
                "metrics": None
            }
    
    # Analysis
    print(f"\n🎯 CONTROLLED TEST RESULTS")
    print("=" * 50)
    
    for node_name in ["jw2", "jw3"]:
        result = results[node_name]
        print(f"\n{node_name.upper()}:")
        
        if result["success"] and result["metrics"]:
            m = result["metrics"]
            print(f"  ✅ Tokens/sec: {m['tokens_per_second']:.2f}")
            print(f"  🌡️  Temperature: {m['temperature']}°C")
            print(f"  ⚡ Power: {m['power_draw']:.1f}W")
            print(f"  🔧 GPU Util: {m['gpu_utilization']}%")
            print(f"  ⏱️  Time: {result['elapsed_time']:.1f}s")
        else:
            print(f"  ❌ Test failed")
    
    # Performance comparison
    if results["jw2"]["success"] and results["jw3"]["success"]:
        jw2_perf = results["jw2"]["metrics"]["tokens_per_second"]
        jw3_perf = results["jw3"]["metrics"]["tokens_per_second"]
        
        diff_pct = ((jw3_perf - jw2_perf) / jw2_perf) * 100
        
        print(f"\n📊 PERFORMANCE COMPARISON:")
        print(f"  jw2: {jw2_perf:.2f} tokens/sec")
        print(f"  jw3: {jw3_perf:.2f} tokens/sec")
        print(f"  Difference: {diff_pct:+.1f}%")
        
        if abs(diff_pct) > 10:
            print(f"  🚨 SIGNIFICANT DIFFERENCE DETECTED!")
        else:
            print(f"  ✅ Performance difference within normal range")
    
    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"controlled_test_results_{timestamp}.json"
    
    with open(results_file, 'w') as f:
        json.dump({
            "timestamp": timestamp,
            "test_purpose": "Controlled performance comparison between jw2 and jw3",
            "test_parameters": {
                "samples": 5,
                "model": "Llama-3.1-8B-Instruct",
                "scenario": "Server",
                "dtype": "bfloat16"
            },
            "results": results
        }, f, indent=2)
    
    print(f"\n💾 Results saved to: {results_file}")
    
    return results

if __name__ == "__main__":
    main()