#!/usr/bin/env python3
import time
import os
import re
import subprocess
import json
from datetime import datetime

def continuous_monitor():
    """Continuously monitor benchmark until completion"""
    log_file = "full_benchmark_log.txt"
    last_position = 0
    start_time = time.time()
    
    print("🔄 Starting continuous monitoring...")
    print("=" * 70)
    
    while True:
        # Check if process is still running
        result = subprocess.run(["pgrep", "-f", "optimized_simple.py"], 
                              capture_output=True, text=True)
        
        if not result.stdout.strip():
            print("\n✅ Benchmark process completed!")
            break
            
        # Read new content from log file
        if os.path.exists(log_file):
            current_size = os.path.getsize(log_file)
            
            if current_size > last_position:
                with open(log_file, 'r') as f:
                    f.seek(last_position)
                    new_content = f.read()
                
                # Process new lines
                for line in new_content.split('\n'):
                    line = line.strip()
                    if not line:
                        continue
                        
                    # Progress updates
                    if 'Progress:' in line and 'Throughput:' in line:
                        elapsed = time.time() - start_time
                        elapsed_min = elapsed / 60
                        timestamp = datetime.now().strftime("%H:%M:%S")
                        
                        # Extract progress info
                        match = re.search(r'Progress: (\d+)/(\d+) \| Throughput: ([\d.]+) samples/sec', line)
                        if match:
                            current, total, throughput = match.groups()
                            current, total, throughput = int(current), int(total), float(throughput)
                            
                            progress_pct = (current / total) * 100
                            remaining = total - current
                            eta_seconds = remaining / throughput if throughput > 0 else 0
                            eta_min = eta_seconds / 60
                            
                            # Progress bar
                            bar_width = 30
                            filled = int(bar_width * current / total)
                            bar = '█' * filled + '░' * (bar_width - filled)
                            
                            print(f"\r[{timestamp}] {bar} {progress_pct:5.1f}% | "
                                  f"{current:,}/{total:,} | "
                                  f"{throughput:.2f} samples/sec | "
                                  f"ETA: {eta_min:.0f}m", end='', flush=True)
                    
                    # Results section
                    elif '=== Results ===' in line:
                        print(f"\n\n{line}")
                    elif any(keyword in line for keyword in [
                        'Samples processed:', 'Total time:', 'Throughput:', 
                        'ROUGE-1:', 'ROUGE-2:', 'ROUGE-L:', 'Estimated time:'
                    ]):
                        print(line)
                
                last_position = current_size
        
        time.sleep(2)  # Check every 2 seconds
    
    # Final results processing
    print("\n" + "=" * 70)
    print("📊 EXTRACTING FINAL RESULTS")
    print("=" * 70)
    
    if os.path.exists(log_file):
        with open(log_file, 'r') as f:
            content = f.read()
        
        # Look for results section
        if '=== Results ===' in content:
            results_start = content.find('=== Results ===')
            results_section = content[results_start:]
            
            # Extract key metrics
            throughput_match = re.search(r'Throughput: ([\d.]+) samples/second', results_section)
            time_match = re.search(r'Total time: ([\d.]+) seconds', results_section)
            samples_match = re.search(r'Samples processed: (\d+)', results_section)
            rouge1_match = re.search(r'ROUGE-1: ([\d.]+)', results_section)
            rouge2_match = re.search(r'ROUGE-2: ([\d.]+)', results_section)
            rougel_match = re.search(r'ROUGE-L: ([\d.]+)', results_section)
            
            if all([throughput_match, time_match, samples_match]):
                throughput = float(throughput_match.group(1))
                total_time = float(time_match.group(1))
                samples = int(samples_match.group(1))
                
                # Baseline comparison
                baseline_throughput = 0.75
                baseline_time = 17831.5
                speedup = throughput / baseline_throughput
                time_saved = baseline_time - total_time
                
                print(f"\n🎯 FINAL PERFORMANCE SUMMARY")
                print("=" * 50)
                print(f"Samples Processed:    {samples:,}")
                print(f"Total Time:          {total_time:.1f} seconds ({total_time/60:.1f} minutes)")
                print(f"Throughput:          {throughput:.2f} samples/second")
                print(f"Baseline Throughput: {baseline_throughput} samples/second")
                print(f"Speedup:             {speedup:.1f}x faster")
                print(f"Time Saved:          {time_saved/60:.0f} minutes ({time_saved/3600:.1f} hours)")
                
                if rouge1_match and rouge2_match and rougel_match:
                    print(f"\n📈 QUALITY METRICS")
                    print("=" * 30)
                    print(f"ROUGE-1: {rouge1_match.group(1)}")
                    print(f"ROUGE-2: {rouge2_match.group(1)}")
                    print(f"ROUGE-L: {rougel_match.group(1)}")
                
                # Save summary
                summary = {
                    "optimized_results": {
                        "samples": samples,
                        "total_time_seconds": total_time,
                        "throughput_samples_per_second": throughput,
                        "rouge_scores": {
                            "rouge-1": float(rouge1_match.group(1)) if rouge1_match else None,
                            "rouge-2": float(rouge2_match.group(1)) if rouge2_match else None,
                            "rouge-l": float(rougel_match.group(1)) if rougel_match else None
                        }
                    },
                    "baseline_comparison": {
                        "baseline_throughput": baseline_throughput,
                        "baseline_time_seconds": baseline_time,
                        "speedup_factor": speedup,
                        "time_saved_seconds": time_saved,
                        "time_saved_hours": time_saved / 3600
                    },
                    "timestamp": datetime.now().isoformat()
                }
                
                with open("final_benchmark_comparison.json", "w") as f:
                    json.dump(summary, f, indent=2)
                
                print(f"\n💾 Results saved to: final_benchmark_comparison.json")
        
        print("\n🏁 Monitoring complete!")

if __name__ == "__main__":
    continuous_monitor()