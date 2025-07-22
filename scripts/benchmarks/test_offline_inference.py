#!/usr/bin/env python3
"""
MLPerf Test Offline Inference - No Latency Constraints
This should show VALID results since it only measures throughput
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

def run_offline_test(node_name, node_config, output_dir, sample_count=20):
    """Run MLPerf Offline test - should pass validation"""
    
    print(f"🧪 Starting TEST Offline Inference on {node_name}")
    print(f"   Node: {node_config['ip']} ({node_config['username']})")
    print(f"   GPU: Single NVIDIA A30")
    print(f"   Samples: {sample_count} (TEST MODE)")
    print(f"   Scenario: Offline (No latency constraints)")
    
    # Prepare remote directory and commands
    remote_dir = "~/official_mlperf/inference/language/llama3.1-8b"
    log_file = f"{node_name}_offline_test_{sample_count}_samples.log"
    results_dir = f"{node_name}_offline_test_{sample_count}_results"
    
    # SSH command for Offline scenario
    ssh_cmd = [
        "ssh", f"{node_config['username']}@{node_config['ip']}",
        f"cd {remote_dir} && "
        f"python3 main.py "
        f"--scenario Offline "
        f"--model-path meta-llama/Llama-3.1-8B-Instruct "
        f"--total-sample-count {sample_count} "
        f"--dataset-path cnn_eval.json "
        f"--vllm "
        f"--tensor-parallel-size 1 "
        f"--dtype bfloat16 "
        f"--output-log-dir {results_dir} "
        f"> {log_file} 2>&1"
    ]
    
    print(f"🚀 Starting Offline test (should complete in ~2-3 minutes)...")
    print(f"📝 Command: {' '.join(ssh_cmd)}")
    
    try:
        # Offline should be faster than Server
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=900)
        
        if result.returncode == 0:
            print(f"✅ Offline test completed successfully on {node_name}")
            
            # Copy results back
            print(f"📁 Copying results from {node_name}...")
            local_results_dir = Path(output_dir) / f"{node_name}_offline_test_results"
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
            
            print(f"📊 Offline test results saved to: {local_results_dir}")
            return True
            
        else:
            print(f"❌ Offline test failed on {node_name}")
            if result.stderr:
                print(f"Error: {result.stderr}")
            if result.stdout:
                print(f"Output: {result.stdout}")
            return False
            
    except subprocess.TimeoutExpired:
        print(f"⏰ Offline test timed out on {node_name}")
        return False
    except Exception as e:
        print(f"❌ Error running offline test on {node_name}: {str(e)}")
        return False

def generate_offline_report(output_dir, node_name, sample_count):
    """Generate visual report for offline test"""
    
    results_dir = Path(output_dir) / f"{node_name}_offline_test_results"
    
    if results_dir.exists():
        # Generate visual HTML report
        try:
            visual_cmd = [
                sys.executable, "scripts/reporting/visual_results_generator.py",
                "--results-dir", str(results_dir)
            ]
            result = subprocess.run(visual_cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                print(f"📊 Visual offline report generated successfully")
                print(f"✨ {result.stdout.strip()}")
            else:
                print(f"⚠️ Visual report generation failed: {result.stderr}")
        except Exception as e:
            print(f"⚠️ Could not generate visual report: {e}")

def main():
    parser = argparse.ArgumentParser(description="MLPerf Test Offline Inference (Should Show VALID)")
    parser.add_argument("--node", choices=["jw2", "jw3"], required=True,
                       help="Target node for offline test")
    parser.add_argument("--samples", type=int, default=20,
                       help="Number of samples for test (default: 20)")
    parser.add_argument("--output-dir", default="./test_results",
                       help="Output directory for test results")
    
    args = parser.parse_args()
    
    print("🧪 MLPerf Test Offline Inference")
    print("=" * 50)
    print(f"🎯 TEST MODE: {args.samples} samples only")
    print(f"✅ Offline scenario: NO latency constraints")
    print(f"⚡ Expected result: VALID (unlike Server scenario)")
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
    
    # Run offline test
    success = run_offline_test(args.node, node_config, args.output_dir, args.samples)
    
    if success:
        generate_offline_report(args.output_dir, args.node, args.samples)
        print(f"\n✅ Offline test completed successfully!")
        print(f"📁 Results: {args.output_dir}/{args.node}_offline_test_results")
        print(f"💡 This should show VALID results (no latency constraints)")
    else:
        print(f"\n❌ Offline test failed on {args.node}")
        sys.exit(1)

if __name__ == "__main__":
    main()