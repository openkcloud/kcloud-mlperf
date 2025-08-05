#!/usr/bin/env python3
"""
Simulation test for MMLU evaluation without requiring actual model or torch.
This verifies the data loading and processing logic.
"""
import argparse
import json
import os
from datasets import load_dataset
import evaluate
import random

def simulate_model_predictions(num_samples, num_choices=4):
    """Simulate model predictions for testing"""
    return [random.randint(0, num_choices-1) for _ in range(num_samples)]

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Test MMLU evaluation pipeline')
    parser.add_argument('--model', type=str, default='meta-llama/Llama-3.1-8B-Instruct')
    parser.add_argument('--dataset', type=str, default='cais/mmlu')
    parser.add_argument('--batch_size', type=int, default=16)
    parser.add_argument('--output', type=str, default='/tmp/mmlu_test_results.json')
    parser.add_argument('--max_samples', type=int, default=100, help='Max samples to test')
    args = parser.parse_args()
    
    print(f"Testing MMLU evaluation pipeline...")
    print(f"Model: {args.model}")
    print(f"Dataset: {args.dataset}")
    print(f"Batch size: {args.batch_size}")
    
    # Set HF token if available
    if 'HUGGINGFACEHUB_API_TOKEN' in os.environ:
        os.environ['HF_TOKEN'] = os.environ['HUGGINGFACEHUB_API_TOKEN']
    
    try:
        # Load dataset
        print("\nLoading dataset...")
        dataset = load_dataset(args.dataset, 'all', split=f'validation[:{args.max_samples}]')
        print(f"Loaded {len(dataset)} samples")
        
        # Load accuracy metric
        print("\nLoading accuracy metric...")
        try:
            accuracy_metric = evaluate.load("accuracy")
            print("Accuracy metric loaded successfully")
        except Exception as e:
            print(f"Warning: Could not load accuracy metric: {e}")
            print("Using manual accuracy calculation")
            accuracy_metric = None
        
        # Simulate batch processing
        all_preds = []
        all_refs = []
        
        print(f"\nProcessing in batches of {args.batch_size}...")
        for i in range(0, len(dataset), args.batch_size):
            batch_end = min(i + args.batch_size, len(dataset))
            batch = dataset[i:batch_end]
            
            # Collect references (batch is a dict with lists)
            refs = batch['answer']
            
            # Simulate predictions
            preds = simulate_model_predictions(len(refs))
            
            all_preds.extend(preds)
            all_refs.extend(refs)
            
            if i == 0:
                print(f"First batch processed: {len(refs)} samples")
                print(f"Sample question: {batch['question'][0]}")
                print(f"Sample choices: {batch['choices'][0]}")
                print(f"True answer: {batch['answer'][0]}")
                print(f"Simulated prediction: {preds[0]}")
        
        # Calculate accuracy
        if accuracy_metric:
            results = accuracy_metric.compute(predictions=all_preds, references=all_refs)
            accuracy = results['accuracy']
        else:
            # Manual accuracy calculation
            correct = sum(1 for p, r in zip(all_preds, all_refs) if p == r)
            accuracy = correct / len(all_preds)
        
        print(f"\nSimulation complete!")
        print(f"Total samples processed: {len(all_preds)}")
        print(f"Simulated accuracy: {accuracy:.4f}")
        
        # Save results
        output_dir = os.path.dirname(args.output)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)
        
        result_data = {
            'accuracy': accuracy,
            'model': args.model,
            'dataset': args.dataset,
            'num_samples': len(all_preds),
            'batch_size': args.batch_size,
            'note': 'This is a simulation test without actual model inference'
        }
        
        with open(args.output, 'w') as f:
            json.dump(result_data, f, indent=2)
        
        print(f"\nResults saved to: {args.output}")
        return 0
        
    except Exception as e:
        print(f"\nError during testing: {str(e)}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    exit(main())