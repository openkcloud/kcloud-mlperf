#!/usr/bin/env python3
"""
MLPerf Benchmark Runner
=======================

Python fallback for MLPerf benchmark execution when mlcr fails.
Provides comprehensive benchmarking with accuracy evaluation.
"""

import os
import sys
import json
import time
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MLPerfBenchmarkRunner:
    def __init__(self, model_name="llama3_1-8b", scenario="Offline", output_dir="/app/results", hf_token="", device="cuda"):
        self.model_name = model_name
        self.scenario = scenario
        self.output_dir = Path(output_dir)
        self.hf_token = hf_token
        self.device = device
        
        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Set environment variables
        os.environ['HF_TOKEN'] = self.hf_token
        os.environ['HUGGING_FACE_HUB_TOKEN'] = self.hf_token
        
    def download_dataset(self):
        """Download CNN-DailyMail dataset"""
        logger.info("📊 Downloading CNN-DailyMail dataset...")
        
        try:
            from datasets import load_dataset
            from transformers import AutoTokenizer
            
            # Load full validation dataset (13,368 samples)
            logger.info("Loading full CNN-DailyMail validation dataset...")
            dataset = load_dataset("cnn_dailymail", "3.0.0", split="validation")
            
            # Load tokenizer
            logger.info("Loading tokenizer...")
            tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")
            tokenizer.padding_side = "left"
            tokenizer.pad_token = tokenizer.eos_token
            
            # Convert to required format
            dataset_samples = []
            logger.info(f"Processing {len(dataset)} samples...")
            for i, item in enumerate(dataset):
                if i % 1000 == 0:
                    logger.info(f"Processed {i}/{len(dataset)} samples")
                
                # Create prompt format
                instruction = f"Summarize the following article:\n\n{item['article']}\n\nSummary:"
                
                # Tokenize input
                tokenized = tokenizer(instruction, truncation=True, max_length=7000)
                
                sample = {
                    "input": instruction,
                    "tok_input": tokenized["input_ids"],
                    "output": item["highlights"]
                }
                dataset_samples.append(sample)
            
            # Save dataset
            dataset_file = self.output_dir / "cnn_dailymail_dataset.json"
            with open(dataset_file, 'w') as f:
                json.dump(dataset_samples, f, indent=2)
            
            logger.info(f"✅ Dataset created with {len(dataset_samples)} samples")
            return dataset_file
            
        except Exception as e:
            logger.error(f"❌ Dataset download failed: {e}")
            return None
    
    def run_vllm_benchmark(self, dataset_file, samples=None):
        """Run VLLM-based benchmark"""
        logger.info("🚀 Running VLLM benchmark...")
        
        try:
            from vllm import LLM, SamplingParams
            import torch
            from rouge_score import rouge_scorer
            
            # Load dataset
            with open(dataset_file) as f:
                dataset = json.load(f)
            
            if samples:
                dataset = dataset[:samples]
                logger.info(f"Using first {samples} samples")
            
            # Initialize VLLM
            logger.info("Initializing VLLM model...")
            llm = LLM(
                model="meta-llama/Llama-3.1-8B-Instruct",
                dtype="float16",
                tensor_parallel_size=1,
                gpu_memory_utilization=0.9,
                max_model_len=8192
            )
            
            # Sampling parameters
            sampling_params = SamplingParams(
                temperature=0.0,
                max_tokens=256,
                stop=["<|end_of_text|>"]
            )
            
            # Run inference
            logger.info(f"Running inference on {len(dataset)} samples...")
            inputs = [item["input"] for item in dataset]
            
            start_time = time.time()
            outputs = llm.generate(inputs, sampling_params)
            inference_time = time.time() - start_time
            
            # Collect results
            results = []
            predictions = []
            references = []
            
            for i, output in enumerate(outputs):
                generated_text = output.outputs[0].text.strip()
                reference = dataset[i]["output"]
                
                results.append({
                    "sample_id": i,
                    "input": dataset[i]["input"],
                    "prediction": generated_text,
                    "reference": reference
                })
                
                predictions.append(generated_text)
                references.append(reference)
            
            # Calculate ROUGE scores
            logger.info("Calculating ROUGE scores...")
            scorer = rouge_scorer.RougeScorer(['rouge1', 'rouge2', 'rougeL'], use_stemmer=True)
            rouge_scores = {"rouge1": [], "rouge2": [], "rougeL": []}
            
            for pred, ref in zip(predictions, references):
                scores = scorer.score(ref, pred)
                rouge_scores["rouge1"].append(scores["rouge1"].fmeasure)
                rouge_scores["rouge2"].append(scores["rouge2"].fmeasure)
                rouge_scores["rougeL"].append(scores["rougeL"].fmeasure)
            
            # Calculate averages
            avg_rouge = {
                "rouge1": sum(rouge_scores["rouge1"]) / len(rouge_scores["rouge1"]),
                "rouge2": sum(rouge_scores["rouge2"]) / len(rouge_scores["rouge2"]),  
                "rougeL": sum(rouge_scores["rougeL"]) / len(rouge_scores["rougeL"])
            }
            
            # Performance metrics
            throughput = len(dataset) / inference_time
            
            benchmark_results = {
                "metadata": {
                    "timestamp": datetime.now().isoformat(),
                    "model": "meta-llama/Llama-3.1-8B-Instruct",
                    "scenario": self.scenario,
                    "device": self.device,
                    "samples": len(dataset)
                },
                "performance": {
                    "total_time_seconds": inference_time,
                    "throughput_samples_per_second": throughput,
                    "samples_processed": len(dataset)
                },
                "accuracy": {
                    "rouge_scores": avg_rouge,
                    "individual_scores": rouge_scores
                },
                "detailed_results": results
            }
            
            # Save results
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            results_file = self.output_dir / f"benchmark_results_{timestamp}.json"
            
            with open(results_file, 'w') as f:
                json.dump(benchmark_results, f, indent=2)
            
            logger.info(f"✅ Benchmark completed successfully")
            logger.info(f"📊 Throughput: {throughput:.2f} samples/sec")
            logger.info(f"🎯 ROUGE-1: {avg_rouge['rouge1']:.4f}")
            logger.info(f"🎯 ROUGE-2: {avg_rouge['rouge2']:.4f}")
            logger.info(f"🎯 ROUGE-L: {avg_rouge['rougeL']:.4f}")
            logger.info(f"💾 Results saved to: {results_file}")
            
            return results_file
            
        except Exception as e:
            logger.error(f"❌ Benchmark failed: {e}")
            return None
    
    def run_complete_benchmark(self, samples=None):
        """Run complete benchmark pipeline"""
        logger.info("🎯 Starting complete MLPerf benchmark pipeline")
        logger.info("=" * 60)
        
        start_time = time.time()
        
        try:
            # Download dataset
            dataset_file = self.download_dataset()
            if not dataset_file:
                logger.error("❌ Dataset download failed")
                return False
            
            # Run benchmark
            results_file = self.run_vllm_benchmark(dataset_file, samples)
            if not results_file:
                logger.error("❌ Benchmark execution failed")
                return False
            
            elapsed = time.time() - start_time
            logger.info(f"\n🎉 Complete benchmark finished in {elapsed:.1f} seconds!")
            logger.info(f"📊 Results: {results_file}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Complete benchmark failed: {e}")
            return False

def main():
    parser = argparse.ArgumentParser(description="MLPerf Benchmark Runner")
    parser.add_argument("--model", default="llama3_1-8b", help="Model name")
    parser.add_argument("--scenario", default="Offline", help="Benchmark scenario")
    parser.add_argument("--output-dir", default="/app/results", help="Output directory")
    parser.add_argument("--hf-token", required=True, help="HuggingFace token")
    parser.add_argument("--device", default="cuda", help="Device (cuda/cpu)")
    parser.add_argument("--samples", type=int, help="Number of samples to process")
    
    args = parser.parse_args()
    
    runner = MLPerfBenchmarkRunner(
        model_name=args.model,
        scenario=args.scenario,
        output_dir=args.output_dir,
        hf_token=args.hf_token,
        device=args.device
    )
    
    success = runner.run_complete_benchmark(args.samples)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()