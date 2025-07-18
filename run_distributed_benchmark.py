#!/usr/bin/env python3
"""
Distributed MLPerf Benchmark Launcher
Coordinates multi-GPU benchmark execution across different servers
"""
import os
import sys
import time
import json
import subprocess
import threading
import socket
from pathlib import Path

def get_local_ip():
    """Get local IP address"""
    try:
        # Connect to Google DNS to get local IP
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
        return local_ip
    except Exception:
        return "127.0.0.1"

def check_connectivity(host, port):
    """Check if host:port is reachable"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False

def run_distributed_node(rank, world_size, master_addr, master_port, log_file):
    """Run distributed benchmark on a single node"""
    env = os.environ.copy()
    env['HF_TOKEN'] = os.environ.get('HF_TOKEN', '')
    env['NUM_SAMPLES'] = '10'
    env['MAX_TOKENS'] = '32'
    env['CUDA_VISIBLE_DEVICES'] = '0'
    
    cmd = [
        sys.executable,
        '/home/jungwooshim/mlperf-benchmark/benchmark_scripts/distributed_benchmark.py',
        '--rank', str(rank),
        '--world-size', str(world_size),
        '--master-addr', master_addr,
        '--master-port', str(master_port)
    ]
    
    print(f"🚀 Starting rank {rank} with command: {' '.join(cmd)}")
    
    with open(log_file, 'w') as f:
        process = subprocess.Popen(
            cmd,
            stdout=f,
            stderr=subprocess.STDOUT,
            env=env,
            cwd='/home/jungwooshim/mlperf-benchmark'
        )
        return process

def main():
    """Main execution"""
    print("=" * 70)
    print("🌐 DISTRIBUTED MLPerf Llama-3.1-8B Benchmark Launcher")
    print("=" * 70)
    
    # Configuration
    nodes = [
        {"host": "129.254.202.252", "name": "jw2"},
        {"host": "129.254.202.253", "name": "jw3"}
    ]
    
    world_size = len(nodes)
    master_addr = nodes[0]["host"]  # Use jw2 as master
    master_port = 29501
    
    print(f"📊 Configuration:")
    print(f"   World Size: {world_size}")
    print(f"   Master: {master_addr}:{master_port}")
    print(f"   Nodes: {[n['name'] for n in nodes]}")
    
    # Check connectivity
    print("\\n🔍 Checking connectivity...")
    for i, node in enumerate(nodes):
        print(f"   {node['name']} ({node['host']}): ", end="")
        if check_connectivity(node['host'], 22):  # SSH port
            print("✅ Reachable")
        else:
            print("❌ Unreachable")
            return 1
    
    # Create results directory
    results_dir = Path("/home/jungwooshim/k8s-gpu-cluster/mlperf-benchmark/results/distributed")
    results_dir.mkdir(parents=True, exist_ok=True)
    
    print("\\n🚀 Starting distributed benchmark...")
    
    # Launch distributed processes
    processes = []
    for rank, node in enumerate(nodes):
        log_file = results_dir / f"distributed_log_rank{rank}_{node['name']}.txt"
        
        if node['host'] == get_local_ip() or node['name'] == 'jw1':
            # Run locally
            print(f"   Rank {rank} ({node['name']}): Running locally")
            process = run_distributed_node(rank, world_size, master_addr, master_port, log_file)
            processes.append((rank, node['name'], process, log_file))
        else:
            # Run remotely via SSH
            print(f"   Rank {rank} ({node['name']}): Running via SSH")
            
            ssh_cmd = [
                'ssh', '-o', 'StrictHostKeyChecking=no',
                f'jungwooshim@{node["host"]}',
                f'cd /home/jungwooshim/mlperf-benchmark && '
                f'source venv/bin/activate && '
                f'export HF_TOKEN={os.environ.get("HF_TOKEN", "")} && '
                f'export NUM_SAMPLES=10 && '
                f'export MAX_TOKENS=32 && '
                f'export CUDA_VISIBLE_DEVICES=0 && '
                f'python benchmark_scripts/distributed_benchmark.py '
                f'--rank {rank} --world-size {world_size} '
                f'--master-addr {master_addr} --master-port {master_port}'
            ]
            
            with open(log_file, 'w') as f:
                process = subprocess.Popen(
                    ssh_cmd,
                    stdout=f,
                    stderr=subprocess.STDOUT
                )
                processes.append((rank, node['name'], process, log_file))
    
    print(f"\\n⏳ Waiting for {len(processes)} processes to complete...")
    
    # Monitor processes
    start_time = time.time()
    completed = []
    
    while len(completed) < len(processes):
        time.sleep(5)
        elapsed = time.time() - start_time
        
        for rank, name, process, log_file in processes:
            if (rank, name) not in completed:
                if process.poll() is not None:
                    completed.append((rank, name))
                    if process.returncode == 0:
                        print(f"   ✅ Rank {rank} ({name}) completed successfully")
                    else:
                        print(f"   ❌ Rank {rank} ({name}) failed (exit code: {process.returncode})")
                        # Show last few lines of log
                        try:
                            with open(log_file, 'r') as f:
                                lines = f.readlines()
                                print(f"      Last error: {lines[-1].strip() if lines else 'No output'}")
                        except:
                            pass
        
        if elapsed > 600:  # 10 minute timeout
            print("⏰ Timeout reached, terminating processes...")
            for rank, name, process, log_file in processes:
                if process.poll() is None:
                    process.terminate()
                    print(f"   🛑 Terminated rank {rank} ({name})")
            break
    
    total_time = time.time() - start_time
    print(f"\\n🏁 All processes completed in {total_time:.2f}s")
    
    # Collect and display results
    print("\\n📊 Collecting results...")
    all_results = []
    
    for rank, node in enumerate(nodes):
        results_pattern = results_dir / f"distributed_results_rank{rank}_*.json"
        
        # Also check node-specific results directory
        node_results_dir = f"/home/jungwooshim/mlperf-benchmark/results/distributed_{node['name']}_rank{rank}"
        
        # Try to copy results from remote nodes
        if node['host'] != get_local_ip():
            try:
                subprocess.run([
                    'scp', '-o', 'StrictHostKeyChecking=no',
                    f'jungwooshim@{node["host"]}:{node_results_dir}/distributed_results_rank{rank}_*.json',
                    str(results_dir)
                ], check=False, capture_output=True)
                
                subprocess.run([
                    'scp', '-o', 'StrictHostKeyChecking=no',
                    f'jungwooshim@{node["host"]}:{node_results_dir}/distributed_summary_rank{rank}_*.txt',
                    str(results_dir)
                ], check=False, capture_output=True)
            except Exception as e:
                print(f"   ⚠️  Could not copy results from {node['name']}: {e}")
        
        # Look for results files
        import glob
        results_files = glob.glob(str(results_dir / f"distributed_results_rank{rank}_*.json"))
        
        if results_files:
            latest_file = max(results_files, key=os.path.getctime)
            try:
                with open(latest_file, 'r') as f:
                    result = json.load(f)
                    all_results.append(result)
                    print(f"   ✅ Loaded results for rank {rank} ({node['name']})")
            except Exception as e:
                print(f"   ❌ Failed to load results for rank {rank}: {e}")
        else:
            print(f"   ⚠️  No results found for rank {rank} ({node['name']})")
    
    # Display combined results
    if all_results:
        print("\\n" + "=" * 70)
        print("🎯 DISTRIBUTED BENCHMARK RESULTS SUMMARY")
        print("=" * 70)
        
        total_successful_samples = sum(r.get('successful_samples', 0) for r in all_results)
        total_samples = sum(r.get('total_samples', 0) for r in all_results)
        total_time = max(r.get('total_time_seconds', 0) for r in all_results)
        avg_throughput = sum(r.get('throughput_samples_per_second', 0) for r in all_results)
        avg_tokens_per_sec = sum(r.get('average_tokens_per_second', 0) for r in all_results) / len(all_results)
        avg_latency = sum(r.get('average_time_per_sample_ms', 0) for r in all_results) / len(all_results)
        total_gpu_memory = sum(r.get('peak_gpu_memory_gb', 0) for r in all_results)
        
        print(f"🌐 World Size: {world_size}")
        print(f"📊 Total Samples: {total_successful_samples}/{total_samples}")
        print(f"⏱️  Total Time: {total_time:.2f}s")
        print(f"⚡ Combined Throughput: {avg_throughput:.2f} samples/sec")
        print(f"📈 Avg Latency: {avg_latency:.0f}ms")
        print(f"🚀 Avg Tokens/sec: {avg_tokens_per_sec:.1f}")
        print(f"🔥 Total GPU Memory: {total_gpu_memory:.2f}GB")
        
        print("\\n📈 Per-Node Results:")
        for result in all_results:
            print(f"   Rank {result.get('rank', 'N/A')} ({result.get('hostname', 'N/A')}):")
            print(f"     Throughput: {result.get('throughput_samples_per_second', 0):.2f} samples/sec")
            print(f"     Tokens/sec: {result.get('average_tokens_per_second', 0):.1f}")
            print(f"     GPU Memory: {result.get('peak_gpu_memory_gb', 0):.2f}GB")
        
        print("=" * 70)
    else:
        print("\\n❌ No results collected!")
        return 1
    
    print("\\n🎉 Distributed benchmark completed!")
    return 0

if __name__ == "__main__":
    exit(main())