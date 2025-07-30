#!/usr/bin/env python3
"""
MMLU (Massive Multitask Language Understanding) Benchmark for LLaMA 3.1-8B
Optimized for high throughput performance
"""
import os
import json
import time
import torch
import random
import numpy as np
from vllm import LLM, SamplingParams
from datasets import load_dataset
import argparse
from typing import Dict, List, Tuple
import gc

class MMLUBenchmark:
    def __init__(self, model_path="meta-llama/Llama-3.1-8B-Instruct"):
        self.model_path = model_path
        
        # Optimized VLLM configuration for MMLU
        self.llm = LLM(
            model=model_path,
            dtype="float16",
            tensor_parallel_size=1,
            gpu_memory_utilization=0.95,
            max_model_len=1024,  # MMLU questions are shorter
            enforce_eager=False,
            max_num_batched_tokens=8192,
            max_num_seqs=64,
            seed=42
        )
        
        # Sampling parameters for multiple choice
        self.sampling_params = SamplingParams(
            temperature=0.0,  # Deterministic for evaluation
            max_tokens=10,    # Only need A, B, C, D
            top_p=1.0,
            skip_special_tokens=True,
            stop=["\n", ".", ",", " "]  # Stop at first token
        )
        
        print(f"🧠 MMLU Benchmark initialized")
    
    def format_question(self, question: str, choices: List[str]) -> str:
        """Format MMLU question for LLaMA 3.1"""
        choice_text = "\n".join([f"{chr(65+i)}. {choice}" for i, choice in enumerate(choices)])
        
        prompt = f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>
You are a helpful assistant that answers multiple choice questions. Respond with only the letter (A, B, C, or D) of the correct answer.<|eot_id|>
<|start_header_id|>user<|end_header_id|>
Question: {question}

{choice_text}

Answer:<|eot_id|>
<|start_header_id|>assistant<|end_header_id|>"""
        
        return prompt
    
    def evaluate_subject(self, subject: str, num_samples: int = None) -> Dict:
        """Evaluate a single MMLU subject"""
        print(f"\n📚 Evaluating subject: {subject}")
        
        # Load test set for this subject
        try:
            dataset = load_dataset("cais/mmlu", subject, split="test")
            if num_samples:
                dataset = dataset.select(range(min(num_samples, len(dataset))))
        except Exception as e:
            print(f"❌ Error loading {subject}: {e}")
            return {"subject": subject, "error": str(e)}
        
        # Prepare prompts
        prompts = []
        correct_answers = []
        
        for sample in dataset:
            question = sample["question"]
            choices = sample["choices"]
            answer_idx = sample["answer"]  # 0=A, 1=B, 2=C, 3=D
            
            prompt = self.format_question(question, choices)
            prompts.append(prompt)
            correct_answers.append(chr(65 + answer_idx))  # Convert to A,B,C,D
        
        # Batch processing
        batch_size = 32
        predictions = []
        
        start_time = time.time()
        
        for i in range(0, len(prompts), batch_size):
            batch = prompts[i:i+batch_size]
            outputs = self.llm.generate(batch, self.sampling_params)
            
            batch_preds = []
            for output in outputs:
                pred = output.outputs[0].text.strip().upper()
                # Extract first letter if response is longer
                if pred and pred[0] in ['A', 'B', 'C', 'D']:
                    batch_preds.append(pred[0])
                else:
                    batch_preds.append('A')  # Default guess
            
            predictions.extend(batch_preds)
        
        total_time = time.time() - start_time
        
        # Calculate accuracy
        correct = sum(1 for pred, true in zip(predictions, correct_answers) if pred == true)
        accuracy = correct / len(correct_answers)
        
        result = {
            "subject": subject,
            "total_questions": len(correct_answers),
            "correct_answers": correct,
            "accuracy": accuracy,
            "time_seconds": total_time,
            "throughput": len(prompts) / total_time
        }
        
        print(f"   ✅ Accuracy: {accuracy:.3f} ({correct}/{len(correct_answers)}) | Time: {total_time:.1f}s")
        return result
    
    def run_quick_test(self, num_subjects: int = 5, samples_per_subject: int = 50) -> Dict:
        """Run a quick test on a subset of subjects"""
        subjects = ["elementary_mathematics", "high_school_physics", "high_school_chemistry", 
                   "computer_security", "moral_scenarios"]
        test_subjects = subjects[:num_subjects]
        
        print(f"🧪 Quick test on {len(test_subjects)} subjects with {samples_per_subject} samples each")
        
        results = {}
        total_start_time = time.time()
        
        for i, subject in enumerate(test_subjects):
            print(f"Progress: {i+1}/{len(test_subjects)} subjects", end=" ")
            result = self.evaluate_subject(subject, samples_per_subject)
            results[subject] = result
        
        total_time = time.time() - total_start_time
        
        # Calculate overall statistics
        valid_results = [r for r in results.values() if "error" not in r]
        overall_accuracy = np.mean([r["accuracy"] for r in valid_results])
        
        summary = {
            "overall_accuracy": overall_accuracy,
            "total_subjects": len(test_subjects),
            "successful_subjects": len(valid_results),
            "total_time_seconds": total_time,
            "detailed_results": results
        }
        
        return summary

def main():
    parser = argparse.ArgumentParser(description="MMLU Benchmark for LLaMA 3.1-8B")
    parser.add_argument("--mode", choices=["quick"], default="quick",
                        help="Benchmark mode")
    parser.add_argument("--output", type=str, default="mmlu_results.json",
                        help="Output file")
    args = parser.parse_args()
    
    # Clear GPU cache
    torch.cuda.empty_cache()
    gc.collect()
    
    benchmark = MMLUBenchmark()
    results = benchmark.run_quick_test(5, 50)
    
    # Save results
    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)
    
    # Print summary
    print("\n" + "=" * 60)
    print("📊 MMLU BENCHMARK RESULTS")
    print("=" * 60)
    print(f"Overall Accuracy: {results['overall_accuracy']:.3f}")
    print(f"Subjects Tested: {results['successful_subjects']}/{results['total_subjects']}")
    print(f"Total Time: {results['total_time_seconds']:.1f} seconds")
    print(f"\n💾 Results saved to: {args.output}")

if __name__ == "__main__":
    main()