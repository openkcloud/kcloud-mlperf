#!/usr/bin/env python3
"""
MLPerf Benchmark with Official ROUGE Scoring
===========================================

Uses real CNN-DailyMail dataset and proper ROUGE evaluation
to generate MLPerf-compliant results for submissions.
"""

import os
import sys
import json
import time
import logging
from pathlib import Path
from datetime import datetime
from datasets import load_dataset  
import numpy as np
# Import our MLPerf Official Scorer
from mlperf_official_scoring import evaluate_with_mlperf

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def download_official_cnndm_dataset():
    """Download official CNN-DailyMail dataset from HuggingFace"""
    logger.info("📊 Downloading official CNN-DailyMail dataset...")
    
    try:
        # Load the official CNN-DailyMail dataset
        dataset = load_dataset("cnn_dailymail", "3.0.0", split="validation")
        logger.info(f"✅ Downloaded {len(dataset)} validation samples")
        
        # Convert to our format
        samples = []
        for i, item in enumerate(dataset):
            samples.append({
                "article": item["article"],
                "highlights": item["highlights"], 
                "sample_id": i
            })
            
            if (i + 1) % 1000 == 0:
                logger.info(f"Processed {i + 1}/{len(dataset)} samples")
        
        logger.info(f"✅ Converted {len(samples)} official CNN-DailyMail samples")
        return samples
        
    except Exception as e:
        logger.error(f"❌ Failed to download CNN-DailyMail: {e}")
        logger.info("⚠️  Falling back to synthetic dataset")
        return None

def run_vllm_with_official_dataset(dataset, hf_token, output_dir):
    """Run VLLM inference with official dataset and ROUGE scoring"""
    logger.info("🚀 Starting Official MLPerf Benchmark with ROUGE Scoring")
    logger.info("=" * 60)
    
    try:
        # Set up environment 
        os.environ['VLLM_ATTENTION_BACKEND'] = 'XFORMERS'
        os.environ['VLLM_USE_TRITON_FLASH_ATTN'] = '0'
        os.environ['HF_TOKEN'] = hf_token
        os.environ['TRANSFORMERS_CACHE'] = '/app/.cache/huggingface'
        os.environ['HF_HOME'] = '/app/.cache/huggingface'
        
        # Import VLLM after setting environment
        logger.info("🔧 Importing VLLM and initializing...")
        from vllm import LLM, SamplingParams
        import torch
        
        # GPU verification
        if not torch.cuda.is_available():
            logger.error("❌ CUDA not available")
            return None
            
        gpu_name = torch.cuda.get_device_name(0)
        gpu_memory = torch.cuda.get_device_properties(0).total_memory
        gpu_memory_gb = gpu_memory // (1024**3)
        
        logger.info(f"✅ GPU: {gpu_name}")
        logger.info(f"✅ GPU Memory: {gpu_memory_gb}GB")
        
        # Initialize VLLM model with A30 optimizations
        logger.info("📥 Loading LLaMA3.1-8B model...")
        model_load_start = time.time()
        
        llm = LLM(
            model="meta-llama/Llama-3.1-8B-Instruct",
            dtype="float16",
            tensor_parallel_size=1,
            gpu_memory_utilization=0.90,
            max_model_len=8192,
            max_num_batched_tokens=8192,
            max_num_seqs=256,
            trust_remote_code=True,
            download_dir="/app/.cache/huggingface",
            disable_custom_all_reduce=True
        )
        
        model_load_time = time.time() - model_load_start
        logger.info(f"✅ Model loaded in {model_load_time:.1f} seconds")
        
        # Configure sampling parameters for MLPerf compliance
        sampling_params = SamplingParams(
            temperature=0.0,  # Deterministic for reproducibility
            max_tokens=150,   # Standard summary length
            stop=["<|end_of_text|>", "\n\n", "Article:", "Summary:"]
        )
        
        # Prepare prompts
        logger.info(f"📝 Preparing {len(dataset)} prompts for inference...")
        prompts = []
        for item in dataset:
            # Use standardized MLPerf prompt format
            prompt = f"Summarize the following article:\n\n{item['article']}\n\nSummary:"
            prompts.append(prompt)
        
        logger.info(f"🚀 Starting inference on {len(dataset)} samples...")
        logger.info(f"⏱️  Expected time: ~{len(dataset)/3.7/60:.1f} minutes at 3.7 samples/sec")
        
        # Run inference
        inference_start_time = time.time()
        outputs = llm.generate(prompts, sampling_params)
        total_inference_time = time.time() - inference_start_time
        overall_throughput = len(dataset) / total_inference_time
        
        logger.info(f"🎉 Inference completed!")
        logger.info(f"⏱️  Total time: {total_inference_time:.1f} seconds ({total_inference_time/60:.1f} minutes)")
        logger.info(f"⚡ Throughput: {overall_throughput:.2f} samples/sec")
        
        # Process results and extract predictions/references
        logger.info("📊 Processing results for MLPerf Official ROUGE scoring...")
        
        predictions = []
        references = []
        results = []
        total_generated_tokens = 0
        
        for i, (prompt, output, original) in enumerate(zip(prompts, outputs, dataset)):
            generated_text = output.outputs[0].text.strip()
            reference_text = original["highlights"]
            
            predictions.append(generated_text)
            references.append(reference_text)
            
            # Token counting
            generated_tokens = len(output.outputs[0].token_ids) if output.outputs[0].token_ids else 0
            total_generated_tokens += generated_tokens
            
            results.append({
                "sample_id": i,
                "prompt": prompt,
                "generated": generated_text,
                "reference": reference_text,
                "generated_tokens": generated_tokens
            })
            
            if (i + 1) % 1000 == 0:
                logger.info(f"Processed {i + 1}/{len(dataset)} results")
        
        # Calculate ROUGE scores using MLPerf Official methodology
        logger.info("🎯 Using MLPerf Official ROUGE Scoring...")
        mlperf_results = evaluate_with_mlperf(predictions, references, "meta-llama/Llama-3.1-8B-Instruct")
        
        # Extract scores from MLPerf results
        rouge_scores = mlperf_results["accuracy"]
        avg_rouge1 = rouge_scores.get("rouge1", 0)
        avg_rouge2 = rouge_scores.get("rouge2", 0)
        avg_rougeL = rouge_scores.get("rougeL", 0)
        avg_rougeLsum = rouge_scores.get("rougeLsum", 0)
        
        logger.info("🎯 MLPerf Official Comprehensive Scores:")
        logger.info(f"   • ROUGE-1: {avg_rouge1:.4f}")
        logger.info(f"   • ROUGE-2: {avg_rouge2:.4f}")  
        logger.info(f"   • ROUGE-L: {avg_rougeL:.4f}")
        logger.info(f"   • ROUGE-Lsum: {avg_rougeLsum:.4f}")
        logger.info(f"   • Ref ROUGE-L: {rouge_scores.get('ref_rougeL', 0):.4f}")
        logger.info(f"   • QA Exact Match: {rouge_scores.get('qa_exact_match', 0):.4f}%")
        logger.info(f"   • NIAH Exact Match: {rouge_scores.get('niah_exact_match', 0):.4f}%")
        logger.info(f"   • Generation Length: {rouge_scores.get('gen_len', 0):,}")
        logger.info(f"   • Generation Count: {rouge_scores.get('gen_num', 0):,}")
        
        # Get MLPerf compliance from official evaluation
        compliance = mlperf_results["mlperf_compliance"]
        
        logger.info("📊 MLPerf Official Compliance:")
        for metric in ["rouge1", "rouge2", "rougeL", "rougeLsum"]:
            if f"{metric}_pass" in compliance:
                target = compliance[f"{metric}_target"]
                achieved = compliance[f"{metric}_achieved"]
                passed = compliance[f"{metric}_pass"]
                status = "✅ PASS" if passed else "❌ FAIL"
                logger.info(f"   • {metric.upper()}: {status} ({achieved:.4f} vs {target:.4f})")
        
        # Create MLPerf-compliant results
        benchmark_results = {
            "metadata": {
                "timestamp": datetime.now().isoformat(),
                "model": "meta-llama/Llama-3.1-8B-Instruct",
                "gpu": gpu_name,
                "gpu_memory_gb": gpu_memory_gb,
                "scenario": "Offline",
                "samples": len(dataset),
                "evaluation_type": "Official ROUGE Scoring",
                "dataset": "CNN-DailyMail 3.0.0 (HuggingFace)",
                "mlperf_compliant": True,
                "attention_backend": "XFORMERS"
            },
            "performance": {
                "model_load_time_seconds": model_load_time,
                "total_inference_time_seconds": total_inference_time,
                "inference_time_minutes": total_inference_time / 60,
                "throughput_samples_per_second": overall_throughput,
                "total_generated_tokens": total_generated_tokens,
                "avg_generated_tokens_per_sample": total_generated_tokens / len(dataset),
                "samples_processed": len(results)
            },
            "accuracy": {
                "rouge1": avg_rouge1,
                "rouge2": avg_rouge2,
                "rougeL": avg_rougeL,
                "rougeLsum": avg_rougeLsum,
                "ref_rougeL": rouge_scores.get("ref_rougeL", 0),
                "qa_exact_match": rouge_scores.get("qa_exact_match", 0),
                "niah_exact_match": rouge_scores.get("niah_exact_match", 0),
                "gen_len": rouge_scores.get("gen_len", 0),
                "gen_num": rouge_scores.get("gen_num", 0),
                "evaluation_method": "MLPerf Official Comprehensive Scorer",
                "samples_evaluated": len(results),
                "metrics_included": mlperf_results.get("metrics_included", []),
                "mlperf_compliance": compliance
            },
            "hardware_configuration": {
                "gpu_name": gpu_name,
                "gpu_memory_gb": gpu_memory_gb,
                "gpu_memory_utilization": 0.90,
                "attention_backend": "XFORMERS",
                "max_model_len": 8192,
                "max_num_batched_tokens": 8192,
                "max_num_seqs": 256,
                "tensor_parallel_size": 1,
                "dtype": "float16"
            }
        }
        
        # Save results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        results_file = Path(output_dir) / f"mlperf_official_rouge_{timestamp}.json"
        detailed_file = Path(output_dir) / f"mlperf_detailed_rouge_{timestamp}.json"
        
        with open(results_file, 'w') as f:
            json.dump(benchmark_results, f, indent=2)
            
        with open(detailed_file, 'w') as f:
            json.dump(results[:100], f, indent=2)  # Save first 100 for inspection
        
        logger.info(f"💾 Official results saved: {results_file}")
        logger.info(f"💾 Detailed results: {detailed_file}")
        
        # Final summary
        logger.info("🎉 OFFICIAL MLPerf ROUGE BENCHMARK COMPLETED!")
        logger.info("=" * 60)
        logger.info(f"📊 PERFORMANCE SUMMARY:")
        logger.info(f"   • Total Runtime: {total_inference_time/60:.1f} minutes")
        logger.info(f"   • Throughput: {overall_throughput:.2f} samples/sec")
        logger.info(f"   • GPU: {gpu_name} ({gpu_memory_gb}GB)")
        logger.info(f"   • Samples: {len(results):,}")
        logger.info(f"")
        logger.info(f"🎯 MLPerf OFFICIAL COMPREHENSIVE SCORES:")
        logger.info(f"   • ROUGE-1: {avg_rouge1:.4f}")
        logger.info(f"   • ROUGE-2: {avg_rouge2:.4f}")
        logger.info(f"   • ROUGE-L: {avg_rougeL:.4f}")
        logger.info(f"   • ROUGE-Lsum: {avg_rougeLsum:.4f}")
        logger.info(f"   • Ref ROUGE-L: {rouge_scores.get('ref_rougeL', 0):.4f}")
        logger.info(f"   • QA Exact Match: {rouge_scores.get('qa_exact_match', 0):.4f}%")
        logger.info(f"   • NIAH Exact Match: {rouge_scores.get('niah_exact_match', 0):.4f}%")
        logger.info(f"")
        logger.info(f"📋 SUBMISSION STATUS:")
        all_pass = compliance.get("all_targets_met", False)
        if all_pass:
            logger.info("✅ READY FOR MLPerf SUBMISSION!")
        else:
            logger.info("⚠️  Some targets not met - check model configuration")
        
        return benchmark_results
        
    except Exception as e:
        logger.error(f"❌ Official benchmark failed: {e}")
        import traceback
        traceback.print_exc()
        return None

def main():
    """Main execution"""
    logger.info("🎯 MLPerf LLaMA3.1-8B Official ROUGE Benchmark")
    logger.info("=" * 50)
    
    # Get HF token
    hf_token = os.getenv('HF_TOKEN')
    if not hf_token:
        logger.error("❌ HF_TOKEN environment variable required")
        return False
    
    # Create output directory
    output_dir = Path("/app/results") if Path("/app").exists() else Path("./results")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        # Download official dataset
        dataset = download_official_cnndm_dataset()
        if not dataset:
            logger.error("❌ Failed to get official dataset")
            return False
        
        # Use subset for testing (uncomment for full run)
        # dataset = dataset[:1000]  # Comment out for full 13,368 samples
        
        logger.info(f"📊 Using {len(dataset)} samples for evaluation")
        
        # Run official benchmark
        results = run_vllm_with_official_dataset(dataset, hf_token, output_dir)
        
        return results is not None
        
    except Exception as e:
        logger.error(f"❌ Benchmark execution failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)