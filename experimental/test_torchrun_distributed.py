#!/usr/bin/env python3

import os
import sys
import torch
import torch.distributed as dist
from vllm import LLM, SamplingParams
import argparse
import json

def setup_distributed():
    """Setup distributed environment using torchrun"""
    # torchrun sets these automatically
    rank = int(os.environ.get('RANK', 0))
    world_size = int(os.environ.get('WORLD_SIZE', 1))
    local_rank = int(os.environ.get('LOCAL_RANK', 0))
    
    print(f"Rank {rank}/{world_size}, Local rank: {local_rank}")
    
    # Initialize process group with NCCL
    dist.init_process_group(backend='nccl')
    
    # Set CUDA device for this process
    torch.cuda.set_device(local_rank)
    
    return rank, world_size, local_rank

def test_vllm_distributed(rank, world_size, local_rank):
    """Test VLLM with native distributed setup"""
    print(f"Rank {rank}: Starting VLLM distributed test")
    
    try:
        # Create VLLM engine without Ray backend
        llm = LLM(
            model="meta-llama/Llama-3.1-8B-Instruct",
            tensor_parallel_size=1,  # Each process uses 1 GPU
            dtype="float16",
            max_model_len=2048,  # Smaller for testing
        )
        
        print(f"Rank {rank}: VLLM engine created successfully")
        
        # Test with a simple prompt
        if rank == 0:  # Only rank 0 generates
            prompts = [
                "Summarize: The quick brown fox jumps over the lazy dog.",
                "Summarize: Artificial intelligence is transforming industries."
            ]
            
            sampling_params = SamplingParams(
                temperature=0.1,
                max_tokens=100,
                top_p=0.9
            )
            
            print(f"Rank {rank}: Running inference...")
            outputs = llm.generate(prompts, sampling_params)
            
            results = []
            for output in outputs:
                result = {
                    "prompt": output.prompt,
                    "generated_text": output.outputs[0].text
                }
                results.append(result)
                print(f"Prompt: {output.prompt}")
                print(f"Generated: {output.outputs[0].text}")
                print("-" * 50)
            
            # Save results
            with open(f'/tmp/torchrun_results_rank_{rank}.json', 'w') as f:
                json.dump(results, f, indent=2)
        
        # Synchronize all processes
        dist.barrier()
        print(f"Rank {rank}: Test completed successfully")
        return True
        
    except Exception as e:
        print(f"Rank {rank}: Error in VLLM distributed test: {e}")
        return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-samples", type=int, default=2)
    args = parser.parse_args()
    
    # Setup distributed environment
    rank, world_size, local_rank = setup_distributed()
    
    # Test VLLM distributed
    success = test_vllm_distributed(rank, world_size, local_rank)
    
    # Cleanup
    dist.destroy_process_group()
    
    if success:
        print(f"Rank {rank}: Torchrun distributed test PASSED")
        sys.exit(0)
    else:
        print(f"Rank {rank}: Torchrun distributed test FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()