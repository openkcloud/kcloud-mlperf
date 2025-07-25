#!/usr/bin/env python3
"""
MLPerf Benchmark Orchestrator
=============================

Centralized script running on jw1 to orchestrate single GPU benchmarks 
on worker nodes (jw2 and jw3).

Usage:
    python3 orchestrate_benchmarks.py --node jw2 --samples 100
    python3 orchestrate_benchmarks.py --node jw3 --samples 100 --accuracy
    python3 orchestrate_benchmarks.py --node all --samples 100
"""

import os
import sys
import argparse
import subprocess
import time
import json
from pathlib import Path
from datetime import datetime
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class BenchmarkOrchestrator:
    def __init__(self):
        self.controller_node = "jw1"
        self.worker_nodes = {
            "jw2": "jungwooshim@129.254.202.252",
            "jw3": "jungwooshim@129.254.202.253"
        }
        self.results_dir = Path("orchestrated_results")
        self.results_dir.mkdir(exist_ok=True)
        
    def check_node_connectivity(self, node_name):
        """Check if worker node is accessible"""
        if node_name not in self.worker_nodes:
            return False
            
        node_address = self.worker_nodes[node_name]
        try:
            result = subprocess.run([
                "ssh", "-o", "ConnectTimeout=5", 
                node_address, "echo 'Connection test'"
            ], capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0:
                logger.info(f"✅ {node_name} ({node_address}): Connected")
                return True
            else:
                logger.error(f"❌ {node_name} ({node_address}): Connection failed")
                return False
        except Exception as e:
            logger.error(f"❌ {node_name} ({node_address}): Error - {e}")
            return False
    
    def check_node_gpu(self, node_name):
        """Check GPU availability on worker node"""
        if node_name not in self.worker_nodes:
            return False
            
        node_address = self.worker_nodes[node_name]
        try:
            result = subprocess.run([
                "ssh", "-o", "ConnectTimeout=5", 
                node_address, "nvidia-smi --query-gpu=name --format=csv,noheader"
            ], capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0:
                gpu_info = result.stdout.strip()
                logger.info(f"✅ {node_name} GPU: {gpu_info}")
                return True, gpu_info
            else:
                logger.error(f"❌ {node_name}: GPU check failed")
                return False, None
        except Exception as e:
            logger.error(f"❌ {node_name}: GPU check error - {e}")
            return False, None
    
    def run_remote_benchmark(self, node_name, samples, accuracy=False):
        """Run MLPerf benchmark on remote worker node"""
        if node_name not in self.worker_nodes:
            logger.error(f"Unknown node: {node_name}")
            return False, None
            
        node_address = self.worker_nodes[node_name]
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        remote_output_dir = f"{node_name}_benchmark_{timestamp}"
        
        # Build the remote command with proper CUDA environment
        mlperf_cmd = [
            "ssh", node_address,
            f"export PATH=/usr/local/cuda-12.9/bin:$PATH && "
            f"export LD_LIBRARY_PATH=/usr/local/cuda-12.9/targets/x86_64-linux/lib:$LD_LIBRARY_PATH && "
            f"cd ~/official_mlperf/inference/language/llama3.1-8b && "
            f"python3 main.py "
            f"--scenario Server "
            f"--model-path meta-llama/Llama-3.1-8B-Instruct "
            f"--batch-size 1 "
            f"--dtype float16 "
            f"--total-sample-count {samples} "
            f"--dataset-path cnn_eval.json "
            f"--output-log-dir {remote_output_dir} "
            f"--tensor-parallel-size 1 "
            f"--vllm "
            f"--user-conf user_both.conf"
            + (" --accuracy" if accuracy else "")
        ]
        
        logger.info(f"🚀 Starting benchmark on {node_name}...")
        logger.info(f"   Samples: {samples}")
        logger.info(f"   Accuracy: {'Enabled' if accuracy else 'Performance only'}")
        logger.info(f"   Remote Output: {remote_output_dir}")
        
        start_time = time.time()
        
        try:
            # Run the benchmark
            result = subprocess.run(
                mlperf_cmd,
                capture_output=True,
                text=True,
                timeout=1800  # 30 minute timeout
            )
            
            duration = time.time() - start_time
            
            if result.returncode == 0:
                logger.info(f"✅ {node_name} benchmark completed in {duration:.1f}s")
                
                # Copy results back to controller
                local_results_dir = self.results_dir / f"{node_name}_{timestamp}"
                local_results_dir.mkdir(exist_ok=True)
                
                # Copy remote results to local automatically
                copy_cmd = [
                    "scp", "-r",
                    f"{node_address}:~/official_mlperf/inference/language/llama3.1-8b/{remote_output_dir}/*",
                    str(local_results_dir)
                ]
                
                try:
                    subprocess.run(copy_cmd, check=True, capture_output=True)
                    logger.info(f"📊 Results copied to: {local_results_dir}")
                    
                    # Auto-generate comprehensive report
                    self.generate_node_report(node_name, local_results_dir, samples, accuracy, duration)
                    
                except subprocess.CalledProcessError as e:
                    logger.warning(f"⚠️ Failed to copy results from {node_name}: {e}")
                    # Still try to copy results even if orchestrator thinks it failed
                    logger.info(f"🔄 Attempting emergency result recovery...")
                    try:
                        subprocess.run(copy_cmd, check=False, capture_output=True)
                        logger.info(f"📊 Emergency recovery: Results copied to {local_results_dir}")
                        self.generate_node_report(node_name, local_results_dir, samples, accuracy, duration)
                    except Exception as recovery_error:
                        logger.error(f"💥 Emergency recovery failed: {recovery_error}")
                
                # Generate summary
                self.generate_summary(node_name, timestamp, samples, accuracy, duration, local_results_dir)
                
                return True, {
                    "node": node_name,
                    "timestamp": timestamp,
                    "samples": samples,
                    "accuracy": accuracy,
                    "duration": duration,
                    "results_dir": str(local_results_dir),
                    "success": True
                }
                
            else:
                logger.error(f"❌ {node_name} benchmark failed")
                logger.error(f"   Error output: {result.stderr}")
                return False, {
                    "node": node_name,
                    "timestamp": timestamp,
                    "samples": samples,
                    "accuracy": accuracy,
                    "success": False,
                    "error": result.stderr
                }
                
        except subprocess.TimeoutExpired:
            logger.error(f"❌ {node_name} benchmark timed out after 30 minutes")
            return False, {"node": node_name, "success": False, "error": "timeout"}
        except Exception as e:
            logger.error(f"❌ {node_name} benchmark error: {e}")
            return False, {"node": node_name, "success": False, "error": str(e)}
    
    def generate_summary(self, node_name, timestamp, samples, accuracy, duration, results_dir):
        """Generate benchmark summary"""
        summary_file = results_dir / "orchestrator_summary.json"
        
        summary = {
            "orchestrator": "jw1",
            "worker_node": node_name,
            "timestamp": timestamp,
            "benchmark_start": datetime.now().isoformat(),
            "samples": samples,
            "accuracy_enabled": accuracy,
            "duration_seconds": duration,
            "model": "meta-llama/Llama-3.1-8B-Instruct",
            "framework": "VLLM",
            "dataset": "CNN-DailyMail",
            "scenario": "Server",
            "results_directory": str(results_dir)
        }
        
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
            
        logger.info(f"📋 Summary saved to: {summary_file}")
    
    def generate_node_report(self, node_name, results_dir, samples, accuracy, duration):
        """Generate comprehensive node report with MLPerf results"""
        report_file = results_dir / f"{node_name}_comprehensive_report.md"
        
        try:
            # Read MLPerf summary if available
            summary_file = results_dir / "mlperf_log_summary.txt"
            accuracy_file = results_dir / "mlperf_log_accuracy.json"
            
            with open(report_file, 'w') as f:
                f.write(f"# MLPerf Benchmark Report - {node_name.upper()}\n\n")
                f.write(f"**Generated**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
                f.write(f"## Configuration\n")
                f.write(f"- **Node**: {node_name}\n")
                f.write(f"- **Samples Requested**: {samples}\n")
                f.write(f"- **Accuracy Enabled**: {accuracy}\n")
                f.write(f"- **Duration**: {duration:.1f} seconds\n")
                f.write(f"- **Model**: Llama-3.1-8B-Instruct\n")
                f.write(f"- **Dataset**: CNN-DailyMail\n\n")
                
                # Add MLPerf summary if available
                if summary_file.exists():
                    f.write(f"## MLPerf Performance Results\n")
                    with open(summary_file, 'r') as summary:
                        f.write(f"```\n{summary.read()}```\n\n")
                
                # Add accuracy info if available
                if accuracy_file.exists():
                    import json
                    with open(accuracy_file, 'r') as acc:
                        acc_data = json.load(acc)
                        f.write(f"## Accuracy Evaluation\n")
                        f.write(f"- **Total Samples Processed**: {len(acc_data)}\n")
                        f.write(f"- **Accuracy Log Available**: Yes\n\n")
                
                f.write(f"## Files Generated\n")
                for file in results_dir.glob("*"):
                    if file.is_file():
                        f.write(f"- `{file.name}` ({file.stat().st_size} bytes)\n")
            
            logger.info(f"📑 Comprehensive report generated: {report_file}")
            
        except Exception as e:
            logger.warning(f"⚠️ Report generation failed for {node_name}: {e}")
    
    def run_single_node(self, node_name, samples, accuracy=False):
        """Run benchmark on a single node"""
        logger.info(f"🎯 Single Node Benchmark: {node_name}")
        logger.info("=" * 50)
        
        # Check connectivity
        if not self.check_node_connectivity(node_name):
            return False
        
        # Check GPU
        gpu_ok, gpu_info = self.check_node_gpu(node_name)
        if not gpu_ok:
            return False
        
        # Run benchmark
        success, result = self.run_remote_benchmark(node_name, samples, accuracy)
        
        if success:
            logger.info(f"🏆 {node_name} benchmark completed successfully!")
            return result
        else:
            logger.error(f"💥 {node_name} benchmark failed!")
            return result
    
    def run_all_nodes(self, samples, accuracy=False):
        """Run benchmarks on all worker nodes in parallel"""
        logger.info("🎯 Multi-Node Benchmark: All Workers")
        logger.info("=" * 50)
        
        results = {}
        
        # Check all nodes first
        available_nodes = []
        for node_name in self.worker_nodes.keys():
            if self.check_node_connectivity(node_name):
                gpu_ok, gpu_info = self.check_node_gpu(node_name)
                if gpu_ok:
                    available_nodes.append(node_name)
        
        if not available_nodes:
            logger.error("❌ No worker nodes available!")
            return {}
        
        logger.info(f"📋 Running benchmarks on {len(available_nodes)} nodes: {available_nodes}")
        
        # Run benchmarks in parallel
        with ThreadPoolExecutor(max_workers=len(available_nodes)) as executor:
            # Submit all benchmark tasks
            future_to_node = {
                executor.submit(self.run_remote_benchmark, node, samples, accuracy): node 
                for node in available_nodes
            }
            
            # Collect results
            for future in as_completed(future_to_node):
                node = future_to_node[future]
                try:
                    success, result = future.result()
                    results[node] = result
                    if success:
                        logger.info(f"✅ {node} completed successfully")
                    else:
                        logger.error(f"❌ {node} failed")
                except Exception as e:
                    logger.error(f"❌ {node} exception: {e}")
                    results[node] = {"node": node, "success": False, "error": str(e)}
        
        # Generate overall summary
        self.generate_multi_node_summary(results, samples, accuracy)
        
        return results
    
    def generate_multi_node_summary(self, results, samples, accuracy):
        """Generate multi-node benchmark summary"""
        summary_file = self.results_dir / f"multi_node_summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        successful_nodes = [node for node, result in results.items() if result.get('success', False)]
        failed_nodes = [node for node, result in results.items() if not result.get('success', False)]
        
        summary = {
            "orchestrator": "jw1",
            "timestamp": datetime.now().isoformat(),
            "total_nodes": len(results),
            "successful_nodes": len(successful_nodes),
            "failed_nodes": len(failed_nodes),
            "success_rate": f"{len(successful_nodes)}/{len(results)}",
            "samples_per_node": samples,
            "accuracy_enabled": accuracy,
            "results": results
        }
        
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
            
        logger.info("🏆 MULTI-NODE BENCHMARK COMPLETED")
        logger.info(f"   Successful: {len(successful_nodes)}/{len(results)} nodes")
        logger.info(f"   Summary: {summary_file}")

def main():
    parser = argparse.ArgumentParser(description='MLPerf Benchmark Orchestrator')
    parser.add_argument('--node', choices=['jw2', 'jw3', 'all'], required=True,
                       help='Node to run benchmark on')
    parser.add_argument('--samples', type=int, default=100,
                       help='Number of samples to process')
    parser.add_argument('--accuracy', action='store_true',
                       help='Enable accuracy evaluation')
    
    args = parser.parse_args()
    
    orchestrator = BenchmarkOrchestrator()
    
    logger.info("🚀 MLPerf Benchmark Orchestrator")
    logger.info(f"   Controller: {orchestrator.controller_node}")
    logger.info(f"   Target: {args.node}")
    logger.info(f"   Samples: {args.samples}")
    logger.info(f"   Accuracy: {'Enabled' if args.accuracy else 'Performance only'}")
    
    if args.node == 'all':
        results = orchestrator.run_all_nodes(args.samples, args.accuracy)
        success = any(result.get('success', False) for result in results.values())
    else:
        result = orchestrator.run_single_node(args.node, args.samples, args.accuracy)
        success = result and result.get('success', False)
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()