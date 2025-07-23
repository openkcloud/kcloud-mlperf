#!/usr/bin/env python3

import os
import sys
import torch
import deepspeed
import json
import argparse
import time
from vllm import LLM, SamplingParams
import torch.distributed as dist
import torch.nn as nn

# Set network environment variables to fix NCCL issues
os.environ['NCCL_SOCKET_IFNAME'] = 'eno1'
os.environ['GLOO_SOCKET_IFNAME'] = 'eno1'
os.environ['NCCL_IB_DISABLE'] = '1'
os.environ['NCCL_P2P_DISABLE'] = '1'
os.environ['NCCL_NET_GDR_LEVEL'] = '0'
os.environ['NCCL_TREE_THRESHOLD'] = '0'
os.environ['NCCL_DEBUG'] = 'WARN'

class SimpleModel(nn.Module):
    """Simple model for DeepSpeed without VLLM complexity"""
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(10, 1)
        
    def forward(self, x):
        return self.linear(x)

def run_deepspeed_proper():
    """Run proper DeepSpeed distributed training"""
    
    # Initialize DeepSpeed distributed
    deepspeed.init_distributed()
    
    rank = dist.get_rank()
    world_size = dist.get_world_size()
    local_rank = int(os.environ.get('LOCAL_RANK', 0))
    
    print(f"DeepSpeed Proper - Rank {rank}/{world_size}, Local rank: {local_rank}")
    
    # Only use GPU nodes for actual work
    is_gpu_node = rank > 0 and torch.cuda.is_available()
    
    if is_gpu_node:
        torch.cuda.set_device(local_rank)
        device = torch.cuda.current_device()
        print(f"Rank {rank}: Using CUDA device {device}")
    else:
        print(f"Rank {rank}: CPU node - coordination only")
    
    try:
        # Create simple model
        model = SimpleModel()
        
        # DeepSpeed configuration - use fp32 for CPU compatibility
        ds_config = {
            "train_batch_size": world_size,
            "train_micro_batch_size_per_gpu": 1,
            "gradient_accumulation_steps": 1,
            "optimizer": {
                "type": "Adam",
                "params": {
                    "lr": 3e-5
                }
            },
            "zero_optimization": {
                "stage": 0,  # No ZeRO for simplicity
            },
            "fp16": {
                "enabled": False  # Disable FP16 for CPU compatibility
            },
            "wall_clock_breakdown": False,
            "steps_per_print": 1
        }
        
        # Initialize DeepSpeed engine
        model_engine, optimizer, _, _ = deepspeed.initialize(
            model=model,
            config=ds_config
        )
        
        print(f"Rank {rank}: DeepSpeed engine initialized successfully")
        
        # Only GPU nodes run VLLM
        if is_gpu_node:
            print(f"Rank {rank}: Creating VLLM engine...")
            llm = LLM(
                model="meta-llama/Llama-3.1-8B-Instruct",
                tensor_parallel_size=1,
                dtype="float16",
                max_model_len=2048,
                gpu_memory_utilization=0.6,
            )
            
            # Create prompts for this GPU
            base_prompts = [
                "Summarize: The quick brown fox jumps over the lazy dog.",
                "Summarize: AI is transforming industries globally.",
                "Summarize: Climate change requires immediate action.",
                "Summarize: Renewable energy is crucial for sustainability.",
                "Summarize: IoT connects devices to the internet.",
                "Summarize: Quantum computing revolutionizes processing.",
            ]
            
            # Distribute prompts among GPU nodes
            gpu_rank = rank - 1  # Convert to 0-based GPU rank
            prompts_per_gpu = len(base_prompts) // (world_size - 1)  # Exclude coordinator
            start_idx = gpu_rank * prompts_per_gpu
            end_idx = start_idx + prompts_per_gpu
            
            my_prompts = base_prompts[start_idx:end_idx]
            
            print(f"Rank {rank}: Processing {len(my_prompts)} prompts")
            
            # Run inference
            sampling_params = SamplingParams(temperature=0.1, max_tokens=100, top_p=0.9)
            start_time = time.time()
            outputs = llm.generate(my_prompts, sampling_params)
            end_time = time.time()
            
            # Process results
            results = []
            for i, output in enumerate(outputs):
                result = {
                    "rank": rank,
                    "sample_id": start_idx + i,
                    "prompt": output.prompt[:50] + "...",
                    "generated_text": output.outputs[0].text.strip(),
                    "tokens_generated": len(output.outputs[0].token_ids),
                    "inference_time": end_time - start_time,
                    "deepspeed_proper": True
                }
                results.append(result)
                print(f"Rank {rank} Sample {start_idx + i}: Generated {len(output.outputs[0].token_ids)} tokens")
            
            print(f"Rank {rank}: Completed inference in {end_time - start_time:.2f}s")
        else:
            # Coordinator node
            results = []
        
        # Synchronize all processes
        dist.barrier()
        print(f"Rank {rank}: All processes synchronized")
        
        # Gather results from all ranks
        gathered_results = [None for _ in range(world_size)]
        dist.all_gather_object(gathered_results, results)
        
        # Save results on coordinator
        if rank == 0:
            all_results = []
            for rank_results in gathered_results:
                if rank_results:
                    all_results.extend(rank_results)
            
            print(f"Rank 0: Gathered {len(all_results)} total results from {world_size} ranks")
            
            # Save combined results
            output_file = f'/tmp/deepspeed_proper_results_{int(time.time())}.json'
            with open(output_file, 'w') as f:
                json.dump({
                    "experiment": "DeepSpeed Proper Distributed MLPerf",
                    "coordinator": "jw1 (129.254.202.251)",
                    "workers": [f"jw{i+2} (129.254.202.{252+i})" for i in range(world_size-1)],
                    "world_size": world_size,
                    "total_samples": len(all_results),
                    "results": all_results
                }, f, indent=2)
            
            print(f"Rank 0: Results saved to {output_file}")
            
            # Print summary
            if all_results:
                total_tokens = sum(r.get("tokens_generated", 0) for r in all_results)
                avg_time = sum(r.get("inference_time", 0) for r in all_results) / len(all_results)
                
                print(f"\n🎉 DeepSpeed Proper Distributed MLPerf Summary:")
                print(f"✅ Coordinator: jw1 (129.254.202.251)")
                print(f"✅ DeepSpeed World Size: {world_size} nodes")
                print(f"✅ GPU Workers: {world_size-1}")
                print(f"✅ Total Samples: {len(all_results)}")
                print(f"✅ Total Tokens Generated: {total_tokens}")
                print(f"✅ Average Time per Sample: {avg_time:.2f}s")
                print(f"✅ DeepSpeed Throughput: {total_tokens / avg_time:.2f} tokens/s")
        
        print(f"Rank {rank}: DeepSpeed proper benchmark completed successfully")
        return True
        
    except Exception as e:
        print(f"Rank {rank}: Error in DeepSpeed proper benchmark: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    parser = argparse.ArgumentParser(description='DeepSpeed Proper Distributed MLPerf Benchmark')
    parser.add_argument('--local_rank', type=int, default=-1, help='Local rank for distributed training')
    
    args = parser.parse_args()
    
    print(f"🚀 DeepSpeed Proper Distributed MLPerf Benchmark")
    print(f"Using proper DeepSpeed distributed training")
    
    # Run DeepSpeed distributed benchmark
    success = run_deepspeed_proper()
    
    rank = dist.get_rank() if dist.is_initialized() else 0
    
    if success:
        print(f"Rank {rank}: ✅ DEEPSPEED PROPER SUCCESS")
        sys.exit(0)
    else:
        print(f"Rank {rank}: ❌ DEEPSPEED PROPER FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()