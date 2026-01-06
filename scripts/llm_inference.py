#!/usr/bin/env python3
"""
K-Cloud LLM Inference - Llama 3.1 8B Chat Demo
===============================================
Simple chat inference script demonstrating Llama-3.1-8B-Instruct model capabilities.
Shows performance metrics including TTFT, throughput, and token counts.
"""

import time
import sys
import os

# Suppress warnings for cleaner output
os.environ["TOKENIZERS_PARALLELISM"] = "false"

def main():
    print("=" * 60)
    print("K-Cloud LLM Inference - Llama 3.1 8B")
    print("=" * 60)
    print()
    
    # Import heavy libraries after banner
    print("Loading model and tokenizer...")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    
    MODEL_NAME = "meta-llama/Llama-3.1-8B-Instruct"
    
    # Load tokenizer and model
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME,
        torch_dtype=torch.float16,
        device_map="auto"
    )
    
    print(f"Model loaded: {MODEL_NAME}")
    print(f"Device: {next(model.parameters()).device}")
    print()
    
    # Test prompts
    prompts = [
        "?멸났吏??諛섎룄泥댁쓽 諛쒖쟾???대씪?곕뱶 而댄벂???곗뾽??誘몄튂???곹뼢??????ㅻ챸??二쇱꽭??",
        "Write a Python function that implements binary search algorithm with detailed comments.",
        "Summarize: Large language models have transformed the AI industry."
    ]
    
    # Run inference for each prompt
    for i, prompt in enumerate(prompts, 1):
        print(f"\n{'=' * 60}")
        print(f"[Test {i}] {prompt[:50]}...")
        print("=" * 60)
        
        # Prepare input
        messages = [{"role": "user", "content": prompt}]
        input_text = tokenizer.apply_chat_template(
            messages, 
            tokenize=False, 
            add_generation_prompt=True
        )
        inputs = tokenizer(input_text, return_tensors="pt").to(model.device)
        input_tokens = inputs['input_ids'].shape[1]
        
        # Generate with timing
        print("\nGenerating response...")
        
        # Measure time to first token (TTFT)
        start = time.perf_counter()
        
        # Generate
        outputs = model.generate(
            **inputs,
            max_new_tokens=256,
            do_sample=True,
            temperature=0.7,
            pad_token_id=tokenizer.eos_token_id
        )
        
        end = time.perf_counter()
        elapsed = end - start
        
        # Decode response
        response = tokenizer.decode(
            outputs[0][inputs['input_ids'].shape[1]:], 
            skip_special_tokens=True
        )
        output_tokens = len(outputs[0]) - inputs['input_ids'].shape[1]
        
        # Display results
        print("\n" + "-" * 60)
        print("LLM Response:")
        print("-" * 60)
        print(response[:500] + ("..." if len(response) > 500 else ""))
        
        print("\n" + "-" * 60)
        print("Performance Metrics:")
        print("-" * 60)
        print(f"  Input Tokens:          {input_tokens}")
        print(f"  Output Tokens:         {output_tokens}")
        print(f"  Total Response Time:   {elapsed:.2f}s")
        print(f"  Throughput:            {output_tokens/elapsed:.1f} tokens/s")
        
    print("\n" + "=" * 60)
    print("Inference demo complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()