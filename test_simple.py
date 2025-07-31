#!/usr/bin/env python3
"""
Simple HuggingFace-based benchmark test
"""
import os
import sys
import json
import time
from datetime import datetime

# Set environment
os.environ['HF_TOKEN'] = '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'
os.environ['HUGGING_FACE_HUB_TOKEN'] = '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'

def test_simple_benchmark():
    """Test simple benchmark without problematic libraries"""
    print("🚀 Testing Simple HuggingFace Benchmark")
    print("=" * 50)
    
    try:
        # Test basic imports first
        print("📦 Testing imports...")
        import torch
        print(f"✅ PyTorch: {torch.__version__}")
        
        if torch.cuda.is_available():
            print(f"✅ CUDA: {torch.cuda.get_device_name(0)}")
            print(f"✅ VRAM: {torch.cuda.get_device_properties(0).total_memory // 1024**3}GB")
        else:
            print("❌ CUDA not available")
            return False
            
        # Test HuggingFace authentication
        print("🔐 Testing HuggingFace authentication...")
        try:
            from huggingface_hub import login
            login(token=os.environ['HF_TOKEN'])
            print("✅ HuggingFace authentication successful")
        except Exception as e:
            print(f"⚠️  Auth warning: {e}")
        
        # Test VLLM import
        print("🧠 Testing VLLM...")
        try:
            from vllm import LLM, SamplingParams
            print("✅ VLLM imported successfully")
        except Exception as e:
            print(f"❌ VLLM import failed: {e}")
            return False
        
        # Test model loading
        print("📥 Loading model (this may take a few minutes)...")
        start_time = time.time()
        
        try:
            # Use basic settings to avoid compatibility issues
            llm = LLM(
                model="meta-llama/Llama-3.1-8B-Instruct",
                dtype="float16",
                tensor_parallel_size=1,
                gpu_memory_utilization=0.85,  # Reduced to avoid OOM
                max_model_len=2048,  # Further reduced for compatibility
                trust_remote_code=True,
                enforce_eager=True  # Disable CUDA graphs for compatibility
            )
            load_time = time.time() - start_time
            print(f"✅ Model loaded successfully in {load_time:.1f}s")
        except Exception as e:
            print(f"❌ Model loading failed: {e}")
            return False
        
        # Test simple inference
        print("🎯 Testing simple inference...")
        sampling_params = SamplingParams(
            temperature=0.0,
            max_tokens=100,
            stop=["<|end_of_text|>"]
        )
        
        test_prompts = [
            "Summarize this: The weather today is sunny and warm.",
            "Summarize this: Technology is advancing rapidly in AI.",
            "Summarize this: The meeting discussed quarterly results."
        ]
        
        inference_start = time.time()
        outputs = llm.generate(test_prompts, sampling_params)
        inference_time = time.time() - inference_start
        
        print(f"✅ Inference completed in {inference_time:.2f}s")
        print(f"📊 Throughput: {len(test_prompts)/inference_time:.2f} samples/sec")
        
        # Show results
        print("\n📋 Sample Results:")
        for i, output in enumerate(outputs):
            print(f"  {i+1}: {output.outputs[0].text.strip()[:50]}...")
        
        # Save test results
        results = {
            "timestamp": datetime.now().isoformat(),
            "model": "meta-llama/Llama-3.1-8B-Instruct",
            "test_samples": len(test_prompts),
            "load_time_seconds": load_time,
            "inference_time_seconds": inference_time,
            "throughput_samples_per_second": len(test_prompts)/inference_time,
            "gpu_memory_utilization": 0.9,
            "max_model_len": 4096,
            "results": [{"input": test_prompts[i], "output": output.outputs[0].text.strip()} 
                       for i, output in enumerate(outputs)]
        }
        
        os.makedirs('/app/results', exist_ok=True)
        with open('/app/results/simple_test_results.json', 'w') as f:
            json.dump(results, f, indent=2)
        
        print(f"\n🎉 Simple benchmark test completed successfully!")
        print(f"📊 Results saved to: /app/results/simple_test_results.json")
        print(f"⚡ Performance: {len(test_prompts)/inference_time:.2f} samples/sec")
        
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_simple_benchmark()
    sys.exit(0 if success else 1)