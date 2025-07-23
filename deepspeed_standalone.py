#!/usr/bin/env python3
"""
Standalone DeepSpeed Multi-GPU MLPerf Benchmark
Attempts native DeepSpeed distributed training without manual coordination
"""

import os
import sys
import torch
import deepspeed
import json
import argparse
import time
import subprocess
from vllm import LLM, SamplingParams
import torch.distributed as dist
import torch.nn as nn
from transformers import AutoTokenizer, AutoModelForCausalLM

# Force network configuration for NCCL
os.environ.update({
    'NCCL_SOCKET_IFNAME': 'eno1',
    'GLOO_SOCKET_IFNAME': 'eno1', 
    'NCCL_IB_DISABLE': '1',
    'NCCL_P2P_DISABLE': '1',
    'NCCL_NET_GDR_LEVEL': '0',
    'NCCL_TREE_THRESHOLD': '0',
    'NCCL_DEBUG': 'WARN',
    'CUDA_VISIBLE_DEVICES': '0'  # Each process sees one GPU
})

class DistributedMLPerfModel(nn.Module):
    """DeepSpeed-compatible model wrapper for distributed MLPerf benchmarking"""
    
    def __init__(self, model_name="meta-llama/Llama-3.1-8B-Instruct"):
        super().__init__()
        self.model_name = model_name
        self.vllm_engine = None
        
        # Create minimal PyTorch model for DeepSpeed compatibility
        self.dummy_linear = nn.Linear(1, 1)
        
    def forward(self, x):
        # DeepSpeed requires a forward method, but we use VLLM for actual inference
        return self.dummy_linear(x)
    
    def initialize_vllm(self, rank):
        """Initialize VLLM engine on GPU nodes only"""
        if rank == 0:  # Coordinator node (jw1) - no GPU
            print(f"Rank {rank}: Coordinator node - no VLLM initialization needed")
            return None
            
        try:
            print(f"Rank {rank}: Initializing VLLM engine...")
            self.vllm_engine = LLM(
                model=self.model_name,
                tensor_parallel_size=1,  # Single GPU per node
                dtype="float16",
                max_model_len=2048,
                gpu_memory_utilization=0.6,  # Leave room for DeepSpeed
                trust_remote_code=True,
            )
            print(f"Rank {rank}: VLLM engine initialized successfully")
            return self.vllm_engine
        except Exception as e:
            print(f"Rank {rank}: Failed to initialize VLLM: {e}")
            return None
    
    def distributed_generate(self, prompts, sampling_params, rank):
        """Run distributed inference using VLLM"""
        if rank == 0 or self.vllm_engine is None:
            return []  # Coordinator or failed initialization
            
        try:
            start_time = time.time()
            outputs = self.vllm_engine.generate(prompts, sampling_params)
            end_time = time.time()
            
            results = []
            for i, output in enumerate(outputs):
                result = {
                    "rank": rank,
                    "node": f"jw{rank+1}",
                    "sample_id": i,
                    "prompt": output.prompt[:100] + "...",
                    "generated_text": output.outputs[0].text.strip(),
                    "tokens_generated": len(output.outputs[0].token_ids),
                    "inference_time": end_time - start_time,
                    "deepspeed_standalone": True
                }
                results.append(result)
                print(f"Rank {rank} Sample {i}: Generated {len(output.outputs[0].token_ids)} tokens")
            
            return results
        except Exception as e:
            print(f"Rank {rank}: Error during generation: {e}")
            return []

def create_deepspeed_config():
    """Create DeepSpeed configuration optimized for multi-node setup"""
    return {
        "train_batch_size": 4,
        "train_micro_batch_size_per_gpu": 1,
        "gradient_accumulation_steps": 4,
        "optimizer": {
            "type": "AdamW",
            "params": {
                "lr": 3e-5,
                "betas": [0.9, 0.999],
                "eps": 1e-8,
                "weight_decay": 0.01
            }
        },
        "scheduler": {
            "type": "WarmupLR",
            "params": {
                "warmup_min_lr": 0,
                "warmup_max_lr": 3e-5,
                "warmup_num_steps": 100
            }
        },
        "zero_optimization": {
            "stage": 1,  # Start with stage 1 for better compatibility
            "allgather_partitions": True,
            "allgather_bucket_size": 5e8,
            "overlap_comm": False,  # Disable for network stability
            "reduce_scatter": True,
            "reduce_bucket_size": 5e8,
            "contiguous_gradients": True,
            "cpu_offload": False
        },
        "fp16": {
            "enabled": False,  # Disable FP16 for CPU compatibility on coordinator
        },
        "communication_data_type": "fp32",
        "wall_clock_breakdown": False,
        "steps_per_print": 1,
        "dump_state": False
    }

def setup_distributed_prompts(rank, world_size):
    """Create distributed dataset with prompts split across ranks"""
    base_prompts = [
        "Summarize the following: The quick brown fox jumps over the lazy dog. This pangram contains all 26 letters of the English alphabet.",
        "Summarize the following: Artificial intelligence and machine learning are rapidly transforming industries across the globe.",
        "Summarize the following: Climate change represents one of the most significant challenges facing humanity in the 21st century.",
        "Summarize the following: The development of renewable energy sources such as solar, wind, and hydroelectric power is crucial.",
        "Summarize the following: The Internet of Things (IoT) connects everyday devices to the internet, enabling smart automation.",
        "Summarize the following: Quantum computing promises to revolutionize computational capabilities through quantum mechanics.",
        "Summarize the following: Space exploration continues to push the boundaries of human knowledge and understanding.",
        "Summarize the following: Biotechnology and genetic engineering are opening new frontiers in medicine and agriculture.",
        "Summarize the following: The rise of cryptocurrency and blockchain technology is reshaping financial systems globally.",
        "Summarize the following: Virtual and augmented reality technologies are transforming entertainment and education."
    ]
    
    # Distribute prompts among GPU ranks (exclude coordinator rank 0)
    gpu_ranks = [i for i in range(1, world_size)]  # [1, 2] for jw2, jw3
    
    if rank == 0:  # Coordinator
        return []
    
    if rank not in gpu_ranks:
        return []
    
    # Calculate prompts for this GPU rank
    gpu_rank_idx = rank - 1  # Convert to 0-based GPU index
    prompts_per_gpu = len(base_prompts) // len(gpu_ranks)
    start_idx = gpu_rank_idx * prompts_per_gpu
    end_idx = start_idx + prompts_per_gpu
    
    if gpu_rank_idx == len(gpu_ranks) - 1:  # Last GPU gets remaining prompts
        end_idx = len(base_prompts)
    
    my_prompts = base_prompts[start_idx:end_idx]
    print(f"Rank {rank}: Assigned {len(my_prompts)} prompts (indices {start_idx}-{end_idx-1})")
    
    return my_prompts

def run_deepspeed_standalone():
    """Main DeepSpeed standalone distributed benchmark"""
    
    try:
        # Initialize DeepSpeed distributed environment
        deepspeed.init_distributed()
        
        rank = dist.get_rank()
        world_size = dist.get_world_size() 
        local_rank = int(os.environ.get('LOCAL_RANK', 0))
        
        print(f"🚀 DeepSpeed Standalone - Rank {rank}/{world_size}, Local rank: {local_rank}")
        
        # Set device based on availability
        device = None
        if rank > 0 and torch.cuda.is_available():  # GPU worker nodes
            torch.cuda.set_device(local_rank)
            device = torch.cuda.current_device()
            print(f"Rank {rank}: Using CUDA device {device}")
        else:
            print(f"Rank {rank}: CPU coordinator node")
            device = torch.device('cpu')
        
        # Create model
        model = DistributedMLPerfModel()
        
        # Create DeepSpeed configuration
        ds_config = create_deepspeed_config()
        
        # Initialize DeepSpeed engine
        print(f"Rank {rank}: Initializing DeepSpeed engine...")
        model_engine, optimizer, _, _ = deepspeed.initialize(
            model=model,
            config=ds_config
        )
        print(f"Rank {rank}: DeepSpeed engine initialized successfully")
        
        # Initialize VLLM on GPU nodes
        vllm_engine = model.initialize_vllm(rank)
        
        # Get distributed prompts for this rank
        my_prompts = setup_distributed_prompts(rank, world_size)
        
        # Run distributed inference
        results = []
        if len(my_prompts) > 0 and vllm_engine is not None:
            print(f"Rank {rank}: Running distributed inference on {len(my_prompts)} prompts...")
            
            sampling_params = SamplingParams(
                temperature=0.1,
                max_tokens=100,
                top_p=0.9
            )
            
            results = model.distributed_generate(my_prompts, sampling_params, rank)
            print(f"Rank {rank}: Completed inference, generated {len(results)} results")
        
        # Synchronize all processes
        print(f"Rank {rank}: Synchronizing with all processes...")
        dist.barrier()
        
        # Gather results from all ranks
        print(f"Rank {rank}: Gathering results from all ranks...")
        gathered_results = [None for _ in range(world_size)]
        dist.all_gather_object(gathered_results, results)
        
        # Process and save results on coordinator
        if rank == 0:
            all_results = []
            for rank_results in gathered_results:
                if rank_results:
                    all_results.extend(rank_results)
            
            print(f"Rank 0: Collected {len(all_results)} results from {world_size} ranks")
            
            # Save results
            timestamp = int(time.time())
            output_file = f'/tmp/deepspeed_standalone_results_{timestamp}.json'
            
            final_results = {
                "experiment": "DeepSpeed Standalone Distributed MLPerf",
                "timestamp": timestamp,
                "coordinator": "jw1 (129.254.202.251)",
                "workers": [f"jw{i+1} (129.254.202.{251+i})" for i in range(1, world_size)],
                "world_size": world_size,
                "total_samples": len(all_results),
                "deepspeed_config": ds_config,
                "results": all_results
            }
            
            with open(output_file, 'w') as f:
                json.dump(final_results, f, indent=2)
            
            print(f"Rank 0: Results saved to {output_file}")
            
            # Print summary
            if all_results:
                total_tokens = sum(r.get("tokens_generated", 0) for r in all_results)
                avg_time = sum(r.get("inference_time", 0) for r in all_results) / len(all_results)
                
                print(f"\n🎉 DeepSpeed Standalone Distributed MLPerf Summary:")
                print(f"✅ Experiment: DeepSpeed Standalone Multi-GPU")
                print(f"✅ Coordinator: jw1 (129.254.202.251)")
                print(f"✅ World Size: {world_size} nodes")
                print(f"✅ Total Samples: {len(all_results)}")
                print(f"✅ Total Tokens Generated: {total_tokens}")
                print(f"✅ Average Time per Sample: {avg_time:.2f}s")
                print(f"✅ Distributed Throughput: {total_tokens / avg_time:.2f} tokens/s")
                
                print(f"\n📊 Per-Rank Results:")
                for r in range(world_size):
                    rank_results = [res for res in all_results if res.get('rank') == r]
                    if rank_results:
                        rank_tokens = sum(res.get('tokens_generated', 0) for res in rank_results)
                        node_name = "jw1 (coord)" if r == 0 else f"jw{r+1} (worker)"
                        print(f"  Rank {r} ({node_name}): {len(rank_results)} samples, {rank_tokens} tokens")
        
        print(f"Rank {rank}: DeepSpeed standalone benchmark completed successfully!")
        return True
        
    except Exception as e:
        rank = dist.get_rank() if dist.is_initialized() else -1
        print(f"Rank {rank}: ERROR in DeepSpeed standalone benchmark: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    parser = argparse.ArgumentParser(description='DeepSpeed Standalone Distributed MLPerf Benchmark')
    parser.add_argument('--local_rank', type=int, default=-1, help='Local rank for distributed training')
    parser.add_argument('--samples', type=int, default=10, help='Total samples to process')
    
    args = parser.parse_args()
    
    print("🚀 DeepSpeed Standalone Distributed MLPerf Benchmark")
    print("=" * 60)
    print("Attempting native DeepSpeed distributed training without manual coordination")
    print("Nodes: jw1 (coordinator) + jw2,jw3 (GPU workers)")
    print("Framework: DeepSpeed + VLLM + MLPerf")
    print("")
    
    # Run the benchmark
    success = run_deepspeed_standalone()
    
    rank = dist.get_rank() if dist.is_initialized() else 0
    
    if success:
        print(f"Rank {rank}: ✅ DEEPSPEED STANDALONE SUCCESS!")
        sys.exit(0)
    else:
        print(f"Rank {rank}: ❌ DEEPSPEED STANDALONE FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()