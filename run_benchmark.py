#!/usr/bin/env python3
"""
Simplified MLPerf benchmark runner for direct execution
"""
import os
import sys
import time
import json
import torch
from pathlib import Path

# Add the benchmark scripts directory to path
sys.path.append(str(Path(__file__).parent / "benchmark_scripts"))

def check_environment():
    """Check if environment is ready"""
    print("🔍 Checking environment...")
    
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
        print("   You may need to set it for Llama model access")
    else:
        print(f"✅ HuggingFace token configured (length: {len(hf_token)})")
    
    return True

def run_quick_test():
    """Run a quick test to verify everything works"""
    print("\n🧪 Running quick PyTorch GPU test...")
    
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
        
        return True
    except Exception as e:
        print(f"❌ GPU test failed: {e}")
        return False

def run_benchmark():
    """Run the full MLPerf benchmark"""
    print("\n🚀 Starting MLPerf Llama-3.1-8B benchmark...")
    
    try:
        # Import the benchmark class
        from host_benchmark import LlamaBenchmark
        
        # Set environment variables
        os.environ.setdefault('NUM_SAMPLES', '10')
        os.environ.setdefault('MAX_TOKENS', '64')
        os.environ.setdefault('BATCH_SIZE', '1')
        
        # Create results directory
        results_dir = Path(__file__).parent / "results"
        results_dir.mkdir(exist_ok=True)
        os.environ['RESULTS_DIR'] = str(results_dir)
        
        # Create cache directory
        cache_dir = Path(__file__).parent / "cache"
        cache_dir.mkdir(exist_ok=True)
        
        # Initialize and run benchmark
        benchmark = LlamaBenchmark()
        
        if not benchmark.check_environment():
            print("❌ Environment check failed")
            return False
        
        if not benchmark.load_model():
            print("❌ Model loading failed")
            return False
        
        benchmark.prepare_samples()
        results = benchmark.run_benchmark()
        benchmark.save_results()
        benchmark.print_results()
        
        print("✅ Benchmark completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Benchmark failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Main execution"""
    print("="*60)
    print("🎯 MLPerf Llama-3.1-8B Benchmark Runner")
    print("="*60)
    
    # Check environment
    if not check_environment():
        print("❌ Environment check failed")
        return 1
    
    # Run quick test
    if not run_quick_test():
        print("❌ Quick test failed")
        return 1
    
    # Ask user if they want to proceed
    print("\n" + "="*60)
    response = input("🤔 Environment looks good! Run full benchmark? (y/N): ")
    if response.lower() not in ['y', 'yes']:
        print("👋 Benchmark cancelled by user")
        return 0
    
    # Run benchmark
    success = run_benchmark()
    
    if success:
        print("\n🎉 All done! Check the results/ directory for output.")
        return 0
    else:
        print("\n💥 Benchmark failed!")
        return 1

if __name__ == "__main__":
    exit(main())