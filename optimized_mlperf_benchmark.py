#!/usr/bin/env python3
import os
import json
import time
import torch
from vllm import LLM, SamplingParams
from vllm.engine.arg_utils import AsyncEngineArgs
from transformers import AutoTokenizer
from datasets import load_dataset
from rouge import Rouge
import numpy as np
from typing import List, Dict
import asyncio
from concurrent.futures import ThreadPoolExecutor
import gc

class OptimizedMLPerfBenchmark:
    def __init__(self, model_path="meta-llama/Llama-3.1-8B-Instruct"):
        self.model_path = model_path
        self.rouge = Rouge()
        
        # Optimized VLLM configuration
        self.llm = LLM(
            model=model_path,
            dtype="float16",
            tensor_parallel_size=torch.cuda.device_count(),  # Use all available GPUs
            gpu_memory_utilization=0.95,  # Increase memory utilization
            max_model_len=4096,  # Reduce from 8192 for better throughput
            enforce_eager=False,  # Enable CUDA graphs
            enable_prefix_caching=True,  # Enable prefix caching
            enable_chunked_prefill=True,  # Enable chunked prefill
            max_num_batched_tokens=16384,  # Increase batched tokens
            max_num_seqs=256,  # Increase concurrent sequences
            swap_space=8,  # Add swap space for OOM handling
            disable_log_stats=True,  # Reduce logging overhead
            seed=42
        )
        
        # Optimized sampling parameters
        self.sampling_params = SamplingParams(
            temperature=0.0,  # Greedy decoding for consistency
            top_p=1.0,
            max_tokens=256,  # Reasonable summary length
            skip_special_tokens=True,
            stop_token_ids=[self.llm.llm_engine.tokenizer.eos_token_id]
        )
        
        print(f"Initialized with {torch.cuda.device_count()} GPU(s)")
    
    def prepare_prompts(self, articles: List[str]) -> List[str]:
        """Prepare prompts with optimized template"""
        template = """<|begin_of_text|><|start_header_id|>system<|end_header_id|>
You are a helpful assistant that summarizes articles concisely.<|eot_id|>
<|start_header_id|>user<|end_header_id|>
Summarize this article in 2-3 sentences:

{article}<|eot_id|>
<|start_header_id|>assistant<|end_header_id|>"""
        
        return [template.format(article=article[:2048]) for article in articles]  # Truncate long articles
    
    def run_benchmark(self, dataset_size: int = None):
        """Run optimized benchmark"""
        print("Loading dataset...")
        dataset = load_dataset("cnn_dailymail", "3.0.0", split="test")
        
        if dataset_size:
            dataset = dataset.select(range(min(dataset_size, len(dataset))))
        
        articles = dataset["article"]
        references = dataset["highlights"]
        
        print(f"Processing {len(articles)} samples...")
        
        # Prepare all prompts
        prompts = self.prepare_prompts(articles)
        
        # Process in optimal batches
        batch_size = 64  # Optimal batch size for A30
        results = []
        total_time = 0
        
        start_time = time.time()
        
        for i in range(0, len(prompts), batch_size):
            batch_prompts = prompts[i:i+batch_size]
            batch_start = time.time()
            
            # Generate summaries
            outputs = self.llm.generate(batch_prompts, self.sampling_params)
            
            batch_time = time.time() - batch_start
            total_time += batch_time
            
            # Extract generated texts
            for output in outputs:
                results.append(output.outputs[0].text)
            
            # Progress update
            processed = min(i + batch_size, len(prompts))
            throughput = processed / (time.time() - start_time)
            print(f"Processed {processed}/{len(prompts)} samples | "
                  f"Throughput: {throughput:.2f} samples/sec | "
                  f"Batch time: {batch_time:.2f}s")
            
            # Clear cache periodically
            if i % (batch_size * 10) == 0:
                torch.cuda.empty_cache()
                gc.collect()
        
        total_time = time.time() - start_time
        
        # Calculate metrics
        rouge_scores = self.calculate_rouge(results, references)
        
        # Results
        final_results = {
            "total_samples": len(articles),
            "total_time_seconds": total_time,
            "throughput_samples_per_second": len(articles) / total_time,
            "average_time_per_sample": total_time / len(articles),
            "rouge_scores": rouge_scores,
            "configuration": {
                "model": self.model_path,
                "batch_size": batch_size,
                "max_tokens": self.sampling_params.max_tokens,
                "tensor_parallel_size": self.llm.llm_engine.model_config.tensor_parallel_size,
                "gpu_memory_utilization": 0.95,
                "enable_cuda_graphs": True,
                "enable_prefix_caching": True
            }
        }
        
        return final_results
    
    def calculate_rouge(self, predictions: List[str], references: List[str]) -> Dict:
        """Calculate ROUGE scores"""
        scores = self.rouge.get_scores(predictions, references, avg=True)
        return {
            "rouge-1": scores["rouge-1"]["f"],
            "rouge-2": scores["rouge-2"]["f"],
            "rouge-l": scores["rouge-l"]["f"]
        }
    
    def run_async_benchmark(self, dataset_size: int = None):
        """Alternative async implementation for even better throughput"""
        # Implementation for async processing if needed
        pass

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=None, help="Number of samples to process")
    parser.add_argument("--output", type=str, default="optimized_results.json", help="Output file")
    args = parser.parse_args()
    
    benchmark = OptimizedMLPerfBenchmark()
    results = benchmark.run_benchmark(args.samples)
    
    # Save results
    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)
    
    print("\n=== Benchmark Results ===")
    print(f"Total samples: {results['total_samples']}")
    print(f"Total time: {results['total_time_seconds']:.2f} seconds")
    print(f"Throughput: {results['throughput_samples_per_second']:.2f} samples/second")
    print(f"Average time per sample: {results['average_time_per_sample']:.2f} seconds")
    print(f"ROUGE-1: {results['rouge_scores']['rouge-1']:.4f}")
    print(f"ROUGE-2: {results['rouge_scores']['rouge-2']:.4f}")
    print(f"ROUGE-L: {results['rouge_scores']['rouge-l']:.4f}")

if __name__ == "__main__":
    main()