#!/usr/bin/env python3
"""
MLPerf Single GPU Inference Benchmark
Optimized for NVIDIA A30 GPU performance on individual nodes
"""

import os
import sys
import subprocess
import json
import yaml
import argparse
from datetime import datetime
from pathlib import Path

def load_config():
    """Load configuration from config.yaml"""
    config_path = Path.cwd() / "config.yaml"
    if not config_path.exists():
        config_path = Path.cwd() / ".." / ".." / "config.yaml"
    
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)

def run_single_gpu_benchmark(node_name, node_config, output_dir):
    """Run MLPerf benchmark on a single GPU node"""
    
    print(f"🎯 Starting Single GPU Inference on {node_name}")
    print(f"   Node: {node_config['ip']} ({node_config['username']})")
    print(f"   GPU: Single NVIDIA A30")
    print(f"   Scenario: Server")
    
    # Prepare remote directory and commands
    remote_dir = "~/official_mlperf/inference/language/llama3.1-8b"
    log_file = f"{node_name}_single_gpu_benchmark.log"
    results_dir = f"{node_name}_single_gpu_results"
    
    # SSH command to run benchmark
    ssh_cmd = [
        "ssh", f"{node_config['username']}@{node_config['ip']}",
        f"cd {remote_dir} && "
        f"python3 main.py "
        f"--scenario Server "
        f"--model-path meta-llama/Llama-3.1-8B-Instruct "
        f"--total-sample-count 13368 "
        f"--dataset-path cnn_eval.json "
        f"--vllm "
        f"--output-dir {results_dir} "
        f"> {log_file} 2>&1"
    ]
    
    print(f"📊 Executing benchmark command...")
    print(f"🔍 Debug: SSH command: {' '.join(ssh_cmd)}")
    
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=3600)
        
        print(f"🔍 Debug: Return code: {result.returncode}")
        print(f"🔍 Debug: Stdout: {result.stdout[:200]}...")
        print(f"🔍 Debug: Stderr: {result.stderr[:200]}...")
        
        if result.returncode == 0:
            print(f"✅ Benchmark completed successfully on {node_name}")
            
            # Copy results back
            print(f"📁 Copying results from {node_name}...")
            local_results_dir = Path(output_dir) / f"{node_name}_single_gpu_results"
            local_results_dir.mkdir(parents=True, exist_ok=True)
            
            # Copy results directory
            scp_cmd = [
                "scp", "-r",
                f"{node_config['username']}@{node_config['ip']}:{remote_dir}/{results_dir}/*",
                str(local_results_dir)
            ]
            try:
                subprocess.run(scp_cmd, check=True)
            except Exception as e:
                print(f"⚠️  Could not copy results directory: {e}")
            
            # Copy log file
            log_cmd = [
                "scp",
                f"{node_config['username']}@{node_config['ip']}:{remote_dir}/{log_file}",
                str(local_results_dir)
            ]
            try:
                subprocess.run(log_cmd, check=True)
                print(f"📊 Results saved to: {local_results_dir}")
            except Exception as e:
                print(f"⚠️  Could not copy log file: {e}")
            
            return True
            
        else:
            print(f"❌ Benchmark failed on {node_name}")
            if result.stderr:
                print(f"Error: {result.stderr}")
            if result.stdout:
                print(f"Output: {result.stdout}")
            return False
            
    except subprocess.TimeoutExpired:
        print(f"⏰ Benchmark timed out on {node_name}")
        return False
    except Exception as e:
        print(f"❌ Error running benchmark on {node_name}: {str(e)}")
        return False

def generate_performance_report(output_dir, node_name):
    """Generate performance report for single GPU benchmark"""
    
    results_dir = Path(output_dir) / f"{node_name}_single_gpu_results"
    summary_file = results_dir / "mlperf_log_summary.txt"
    
    if not summary_file.exists():
        print(f"⚠️  Summary file not found: {summary_file}")
        return
    
    # Parse MLPerf results
    with open(summary_file, 'r') as f:
        content = f.read()
    
    # Extract key metrics
    report_data = {
        "timestamp": datetime.now().isoformat(),
        "node": node_name,
        "benchmark_type": "Single GPU Inference",
        "gpu_type": "NVIDIA A30",
        "model": "Llama-3.1-8B-Instruct",
        "scenario": "Server",
        "dataset": "CNN DailyMail (13,368 samples)",
        "summary_content": content
    }
    
    # Save detailed report
    report_file = Path("reports") / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{node_name}_single_gpu_report.json"
    report_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(report_file, 'w') as f:
        json.dump(report_data, f, indent=2)
    
    print(f"📊 Performance report generated: {report_file}")

def main():
    parser = argparse.ArgumentParser(description="MLPerf Single GPU Inference Benchmark")
    parser.add_argument("--node", choices=["jw2", "jw3"], required=True,
                       help="Target node for single GPU benchmark")
    parser.add_argument("--output-dir", default="./results",
                       help="Output directory for results")
    parser.add_argument("--generate-report", action="store_true",
                       help="Generate performance report after completion")
    
    args = parser.parse_args()
    
    print("🚀 MLPerf Single GPU Inference Benchmark")
    print("=" * 50)
    
    # Load configuration
    try:
        config = load_config()
    except Exception as e:
        print(f"❌ Error loading configuration: {str(e)}")
        sys.exit(1)
    
    # Get node configuration
    node_config = None
    for node_data in config['infrastructure']['gpu_nodes']:
        if node_data['name'] == args.node:
            node_config = {'ip': node_data['ip'], 'username': node_data['ssh_user']}
            break
    
    if not node_config:
        print(f"❌ Node '{args.node}' not found in configuration")
        sys.exit(1)
    
    # Create output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Run benchmark
    success = run_single_gpu_benchmark(args.node, node_config, args.output_dir)
    
    if success and args.generate_report:
        generate_performance_report(args.output_dir, args.node)
    
    if success:
        print(f"\n✅ Single GPU benchmark completed successfully on {args.node}")
        print(f"📁 Results available in: {args.output_dir}/{args.node}_single_gpu_results")
    else:
        print(f"\n❌ Single GPU benchmark failed on {args.node}")
        sys.exit(1)

if __name__ == "__main__":
    main()