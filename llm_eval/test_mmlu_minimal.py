#!/usr/bin/env python3
import argparse
import json
import os
from datasets import load_dataset
import evaluate

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Test MMLU dataset loading')
    parser.add_argument('--model', type=str, default='meta-llama/Llama-3.1-8B-Instruct')
    parser.add_argument('--dataset', type=str, default='cais/mmlu')
    parser.add_argument('--batch_size', type=int, default=16)
    parser.add_argument('--output', type=str, default='/tmp/test_mmlu.json')
    args = parser.parse_args()
    
    print(f"Testing MMLU dataset loading...")
    print(f"Dataset: {args.dataset}")
    
    try:
        # Try to load a small subset of the dataset
        # MMLU requires specifying a config - using 'all' for complete dataset
        dataset = load_dataset(args.dataset, 'all', split='validation[:5]')
        print(f"Successfully loaded {len(dataset)} samples")
        
        # Display first sample
        if len(dataset) > 0:
            print("\nFirst sample:")
            print(f"Question: {dataset[0]['question']}")
            print(f"Choices: {dataset[0]['choices']}")
            print(f"Answer: {dataset[0]['answer']}")
        
        # Test accuracy metric
        accuracy_metric = evaluate.load("accuracy")
        print("\nAccuracy metric loaded successfully")
        
        # Create a dummy result
        result = {
            'status': 'Dataset and metric loading successful',
            'dataset': args.dataset,
            'samples_loaded': len(dataset)
        }
        
        # Save to output
        os.makedirs(os.path.dirname(args.output), exist_ok=True)
        with open(args.output, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"\nTest results saved to: {args.output}")
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return 1
    
    return 0

if __name__ == '__main__':
    exit(main())