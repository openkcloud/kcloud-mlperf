#!/usr/bin/env python3
"""
Parallel MLPerf Benchmark - Server Scenario with Accuracy
"""
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

def run_mlperf_benchmark(node_ip, node_name, samples):
    """Run MLPerf benchmark on a specific node"""
    print(f"🚀 Starting {node_name} benchmark ({samples} samples)")
    start_time = time.time()
    
    cmd = f"""cd ~/official_mlperf/inference/language/llama3.1-8b && 
python3 main.py \
--scenario Server \
--model-path meta-llama/Llama-3.1-8B-Instruct \
--batch-size 1 \
--dtype float16 \
--total-sample-count {samples} \
--dataset-path cnn_eval.json \
--output-log-dir {node_name}_parallel_{int(time.time())} \
--tensor-parallel-size 1 \
--vllm \
--accuracy \
--user-conf user_both.conf"""
    
    result = subprocess.run([
        "ssh", f"jungwooshim@{node_ip}", cmd
    ], capture_output=True, text=True, timeout=3600)
    
    end_time = time.time()
    duration = end_time - start_time
    
    return {
        "node": node_name,
        "samples": samples,
        "duration": duration,
        "throughput": samples / duration,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode
    }

def run_parallel_benchmarks():
    """Run benchmarks on both nodes in parallel"""
    print("🎯 PARALLEL MLPerf BENCHMARKS")
    print("Requirements: Server scenario + Accuracy validation")
    print("=" * 60)
    
    nodes = [
        ("129.254.202.252", "jw2"),
        ("129.254.202.253", "jw3")
    ]
    
    samples_per_node = 200  # 400 total samples
    
    # Run in parallel
    with ThreadPoolExecutor(max_workers=2) as executor:
        overall_start = time.time()
        
        futures = [
            executor.submit(run_mlperf_benchmark, ip, name, samples_per_node)
            for ip, name in nodes
        ]
        
        results = []
        for future in futures:
            try:
                result = future.result()
                results.append(result)
                print(f"✅ {result['node']} completed: {result['duration']:.1f}s, {result['throughput']:.2f} samples/sec")
            except Exception as e:
                print(f"❌ Node failed: {e}")
                results.append({"error": str(e)})
        
        overall_duration = time.time() - overall_start
    
    # Report results
    print("\n" + "=" * 60)
    print("🎯 PARALLEL BENCHMARK RESULTS")
    print("=" * 60)
    
    successful_results = [r for r in results if 'error' not in r]
    
    if successful_results:
        total_samples = sum(r['samples'] for r in successful_results)
        combined_throughput = total_samples / overall_duration
        
        print(f"Total samples processed: {total_samples}")
        print(f"Overall duration: {overall_duration:.1f}s")
        print(f"Combined throughput: {combined_throughput:.2f} samples/second")
        
        # Compare with sequential
        sequential_time = sum(r['duration'] for r in successful_results)
        speedup = sequential_time / overall_duration
        print(f"Sequential time would be: {sequential_time:.1f}s")
        print(f"Parallel speedup: {speedup:.2f}x")
        
        # Extrapolate to full dataset
        full_dataset = 13368
        estimated_time = full_dataset / combined_throughput
        print(f"\n📊 FULL DATASET PROJECTION:")
        print(f"Estimated time for {full_dataset} samples: {estimated_time/3600:.1f} hours")
    
    return results

if __name__ == "__main__":
    run_parallel_benchmarks()