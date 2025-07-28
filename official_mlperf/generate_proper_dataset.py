#!/usr/bin/env python3
"""
Generate a properly formatted test dataset for MLPerf benchmarking
"""
import json
import os
from transformers import AutoTokenizer

def create_proper_dataset(num_samples=100):
    """Create a properly formatted dataset matching MLPerf expectations"""
    
    # Initialize tokenizer
    model_id = "meta-llama/Llama-3.1-8B-Instruct"
    try:
        tokenizer = AutoTokenizer.from_pretrained(model_id)
        tokenizer.padding_side = "left"
        tokenizer.pad_token = tokenizer.eos_token
    except:
        print("Warning: Could not load tokenizer. Using mock tokenization.")
        tokenizer = None
    
    instruction_template = "Summarize the following news article in 128 tokens. Please output the summary only, without any other text.\n\nArticle:\n{input}\n\nSummary:"
    
    samples = []
    
    for i in range(num_samples):
        # Create sample content
        article_text = f"""
        In a groundbreaking development for artificial intelligence benchmarking, researchers have announced 
        a new framework for testing machine learning models. The framework, known as Test Framework {i}, 
        provides comprehensive evaluation metrics for assessing model performance across various tasks.
        
        The key features of this framework include automated testing procedures, standardized evaluation 
        metrics, and support for distributed computing environments. This development is expected to 
        significantly impact how AI models are evaluated in production settings.
        
        Experts in the field have praised the new framework for its thoroughness and ease of use. 
        Dr. Jane Smith, a leading AI researcher, stated that "This framework represents a major step 
        forward in our ability to accurately assess AI model capabilities."
        
        The framework is designed to be platform-agnostic and can run on various hardware configurations,
        from single GPUs to large-scale distributed systems. This flexibility makes it accessible to 
        both academic researchers and industry practitioners.
        """
        
        summary_text = f"Test Framework {i} is a new AI benchmarking tool that provides automated testing, standardized metrics, and distributed computing support. It has been praised by experts for its thoroughness and platform-agnostic design."
        
        sample = {
            "instruction": {"llama": instruction_template},
            "input": article_text.strip(),
            "output": summary_text
        }
        
        # Add tokenized input if tokenizer is available
        if tokenizer:
            formatted_input = instruction_template.format(input=article_text.strip())
            sample["tok_input"] = tokenizer.encode(formatted_input)
        else:
            # Mock tokenization for testing
            sample["tok_input"] = list(range(100, 200))  # Dummy token IDs
        
        samples.append(sample)
    
    return samples

def main():
    print("🔄 Generating properly formatted test dataset...")
    
    # Create test dataset
    dataset = create_proper_dataset(100)
    
    # Save to JSON file
    output_file = "cnn_eval.json"
    with open(output_file, 'w') as f:
        json.dump(dataset, f, indent=2)
    
    print(f"✅ Generated {len(dataset)} test samples")
    print(f"📁 Dataset saved to: {output_file}")
    
    # Show sample structure
    print("\n📋 Sample structure:")
    sample = dataset[0]
    print(f"  - instruction: {type(sample['instruction'])}")
    print(f"  - input: {len(sample['input'])} chars")
    print(f"  - output: {len(sample['output'])} chars")
    print(f"  - tok_input: {len(sample['tok_input'])} tokens")

if __name__ == "__main__":
    main()