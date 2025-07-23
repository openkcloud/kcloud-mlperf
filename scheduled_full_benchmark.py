#!/usr/bin/env python3
"""
Scheduled Full MLPerf Benchmark
Runs complete dataset (13,368 samples) on all 3 scenarios:
1. jw2 single GPU
2. jw3 single GPU  
3. jw2+jw3 distributed

Scheduled for 18:00 KST
"""

import subprocess
import time
from datetime import datetime, timedelta
import os
import sys

def check_current_time():
    """Check if it's time to run (18:00 KST)"""
    now = datetime.now()
    target_hour = 18
    
    if now.hour == target_hour and now.minute == 0:
        return True
    elif now.hour > target_hour:
        print(f"⏰ Scheduled time (18:00) has passed. Current time: {now.strftime('%H:%M')}")
        return True
    else:
        minutes_until = (target_hour - now.hour - 1) * 60 + (60 - now.minute)
        print(f"⏱️  Waiting {minutes_until} minutes until 18:00...")
        return False

def run_full_benchmark_scenario(scenario_name, command, description):
    """Run a full benchmark scenario"""
    print(f"\n{'='*60}")
    print(f"🚀 STARTING: {scenario_name}")
    print(f"📋 {description}")
    print(f"⏰ Started at: {datetime.now().strftime('%H:%M:%S')}")
    print(f"📊 Dataset: Full CNN DailyMail (13,368 samples)")
    print(f"{'='*60}")
    
    start_time = time.time()
    
    try:
        # Run command
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        
        elapsed_hours = (time.time() - start_time) / 3600
        
        if result.returncode == 0:
            print(f"✅ {scenario_name} - COMPLETED ({elapsed_hours:.1f} hours)")
            return True, elapsed_hours
        else:
            print(f"❌ {scenario_name} - FAILED ({elapsed_hours:.1f} hours)")
            print(f"Error: {result.stderr[:500]}")
            return False, elapsed_hours
            
    except Exception as e:
        elapsed_hours = (time.time() - start_time) / 3600
        print(f"❌ {scenario_name} - EXCEPTION ({elapsed_hours:.1f} hours): {e}")
        return False, elapsed_hours

def generate_timestamp():
    """Generate timestamp for results"""
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def main():
    print("📅 MLPerf Full Benchmark Scheduler")
    print("=" * 50)
    print(f"⏰ Scheduled for: 18:00 KST")
    print(f"🕐 Current time: {datetime.now().strftime('%H:%M:%S KST')}")
    print()
    
    # Wait until 18:00 if not time yet
    while not check_current_time():
        time.sleep(60)  # Check every minute
    
    print(f"\n🎯 STARTING FULL BENCHMARK SUITE")
    print(f"⏰ Execution time: {datetime.now().strftime('%H:%M:%S KST')}")
    print()
    
    timestamp = generate_timestamp()
    results = {}
    
    # Scenario 1: jw2 Single GPU (Full Dataset)
    jw2_cmd = f"""
    ssh jungwooshim@129.254.202.252 'cd ~/official_mlperf/inference/language/llama3.1-8b && 
    python3 main.py 
    --scenario Server 
    --model-path meta-llama/Llama-3.1-8B-Instruct 
    --total-sample-count 13368 
    --dataset-path cnn_eval.json 
    --vllm 
    --tensor-parallel-size 1 
    --dtype bfloat16 
    --output-log-dir jw2_full_benchmark_{timestamp} 
    > jw2_full_benchmark_{timestamp}.log 2>&1'
    """
    
    success1, time1 = run_full_benchmark_scenario(
        "JW2 Single GPU",
        jw2_cmd,
        "Full dataset benchmark on jw2 (129.254.202.252)"
    )
    results["jw2_single"] = {"success": success1, "time_hours": time1}
    
    # Scenario 2: jw3 Single GPU (Full Dataset)
    jw3_cmd = f"""
    ssh jungwooshim@129.254.202.253 'cd ~/official_mlperf/inference/language/llama3.1-8b && 
    python3 main.py 
    --scenario Server 
    --model-path meta-llama/Llama-3.1-8B-Instruct 
    --total-sample-count 13368 
    --dataset-path cnn_eval.json 
    --vllm 
    --tensor-parallel-size 1 
    --dtype bfloat16 
    --output-log-dir jw3_full_benchmark_{timestamp} 
    > jw3_full_benchmark_{timestamp}.log 2>&1'
    """
    
    success2, time2 = run_full_benchmark_scenario(
        "JW3 Single GPU", 
        jw3_cmd,
        "Full dataset benchmark on jw3 (129.254.202.253)"
    )
    results["jw3_single"] = {"success": success2, "time_hours": time2}
    
    # Scenario 3: Distributed (Both nodes in parallel)
    distributed_cmd = f"""
    # Start jw2 in background
    ssh jungwooshim@129.254.202.252 'cd ~/official_mlperf/inference/language/llama3.1-8b && 
    python3 main.py 
    --scenario Server 
    --model-path meta-llama/Llama-3.1-8B-Instruct 
    --total-sample-count 6684 
    --dataset-path cnn_eval.json 
    --vllm 
    --tensor-parallel-size 1 
    --dtype bfloat16 
    --output-log-dir jw2_distributed_{timestamp} 
    > jw2_distributed_{timestamp}.log 2>&1' &
    
    # Start jw3 in parallel
    ssh jungwooshim@129.254.202.253 'cd ~/official_mlperf/inference/language/llama3.1-8b && 
    python3 main.py 
    --scenario Server 
    --model-path meta-llama/Llama-3.1-8B-Instruct 
    --total-sample-count 6684 
    --dataset-path cnn_eval.json 
    --vllm 
    --tensor-parallel-size 1 
    --dtype bfloat16 
    --output-log-dir jw3_distributed_{timestamp} 
    > jw3_distributed_{timestamp}.log 2>&1' &
    
    # Wait for both to complete
    wait
    """
    
    success3, time3 = run_full_benchmark_scenario(
        "JW2+JW3 Distributed",
        distributed_cmd,
        "Parallel execution across both nodes (6,684 samples each)"
    )
    results["distributed"] = {"success": success3, "time_hours": time3}
    
    # Final Summary
    total_time = time1 + time2 + time3
    successful_tests = sum(1 for r in results.values() if r["success"])
    
    print(f"\n🎉 FULL BENCHMARK SUITE COMPLETED")
    print("=" * 60)
    print(f"⏰ Total execution time: {total_time:.1f} hours")
    print(f"✅ Successful scenarios: {successful_tests}/3")
    print()
    
    for scenario, result in results.items():
        status = "✅ SUCCESS" if result["success"] else "❌ FAILED"
        print(f"{scenario.upper():<20} {status} ({result['time_hours']:.1f}h)")
    
    print(f"\n📊 Results saved with timestamp: {timestamp}")
    print(f"🔍 Check logs on nodes for detailed performance metrics")
    
    # Generate completion report
    report_file = f"reports/Full_Benchmark_Report_{timestamp}.md"
    with open(report_file, 'w') as f:
        f.write(f"""# MLPerf Full Benchmark Report

**Execution Date:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S KST')}
**Dataset:** Full CNN DailyMail (13,368 samples)
**Infrastructure:** jw2 + jw3 with Driver 575, CUDA 12.9

## Results Summary

| Scenario | Status | Duration | Samples |
|----------|--------|----------|---------|
| JW2 Single | {"SUCCESS" if results["jw2_single"]["success"] else "FAILED"} | {results["jw2_single"]["time_hours"]:.1f}h | 13,368 |
| JW3 Single | {"SUCCESS" if results["jw3_single"]["success"] else "FAILED"} | {results["jw3_single"]["time_hours"]:.1f}h | 13,368 |
| Distributed | {"SUCCESS" if results["distributed"]["success"] else "FAILED"} | {results["distributed"]["time_hours"]:.1f}h | 13,368 total |

**Total Execution Time:** {total_time:.1f} hours
**Success Rate:** {successful_tests}/3 scenarios

## Performance Analysis
Results available in node-specific log files:
- jw2: `jw2_full_benchmark_{timestamp}.log`
- jw3: `jw3_full_benchmark_{timestamp}.log` 
- Distributed: `jw2_distributed_{timestamp}.log`, `jw3_distributed_{timestamp}.log`

This represents the complete validation of our MLPerf infrastructure with uniform driver 575 configuration.
""")
    
    print(f"📄 Report generated: {report_file}")

if __name__ == "__main__":
    main()