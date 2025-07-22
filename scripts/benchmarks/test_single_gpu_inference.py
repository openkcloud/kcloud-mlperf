#!/usr/bin/env python3
"""
Test MLPerf Single GPU Inference with Small Sample Count
Quick debugging version with 20 samples
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

def run_test_benchmark(node_name, node_config, output_dir, sample_count=20):
    """Run quick test MLPerf benchmark with limited samples"""
    
    print(f"🧪 Starting TEST Single GPU Inference on {node_name}")
    print(f"   Node: {node_config['ip']} ({node_config['username']})")
    print(f"   GPU: Single NVIDIA A30")
    print(f"   Samples: {sample_count} (TEST MODE)")
    print(f"   Scenario: Server")
    
    # Prepare remote directory and commands
    remote_dir = "~/official_mlperf/inference/language/llama3.1-8b"
    log_file = f"{node_name}_test_{sample_count}_samples.log"
    results_dir = f"{node_name}_test_{sample_count}_results"
    
    # SSH command to run test benchmark
    ssh_cmd = [
        "ssh", f"{node_config['username']}@{node_config['ip']}",
        f"cd {remote_dir} && "
        f"python3 main.py "
        f"--scenario Server "
        f"--model-path meta-llama/Llama-3.1-8B-Instruct "
        f"--total-sample-count {sample_count} "
        f"--dataset-path cnn_eval.json "
        f"--vllm "
        f"--tensor-parallel-size 1 "
        f"--dtype bfloat16 "
        f"--output-log-dir {results_dir} "
        f"> {log_file} 2>&1"
    ]
    
    print(f"🚀 Starting test benchmark (should complete in ~2-5 minutes)...")
    print(f"📝 Command: {' '.join(ssh_cmd)}")
    
    try:
        # Use longer timeout for test (includes model loading time)
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=1200)
        
        if result.returncode == 0:
            print(f"✅ Test benchmark completed successfully on {node_name}")
            
            # Copy results back
            print(f"📁 Copying test results from {node_name}...")
            local_results_dir = Path(output_dir) / f"{node_name}_test_results"
            local_results_dir.mkdir(parents=True, exist_ok=True)
            
            # Copy results directory
            scp_cmd = [
                "scp", "-r",
                f"{node_config['username']}@{node_config['ip']}:{remote_dir}/{results_dir}/*",
                str(local_results_dir)
            ]
            try:
                subprocess.run(scp_cmd, check=True)
                print(f"✅ Results directory copied")
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
                print(f"✅ Log file copied")
            except Exception as e:
                print(f"⚠️  Could not copy log file: {e}")
            
            print(f"📊 Test results saved to: {local_results_dir}")
            return True
            
        else:
            print(f"❌ Test benchmark failed on {node_name}")
            if result.stderr:
                print(f"Error: {result.stderr}")
            if result.stdout:
                print(f"Output: {result.stdout}")
            return False
            
    except subprocess.TimeoutExpired:
        print(f"⏰ Test benchmark timed out on {node_name} (>10 minutes)")
        return False
    except Exception as e:
        print(f"❌ Error running test benchmark on {node_name}: {str(e)}")
        return False

def generate_test_report(output_dir, node_name, sample_count):
    """Generate test report"""
    
    results_dir = Path(output_dir) / f"{node_name}_test_results"
    
    report_data = {
        "timestamp": datetime.now().isoformat(),
        "test_mode": True,
        "node": node_name,
        "sample_count": sample_count,
        "benchmark_type": "Test Single GPU Inference",
        "status": "completed" if results_dir.exists() else "failed"
    }
    
    # Save test report
    report_file = Path("reports") / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{node_name}_test_report.json"
    report_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(report_file, 'w') as f:
        json.dump(report_data, f, indent=2)
    
    print(f"📊 Test report generated: {report_file}")

def main():
    parser = argparse.ArgumentParser(description="MLPerf Test Single GPU Inference (Small Sample Count)")
    parser.add_argument("--node", choices=["jw2", "jw3"], required=True,
                       help="Target node for test")
    parser.add_argument("--samples", type=int, default=20,
                       help="Number of samples for test (default: 20)")
    parser.add_argument("--output-dir", default="./test_results",
                       help="Output directory for test results")
    
    args = parser.parse_args()
    
    print("🧪 MLPerf Test Single GPU Inference")
    print("=" * 50)
    print(f"🎯 TEST MODE: {args.samples} samples only")
    print(f"⚡ Expected completion: ~2-5 minutes")
    print("")
    
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
    
    # Run test benchmark
    success = run_test_benchmark(args.node, node_config, args.output_dir, args.samples)
    
    if success:
        generate_test_report(args.output_dir, args.node, args.samples)
        print(f"\n✅ Test benchmark completed successfully!")
        print(f"📁 Results: {args.output_dir}/{args.node}_test_results")
        print(f"💡 Ready to run full benchmark after debugging")
    else:
        print(f"\n❌ Test benchmark failed on {args.node}")
        print(f"🔧 Debug the issues before running full benchmark")
        sys.exit(1)

if __name__ == "__main__":
    main()