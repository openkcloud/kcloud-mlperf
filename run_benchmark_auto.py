#!/usr/bin/env python3
"""
Automated MLPerf benchmark runner for non-interactive execution
"""
import os
import sys
import time
import json
import torch
from pathlib import Path
import socket

# Add the benchmark scripts directory to path
sys.path.append(str(Path(__file__).parent / "benchmark_scripts"))

def get_node_info():
    """Get node identification"""
    hostname = socket.gethostname()
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        gpu_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
        return f"{hostname} - {gpu_name} ({gpu_memory:.1f}GB)"
    else:
        return f"{hostname} - No GPU"

def check_environment():
    """Check if environment is ready"""
    print(f"🔍 Checking environment on {get_node_info()}...")
    
    # Check CUDA
    if not torch.cuda.is_available():
        print("❌ CUDA not available!")
        return False
    
    gpu_name = torch.cuda.get_device_name(0)
    gpu_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
    print(f"✅ GPU: {gpu_name} ({gpu_memory:.1f}GB)")
    
    # Check HF token
    hf_token = os.getenv('HF_TOKEN')
    if not hf_token:
        print("⚠️  No HF_TOKEN environment variable found")
        print("   Benchmark will attempt to use model without authentication")
        print("   Note: Some models may require HuggingFace authentication")
    else:
        print(f"✅ HuggingFace token configured")
    
    return True

def run_quick_test():
    """Run a quick test to verify everything works"""
    print("🧪 Running GPU validation test...")
    
    try:
        # Simple tensor operation on GPU
        x = torch.randn(1000, 1000).cuda()
        y = torch.randn(1000, 1000).cuda()
        
        start_time = time.time()
        z = torch.mm(x, y)
        torch.cuda.synchronize()
        elapsed = time.time() - start_time
        
        print(f"✅ GPU matrix multiplication: {elapsed:.3f}s")
        print(f"🔥 GPU Memory used: {torch.cuda.memory_allocated() / 1024**2:.1f}MB")
        
        # Clear memory
        del x, y, z
        torch.cuda.empty_cache()
        
        return True
    except Exception as e:
        print(f"❌ GPU test failed: {e}")
        return False

def run_benchmark():
    """Run the full MLPerf benchmark"""
    print(f"🚀 Starting MLPerf Llama-3.1-8B benchmark on {get_node_info()}...")
    
    try:
        # Import the benchmark class
        from host_benchmark import LlamaBenchmark
        
        # Set environment variables for smaller test
        os.environ.setdefault('NUM_SAMPLES', '5')  # Smaller for faster testing
        os.environ.setdefault('MAX_TOKENS', '32')  # Smaller for faster testing
        os.environ.setdefault('BATCH_SIZE', '1')
        
        # Create results directory with node identifier
        hostname = socket.gethostname()
        results_dir = Path(__file__).parent / "results" / hostname
        results_dir.mkdir(parents=True, exist_ok=True)
        
        # Create cache directory
        cache_dir = Path(__file__).parent / "cache"
        cache_dir.mkdir(exist_ok=True)
        
        # Initialize and run benchmark
        benchmark = LlamaBenchmark()
        
        if not benchmark.check_environment():
            print("❌ Environment check failed")
            return False
        
        print("📥 Loading model (this may take several minutes)...")
        if not benchmark.load_model():
            print("❌ Model loading failed")
            return False
        
        benchmark.prepare_samples()
        results = benchmark.run_benchmark()
        
        # Save results with node identifier
        results_file = results_dir / f"benchmark_results_{hostname}_{int(time.time())}.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        # Save summary
        summary_file = results_dir / f"summary_{hostname}_{int(time.time())}.txt"
        with open(summary_file, 'w') as f:
            if 'error' not in results:
                f.write(f"MLPerf Llama-3.1-8B Benchmark Results - {get_node_info()}\\n")
                f.write(f"=" * 70 + "\\n\\n")
                f.write(f"Model: {results['model']}\\n")
                f.write(f"Device: {results['device']}\\n")
                f.write(f"Node: {hostname}\\n")
                f.write(f"Success Rate: {results['success_rate_percent']:.1f}%\\n")
                f.write(f"Throughput: {results['throughput_samples_per_second']:.2f} samples/sec\\n")
                f.write(f"Avg Latency: {results['average_time_per_sample_ms']:.0f}ms\\n")
                f.write(f"Tokens/sec: {results['average_tokens_per_second']:.1f}\\n")
                f.write(f"GPU Memory: {results['peak_gpu_memory_gb']:.2f}GB\\n")
            else:
                f.write(f"Benchmark failed on {hostname}: {results['error']}\\n")
        
        benchmark.print_results()
        
        print(f"💾 Results saved to {results_file}")
        print(f"📊 Summary saved to {summary_file}")
        print("✅ Benchmark completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Benchmark failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Main execution"""
    print("="*70)
    print(f"🎯 MLPerf Llama-3.1-8B Benchmark - {get_node_info()}")
    print("="*70)
    
    # Check environment
    if not check_environment():
        print("❌ Environment check failed")
        return 1
    
    # Run quick test
    if not run_quick_test():
        print("❌ Quick test failed")
        return 1
    
    print("\\n🚀 Starting automated benchmark execution...")
    
    # Run benchmark
    success = run_benchmark()
    
    if success:
        print("\\n🎉 Benchmark completed successfully!")
        return 0
    else:
        print("\\n💥 Benchmark failed!")
        return 1

if __name__ == "__main__":
    exit(main())