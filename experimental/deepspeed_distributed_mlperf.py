#!/usr/bin/env python3

import os
import sys
import torch
import deepspeed
import json
import argparse
import time
from vllm import LLM, SamplingParams
from torch.utils.data import Dataset, DataLoader
import torch.distributed as dist

class MLPerfDataset(Dataset):
    """Custom dataset for MLPerf inference"""
    def __init__(self, prompts, start_idx=0):
        self.prompts = prompts
        self.start_idx = start_idx
        
    def __len__(self):
        return len(self.prompts)
        
    def __getitem__(self, idx):
        return {
            'sample_id': self.start_idx + idx,
            'prompt': self.prompts[idx]
        }

def setup_deepspeed_distributed():
    """Initialize DeepSpeed distributed environment"""
    # DeepSpeed handles distributed initialization
    deepspeed.init_distributed()
    
    rank = dist.get_rank()
    world_size = dist.get_world_size()
    local_rank = int(os.environ.get('LOCAL_RANK', 0))
    
    print(f"DeepSpeed - Rank {rank}/{world_size}, Local rank: {local_rank}")
    
    # Set CUDA device
    if torch.cuda.is_available():
        torch.cuda.set_device(local_rank)
        device = torch.cuda.current_device()
        print(f"Rank {rank}: Using CUDA device {device}")
    else:
        print(f"Rank {rank}: CUDA not available")
        return None, None, None
        
    return rank, world_size, local_rank

def create_dummy_model():
    """Create a dummy model for DeepSpeed initialization"""
    import torch.nn as nn
    
    class DummyModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.linear = nn.Linear(10, 1)
            
        def forward(self, x):
            return self.linear(x)
    
    return DummyModel()

def run_deepspeed_vllm_benchmark(rank, world_size, local_rank, samples_per_gpu, config_path):
    """Run VLLM benchmark with DeepSpeed distributed setup"""
    print(f"Rank {rank}: Starting DeepSpeed VLLM benchmark")
    
    try:
        # Create dummy model for DeepSpeed (VLLM handles its own model loading)
        dummy_model = create_dummy_model()
        
        # Initialize DeepSpeed engine (mainly for distributed coordination)
        with open(config_path, 'r') as f:
            ds_config = json.load(f)
        
        # Reduce batch size for inference
        ds_config['train_batch_size'] = 1
        ds_config['train_micro_batch_size_per_gpu'] = 1
        ds_config['gradient_accumulation_steps'] = 1
        
        model_engine, optimizer, _, _ = deepspeed.initialize(
            model=dummy_model,
            config=ds_config
        )
        
        print(f"Rank {rank}: DeepSpeed engine initialized")
        
        # Create VLLM engine (each process uses single GPU)
        print(f"Rank {rank}: Creating VLLM engine...")
        llm = LLM(
            model="meta-llama/Llama-3.1-8B-Instruct",
            tensor_parallel_size=1,  # Single GPU per process
            dtype="float16",
            max_model_len=2048,
            gpu_memory_utilization=0.7,  # Leave room for DeepSpeed
        )
        print(f"Rank {rank}: VLLM engine created successfully")
        
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
        
        # Distribute prompts across ranks
        start_idx = rank * samples_per_gpu
        end_idx = min(start_idx + samples_per_gpu, len(base_prompts))
        my_prompts = base_prompts[start_idx:end_idx]
        
        print(f"Rank {rank}: Processing {len(my_prompts)} prompts (samples {start_idx}-{end_idx-1})")
        
        if len(my_prompts) == 0:
            print(f"Rank {rank}: No prompts assigned")
            results = []
        else:
            # Configure sampling parameters
            sampling_params = SamplingParams(
                temperature=0.1,
                max_tokens=100,
                top_p=0.9
            )
            
            # Run inference
            print(f"Rank {rank}: Running VLLM inference...")
            start_time = time.time()
            outputs = llm.generate(my_prompts, sampling_params)
            end_time = time.time()
            
            # Process results
            results = []
            for i, output in enumerate(outputs):
                result = {
                    "rank": rank,
                    "sample_id": start_idx + i,
                    "prompt": output.prompt,
                    "generated_text": output.outputs[0].text.strip(),
                    "tokens_generated": len(output.outputs[0].token_ids),
                    "inference_time": end_time - start_time
                }
                results.append(result)
                print(f"Rank {rank} Sample {start_idx + i}: Generated {len(output.outputs[0].token_ids)} tokens")
            
            print(f"Rank {rank}: Completed inference in {end_time - start_time:.2f}s")
        
        # Synchronize all processes using DeepSpeed
        dist.barrier()
        print(f"Rank {rank}: All processes synchronized")
        
        # Gather results from all ranks
        gathered_results = [None for _ in range(world_size)]
        dist.all_gather_object(gathered_results, results)
        
        # Save results on rank 0
        if rank == 0:
            all_results = []
            for rank_results in gathered_results:
                if rank_results:
                    all_results.extend(rank_results)
            
            print(f"Rank 0: Gathered {len(all_results)} total results from {world_size} ranks")
            
            # Save combined results
            output_file = f'/tmp/deepspeed_distributed_results_{int(time.time())}.json'
            with open(output_file, 'w') as f:
                json.dump({
                    "experiment": "DeepSpeed Distributed MLPerf",
                    "world_size": world_size,
                    "total_samples": len(all_results),
                    "results": all_results
                }, f, indent=2)
            
            print(f"Rank 0: Results saved to {output_file}")
            
            # Print summary
            total_tokens = sum(r.get("tokens_generated", 0) for r in all_results)
            avg_time = sum(r.get("inference_time", 0) for r in all_results) / len(all_results) if all_results else 0
            
            print(f"\n🎉 DeepSpeed Distributed MLPerf Summary:")
            print(f"✅ World Size: {world_size} GPUs")
            print(f"✅ Total Samples: {len(all_results)}")
            print(f"✅ Total Tokens Generated: {total_tokens}")
            print(f"✅ Average Time per Sample: {avg_time:.2f}s")
            print(f"✅ Throughput: {total_tokens / avg_time:.2f} tokens/s (distributed)")
        
        print(f"Rank {rank}: DeepSpeed distributed benchmark completed successfully")
        return True
        
    except Exception as e:
        print(f"Rank {rank}: Error in DeepSpeed benchmark: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    parser = argparse.ArgumentParser(description='DeepSpeed Distributed MLPerf Benchmark')
    parser.add_argument('--samples-per-gpu', type=int, default=5, help='Samples per GPU')
    parser.add_argument('--deepspeed-config', type=str, default='/home/jungwooshim/deepspeed_config.json', help='DeepSpeed config file')
    parser.add_argument('--local_rank', type=int, default=-1, help='Local rank for distributed training')
    
    args = parser.parse_args()
    
    print(f"🚀 DeepSpeed Distributed MLPerf Benchmark")
    print(f"Config: {args.deepspeed_config}")
    print(f"Samples per GPU: {args.samples_per_gpu}")
    
    # Setup distributed environment
    rank, world_size, local_rank = setup_deepspeed_distributed()
    
    if rank is None:
        print("Failed to setup distributed environment")
        sys.exit(1)
    
    # Launch distributed benchmark
    success = run_deepspeed_vllm_benchmark(
        rank, 
        world_size, 
        local_rank, 
        args.samples_per_gpu,
        args.deepspeed_config
    )
    
    if success:
        print(f"Rank {rank}: ✅ SUCCESS")
        sys.exit(0)
    else:
        print(f"Rank {rank}: ❌ FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()