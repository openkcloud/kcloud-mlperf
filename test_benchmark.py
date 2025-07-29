#!/usr/bin/env python3
"""
Test MLPerf Benchmark Script
============================

Quick test to validate the automated benchmark pipeline works.
"""

import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Add current directory to path
sys.path.append(str(Path(__file__).parent))

from benchmark_runner import MLPerfBenchmarkRunner
from report_generator import MLPerfReportGenerator

def test_benchmark_pipeline():
    """Test the complete benchmark pipeline"""
    print("🚀 Testing MLPerf Benchmark Pipeline")
    print("=" * 50)
    
    # Set environment
    hf_token = os.getenv('HF_TOKEN')
    if not hf_token:
        print("❌ HF_TOKEN environment variable required")
        print("   Set it with: export HF_TOKEN=your_huggingface_token")
        return False
    
    # Create test directory
    test_dir = Path("./test_results")
    test_dir.mkdir(exist_ok=True)
    
    print(f"📊 Results directory: {test_dir}")
    
    try:
        # Initialize benchmark runner
        runner = MLPerfBenchmarkRunner(
            model_name="llama3_1-8b",
            scenario="Offline", 
            output_dir=str(test_dir),
            hf_token=hf_token,
            device="cuda"
        )
        
        # Run small benchmark test (5 samples only)
        print("🎯 Running benchmark with 5 samples for testing...")
        success = runner.run_complete_benchmark(samples=5)
        
        if not success:
            print("❌ Benchmark test failed")
            return False
            
        # Generate reports
        print("📋 Generating test reports...")
        generator = MLPerfReportGenerator(str(test_dir), str(test_dir))
        report_success = generator.generate_reports()
        
        if report_success:
            print("✅ Test pipeline completed successfully!")
            print(f"📊 Check results in: {test_dir}")
            return True
        else:
            print("⚠️  Reports generation failed")
            return False
            
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

if __name__ == "__main__":
    success = test_benchmark_pipeline()
    sys.exit(0 if success else 1)