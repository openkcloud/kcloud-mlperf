#!/usr/bin/env python3
import time
import os
import subprocess

def monitor_benchmark():
    """Monitor the running benchmark progress"""
    print("🔍 Monitoring MLPerf benchmark progress...")
    print("=" * 60)
    
    log_file = "full_benchmark_log.txt"
    last_size = 0
    no_change_count = 0
    
    while True:
        # Check if process is still running
        result = subprocess.run(["pgrep", "-f", "optimized_simple.py"], 
                              capture_output=True, text=True)
        
        if not result.stdout.strip():
            print("\n✅ Benchmark completed!")
            break
            
        # Check log file
        if os.path.exists(log_file):
            current_size = os.path.getsize(log_file)
            
            if current_size > last_size:
                # Read new content
                with open(log_file, 'r') as f:
                    f.seek(last_size)
                    new_content = f.read()
                    
                # Look for progress updates
                for line in new_content.split('\n'):
                    if 'Progress:' in line or 'Throughput:' in line:
                        print(f"\r{line.strip()}", end='', flush=True)
                    elif '=== Results ===' in line:
                        print(f"\n{line}")
                    elif 'Samples processed:' in line or 'Total time:' in line:
                        print(line)
                    elif 'Estimated time:' in line:
                        print(line)
                
                last_size = current_size
                no_change_count = 0
            else:
                no_change_count += 1
                if no_change_count % 30 == 0:  # Every 30 seconds
                    print(f"\n⏳ Still running... (no output for {no_change_count}s)")
        
        time.sleep(1)
    
    # Print final results
    print("\n" + "=" * 60)
    print("📊 FINAL RESULTS")
    print("=" * 60)
    
    if os.path.exists(log_file):
        with open(log_file, 'r') as f:
            content = f.read()
            
        # Extract results section
        if '=== Results ===' in content:
            results_start = content.find('=== Results ===')
            results_section = content[results_start:]
            print(results_section.split('=== Full Dataset Estimates ===')[0])

if __name__ == "__main__":
    monitor_benchmark()