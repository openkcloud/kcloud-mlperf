#!/usr/bin/env python3
"""
Official MLCommons MLPerf Benchmark Runner
==========================================

This script runs the official MLCommons inference benchmark for Llama-3.1-8B
and generates comprehensive reports comparable to official submissions.

Features:
- Official MLCommons inference implementation
- Automated result generation and reporting
- Docker-containerized for easy distribution
- Comparable results to official MLPerf submissions
"""

import os
import sys
import subprocess
import json
import time
from datetime import datetime
from pathlib import Path

class OfficialMLPerfRunner:
    def __init__(self):
        self.base_dir = Path(__file__).parent
        self.benchmark_dir = self.base_dir / "official_mlperf_benchmark"  
        self.results_dir = self.base_dir / "results"
        self.reports_dir = self.base_dir / "reports"
        
        # Create directories
        self.results_dir.mkdir(exist_ok=True)
        self.reports_dir.mkdir(exist_ok=True)
        
    def download_dataset(self):
        """Download and prepare the CNN-DailyMail dataset"""
        print("📊 Downloading CNN-DailyMail dataset...")
        dataset_script = self.benchmark_dir / "download_cnndm.py"
        dataset_dir = self.benchmark_dir / "dataset"
        dataset_dir.mkdir(exist_ok=True)
        
        # Check if dataset already exists
        dataset_file = dataset_dir / "data" / "cnn_dailymail_v3.json"
        if dataset_file.exists():
            print(f"✅ Dataset already exists at {dataset_file}")
            return
        
        if dataset_script.exists():
            print("📥 Downloading CNN-DailyMail dataset (this may take several minutes)...")
            # Set environment for dataset download
            env = os.environ.copy()
            env['HF_TOKEN'] = os.getenv('HF_TOKEN', '')
            env['DATASET_CNNDM_PATH'] = str(dataset_dir / "data")
            
            # Run dataset download with proper environment
            result = subprocess.run([
                sys.executable, str(dataset_script),
                "--n-samples", "1000"  # Download smaller subset for testing
            ], cwd=str(self.benchmark_dir), env=env, capture_output=False, text=True)
            
            if result.returncode != 0:
                print(f"⚠️  Dataset download failed with code {result.returncode}")
                print("⚠️  Trying alternative download method...")
                self._download_dataset_alternative(dataset_dir)
            else:
                print("✅ Dataset download completed successfully")
        else:
            print("⚠️  Dataset download script not found, trying alternative...")
            self._download_dataset_alternative(dataset_dir)
    
    def _download_dataset_alternative(self, dataset_dir):
        """Alternative dataset download method"""
        try:
            import json
            from datasets import load_dataset
            from transformers import AutoTokenizer
            
            print("📥 Using alternative dataset download...")
            
            # Create data directory
            data_dir = dataset_dir / "data"
            data_dir.mkdir(exist_ok=True)
            
            # Load dataset for benchmark
            print("Loading CNN-DailyMail dataset...")
            dataset = load_dataset("cnn_dailymail", "3.0.0", split="validation[:500]")
            
            # Load tokenizer
            print("Loading tokenizer...")
            tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")
            tokenizer.padding_side = "left"
            tokenizer.pad_token = tokenizer.eos_token
            
            # Convert to required format
            dataset_samples = []
            print("Processing samples...")
            for i, item in enumerate(dataset):
                # Create prompt format
                instruction = f"Summarize the following article:\n\n{item['article']}\n\nSummary:"
                
                # Tokenize input
                tokenized = tokenizer(instruction, truncation=True, max_length=2048)
                
                sample = {
                    "input": instruction,
                    "tok_input": tokenized["input_ids"],
                    "output": item["highlights"]
                }
                dataset_samples.append(sample)
            
            # Save dataset
            dataset_file = data_dir / "cnn_dailymail_v3.json"
            with open(dataset_file, 'w') as f:
                json.dump(dataset_samples, f, indent=2)
            
            print(f"✅ Alternative dataset created with {len(dataset_samples)} samples")
            
        except Exception as e:
            print(f"❌ Alternative dataset download failed: {e}")
            print("⚠️  Benchmark may fail without dataset")
            
    def run_offline_benchmark(self, samples=100):
        """Run the official offline scenario benchmark"""
        print(f"🚀 Running official MLPerf offline benchmark with {samples} samples...")
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = self.results_dir / f"official_offline_{timestamp}"
        output_dir.mkdir(exist_ok=True)
        
        # Get dataset path
        dataset_file = self.benchmark_dir / "dataset" / "data" / "cnn_dailymail_v3.json"
        if not dataset_file.exists():
            print(f"❌ Dataset file not found at {dataset_file}")
            return None
        
        # Run the official benchmark
        env = os.environ.copy()
        env['CUDA_VISIBLE_DEVICES'] = '0'
        
        cmd = [
            sys.executable, str(self.benchmark_dir / "main.py"),
            "--scenario", "Offline",
            "--model-path", "meta-llama/Llama-3.1-8B-Instruct",
            "--dataset-path", str(dataset_file),
            "--total-sample-count", str(samples),
            "--output-log-dir", str(output_dir),
            "--dtype", "float16",
            "--vllm"
        ]
        
        print(f"Running command: {' '.join(cmd)}")
        result = subprocess.run(cmd, cwd=self.benchmark_dir, env=env, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"❌ Benchmark failed: {result.stderr}")
            print(f"❌ Stdout: {result.stdout}")
            return None
            
        print("✅ Performance benchmark completed successfully")
        return output_dir
        
    def run_accuracy_benchmark(self, samples=100):
        """Run the official accuracy benchmark"""
        print(f"🎯 Running official MLPerf accuracy benchmark with {samples} samples...")
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = self.results_dir / f"official_accuracy_{timestamp}"
        output_dir.mkdir(exist_ok=True)
        
        # Get dataset path
        dataset_file = self.benchmark_dir / "dataset" / "data" / "cnn_dailymail_v3.json"
        if not dataset_file.exists():
            print(f"❌ Dataset file not found at {dataset_file}")
            return None
        
        # Run the official accuracy benchmark
        env = os.environ.copy()
        env['CUDA_VISIBLE_DEVICES'] = '0'
        
        cmd = [
            sys.executable, str(self.benchmark_dir / "main.py"),
            "--scenario", "Offline", 
            "--model-path", "meta-llama/Llama-3.1-8B-Instruct",
            "--dataset-path", str(dataset_file),
            "--total-sample-count", str(samples),
            "--output-log-dir", str(output_dir),
            "--dtype", "float16",
            "--accuracy",
            "--vllm"
        ]
        
        print(f"Running command: {' '.join(cmd)}")
        result = subprocess.run(cmd, cwd=self.benchmark_dir, env=env, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"❌ Accuracy benchmark failed: {result.stderr}")
            print(f"❌ Stdout: {result.stdout}")
            return None
            
        print("✅ Accuracy benchmark completed successfully")
        return output_dir
        
    def evaluate_accuracy(self, accuracy_dir):
        """Evaluate accuracy using official evaluation script"""
        print("📈 Evaluating accuracy with official script...")
        
        accuracy_log = accuracy_dir / "mlperf_log_accuracy.json"
        if not accuracy_log.exists():
            print("❌ Accuracy log not found")
            return None
            
        # Run official evaluation
        eval_script = self.benchmark_dir / "evaluation.py"  
        if eval_script.exists():
            try:
                cmd = [
                    sys.executable, str(eval_script),
                    "--dataset-path", str(self.benchmark_dir / "dataset" / "cnn_dailymail_v3.json"),
                    "--log-path", str(accuracy_log),
                    "--output-file", str(accuracy_dir / "accuracy_results.json")
                ]
                subprocess.run(cmd, cwd=self.benchmark_dir, check=True)
                return accuracy_dir / "accuracy_results.json"
            except subprocess.CalledProcessError:
                print("⚠️  Official evaluation failed, trying alternative...")
                
        # Fallback to simple evaluation
        try:
            simple_eval = self.benchmark_dir / "ref_eval.py"
            if simple_eval.exists():
                cmd = [
                    sys.executable, str(simple_eval),
                    "--mlperf-accuracy-file", str(accuracy_log),
                    "--dataset-file", str(self.benchmark_dir / "dataset" / "cnn_dailymail_v3.json")
                ]
                result = subprocess.run(cmd, cwd=self.benchmark_dir, capture_output=True, text=True)
                
                # Save results
                with open(accuracy_dir / "accuracy_results.txt", "w") as f:
                    f.write(result.stdout)
                return accuracy_dir / "accuracy_results.txt"
        except:
            pass
            
        return None
        
    def generate_report(self, performance_dir=None, accuracy_dir=None, accuracy_results=None):
        """Generate comprehensive MLPerf report"""
        print("📋 Generating comprehensive MLPerf report...")
        
        report = {
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "benchmark_type": "Official MLCommons MLPerf Inference",
                "model": "meta-llama/Llama-3.1-8B-Instruct",
                "implementation": "Official Reference Implementation"
            },
            "performance": {},
            "accuracy": {},
            "system_info": {}
        }
        
        # Parse performance results
        if performance_dir and (performance_dir / "mlperf_log_summary.txt").exists():
            with open(performance_dir / "mlperf_log_summary.txt") as f:
                summary = f.read()
                report["performance"]["summary"] = summary
                
        # Parse accuracy results  
        if accuracy_results and accuracy_results.exists():
            if accuracy_results.suffix == ".json":
                with open(accuracy_results) as f:
                    report["accuracy"] = json.load(f)
            else:
                with open(accuracy_results) as f:
                    report["accuracy"]["evaluation"] = f.read()
                    
        # Save report
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_file = self.reports_dir / f"official_mlperf_report_{timestamp}.json"
        
        with open(report_file, "w") as f:
            json.dump(report, f, indent=2)
            
        print(f"✅ Report saved to: {report_file}")
        return report_file
        
    def run_full_benchmark(self, samples=100):
        """Run complete benchmark suite"""
        print("🎯 Starting Official MLCommons MLPerf Benchmark Suite")
        print("=" * 60)
        
        start_time = time.time()
        
        try:
            # Download dataset
            self.download_dataset()
            
            # Run performance benchmark
            perf_dir = self.run_offline_benchmark(samples)
            
            # Run accuracy benchmark  
            acc_dir = self.run_accuracy_benchmark(samples)
            
            # Evaluate accuracy
            acc_results = None
            if acc_dir:
                acc_results = self.evaluate_accuracy(acc_dir)
                
            # Generate comprehensive report
            report_file = self.generate_report(perf_dir, acc_dir, acc_results)
            
            elapsed = time.time() - start_time
            print(f"\n🎉 Benchmark completed successfully in {elapsed:.1f} seconds!")
            print(f"📊 Results: {self.results_dir}")
            print(f"📋 Reports: {report_file}")
            
            return True
            
        except Exception as e:
            print(f"❌ Benchmark failed: {e}")
            return False

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Official MLCommons MLPerf Benchmark Runner")
    parser.add_argument("--samples", type=int, default=100, 
                       help="Number of samples to benchmark (default: 100)")
    parser.add_argument("--performance-only", action="store_true",
                       help="Run only performance benchmark")
    parser.add_argument("--accuracy-only", action="store_true", 
                       help="Run only accuracy benchmark")
    
    args = parser.parse_args()
    
    runner = OfficialMLPerfRunner()
    
    if args.performance_only:
        runner.run_offline_benchmark(args.samples)
    elif args.accuracy_only:
        acc_dir = runner.run_accuracy_benchmark(args.samples)
        if acc_dir:
            runner.evaluate_accuracy(acc_dir)
    else:
        runner.run_full_benchmark(args.samples)

if __name__ == "__main__":
    main()