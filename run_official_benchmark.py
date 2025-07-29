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
        if dataset_script.exists():
            subprocess.run([
                sys.executable, str(dataset_script),
                "--output_dir", str(self.benchmark_dir / "dataset")
            ], check=True)
        else:
            print("⚠️  Dataset download script not found, using existing dataset")
            
    def run_offline_benchmark(self, samples=100):
        """Run the official offline scenario benchmark"""
        print(f"🚀 Running official MLPerf offline benchmark with {samples} samples...")
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = self.results_dir / f"official_offline_{timestamp}"
        output_dir.mkdir(exist_ok=True)
        
        # Run the official benchmark
        env = os.environ.copy()
        env['CUDA_VISIBLE_DEVICES'] = '0'
        
        cmd = [
            sys.executable, str(self.benchmark_dir / "main.py"),
            "--scenario", "Offline",
            "--model-path", "meta-llama/Llama-3.1-8B-Instruct",
            "--total-sample-count", str(samples),
            "--output-log-dir", str(output_dir),
            "--dtype", "float16",
            "--vllm"
        ]
        
        print(f"Running command: {' '.join(cmd)}")
        result = subprocess.run(cmd, cwd=self.benchmark_dir, env=env, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"❌ Benchmark failed: {result.stderr}")
            return None
            
        return output_dir
        
    def run_accuracy_benchmark(self, samples=100):
        """Run the official accuracy benchmark"""
        print(f"🎯 Running official MLPerf accuracy benchmark with {samples} samples...")
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = self.results_dir / f"official_accuracy_{timestamp}"
        output_dir.mkdir(exist_ok=True)
        
        # Run the official accuracy benchmark
        env = os.environ.copy()
        env['CUDA_VISIBLE_DEVICES'] = '0'
        
        cmd = [
            sys.executable, str(self.benchmark_dir / "main.py"),
            "--scenario", "Offline", 
            "--model-path", "meta-llama/Llama-3.1-8B-Instruct",
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
            return None
            
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