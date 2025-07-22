#!/usr/bin/env python3
"""
Live Results Generator for jw2, jw3, and distributed tests
Generates results while tests are running
"""

import json
import subprocess
from datetime import datetime
from pathlib import Path

def get_node_status(node_name, node_ip):
    """Get current status of a node test"""
    try:
        # Check if test is running
        cmd = f"ssh jungwooshim@{node_ip} 'ps aux | grep -i main.py | grep -v grep | wc -l'"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        is_running = int(result.stdout.strip()) > 1
        
        # Get current log info if available
        log_cmd = f"ssh jungwooshim@{node_ip} 'cd ~/official_mlperf/inference/language/llama3.1-8b && tail -5 {node_name}_test_10_samples.log 2>/dev/null'"
        log_result = subprocess.run(log_cmd, shell=True, capture_output=True, text=True)
        
        # Check results if available
        results_cmd = f"ssh jungwooshim@{node_ip} 'cd ~/official_mlperf/inference/language/llama3.1-8b && ls -la {node_name}_test_10_results/ 2>/dev/null'"
        results_result = subprocess.run(results_cmd, shell=True, capture_output=True, text=True)
        
        return {
            "node": node_name,
            "ip": node_ip,
            "status": "RUNNING" if is_running else "COMPLETED/STOPPED",
            "log_tail": log_result.stdout.strip() if log_result.returncode == 0 else "No log available",
            "results_available": "mlperf_log" in results_result.stdout if results_result.returncode == 0 else False
        }
        
    except Exception as e:
        return {
            "node": node_name,
            "ip": node_ip, 
            "status": "ERROR",
            "error": str(e)
        }

def generate_live_report():
    """Generate live status report"""
    
    print("# MLPerf Test Results - jw2, jw3, and Distributed")
    print("=" * 60)
    print(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"**Test Type:** Quick validation (10 samples each)")
    print()
    
    # Test scenarios requested by user
    nodes = [
        ("jw2", "129.254.202.252"),
        ("jw3", "129.254.202.253")
    ]
    
    results = {}
    
    for node_name, node_ip in nodes:
        print(f"## {node_name.upper()} Results ({node_ip})")
        print("-" * 40)
        
        status = get_node_status(node_name, node_ip)
        results[node_name] = status
        
        print(f"**Status:** {status['status']}")
        
        if status['status'] == "RUNNING":
            print("**Current Activity:**")
            print("```")
            print(status['log_tail'][-200:] if len(status['log_tail']) > 200 else status['log_tail'])
            print("```")
        elif status['status'] == "ERROR":
            print(f"**Error:** {status.get('error', 'Unknown error')}")
        
        print(f"**Results Available:** {'Yes' if status.get('results_available') else 'No'}")
        print()
    
    # Distributed test status (parallel execution on both nodes)
    print("## DISTRIBUTED Test (jw2+jw3)")
    print("-" * 40)
    
    both_running = all(results[node]['status'] == 'RUNNING' for node in ['jw2', 'jw3'])
    both_completed = all(results[node]['status'] in ['COMPLETED', 'STOPPED'] for node in ['jw2', 'jw3'])
    
    if both_running:
        print("**Status:** ✅ RUNNING (Parallel execution on both nodes)")
        print("**Progress:** Both jw2 and jw3 processing 10 samples simultaneously")
    elif both_completed:
        print("**Status:** ✅ COMPLETED")
        print("**Results:** Ready for analysis")
    else:
        print("**Status:** ⚡ MIXED (Some nodes still running)")
    
    print()
    print("## Summary")
    print("-" * 40)
    
    total_tests = 3  # jw2, jw3, distributed
    completed_tests = 0
    
    if results['jw2']['status'] != 'RUNNING':
        completed_tests += 1
    if results['jw3']['status'] != 'RUNNING': 
        completed_tests += 1
    if both_completed:
        completed_tests += 1  # distributed test complete
    
    print(f"**Progress:** {completed_tests}/{total_tests} scenarios completed")
    
    if completed_tests == total_tests:
        print("\n🎉 **ALL TESTS COMPLETED!**")
        print("✅ jw2 single GPU test")
        print("✅ jw3 single GPU test")
        print("✅ jw2+jw3 distributed test")
        print("\n📊 **Ready for performance comparison analysis**")
    else:
        print(f"\n⏳ **Tests in progress:** {total_tests - completed_tests} remaining")
        
    print(f"\n**Next Update:** Run this script again to see latest status")

if __name__ == "__main__":
    generate_live_report()