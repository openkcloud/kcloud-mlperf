#!/usr/bin/env python3
"""
MLPerf Llama3.1-8B Dataset Download and Preparation Script
Downloads the CNN-DailyMail dataset and prepares it for MLPerf benchmarking
"""

import os
import json
import logging
import argparse
from pathlib import Path
from datasets import load_dataset
from transformers import AutoTokenizer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def download_and_prepare_dataset(
    model_name="meta-llama/Llama-3.1-8B-Instruct",
    dataset_path="./dataset/cnn_dailymail_v3.json",
    total_count=13368,
    max_input_length=1024,
    max_output_length=128
):
    """Download and prepare the CNN-DailyMail dataset for MLPerf"""
    
    logger.info("Starting dataset preparation...")
    
    # Create output directory
    os.makedirs(os.path.dirname(dataset_path), exist_ok=True)
    
    # Load tokenizer
    logger.info(f"Loading tokenizer for {model_name}")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    
    # Load CNN-DailyMail dataset
    logger.info("Loading CNN-DailyMail dataset...")
    dataset = load_dataset("cnn_dailymail", "3.0.0", split="validation")
    
    # Prepare the data
    processed_data = []
    
    logger.info(f"Processing {min(total_count, len(dataset))} samples...")
    
    for i in range(min(total_count, len(dataset))):
        if i % 1000 == 0:
            logger.info(f"Processed {i}/{total_count} samples")
            
        sample = dataset[i]
        
        # Create input prompt
        input_text = f"Please summarize the following article:\n\n{sample['article']}\n\nSummary:"
        
        # Tokenize input
        input_tokens = tokenizer(
            input_text,
            max_length=max_input_length,
            truncation=True,
            padding=False,
            return_tensors=None
        )
        
        # Use the highlights as target output
        target_text = sample['highlights']
        
        # Create data entry
        data_entry = {
            "input": input_text,
            "output": target_text,
            "tok_input": input_tokens['input_ids'],
            "input_len": len(input_tokens['input_ids'])
        }
        
        processed_data.append(data_entry)
        
        if len(processed_data) >= total_count:
            break
    
    # Save to JSON file
    logger.info(f"Saving {len(processed_data)} samples to {dataset_path}")
    with open(dataset_path, 'w') as f:
        json.dump(processed_data, f, indent=2)
    
    # Create stats
    input_lengths = [len(sample['tok_input']) for sample in processed_data]
    logger.info(f"Dataset statistics:")
    logger.info(f"  Total samples: {len(processed_data)}")
    logger.info(f"  Avg input length: {sum(input_lengths) / len(input_lengths):.1f}")
    logger.info(f"  Max input length: {max(input_lengths)}")
    logger.info(f"  Min input length: {min(input_lengths)}")
    
    logger.info("Dataset preparation completed!")

def main():
    parser = argparse.ArgumentParser(description="Download and prepare MLPerf dataset")
    parser.add_argument(
        "--model_name", 
        default="meta-llama/Llama-3.1-8B-Instruct",
        help="Model name for tokenizer"
    )
    parser.add_argument(
        "--dataset_path", 
        default="./dataset/cnn_dailymail_v3.json",
        help="Output path for prepared dataset"
    )
    parser.add_argument(
        "--total_count", 
        type=int, 
        default=13368,
        help="Total number of samples to prepare"
    )
    parser.add_argument(
        "--max_input_length", 
        type=int, 
        default=1024,
        help="Maximum input sequence length"
    )
    parser.add_argument(
        "--max_output_length", 
        type=int, 
        default=128,
        help="Maximum output sequence length"
    )
    
    args = parser.parse_args()
    
    download_and_prepare_dataset(
        model_name=args.model_name,
        dataset_path=args.dataset_path,
        total_count=args.total_count,
        max_input_length=args.max_input_length,
        max_output_length=args.max_output_length
    )

if __name__ == "__main__":
    main()