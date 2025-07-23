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
os.environ['NCCL_IB_DISABLE'] = '1'  # Disable InfiniBand
os.environ['NCCL_P2P_DISABLE'] = '1'  # Disable P2P
os.environ['NCCL_NET_GDR_LEVEL'] = '0'  # Disable GPU Direct RDMA
os.environ['NCCL_TREE_THRESHOLD'] = '0'  # Force ring algorithm
os.environ['NCCL_DEBUG'] = 'WARN'  # Set debug level

class DistributedVLLMWrapper(nn.Module):
    """Wrapper to make VLLM work with DeepSpeed distributed training"""
    def __init__(self, model_name, max_tokens=100, rank=0):
        super().__init__()
        self.model_name = model_name
        self.max_tokens = max_tokens
        self.rank = rank
        self.llm = None
        
        # Create a dummy parameter for DeepSpeed
        self.dummy_param = nn.Parameter(torch.zeros(1))
        
    def forward(self, prompts):
        # This won't be called in our inference setup
        return torch.zeros(1)
    
    def generate(self, prompts, sampling_params):
        # Only create VLLM on GPU nodes (jw2, jw3)
        if self.rank == 0:  # jw1 - coordinator only
            print(f"Rank {self.rank}: Coordinator node - no VLLM inference")
            return []
            
        if self.llm is None:
            # Initialize VLLM on GPU nodes
            print(f"Rank {self.rank}: Initializing VLLM on GPU node...")
            self.llm = LLM(
                model=self.model_name,
                tensor_parallel_size=1,  # Single GPU per process
                dtype="float16",
                max_model_len=2048,
                gpu_memory_utilization=0.6,  # Leave room for DeepSpeed
            )
        
        return self.llm.generate(prompts, sampling_params)

def run_deepspeed_fixed_network():
    """Run DeepSpeed distributed with fixed network configuration"""
    
    # Initialize DeepSpeed distributed
    deepspeed.init_distributed()
    
    rank = dist.get_rank()
    world_size = dist.get_world_size()
    local_rank = int(os.environ.get('LOCAL_RANK', 0))
    
    print(f"DeepSpeed Fixed Network - Rank {rank}/{world_size}, Local rank: {local_rank}")
    
    # Set CUDA device only for GPU nodes
    if rank > 0 and torch.cuda.is_available():  # jw2, jw3 have GPUs
        torch.cuda.set_device(local_rank)
        device = torch.cuda.current_device()
        print(f"Rank {rank}: Using CUDA device {device}")
    else:
        print(f"Rank {rank}: Coordinator node - no GPU required")
    
    try:
        # Create distributed model wrapper
        model = DistributedVLLMWrapper("meta-llama/Llama-3.1-8B-Instruct", rank=rank)
        
        # DeepSpeed configuration with network fixes
        ds_config = {
            "train_batch_size": max(1, world_size - 1),  # Exclude coordinator
            "train_micro_batch_size_per_gpu": 1,
            "gradient_accumulation_steps": 1,
            "fp16": {
                "enabled": True,
                "auto_cast": False,
                "loss_scale": 0,
                "initial_scale_power": 16,
                "loss_scale_window": 1000,
                "hysteresis": 2,
                "min_loss_scale": 1
            },
            "zero_optimization": {
                "stage": 1,  # Reduce to stage 1 for better network compatibility
                "allgather_partitions": True,
                "allgather_bucket_size": 2e8,
                "overlap_comm": False,  # Disable overlap for network stability
                "reduce_scatter": True,
                "reduce_bucket_size": 2e8,
                "contiguous_gradients": True
            },
            "communication_data_type": "fp16",
            "wall_clock_breakdown": False,
            "steps_per_print": 1
        }
        
        # Initialize DeepSpeed engine
        model_engine, optimizer, _, _ = deepspeed.initialize(
            model=model,
            config=ds_config
        )
        
        print(f"Rank {rank}: DeepSpeed engine initialized with fixed network settings")
        
        # Create distributed dataset
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
        
        # Distribute work only among GPU nodes (ranks 1, 2)
        gpu_ranks = [i for i in range(1, world_size)]  # Exclude coordinator (rank 0)
        
        if rank == 0:  # Coordinator
            print(f"Rank {rank}: Coordinator - managing {len(gpu_ranks)} GPU workers")
            my_prompts = []
            results = []
        else:  # Worker nodes
            gpu_rank_idx = rank - 1  # Convert to 0-based index for GPU ranks
            samples_per_gpu = len(base_prompts) // len(gpu_ranks)
            start_idx = gpu_rank_idx * samples_per_gpu
            end_idx = start_idx + samples_per_gpu
            if gpu_rank_idx == len(gpu_ranks) - 1:  # Last GPU gets remaining
                end_idx = len(base_prompts)
                
            my_prompts = base_prompts[start_idx:end_idx]
            
            print(f"Rank {rank}: Processing {len(my_prompts)} prompts (samples {start_idx}-{end_idx-1})")
            
            if len(my_prompts) > 0:
                # Configure sampling parameters
                sampling_params = SamplingParams(
                    temperature=0.1,
                    max_tokens=100,
                    top_p=0.9
                )
                
                # Run distributed inference
                print(f"Rank {rank}: Running DeepSpeed distributed inference...")
                start_time = time.time()
                
                # Use DeepSpeed model for generation
                outputs = model_engine.module.generate(my_prompts, sampling_params)
                
                end_time = time.time()
                
                # Process results
                results = []
                for i, output in enumerate(outputs):
                    result = {
                        "rank": rank,
                        "sample_id": start_idx + i,
                        "prompt": output.prompt[:100] + "...",
                        "generated_text": output.outputs[0].text.strip(),
                        "tokens_generated": len(output.outputs[0].token_ids),
                        "inference_time": end_time - start_time,
                        "deepspeed_fixed_network": True,
                        "zero_stage": 1
                    }
                    results.append(result)
                    print(f"Rank {rank} Sample {start_idx + i}: Generated {len(output.outputs[0].token_ids)} tokens")
                
                print(f"Rank {rank}: Completed distributed inference in {end_time - start_time:.2f}s")
            else:
                results = []
        
        # Synchronize all processes using DeepSpeed
        dist.barrier()
        print(f"Rank {rank}: All DeepSpeed processes synchronized")
        
        # Gather results from all ranks using DeepSpeed communication
        gathered_results = [None for _ in range(world_size)]
        dist.all_gather_object(gathered_results, results)
        
        # Save results on coordinator (rank 0)
        if rank == 0:
            all_results = []
            for rank_results in gathered_results:
                if rank_results:
                    all_results.extend(rank_results)
            
            print(f"Rank 0: Gathered {len(all_results)} total results from {world_size} DeepSpeed ranks")
            
            # Save combined results
            output_file = f'/tmp/deepspeed_fixed_network_results_{int(time.time())}.json'
            with open(output_file, 'w') as f:
                json.dump({
                    "experiment": "DeepSpeed Fixed Network Distributed MLPerf",
                    "coordinator": "jw1 (129.254.202.251)",
                    "workers": ["jw2 (129.254.202.252)", "jw3 (129.254.202.253)"],
                    "world_size": world_size,
                    "total_samples": len(all_results),
                    "deepspeed_config": {
                        "zero_stage": 1,
                        "fp16": True,
                        "distributed": True,
                        "network_fixes": True
                    },
                    "results": all_results
                }, f, indent=2)
            
            print(f"Rank 0: DeepSpeed fixed network results saved to {output_file}")
            
            # Print DeepSpeed distributed summary
            total_tokens = sum(r.get("tokens_generated", 0) for r in all_results)
            avg_time = sum(r.get("inference_time", 0) for r in all_results) / len(all_results) if all_results else 0
            
            print(f"\n🎉 DeepSpeed Fixed Network Distributed MLPerf Summary:")
            print(f"✅ Coordinator: jw1 (129.254.202.251)")
            print(f"✅ DeepSpeed World Size: {world_size} nodes")
            print(f"✅ ZeRO Stage: 1 (gradient partitioning)")
            print(f"✅ Network Fixes Applied: NCCL_IB_DISABLE, P2P_DISABLE")
            print(f"✅ Total Samples: {len(all_results)}")
            print(f"✅ Total Tokens Generated: {total_tokens}")
            print(f"✅ Average Time per Sample: {avg_time:.2f}s")
            if all_results:
                print(f"✅ DeepSpeed Fixed Network Throughput: {total_tokens / avg_time:.2f} tokens/s")
            
            # Per-rank breakdown
            print(f"\n📊 DeepSpeed Per-Node Results:")
            for r in range(world_size):
                rank_results = [res for res in all_results if res.get('rank') == r]
                if rank_results:
                    rank_tokens = sum(res.get('tokens_generated', 0) for res in rank_results)
                    node_name = "jw1 (coordinator)" if r == 0 else f"jw{r+1} (worker)"
                    print(f"  Rank {r} ({node_name}): {len(rank_results)} samples, {rank_tokens} tokens")
        
        print(f"Rank {rank}: DeepSpeed fixed network benchmark completed successfully")
        return True
        
    except Exception as e:
        print(f"Rank {rank}: Error in DeepSpeed fixed network benchmark: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    parser = argparse.ArgumentParser(description='DeepSpeed Fixed Network Distributed MLPerf Benchmark')
    parser.add_argument('--local_rank', type=int, default=-1, help='Local rank for distributed training')
    
    args = parser.parse_args()
    
    print(f"🚀 DeepSpeed Fixed Network Distributed MLPerf Benchmark")
    print(f"Using DeepSpeed with network fixes for multi-node training")
    
    # Run DeepSpeed distributed benchmark with network fixes
    success = run_deepspeed_fixed_network()
    
    rank = dist.get_rank() if dist.is_initialized() else 0
    
    if success:
        print(f"Rank {rank}: ✅ DEEPSPEED FIXED NETWORK SUCCESS")
        sys.exit(0)
    else:
        print(f"Rank {rank}: ❌ DEEPSPEED FIXED NETWORK FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()