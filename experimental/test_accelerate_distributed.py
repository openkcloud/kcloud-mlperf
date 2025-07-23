#!/usr/bin/env python3

import os
import sys
import torch
import json
from accelerate import Accelerator, DistributedDataParallelKwargs
from accelerate.utils import gather_object
from vllm import LLM, SamplingParams
import argparse

def setup_accelerate_distributed():
    """Setup distributed environment using Accelerate"""
    # Configure DDP to handle NCCL issues
    ddp_kwargs = DistributedDataParallelKwargs(find_unused_parameters=True)
    
    # Initialize accelerator
    accelerator = Accelerator(
        kwargs_handlers=[ddp_kwargs],
        # Force specific communication backend
        # dispatch_batches=False,
    )
    
    print(f"Accelerate - Process {accelerator.process_index}/{accelerator.num_processes}")
    print(f"Device: {accelerator.device}")
    print(f"Local process index: {accelerator.local_process_index}")
    
    return accelerator

def test_accelerate_vllm_distributed(accelerator):
    """Test VLLM with Accelerate distributed setup"""
    print(f"Process {accelerator.process_index}: Starting VLLM distributed test")
    
    try:
        # Only create model on main process to avoid conflicts
        if accelerator.is_main_process:
            print(f"Main process: Creating VLLM engine...")
            
            # Create VLLM engine (single GPU per process)
            llm = LLM(
                model="meta-llama/Llama-3.1-8B-Instruct",
                tensor_parallel_size=1,  # Single GPU per process
                dtype="float16",
                max_model_len=2048,  # Smaller for testing
                gpu_memory_utilization=0.8,
            )
            
            print(f"Main process: VLLM engine created successfully")
            
            # Test with simple prompts
            prompts = [
                "Summarize: The quick brown fox jumps over the lazy dog. This is a common pangram used in typing practice.",
                "Summarize: Artificial intelligence is rapidly transforming industries across the globe with machine learning.",
                "Summarize: Climate change represents one of the most significant challenges facing humanity in the 21st century.",
                "Summarize: The development of renewable energy sources is crucial for sustainable economic growth."
            ]
            
            # Split prompts across processes
            prompts_per_process = len(prompts) // accelerator.num_processes
            start_idx = accelerator.process_index * prompts_per_process
            end_idx = start_idx + prompts_per_process
            
            if accelerator.process_index == accelerator.num_processes - 1:
                # Last process gets remaining prompts
                end_idx = len(prompts)
            
            my_prompts = prompts[start_idx:end_idx]
            
            print(f"Main process: Processing {len(my_prompts)} prompts")
            
            sampling_params = SamplingParams(
                temperature=0.1,
                max_tokens=50,  # Short for testing
                top_p=0.9
            )
            
            # Generate responses
            outputs = llm.generate(my_prompts, sampling_params)
            
            results = []
            for output in outputs:
                result = {
                    "process": accelerator.process_index,
                    "prompt": output.prompt,
                    "generated_text": output.outputs[0].text.strip()
                }
                results.append(result)
                print(f"Process {accelerator.process_index} - Generated: {output.outputs[0].text.strip()[:100]}...")
                
        else:
            # Worker processes
            print(f"Worker process {accelerator.process_index}: Waiting for coordination...")
            results = []
        
        # Wait for all processes
        accelerator.wait_for_everyone()
        
        # Gather results from all processes
        all_results = gather_object(results)
        
        if accelerator.is_main_process:
            print(f"Main process: Gathered {len(all_results)} total results")
            
            # Save combined results
            with open('/tmp/accelerate_distributed_results.json', 'w') as f:
                json.dump(all_results, f, indent=2)
            
            print("Results saved to /tmp/accelerate_distributed_results.json")
        
        print(f"Process {accelerator.process_index}: Accelerate distributed test completed")
        return True
        
    except Exception as e:
        print(f"Process {accelerator.process_index}: Error in Accelerate test: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-samples", type=int, default=4)
    args = parser.parse_args()
    
    # Setup accelerate distributed environment
    accelerator = setup_accelerate_distributed()
    
    # Test VLLM with Accelerate
    success = test_accelerate_vllm_distributed(accelerator)
    
    if success:
        print(f"Process {accelerator.process_index}: Accelerate distributed test PASSED")
        sys.exit(0)
    else:
        print(f"Process {accelerator.process_index}: Accelerate distributed test FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()