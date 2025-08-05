#!/usr/bin/env python3
"""
Download CNN-DailyMail 3.0.0 dataset from HuggingFace for local MLPerf benchmarking.
This bypasses MLCommons authentication while providing real dataset for ROUGE scoring.
"""

import os
import json
import argparse
from pathlib import Path
from datasets import load_dataset
from huggingface_hub import login

def download_cnn_dailymail(output_dir="data/cnn_dailymail", hf_token=None, max_samples=None):
    """Download CNN-DailyMail 3.0.0 dataset from HuggingFace."""
    
    print("🔐 Authenticating with HuggingFace...")
    if hf_token:
        login(token=hf_token)
        print("✅ HuggingFace authentication successful")
    
    print("📊 Downloading CNN-DailyMail 3.0.0 dataset...")
    print("   Source: HuggingFace datasets/cnn_dailymail")
    print("   Version: 3.0.0 (same as MLCommons official)")
    print("   Split: validation (13,368 samples)")
    
    # Create output directory
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    try:
        # Load the validation split (same as MLPerf uses)
        print("⏳ Loading validation dataset...")
        dataset = load_dataset("cnn_dailymail", "3.0.0", split="validation")
        
        total_samples = len(dataset)
        print(f"✅ Loaded {total_samples:,} samples")
        
        # Limit samples if specified (for testing)
        if max_samples and max_samples < total_samples:
            dataset = dataset.select(range(max_samples))
            print(f"🎯 Limited to {max_samples:,} samples for testing")
        
        # Convert to list of dictionaries for easier processing
        print("💾 Converting dataset format...")
        samples = []
        for i, item in enumerate(dataset):
            if i % 1000 == 0:
                print(f"   Processed {i:,}/{len(dataset):,} samples")
            
            samples.append({
                "id": item.get("id", f"sample_{i}"),
                "article": item["article"],
                "highlights": item["highlights"],
                # Add metadata for MLPerf compatibility
                "source": "cnn_dailymail_3.0.0",
                "split": "validation"
            })
        
        # Save as JSON for easy loading
        json_path = output_path / "validation.json"
        print(f"💾 Saving dataset to {json_path}")
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(samples, f, indent=2, ensure_ascii=False)
        
        # Save metadata
        metadata = {
            "dataset_name": "cnn_dailymail",
            "version": "3.0.0",
            "split": "validation",
            "total_samples": len(samples),
            "source": "huggingface:cnn_dailymail",
            "download_date": "2025-08-05",
            "mlperf_compatible": True,
            "rouge_ready": True
        }
        
        metadata_path = output_path / "metadata.json"
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"✅ Dataset downloaded successfully!")
        print(f"📁 Location: {output_path.absolute()}")
        print(f"📊 Samples: {len(samples):,}")
        print(f"💾 Size: {json_path.stat().st_size / 1024 / 1024:.1f} MB")
        print("")
        print("🎯 Ready for MLPerf benchmarking with proper ROUGE scoring!")
        
        return str(json_path)
        
    except Exception as e:
        print(f"❌ Error downloading dataset: {e}")
        raise

def main():
    parser = argparse.ArgumentParser(description="Download CNN-DailyMail dataset for MLPerf")
    parser.add_argument("--output-dir", default="data/cnn_dailymail",
                       help="Output directory for dataset")
    parser.add_argument("--hf-token", 
                       help="HuggingFace token (or set HF_TOKEN env var)")
    parser.add_argument("--max-samples", type=int,
                       help="Limit number of samples (for testing)")
    
    args = parser.parse_args()
    
    # Get token from env if not provided
    hf_token = args.hf_token or os.getenv("HF_TOKEN")
    
    if not hf_token:
        print("⚠️  No HuggingFace token provided")
        print("   Dataset is public, but token recommended for reliability")
    
    download_cnn_dailymail(
        output_dir=args.output_dir,
        hf_token=hf_token,
        max_samples=args.max_samples
    )

if __name__ == "__main__":
    main()