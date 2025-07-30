#!/usr/bin/env python3
"""Quick test script to benchmark 100 samples"""
import os
import sys
import json
import time

# Try to run the optimized script if available
try:
    # First check if we're in a Docker container with mlperf environment
    if os.path.exists("/workspace/mlperf_benchmark"):
        print("Running in MLPerf Docker container...")
        os.chdir("/workspace/mlperf_benchmark")
        
        # Use the MLPerf benchmark runner with limited samples
        import subprocess
        result = subprocess.run([
            "python3", "benchmark_runner.py",
            "--samples", "100",
            "--scenario", "Offline",
            "--model", "llama2-70b-99",
            "--backend", "vllm"
        ], capture_output=True, text=True)
        
        print(result.stdout)
        if result.stderr:
            print("Errors:", result.stderr)
            
    else:
        # Run the optimized standalone script
        print("Running standalone optimized script...")
        
        # Add the current directory to Python path
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        
        from optimized_mlperf_single_gpu import OptimizedSingleGPUBenchmark
        
        benchmark = OptimizedSingleGPUBenchmark()
        results = benchmark.run_benchmark(dataset_size=100)
        
        # Save and print results
        with open("test_100_samples_results.json", "w") as f:
            json.dump(results, f, indent=2)
        
        print("\n=== Test Results (100 samples) ===")
        print(f"Throughput: {results['throughput_samples_per_second']:.2f} samples/second")
        print(f"Total time: {results['total_time_seconds']:.2f} seconds")
        print(f"Average per sample: {results['average_time_per_sample']:.3f} seconds")
        
        # Estimate full dataset time
        full_dataset_samples = 13368  # CNN-DailyMail test set size
        estimated_time = full_dataset_samples / results['throughput_samples_per_second']
        
        print(f"\n=== Full Dataset Estimates ===")
        print(f"Samples: {full_dataset_samples}")
        print(f"Estimated time: {estimated_time:.0f} seconds ({estimated_time/60:.1f} minutes)")
        print(f"Estimated speedup vs baseline: {results['throughput_samples_per_second'] / 0.75:.1f}x")
        
except Exception as e:
    print(f"Error running benchmark: {e}")
    import traceback
    traceback.print_exc()
    
    # Fallback: Try using existing benchmark infrastructure
    print("\nTrying fallback method...")
    try:
        if os.path.exists("MLPerf_local_test"):
            os.chdir("MLPerf_local_test")
            import subprocess
            subprocess.run(["./test_benchmark.py", "--samples", "100"], check=True)
        else:
            print("Could not find MLPerf benchmark directory")
    except Exception as e2:
        print(f"Fallback also failed: {e2}")