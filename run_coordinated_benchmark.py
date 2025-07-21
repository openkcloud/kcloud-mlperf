#!/usr/bin/env python3
"""
Coordinated Multi-GPU MLPerf Benchmark
Runs benchmarks simultaneously on multiple GPU nodes and aggregates results
"""
import os
import sys
import time
import json
import subprocess
import threading
import socket
from pathlib import Path
from datetime import datetime
from config import config

def run_benchmark_on_node(node_name, node_ip, samples_per_node, log_file, results_container):
    """Run benchmark on a single node"""
    try:
        env_vars = {
            'HF_TOKEN': os.environ.get('HF_TOKEN', ''),
            'NUM_SAMPLES': str(samples_per_node),
            'MAX_TOKENS': '32',
            'CUDA_VISIBLE_DEVICES': '0'
        }
        
        env_str = ' && '.join([f'export {k}={v}' for k, v in env_vars.items()])
        
        cmd = [
            'ssh', '-o', 'StrictHostKeyChecking=no',
            f'{config.username}@{node_ip}',
            f'cd {config.remote_base_dir} && '
            f'source venv/bin/activate && '
            f'{env_str} && '
            f'python run_benchmark_auto.py'
        ]
        
        print(f"🚀 Starting benchmark on {node_name}...")
        start_time = time.time()
        
        with open(log_file, 'w') as f:
            process = subprocess.Popen(
                cmd,
                stdout=f,
                stderr=subprocess.STDOUT
            )
            
            return_code = process.wait()
            elapsed = time.time() - start_time
            
            if return_code == 0:
                print(f"✅ {node_name} completed successfully in {elapsed:.2f}s")
                
                # Try to collect results
                try:
                    results_cmd = [
                        'ssh', '-o', 'StrictHostKeyChecking=no',
                        f'{config.username}@{node_ip}',
                        f'find /home/jungwooshim/mlperf-benchmark/results/{node_name} -name "*.json" -type f | head -1 | xargs cat'
                    ]
                    
                    result = subprocess.run(results_cmd, capture_output=True, text=True)
                    if result.returncode == 0 and result.stdout.strip():
                        benchmark_result = json.loads(result.stdout)
                        benchmark_result['node_name'] = node_name
                        benchmark_result['node_ip'] = node_ip
                        benchmark_result['elapsed_time'] = elapsed
                        results_container[node_name] = benchmark_result
                        print(f"📊 Results collected from {node_name}")
                    else:
                        print(f"⚠️  Could not collect results from {node_name}")
                        results_container[node_name] = {'error': 'Results collection failed'}
                        
                except Exception as e:
                    print(f"❌ Error collecting results from {node_name}: {e}")
                    results_container[node_name] = {'error': str(e)}
            else:
                print(f"❌ {node_name} failed with return code {return_code}")
                results_container[node_name] = {'error': f'Process failed with code {return_code}'}
                
    except Exception as e:
        print(f"❌ Exception running benchmark on {node_name}: {e}")
        results_container[node_name] = {'error': str(e)}

def main():
    """Main execution"""
    print("=" * 70)
    print("🌐 COORDINATED MULTI-GPU MLPerf Benchmark")
    print("=" * 70)
    
    # Configuration
    nodes = [
        {"name": "jw2", "ip": "129.254.202.252"},
        {"name": "jw3", "ip": "129.254.202.253"}
    ]
    
    total_samples = 20  # Total samples to distribute
    samples_per_node = total_samples // len(nodes)
    
    print(f"📊 Configuration:")
    print(f"   Total Samples: {total_samples}")
    print(f"   Samples per Node: {samples_per_node}")
    print(f"   Nodes: {[n['name'] for n in nodes]}")
    
    # Create results directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_dir = config.get_results_path("coordinated", timestamp)
    results_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"📁 Results directory: {results_dir}")
    
    # Check connectivity
    print("\\n🔍 Checking node connectivity...")
    for node in nodes:
        try:
            result = subprocess.run(
                ['ssh', '-o', 'StrictHostKeyChecking=no', f'jungwooshim@{node["ip"]}', 'hostname'],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                print(f"   ✅ {node['name']} ({node['ip']}): {result.stdout.strip()}")
            else:
                print(f"   ❌ {node['name']} ({node['ip']}): Connection failed")
                return 1
        except Exception as e:
            print(f"   ❌ {node['name']} ({node['ip']}): {e}")
            return 1
    
    # Start benchmarks simultaneously
    print("\\n🚀 Starting coordinated benchmarks...")
    threads = []
    results_container = {}
    
    start_time = time.time()
    
    for node in nodes:
        log_file = results_dir / f"{node['name']}_benchmark.log"
        
        thread = threading.Thread(
            target=run_benchmark_on_node,
            args=(node['name'], node['ip'], samples_per_node, log_file, results_container)
        )
        thread.start()
        threads.append(thread)
    
    # Wait for all threads to complete
    for thread in threads:
        thread.join()
    
    total_time = time.time() - start_time
    
    print(f"\\n🏁 All benchmarks completed in {total_time:.2f}s")
    
    # Aggregate and display results
    print("\\n📊 Aggregating results...")
    
    successful_nodes = []
    failed_nodes = []
    
    for node_name, result in results_container.items():
        if 'error' in result:
            failed_nodes.append(node_name)
            print(f"   ❌ {node_name}: {result['error']}")
        else:
            successful_nodes.append(node_name)
            print(f"   ✅ {node_name}: Success")
    
    if not successful_nodes:
        print("\\n❌ No successful benchmarks!")
        return 1
    
    # Calculate aggregated metrics
    print("\\n" + "=" * 70)
    print("🎯 COORDINATED MULTI-GPU BENCHMARK RESULTS")
    print("=" * 70)
    
    total_successful_samples = 0
    total_gpu_memory = 0
    total_throughput = 0
    avg_latency = 0
    avg_tokens_per_sec = 0
    
    print("\\n📈 Per-Node Results:")
    for node_name in successful_nodes:
        result = results_container[node_name]
        
        successful_samples = result.get('successful_samples', 0)
        throughput = result.get('throughput_samples_per_second', 0)
        latency = result.get('average_time_per_sample_ms', 0)
        tokens_per_sec = result.get('average_tokens_per_second', 0)
        gpu_memory = result.get('peak_gpu_memory_gb', 0)
        
        total_successful_samples += successful_samples
        total_gpu_memory += gpu_memory
        total_throughput += throughput
        avg_latency += latency
        avg_tokens_per_sec += tokens_per_sec
        
        print(f"   🖥️  {node_name}:")
        print(f"      Samples: {successful_samples}")
        print(f"      Throughput: {throughput:.2f} samples/sec")
        print(f"      Latency: {latency:.0f}ms")
        print(f"      Tokens/sec: {tokens_per_sec:.1f}")
        print(f"      GPU Memory: {gpu_memory:.2f}GB")
    
    # Calculate averages
    num_successful = len(successful_nodes)
    avg_latency = avg_latency / num_successful if num_successful > 0 else 0
    avg_tokens_per_sec = avg_tokens_per_sec / num_successful if num_successful > 0 else 0
    
    print("\\n📊 Aggregated Results:")
    print(f"   🌐 Active Nodes: {num_successful}/{len(nodes)}")
    print(f"   🔢 Total Samples: {total_successful_samples}")
    print(f"   ⏱️  Total Time: {total_time:.2f}s")
    print(f"   ⚡ Combined Throughput: {total_throughput:.2f} samples/sec")
    print(f"   📈 Average Latency: {avg_latency:.0f}ms")
    print(f"   🚀 Average Tokens/sec: {avg_tokens_per_sec:.1f}")
    print(f"   🔥 Total GPU Memory: {total_gpu_memory:.2f}GB")
    print(f"   🎯 Efficiency: {(total_throughput / num_successful):.2f} samples/sec per GPU")
    
    # Save aggregated results
    aggregated_results = {
        'timestamp': timestamp,
        'total_time_seconds': total_time,
        'active_nodes': num_successful,
        'total_nodes': len(nodes),
        'total_successful_samples': total_successful_samples,
        'combined_throughput_samples_per_second': total_throughput,
        'average_latency_ms': avg_latency,
        'average_tokens_per_second': avg_tokens_per_sec,
        'total_gpu_memory_gb': total_gpu_memory,
        'efficiency_samples_per_sec_per_gpu': total_throughput / num_successful if num_successful > 0 else 0,
        'node_results': results_container
    }
    
    results_file = results_dir / "aggregated_results.json"
    with open(results_file, 'w') as f:
        json.dump(aggregated_results, f, indent=2)
    
    print(f"\\n💾 Aggregated results saved to: {results_file}")
    
    # Compare with single GPU performance
    print("\\n📈 Performance Comparison:")
    single_gpu_throughput = 1.0  # From previous single GPU benchmark (approximate)
    speedup = total_throughput / single_gpu_throughput
    print(f"   Single GPU Throughput: ~{single_gpu_throughput:.2f} samples/sec")
    print(f"   Multi-GPU Throughput: {total_throughput:.2f} samples/sec")
    print(f"   Speedup: {speedup:.2f}x")
    
    print("=" * 70)
    print("🎉 Coordinated multi-GPU benchmark completed successfully!")
    
    return 0

if __name__ == "__main__":
    exit(main())