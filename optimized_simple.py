#!/usr/bin/env python3
import os
import json
import time
import torch
from vllm import LLM, SamplingParams
from datasets import load_dataset
from rouge_score import rouge_scorer
import gc

# Set environment variables for maximum performance
os.environ['CUDA_LAUNCH_BLOCKING'] = '0'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['OMP_NUM_THREADS'] = '1'

class OptimizedSingleGPUBenchmark:
    def __init__(self, model_path="meta-llama/Llama-3.1-8B-Instruct"):
        self.model_path = model_path
        self.rouge = rouge_scorer.RougeScorer(['rouge1', 'rouge2', 'rougeL'], use_stemmer=True)
        
        # Aggressive single-GPU optimization
        self.llm = LLM(
            model=model_path,
            dtype="float16",
            tensor_parallel_size=1,  # Single GPU
            gpu_memory_utilization=0.98,  # Maximum memory usage
            max_model_len=2048,  # Reduced for higher throughput
            enforce_eager=False,  # Enable CUDA graphs
            enable_prefix_caching=True,
            enable_chunked_prefill=True,
            max_num_batched_tokens=32768,  # Increased significantly
            max_num_seqs=512,  # Maximum concurrent sequences
            swap_space=0,  # No swap for maximum speed
            disable_log_stats=True,
            disable_log_requests=True,
            trust_remote_code=True,
            download_dir="/tmp/model_cache",
            seed=42,
            # Additional optimizations
            use_v2_block_manager=True,
            preemption_mode="recompute",
            max_lora_rank=0,  # Disable LoRA
            max_cpu_loras=0,
            tokenizer_pool_size=0,  # Disable tokenizer pool overhead
            disable_sliding_window=True,
            disable_custom_all_reduce=True
        )
        
        # Greedy decoding for maximum speed
        self.sampling_params = SamplingParams(
            temperature=0.0,
            top_p=1.0,
            max_tokens=128,  # Shorter summaries for speed
            skip_special_tokens=True,
            spaces_between_special_tokens=False,
            logprobs=None,  # Disable logprobs calculation
            prompt_logprobs=None,
            detokenize=True,
            stop_token_ids=[self.llm.llm_engine.tokenizer.eos_token_id]
        )
        
        print(f"Initialized with single GPU optimization")
        print(f"Max batch tokens: 32768")
        print(f"Max concurrent sequences: 512")
    
    def prepare_prompts_batch(self, articles: list) -> list:
        """Prepare prompts with minimal template"""
        # Shorter template for less overhead
        template = "Summarize in 2 sentences:\n{article}\n\nSummary:"
        
        # Truncate articles to reduce processing time
        return [template.format(article=article[:1500]) for article in articles]
    
    def run_benchmark(self, dataset_size: int = None):
        """Run optimized benchmark with maximum batch size"""
        print("Loading dataset...")
        dataset = load_dataset("cnn_dailymail", "3.0.0", split="test", num_proc=4)
        
        if dataset_size:
            dataset = dataset.select(range(min(dataset_size, len(dataset))))
        
        articles = dataset["article"]
        references = dataset["highlights"]
        
        print(f"Processing {len(articles)} samples...")
        
        # Prepare all prompts at once
        prompts = self.prepare_prompts_batch(articles)
        
        # Find optimal batch size based on GPU memory
        # Start with large batch and reduce if OOM
        batch_sizes_to_try = [256, 192, 128, 96, 64, 32]
        optimal_batch_size = 256
        
        for batch_size in batch_sizes_to_try:
            try:
                # Test batch
                test_batch = prompts[:batch_size]
                _ = self.llm.generate(test_batch, self.sampling_params)
                optimal_batch_size = batch_size
                print(f"Using batch size: {optimal_batch_size}")
                break
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                gc.collect()
                continue
        
        # Process with optimal batch size
        results = []
        
        # Warmup
        print("Warming up...")
        warmup_batch = prompts[:min(32, len(prompts))]
        _ = self.llm.generate(warmup_batch, self.sampling_params)
        torch.cuda.synchronize()
        
        # Actual benchmark
        start_time = time.time()
        
        # Process all at once if possible
        if len(prompts) <= optimal_batch_size:
            outputs = self.llm.generate(prompts, self.sampling_params)
            results = [output.outputs[0].text for output in outputs]
        else:
            # Process in large batches
            for i in range(0, len(prompts), optimal_batch_size):
                batch_prompts = prompts[i:i+optimal_batch_size]
                
                # Generate without timing individual batches to reduce overhead
                outputs = self.llm.generate(batch_prompts, self.sampling_params)
                
                # Extract results
                results.extend([output.outputs[0].text for output in outputs])
                
                # Progress update every 10 batches
                if i % (optimal_batch_size * 10) == 0 and i > 0:
                    elapsed = time.time() - start_time
                    processed = min(i + optimal_batch_size, len(prompts))
                    throughput = processed / elapsed
                    eta = (len(prompts) - processed) / throughput
                    print(f"Progress: {processed}/{len(prompts)} | "
                          f"Throughput: {throughput:.2f} samples/sec | "
                          f"ETA: {eta:.0f}s")
        
        torch.cuda.synchronize()
        total_time = time.time() - start_time
        
        # Calculate metrics
        rouge_scores = self.calculate_rouge(results[:len(references)], references)
        
        # Results
        final_results = {
            "total_samples": len(articles),
            "total_time_seconds": total_time,
            "throughput_samples_per_second": len(articles) / total_time,
            "average_time_per_sample": total_time / len(articles),
            "optimal_batch_size": optimal_batch_size,
            "rouge_scores": rouge_scores,
            "configuration": {
                "model": self.model_path,
                "batch_size": optimal_batch_size,
                "max_tokens": self.sampling_params.max_tokens,
                "gpu_memory_utilization": 0.98,
                "max_num_batched_tokens": 32768,
                "max_num_seqs": 512,
                "max_model_len": 2048,
                "enable_cuda_graphs": True,
                "enable_prefix_caching": True,
                "enable_chunked_prefill": True
            }
        }
        
        return final_results
    
    def calculate_rouge(self, predictions: list, references: list) -> dict:
        """Calculate ROUGE scores efficiently"""
        scores = {'rouge1': 0, 'rouge2': 0, 'rougeL': 0}
        
        for pred, ref in zip(predictions, references):
            result = self.rouge.score(ref, pred)
            scores['rouge1'] += result['rouge1'].fmeasure
            scores['rouge2'] += result['rouge2'].fmeasure
            scores['rougeL'] += result['rougeL'].fmeasure
        
        # Average the scores
        n = len(predictions)
        return {
            "rouge-1": scores['rouge1'] / n,
            "rouge-2": scores['rouge2'] / n,
            "rouge-l": scores['rougeL'] / n
        }

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=None, help="Number of samples to process")
    parser.add_argument("--output", type=str, default="optimized_single_gpu_results.json", help="Output file")
    args = parser.parse_args()
    
    # Clear cache before starting
    torch.cuda.empty_cache()
    gc.collect()
    
    benchmark = OptimizedSingleGPUBenchmark()
    results = benchmark.run_benchmark(args.samples)
    
    # Save results
    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)
    
    print("\n=== Optimized Single GPU Benchmark Results ===")
    print(f"Total samples: {results['total_samples']}")
    print(f"Total time: {results['total_time_seconds']:.2f} seconds")
    print(f"Throughput: {results['throughput_samples_per_second']:.2f} samples/second")
    print(f"Speedup vs baseline: {results['throughput_samples_per_second'] / 0.75:.1f}x")
    print(f"Average time per sample: {results['average_time_per_sample']:.3f} seconds")
    print(f"Optimal batch size: {results['optimal_batch_size']}")
    print(f"ROUGE-1: {results['rouge_scores']['rouge-1']:.4f}")
    print(f"ROUGE-2: {results['rouge_scores']['rouge-2']:.4f}")
    print(f"ROUGE-L: {results['rouge_scores']['rouge-l']:.4f}")

if __name__ == "__main__":
    main()