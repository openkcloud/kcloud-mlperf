#!/usr/bin/env python3
"""
MLPerf LLaMA3.1-8B Local Benchmark with Official ROUGE Scoring
Uses locally downloaded CNN-DailyMail dataset to bypass MLCommons authentication.
Provides proper ROUGE-1, ROUGE-2, ROUGE-L scores for MLPerf compliance.
"""

import os
import json
import time
import logging
import argparse
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any

import torch
from vllm import LLM, SamplingParams
from transformers import AutoTokenizer
from rouge_score import rouge_scorer
from huggingface_hub import login

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class LocalMLPerfBenchmark:
    """MLPerf benchmark using local CNN-DailyMail dataset with proper ROUGE scoring."""
    
    def __init__(self, 
                 model_name="meta-llama/Llama-3.1-8B-Instruct",
                 dataset_path="data/cnn_dailymail/validation.json",
                 gpu_memory_utilization=0.95,
                 max_model_len=8192,
                 max_num_batched_tokens=8192,
                 max_num_seqs=256,
                 hf_token=None):
        
        self.model_name = model_name
        self.dataset_path = Path(dataset_path)
        self.hf_token = hf_token
        
        # A30-optimized VLLM settings
        self.gpu_memory_utilization = gpu_memory_utilization
        self.max_model_len = max_model_len
        self.max_num_batched_tokens = max_num_batched_tokens
        self.max_num_seqs = max_num_seqs
        
        # ROUGE scorer for official scoring
        self.rouge_scorer = rouge_scorer.RougeScorer(['rouge1', 'rouge2', 'rougeL'], use_stemmer=True)
        
        # Model and tokenizer will be loaded later
        self.llm = None
        self.tokenizer = None
    
    def authenticate_hf(self):
        """Authenticate with HuggingFace."""
        if self.hf_token:
            logger.info("🔐 Authenticating with HuggingFace...")
            login(token=self.hf_token)
            logger.info("✅ HuggingFace authentication successful")
    
    def load_dataset(self, max_samples=None):
        """Load local CNN-DailyMail dataset."""
        logger.info(f"📊 Loading local CNN-DailyMail dataset from {self.dataset_path}")
        
        if not self.dataset_path.exists():
            raise FileNotFoundError(f"Dataset not found: {self.dataset_path}")
        
        with open(self.dataset_path, 'r', encoding='utf-8') as f:
            dataset = json.load(f)
        
        total_samples = len(dataset)
        logger.info(f"✅ Loaded {total_samples:,} samples from local dataset")
        
        # Limit samples if specified
        if max_samples and max_samples < total_samples:
            dataset = dataset[:max_samples]
            logger.info(f"🎯 Limited to {max_samples:,} samples for testing")
        
        return dataset
    
    def initialize_model(self):
        """Initialize VLLM model with A30 optimizations."""
        logger.info("🚀 Initializing VLLM model with A30 optimizations...")
        logger.info(f"   Model: {self.model_name}")
        logger.info(f"   GPU Memory Utilization: {self.gpu_memory_utilization}")
        logger.info(f"   Max Model Length: {self.max_model_len}")
        logger.info(f"   Max Batched Tokens: {self.max_num_batched_tokens}")
        logger.info(f"   Max Sequences: {self.max_num_seqs}")
        
        # VLLM model initialization (compatible with container version)
        self.llm = LLM(
            model=self.model_name,
            trust_remote_code=True,
            dtype=torch.float16,
            gpu_memory_utilization=self.gpu_memory_utilization,
            max_model_len=self.max_model_len,
            enforce_eager=True,  # A30 optimization
            enable_prefix_caching=True
        )
        
        # Load tokenizer for prompt formatting
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        
        logger.info("✅ Model initialized successfully")
    
    def format_prompt(self, article: str) -> str:
        """Format article for LLaMA3.1 instruction format."""
        prompt = f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are a helpful assistant that creates concise, accurate summaries of news articles.

<|eot_id|><|start_header_id|>user<|end_header_id|>

Please provide a concise summary of the following article:

{article}

<|eot_id|><|start_header_id|>assistant<|end_header_id|>

"""
        return prompt
    
    def run_inference(self, dataset: List[Dict], batch_size: int = 100) -> List[Dict]:
        """Run VLLM inference on dataset."""
        logger.info(f"🚀 Running inference on {len(dataset):,} samples...")
        
        sampling_params = SamplingParams(
            temperature=0.1,
            top_p=0.9,
            max_tokens=150,  # Typical summary length
            stop=["<|eot_id|>", "<|end_of_text|>"]
        )
        
        results = []
        num_batches = (len(dataset) + batch_size - 1) // batch_size
        
        for batch_idx in range(num_batches):
            start_idx = batch_idx * batch_size
            end_idx = min(start_idx + batch_size, len(dataset))
            batch = dataset[start_idx:end_idx]
            
            logger.info(f"Processing batch {batch_idx + 1}/{num_batches}")
            
            # Format prompts for batch
            prompts = [self.format_prompt(item["article"]) for item in batch]
            
            # Run inference
            batch_start = time.time()
            outputs = self.llm.generate(prompts, sampling_params)
            batch_time = time.time() - batch_start
            
            # Process outputs
            for i, output in enumerate(outputs):
                original_item = batch[i]
                generated_text = output.outputs[0].text.strip()
                
                results.append({
                    "id": original_item["id"],
                    "article": original_item["article"],
                    "reference_summary": original_item["highlights"],
                    "generated_summary": generated_text,
                    "source": "local_cnn_dailymail"
                })
            
            # Log progress
            throughput = len(batch) / batch_time
            logger.info(f"   Batch {batch_idx + 1} completed: {throughput:.1f} samples/sec")
        
        logger.info("✅ Inference completed")
        return results
    
    def compute_rouge_scores(self, results: List[Dict]) -> Dict[str, float]:
        """Compute official ROUGE scores."""
        logger.info("📊 Computing ROUGE scores...")
        
        rouge1_scores = []
        rouge2_scores = []
        rougeL_scores = []
        
        for i, result in enumerate(results):
            if i % 1000 == 0:
                logger.info(f"   Computed ROUGE for {i:,}/{len(results):,} samples")
            
            reference = result["reference_summary"]
            generated = result["generated_summary"]
            
            # Compute ROUGE scores
            scores = self.rouge_scorer.score(reference, generated)
            
            rouge1_scores.append(scores['rouge1'].fmeasure)
            rouge2_scores.append(scores['rouge2'].fmeasure)
            rougeL_scores.append(scores['rougeL'].fmeasure)
        
        # Calculate averages
        avg_rouge1 = sum(rouge1_scores) / len(rouge1_scores)
        avg_rouge2 = sum(rouge2_scores) / len(rouge2_scores)
        avg_rougeL = sum(rougeL_scores) / len(rougeL_scores)
        
        rouge_results = {
            "rouge1": avg_rouge1,
            "rouge2": avg_rouge2,
            "rougeL": avg_rougeL,
            "num_samples": len(results)
        }
        
        logger.info("✅ ROUGE computation completed")
        logger.info(f"📊 ROUGE-1: {avg_rouge1:.4f}")
        logger.info(f"📊 ROUGE-2: {avg_rouge2:.4f}")
        logger.info(f"📊 ROUGE-L: {avg_rougeL:.4f}")
        
        return rouge_results
    
    def save_results(self, results: List[Dict], rouge_scores: Dict, output_dir: str):
        """Save benchmark results."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save detailed results
        results_file = output_path / f"local_rouge_results_{timestamp}.json"
        with open(results_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        
        # Save summary report
        summary = {
            "benchmark_type": "MLPerf LLaMA3.1-8B Local ROUGE",
            "model": self.model_name,
            "dataset": "CNN-DailyMail 3.0.0 (local)",
            "num_samples": len(results),
            "rouge_scores": rouge_scores,
            "mlperf_targets": {
                "rouge1": 38.78,
                "rouge2": 15.91,
                "rougeL": 24.50
            },
            "timestamp": timestamp,
            "gpu_config": {
                "memory_utilization": self.gpu_memory_utilization,
                "max_model_len": self.max_model_len,
                "max_batched_tokens": self.max_num_batched_tokens,
                "max_sequences": self.max_num_seqs
            }
        }
        
        summary_file = output_path / f"local_rouge_summary_{timestamp}.json"
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
        
        logger.info(f"📁 Results saved to {output_path}")
        logger.info(f"📊 Detailed results: {results_file.name}")
        logger.info(f"📈 Summary report: {summary_file.name}")
        
        return str(summary_file)
    
    def run_benchmark(self, max_samples=None, batch_size=100, output_dir="results/local_rouge"):
        """Run complete benchmark."""
        logger.info("🚀 Starting Local MLPerf ROUGE Benchmark")
        logger.info("=" * 50)
        
        start_time = time.time()
        
        try:
            # Authenticate
            self.authenticate_hf()
            
            # Load dataset
            dataset = self.load_dataset(max_samples)
            
            # Initialize model
            self.initialize_model()
            
            # Run inference
            results = self.run_inference(dataset, batch_size)
            
            # Compute ROUGE scores
            rouge_scores = self.compute_rouge_scores(results)
            
            # Save results
            summary_file = self.save_results(results, rouge_scores, output_dir)
            
            total_time = time.time() - start_time
            logger.info(f"✅ Benchmark completed in {total_time:.1f}s")
            logger.info(f"📊 Average throughput: {len(results) / total_time:.2f} samples/sec")
            
            # Compare with MLPerf targets
            targets = {"rouge1": 38.78, "rouge2": 15.91, "rougeL": 24.50}
            logger.info("\n🎯 MLPerf Target Comparison:")
            for metric, target in targets.items():
                actual = rouge_scores[metric]
                status = "✅" if actual >= target else "❌"
                logger.info(f"   {metric.upper()}: {actual:.4f} (target: {target:.2f}) {status}")
            
            return summary_file
            
        except Exception as e:
            logger.error(f"❌ Benchmark failed: {e}")
            raise

def main():
    parser = argparse.ArgumentParser(description="MLPerf Local ROUGE Benchmark")
    parser.add_argument("--model", default="meta-llama/Llama-3.1-8B-Instruct",
                       help="Model name")
    parser.add_argument("--dataset", default="data/cnn_dailymail/validation.json",
                       help="Local dataset path")
    parser.add_argument("--max-samples", type=int,
                       help="Limit number of samples")
    parser.add_argument("--batch-size", type=int, default=100,
                       help="Inference batch size")
    parser.add_argument("--output-dir", default="results/local_rouge",
                       help="Output directory")
    parser.add_argument("--hf-token",
                       help="HuggingFace token")
    
    args = parser.parse_args()
    
    # Get token from env if not provided
    hf_token = args.hf_token or os.getenv("HF_TOKEN")
    
    # Create benchmark instance
    benchmark = LocalMLPerfBenchmark(
        model_name=args.model,
        dataset_path=args.dataset,
        hf_token=hf_token
    )
    
    # Run benchmark
    benchmark.run_benchmark(
        max_samples=args.max_samples,
        batch_size=args.batch_size,
        output_dir=args.output_dir
    )

if __name__ == "__main__":
    main()