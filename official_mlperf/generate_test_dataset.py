#!/usr/bin/env python3
"""
Generate a minimal test dataset for MLPerf benchmarking
"""
import json

def create_test_dataset(num_samples=100):
    """Create a minimal test dataset with sample prompts"""
    samples = []
    
    for i in range(num_samples):
        sample = {
            "id": f"test_{i:04d}",
            "passage": f"This is a test passage number {i}. It contains some sample text that can be used for summarization testing. The passage discusses various topics related to machine learning and artificial intelligence benchmarking.",
            "question": f"Please provide a brief summary of this passage about test item {i}.",
            "answer": f"Test summary {i}: This passage discusses machine learning benchmarking."
        }
        samples.append(sample)
    
    return samples

def main():
    print("🔄 Generating minimal test dataset...")
    
    # Create test dataset
    dataset = create_test_dataset(100)
    
    # Save to JSON file
    output_file = "cnn_eval.json"
    with open(output_file, 'w') as f:
        json.dump(dataset, f, indent=2)
    
    print(f"✅ Generated {len(dataset)} test samples")
    print(f"📁 Dataset saved to: {output_file}")
    print(f"💾 File size: {len(json.dumps(dataset))} bytes")

if __name__ == "__main__":
    main()