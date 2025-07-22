#!/usr/bin/env python3
"""
MLPerf Distributed Infrastructure Inference Benchmark
Cross-node distributed inference across jw2 AND jw3
"""

import os
import sys
import subprocess
import json
import yaml
import argparse
import threading
import time
from datetime import datetime
from pathlib import Path

def load_config():
    """Load configuration from config.yaml"""
    config_path = Path.cwd() / "config.yaml"
    if not config_path.exists():
        config_path = Path.cwd() / ".." / ".." / "config.yaml"
    
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)

def run_distributed_node(node_name, node_config, output_dir, sample_split):
    """Run MLPerf benchmark on a single node as part of distributed setup"""
    
    print(f"🎯 Starting distributed inference on {node_name}")
    print(f"   Samples: {sample_split['start']}-{sample_split['end']} ({sample_split['count']} total)")
    
    # Prepare remote directory and commands
    remote_dir = "~/official_mlperf/inference/language/llama3.1-8b"
    log_file = f"{node_name}_distributed_benchmark.log"
    results_dir = f"{node_name}_distributed_results"
    
    # SSH command for distributed portion
    ssh_cmd = [
        "ssh", f"{node_config['username']}@{node_config['ip']}",
        f"cd {remote_dir} && "
        f"python3 main.py "
        f"--scenario Server "
        f"--model-path meta-llama/Llama-3.1-8B-Instruct "
        f"--total-sample-count {sample_split['count']} "
        f"--dataset-path cnn_eval.json "
        f"--sample-index-start {sample_split['start']} "
        f"--sample-index-end {sample_split['end']} "
        f"--vllm "
        f"--output-dir {results_dir} "
        f"> {log_file} 2>&1"
    ]
    
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=3600)
        
        if result.returncode == 0:
            print(f"✅ Distributed benchmark completed on {node_name}")
            
            # Copy results back
            local_results_dir = Path(output_dir) / f"{node_name}_distributed_results"
            local_results_dir.mkdir(parents=True, exist_ok=True)
            
            # Copy results directory
            scp_cmd = [
                "scp", "-r",
                f"{node_config['username']}@{node_config['ip']}:{remote_dir}/{results_dir}/*",
                str(local_results_dir)
            ]
            subprocess.run(scp_cmd, check=True)
            
            # Copy log file
            log_cmd = [
                "scp",
                f"{node_config['username']}@{node_config['ip']}:{remote_dir}/{log_file}",
                str(local_results_dir)
            ]
            subprocess.run(log_cmd, check=True)
            
            return True
            
        else:
            print(f"❌ Distributed benchmark failed on {node_name}")
            print(f"Error: {result.stderr}")
            return False
            
    except subprocess.TimeoutExpired:
        print(f"⏰ Distributed benchmark timed out on {node_name}")
        return False
    except Exception as e:
        print(f"❌ Error running distributed benchmark on {node_name}: {str(e)}")
        return False

def run_distributed_benchmark(config, output_dir):
    """Run distributed benchmark across all configured nodes"""
    
    print("🎯 Starting Distributed Infrastructure Inference")
    print("   Nodes: jw2 AND jw3 (Cross-node distributed)")
    print("   Strategy: Sample splitting with result aggregation")
    
    gpu_nodes = config['infrastructure']['gpu_nodes']
    total_samples = 13368
    
    # Split samples between nodes
    samples_per_node = total_samples // len(gpu_nodes)
    sample_splits = {}
    
    current_start = 0
    for i, node_data in enumerate(gpu_nodes):
        node_name = node_data['name']
        node_config = {'ip': node_data['ip'], 'username': node_data['ssh_user']}
        if i == len(gpu_nodes) - 1:  # Last node gets remaining samples
            end_sample = total_samples
        else:
            end_sample = current_start + samples_per_node
        
        sample_splits[node_name] = {
            'start': current_start,
            'end': end_sample,
            'count': end_sample - current_start
        }
        current_start = end_sample
    
    print(f"📊 Sample distribution:")
    for node_name, split in sample_splits.items():
        print(f"   {node_name}: samples {split['start']}-{split['end']} ({split['count']} samples)")
    
    # Run benchmarks in parallel using threads
    threads = []
    results = {}
    
    def node_worker(node_name, node_config, split):
        results[node_name] = run_distributed_node(node_name, node_config, output_dir, split)
    
    # Start all node benchmarks
    for node_data in gpu_nodes:
        node_name = node_data['name']
        node_config = {'ip': node_data['ip'], 'username': node_data['ssh_user']}
        thread = threading.Thread(
            target=node_worker, 
            args=(node_name, node_config, sample_splits[node_name])
        )
        threads.append(thread)
        thread.start()
    
    # Wait for all nodes to complete
    for thread in threads:
        thread.join()
    
    # Check if all nodes succeeded
    success = all(results.values())
    
    if success:
        print("✅ All distributed nodes completed successfully")
        aggregate_distributed_results(output_dir, [node['name'] for node in gpu_nodes])
    else:
        print("❌ Some distributed nodes failed")
    
    return success

def aggregate_distributed_results(output_dir, node_names):
    """Aggregate results from all distributed nodes"""
    
    print("📊 Aggregating distributed results...")
    
    aggregated_dir = Path(output_dir) / "distributed_aggregated_results"
    aggregated_dir.mkdir(parents=True, exist_ok=True)
    
    # Collect all individual results
    all_results = {}
    for node_name in node_names:
        node_results_dir = Path(output_dir) / f"{node_name}_distributed_results"
        if node_results_dir.exists():
            summary_file = node_results_dir / "mlperf_log_summary.txt"
            if summary_file.exists():
                with open(summary_file, 'r') as f:
                    all_results[node_name] = f.read()
    
    # Create aggregated summary
    aggregated_summary = {
        "timestamp": datetime.now().isoformat(),
        "benchmark_type": "Distributed Infrastructure Inference",
        "nodes": list(node_names),
        "total_nodes": len(node_names),
        "model": "Llama-3.1-8B-Instruct",
        "scenario": "Server",
        "dataset": "CNN DailyMail (13,368 samples)",
        "distribution_strategy": "Sample Splitting",
        "individual_results": all_results
    }
    
    # Save aggregated results
    summary_file = aggregated_dir / "distributed_summary.json"
    with open(summary_file, 'w') as f:
        json.dump(aggregated_summary, f, indent=2)
    
    # Generate distributed performance report
    report_file = Path("reports") / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_distributed_infrastructure_report.json"
    report_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(report_file, 'w') as f:
        json.dump(aggregated_summary, f, indent=2)
    
    print(f"📊 Distributed results aggregated: {aggregated_dir}")
    print(f"📊 Performance report generated: {report_file}")

def main():
    parser = argparse.ArgumentParser(description="MLPerf Distributed Infrastructure Inference Benchmark")
    parser.add_argument("--output-dir", default="./results",
                       help="Output directory for results")
    parser.add_argument("--generate-report", action="store_true",
                       help="Generate performance report after completion")
    
    args = parser.parse_args()
    
    print("🚀 MLPerf Distributed Infrastructure Inference Benchmark")
    print("=" * 60)
    
    # Load configuration
    try:
        config = load_config()
    except Exception as e:
        print(f"❌ Error loading configuration: {str(e)}")
        sys.exit(1)
    
    # Verify we have multiple nodes
    gpu_nodes = config['infrastructure']['gpu_nodes']
    if len(gpu_nodes) < 2:
        print(f"❌ Distributed benchmark requires at least 2 nodes, found {len(gpu_nodes)}")
        sys.exit(1)
    
    # Create output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Run distributed benchmark
    success = run_distributed_benchmark(config, args.output_dir)
    
    if success:
        print(f"\n✅ Distributed infrastructure benchmark completed successfully")
        print(f"📁 Results available in: {args.output_dir}/distributed_aggregated_results")
    else:
        print(f"\n❌ Distributed infrastructure benchmark failed")
        sys.exit(1)

if __name__ == "__main__":
    main()