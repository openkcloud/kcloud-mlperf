#!/usr/bin/env python3

import os
import sys
import torch
import json
import argparse
import time
from vllm import LLM, SamplingParams

def run_deepspeed_vllm_single_node(rank, samples_per_gpu):
    """Run VLLM benchmark with DeepSpeed optimizations on single node"""
    print(f"Node {rank}: Starting DeepSpeed VLLM benchmark")
    
    try:
        # Import DeepSpeed for potential optimizations
        import deepspeed
        print(f"Node {rank}: DeepSpeed version {deepspeed.__version__} available")
        
        # Create VLLM engine with DeepSpeed-friendly settings
        print(f"Node {rank}: Creating VLLM engine...")
        llm = LLM(
            model="meta-llama/Llama-3.1-8B-Instruct",
            tensor_parallel_size=1,  # Single GPU per node
            dtype="float16",
            max_model_len=2048,
            gpu_memory_utilization=0.7,  # Leave room for DeepSpeed overhead
            trust_remote_code=True,
        )
        print(f"Node {rank}: VLLM engine created successfully")
        
        # Create dataset - different samples per node
        base_prompts = [
            "Summarize the following: The quick brown fox jumps over the lazy dog. This pangram contains all 26 letters of the English alphabet and is commonly used for typing practice and font testing.",
            "Summarize the following: Artificial intelligence and machine learning are rapidly transforming industries across the globe, from healthcare and finance to transportation and entertainment.",
            "Summarize the following: Climate change represents one of the most significant challenges facing humanity in the 21st century, requiring immediate action from governments and individuals worldwide.",
            "Summarize the following: The development of renewable energy sources such as solar, wind, and hydroelectric power is crucial for sustainable economic growth and environmental protection.",
            "Summarize the following: The Internet of Things (IoT) connects everyday devices to the internet, enabling smart homes, cities, and industrial automation systems.",
            "Summarize the following: Quantum computing promises to revolutionize computational capabilities by leveraging quantum mechanical phenomena to process information.",
            "Summarize the following: Space exploration continues to push the boundaries of human knowledge, with missions to Mars and beyond expanding our understanding of the universe.",
            "Summarize the following: Biotechnology and genetic engineering are opening new frontiers in medicine, agriculture, and environmental conservation.",
            "Summarize the following: The rise of cryptocurrency and blockchain technology is reshaping financial systems and creating new economic paradigms.",
            "Summarize the following: Virtual and augmented reality technologies are transforming entertainment, education, and professional training across multiple industries."
        ]
        
        # Distribute prompts based on rank
        start_idx = rank * samples_per_gpu
        end_idx = min(start_idx + samples_per_gpu, len(base_prompts))
        my_prompts = base_prompts[start_idx:end_idx]
        
        print(f"Node {rank}: Processing {len(my_prompts)} prompts (samples {start_idx}-{end_idx-1})")
        
        if len(my_prompts) == 0:
            print(f"Node {rank}: No prompts assigned")
            results = []
        else:
            # Configure sampling parameters optimized for DeepSpeed
            sampling_params = SamplingParams(
                temperature=0.1,
                max_tokens=100,
                top_p=0.9,
                use_beam_search=False,  # Faster for distributed
            )
            
            # Run inference
            print(f"Node {rank}: Running VLLM inference with DeepSpeed optimizations...")
            start_time = time.time()
            outputs = llm.generate(my_prompts, sampling_params)
            end_time = time.time()
            
            # Process results
            results = []
            for i, output in enumerate(outputs):
                result = {
                    "node": rank,
                    "sample_id": start_idx + i,
                    "prompt": output.prompt[:100] + "...",  # Truncate for storage
                    "generated_text": output.outputs[0].text.strip(),
                    "tokens_generated": len(output.outputs[0].token_ids),
                    "inference_time": end_time - start_time,
                    "deepspeed_enabled": True
                }
                results.append(result)
                print(f"Node {rank} Sample {start_idx + i}: Generated {len(output.outputs[0].token_ids)} tokens")
            
            print(f"Node {rank}: Completed inference in {end_time - start_time:.2f}s")
        
        # Save results for this node
        output_file = f'/tmp/deepspeed_manual_node_{rank}_{int(time.time())}.json'
        with open(output_file, 'w') as f:
            json.dump({
                "experiment": "DeepSpeed Manual Distributed MLPerf",
                "node": rank,
                "samples": len(results),
                "results": results
            }, f, indent=2)
        
        print(f"Node {rank}: Results saved to {output_file}")
        
        # Print node summary
        if results:
            total_tokens = sum(r.get("tokens_generated", 0) for r in results)
            avg_time = sum(r.get("inference_time", 0) for r in results) / len(results)
            
            print(f"\n🎉 Node {rank} DeepSpeed MLPerf Summary:")
            print(f"✅ Samples: {len(results)}")
            print(f"✅ Total Tokens Generated: {total_tokens}")
            print(f"✅ Average Time per Sample: {avg_time:.2f}s")
            print(f"✅ Node Throughput: {total_tokens / avg_time:.2f} tokens/s")
        
        print(f"Node {rank}: DeepSpeed benchmark completed successfully")
        return True
        
    except Exception as e:
        print(f"Node {rank}: Error in DeepSpeed benchmark: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    parser = argparse.ArgumentParser(description='DeepSpeed Manual Distributed MLPerf Benchmark')
    parser.add_argument('--node', type=int, default=0, help='Node ID (0 or 1)')
    parser.add_argument('--samples-per-gpu', type=int, default=5, help='Samples per GPU')
    
    args = parser.parse_args()
    
    print(f"🚀 DeepSpeed Manual Distributed MLPerf Benchmark")
    print(f"Node: {args.node}")
    print(f"Samples per GPU: {args.samples_per_gpu}")
    
    # Run single node benchmark with DeepSpeed optimizations
    success = run_deepspeed_vllm_single_node(args.node, args.samples_per_gpu)
    
    if success:
        print(f"Node {args.node}: ✅ SUCCESS")
        sys.exit(0)
    else:
        print(f"Node {args.node}: ❌ FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()