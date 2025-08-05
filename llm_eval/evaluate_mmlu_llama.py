#!/usr/bin/env python3
"""
MMLU evaluation script for LLaMA models using generation approach.
This script evaluates LLaMA models on the MMLU dataset by generating answers.
"""
import argparse
import json
import os
import torch
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM
from tqdm import tqdm
import time

def format_mmlu_prompt(question, choices):
    """Format MMLU question for LLaMA model"""
    # Format as multiple choice question with clear instructions
    prompt = f"""Answer the following multiple choice question by responding with just the letter (A, B, C, or D) of the correct answer.

Question: {question}

"""
    for i, choice in enumerate(choices):
        letter = chr(65 + i)  # A, B, C, D
        prompt += f"{letter}. {choice}\n"
    prompt += "\nAnswer: "
    return prompt

def extract_answer(generated_text):
    """Extract the answer letter from generated text"""
    # Look for first occurrence of A, B, C, or D
    generated_text = generated_text.strip()
    for char in generated_text:
        if char in ['A', 'B', 'C', 'D']:
            return ord(char) - 65  # Convert to 0-3 index
    return -1  # No valid answer found

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Evaluate LLaMA model on MMLU dataset')
    parser.add_argument('--model', type=str, default='meta-llama/Llama-3.1-8B-Instruct', help='Model name or path')
    parser.add_argument('--dataset', type=str, default='cais/mmlu', help='Dataset name')
    parser.add_argument('--batch_size', type=int, default=1, help='Batch size (1 for generation)')
    parser.add_argument('--output', type=str, required=True, help='Output file path for results')
    parser.add_argument('--max_samples', type=int, default=None, help='Maximum samples to evaluate')
    parser.add_argument('--subjects', type=str, nargs='+', default=None, help='Specific subjects to evaluate')
    args = parser.parse_args()
    
    print(f"🚀 MMLU Evaluation for LLaMA Models")
    print(f"Model: {args.model}")
    print(f"Dataset: {args.dataset}")
    
    # Set HuggingFace token from environment
    if 'HUGGINGFACEHUB_API_TOKEN' in os.environ:
        os.environ['HF_TOKEN'] = os.environ['HUGGINGFACEHUB_API_TOKEN']
    
    # Load tokenizer and model
    print("\n📥 Loading model and tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    tokenizer.pad_token = tokenizer.eos_token
    
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=torch.float16,
        device_map="auto",
        load_in_8bit=False
    )
    model.eval()
    
    # If subjects are specified, evaluate each separately
    if args.subjects:
        subjects_to_eval = args.subjects
    else:
        # Get all available subjects
        subjects_to_eval = ['all']  # For now, just use 'all' config
    
    all_results = {}
    overall_correct = 0
    overall_total = 0
    
    for subject in subjects_to_eval:
        print(f"\n📊 Evaluating subject: {subject}")
        
        # Load dataset
        try:
            if subject == 'all':
                dataset = load_dataset(args.dataset, 'all', split='validation')
            else:
                dataset = load_dataset(args.dataset, subject, split='validation')
        except Exception as e:
            print(f"⚠️  Could not load subject {subject}: {e}")
            continue
        
        # Limit samples if specified
        if args.max_samples:
            dataset = dataset.select(range(min(args.max_samples, len(dataset))))
        
        print(f"Loaded {len(dataset)} samples")
        
        correct = 0
        total = 0
        predictions = []
        
        # Process each example
        start_time = time.time()
        for idx, example in enumerate(tqdm(dataset, desc=f"Evaluating {subject}")):
            question = example['question']
            choices = example['choices']
            answer_idx = example['answer']
            
            # Format prompt
            prompt = format_mmlu_prompt(question, choices)
            
            # Tokenize
            inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)
            inputs = {k: v.to(model.device) for k, v in inputs.items()}
            
            # Generate
            with torch.no_grad():
                outputs = model.generate(
                    **inputs,
                    max_new_tokens=5,
                    temperature=0.0,  # Deterministic
                    do_sample=False,
                    pad_token_id=tokenizer.eos_token_id
                )
            
            # Decode and extract answer
            generated_text = tokenizer.decode(outputs[0][inputs['input_ids'].shape[1]:], skip_special_tokens=True)
            predicted_idx = extract_answer(generated_text)
            
            # Record prediction
            predictions.append({
                'question': question,
                'choices': choices,
                'correct_answer': answer_idx,
                'predicted_answer': predicted_idx,
                'generated_text': generated_text.strip(),
                'correct': predicted_idx == answer_idx
            })
            
            # Update counters
            if predicted_idx == answer_idx:
                correct += 1
            total += 1
            
            # Print progress every 10 samples
            if (idx + 1) % 10 == 0:
                current_accuracy = correct / total
                elapsed = time.time() - start_time
                samples_per_sec = total / elapsed
                print(f"\nProgress: {total}/{len(dataset)} | Accuracy: {current_accuracy:.4f} | Speed: {samples_per_sec:.2f} samples/sec")
        
        # Calculate accuracy
        accuracy = correct / total if total > 0 else 0
        
        # Store results
        all_results[subject] = {
            'accuracy': accuracy,
            'correct': correct,
            'total': total,
            'predictions': predictions[:10]  # Store first 10 for inspection
        }
        
        overall_correct += correct
        overall_total += total
        
        print(f"\n✅ {subject} - Accuracy: {accuracy:.4f} ({correct}/{total})")
    
    # Calculate overall accuracy
    overall_accuracy = overall_correct / overall_total if overall_total > 0 else 0
    
    # Prepare final results
    final_results = {
        'model': args.model,
        'dataset': args.dataset,
        'overall_accuracy': overall_accuracy,
        'overall_correct': overall_correct,
        'overall_total': overall_total,
        'subjects': all_results,
        'evaluation_time': time.time() - start_time,
        'samples_per_second': overall_total / (time.time() - start_time) if overall_total > 0 else 0
    }
    
    # Save results
    output_dir = os.path.dirname(args.output)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    
    with open(args.output, 'w') as f:
        json.dump(final_results, f, indent=2)
    
    # Auto-generate HTML report
    report_output = args.output.replace('.json', '_report.html')
    report_dir = os.path.dirname(report_output)
    if report_dir:
        report_dir = report_dir.replace('result_', 'report_')
        report_output = os.path.join(report_dir, os.path.basename(report_output))
        if not os.path.exists(report_dir):
            os.makedirs(report_dir, exist_ok=True)
    
    # Generate HTML report using the existing report generator
    try:
        import subprocess
        subprocess.run([
            'python', 'generate_mmlu_report.py',
            args.output, report_output
        ], check=True)
        print(f"📊 HTML report generated: {report_output}")
    except Exception as e:
        print(f"⚠️ Could not generate HTML report: {e}")
    
    print(f"\n🎯 Overall Accuracy: {overall_accuracy:.4f} ({overall_correct}/{overall_total})")
    print(f"📁 Results saved to: {args.output}")

if __name__ == '__main__':
    main()