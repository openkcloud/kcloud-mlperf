#!/usr/bin/env python3
import argparse
import json
import os
import torch
from datasets import load_dataset
import evaluate
from transformers import AutoTokenizer, AutoModelForMultipleChoice
from torch.utils.data import DataLoader
from tqdm import tqdm

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Evaluate model on official MMLU dataset')
    parser.add_argument('--model', type=str, required=True, help='Model name or path')
    parser.add_argument('--dataset', type=str, required=True, help='Dataset name')
    parser.add_argument('--batch_size', type=int, default=16, help='Batch size for evaluation')
    parser.add_argument('--output', type=str, required=True, help='Output file path for results')
    args = parser.parse_args()
    
    # Set HuggingFace token from environment
    if 'HUGGINGFACEHUB_API_TOKEN' in os.environ:
        os.environ['HF_TOKEN'] = os.environ['HUGGINGFACEHUB_API_TOKEN']
    
    # Load the MMLU dataset (validation split)
    # MMLU requires specifying a config - using 'all' for complete dataset
    dataset = load_dataset(args.dataset, 'all', split='validation')
    
    # Load accuracy metric
    accuracy_metric = evaluate.load("accuracy")
    
    # Load tokenizer and model
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForMultipleChoice.from_pretrained(args.model)
    
    # Move model to CUDA and set to eval mode
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = model.to(device)
    model.eval()
    
    # Prepare for batching
    all_preds = []
    all_refs = []
    
    # Process dataset in batches
    for i in tqdm(range(0, len(dataset), args.batch_size), desc="Evaluating"):
        batch_end = min(i + args.batch_size, len(dataset))
        batch = dataset[i:batch_end]
        
        # Prepare questions and choices
        questions = []
        choices_list = []
        refs = []
        
        for j in range(batch_end - i):
            question = batch['question'][j]
            choices = batch['choices'][j]
            answer_idx = batch['answer'][j]
            
            # Format each choice with the question
            formatted_choices = []
            for choice in choices:
                formatted_choices.append(f"{question} {choice}")
            
            questions.append(question)
            choices_list.append(formatted_choices)
            refs.append(answer_idx)
        
        # Tokenize batch
        max_choices = max(len(choices) for choices in choices_list)
        
        # Flatten all choices for tokenization
        all_texts = []
        for choices in choices_list:
            # Pad choices list to max_choices
            padded_choices = choices + [''] * (max_choices - len(choices))
            all_texts.extend(padded_choices)
        
        # Tokenize all at once
        encoding = tokenizer(
            all_texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors='pt'
        )
        
        # Reshape to (batch_size, num_choices, seq_len)
        batch_size = len(questions)
        input_ids = encoding['input_ids'].view(batch_size, max_choices, -1).to(device)
        attention_mask = encoding['attention_mask'].view(batch_size, max_choices, -1).to(device)
        
        # Forward pass
        with torch.no_grad():
            outputs = model(
                input_ids=input_ids.view(-1, input_ids.size(-1)),
                attention_mask=attention_mask.view(-1, attention_mask.size(-1))
            )
            logits = outputs.logits.view(batch_size, max_choices)
            
            # Get predictions
            preds = torch.argmax(logits, dim=1)
            
        # Collect predictions and references
        all_preds.extend(preds.cpu().numpy().tolist())
        all_refs.extend(refs)
    
    # Compute accuracy
    results = accuracy_metric.compute(predictions=all_preds, references=all_refs)
    
    # Save results to JSON
    output_dir = os.path.dirname(args.output)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    
    with open(args.output, 'w') as f:
        json.dump({
            'accuracy': results['accuracy'],
            'model': args.model,
            'dataset': args.dataset,
            'num_samples': len(all_preds)
        }, f, indent=2)
    
    print(f"Evaluation complete. Accuracy: {results['accuracy']:.4f}")
    print(f"Results saved to: {args.output}")

if __name__ == '__main__':
    main()