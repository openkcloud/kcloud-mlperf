#!/usr/bin/env python3
"""
Simplified Distributed MLPerf Benchmark
Runs independent benchmark processes on multiple nodes and aggregates results
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
from typing import Dict, List, Any

def run_simple_distributed_benchmark():
    """Run simplified distributed benchmark across multiple nodes"""
    print("=" * 70)
    print("🌐 SIMPLIFIED DISTRIBUTED MLPerf Benchmark")
    print("=" * 70)
    
    # Node configuration
    nodes = [
        {"name": "jw2", "ip": "129.254.202.252"},
        {"name": "jw3", "ip": "129.254.202.253"}
    ]
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_dir = Path(f"results/distributed_simple_{timestamp}")
    results_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"📊 Configuration:")
    print(f"   Nodes: {[node['name'] for node in nodes]}")
    print(f"   Results directory: {results_dir}")
    print(f"   Approach: Independent node execution")
    
    # Check node connectivity
    print(f"\n🔍 Checking node connectivity...")
    for node in nodes:
        try:
            result = subprocess.run([
                'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5',
                f'jungwooshim@{node["ip"]}', 'hostname'
            ], capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0:
                print(f"   ✅ {node['name']} ({node['ip']}): {result.stdout.strip()}")
            else:
                print(f"   ❌ {node['name']} ({node['ip']}): Connection failed")
                return 1
        except Exception as e:
            print(f"   ❌ {node['name']} ({node['ip']}): {str(e)}")
            return 1
    
    # Create individual benchmark scripts for each node
    print(f"\n🚀 Starting independent benchmarks on each node...")
    
    results_container = {}
    threads = []
    
    def run_node_benchmark(node_name: str, node_ip: str):
        """Run benchmark on a single node"""
        try:
            env_vars = {
                'HF_TOKEN': os.environ.get('HF_TOKEN', ''),
                'NUM_SAMPLES': '10',
                'MAX_TOKENS': '32',
                'CUDA_VISIBLE_DEVICES': '0',
                'NODE_NAME': node_name
            }
            
            env_str = ' && '.join([f'export {k}={v}' for k, v in env_vars.items()])
            
            # Use the existing benchmark script
            cmd = [
                'ssh', '-o', 'StrictHostKeyChecking=no',
                f'jungwooshim@{node_ip}',
                f'cd /home/jungwooshim/mlperf-benchmark && '
                f'source venv/bin/activate && '
                f'{env_str} && '
                f'python run_benchmark_auto.py'
            ]
            
            print(f"🚀 Starting independent benchmark on {node_name}...")
            log_file = results_dir / f"{node_name}_distributed_benchmark.log"
            
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
                    # Collect results from remote node
                    collect_node_results(node_name, node_ip, results_container, elapsed)
                else:
                    print(f"❌ {node_name} failed with return code {return_code}")
                    results_container[node_name] = {
                        "error": f"Process failed with code {return_code}",
                        "elapsed_time": elapsed
                    }
                    
        except Exception as e:
            print(f"❌ {node_name} failed with error: {str(e)}")
            results_container[node_name] = {"error": str(e)}
    
    def collect_node_results(node_name: str, node_ip: str, results_container: Dict, elapsed_time: float):
        """Collect results from remote node"""
        try:
            # Get the latest results file
            cmd = [
                'ssh', '-o', 'StrictHostKeyChecking=no',
                f'jungwooshim@{node_ip}',
                f'ls -t /home/jungwooshim/mlperf-benchmark/results/*/benchmark_results_*.json 2>/dev/null | head -1'
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                remote_file = result.stdout.strip()
                
                # Copy results file
                local_file = results_dir / f"{node_name}_results.json"
                copy_cmd = [
                    'scp', '-o', 'StrictHostKeyChecking=no',
                    f'jungwooshim@{node_ip}:{remote_file}',
                    str(local_file)
                ]
                
                copy_result = subprocess.run(copy_cmd, capture_output=True)
                if copy_result.returncode == 0:
                    # Load and enhance results
                    with open(local_file, 'r') as f:
                        node_results = json.load(f)
                    
                    # Add node info
                    node_results['node_name'] = node_name
                    node_results['node_ip'] = node_ip
                    node_results['distributed_benchmark_time'] = elapsed_time
                    
                    results_container[node_name] = node_results
                    print(f"📊 Results collected from {node_name}")
                else:
                    print(f"⚠️  Failed to copy results from {node_name}")
                    results_container[node_name] = {
                        "error": "Failed to copy results",
                        "elapsed_time": elapsed_time
                    }
            else:
                print(f"⚠️  No results file found on {node_name}")
                results_container[node_name] = {
                    "error": "No results file found",
                    "elapsed_time": elapsed_time
                }
                
        except Exception as e:
            print(f"❌ Error collecting results from {node_name}: {str(e)}")
            results_container[node_name] = {
                "error": f"Collection failed: {str(e)}",
                "elapsed_time": elapsed_time
            }
    
    # Start all benchmarks in parallel
    start_time = time.time()
    
    for node in nodes:
        thread = threading.Thread(
            target=run_node_benchmark,
            args=(node['name'], node['ip'])
        )
        thread.start()
        threads.append(thread)
    
    # Wait for all benchmarks to complete with timeout
    timeout = 300  # 5 minutes timeout
    for thread in threads:
        thread.join(timeout=timeout)
    
    total_time = time.time() - start_time
    print(f"\n🏁 All benchmarks completed in {total_time:.2f}s")
    
    # Aggregate and analyze results
    print(f"\n📊 Aggregating results...")
    
    successful_nodes = []
    failed_nodes = []
    
    for node_name, result in results_container.items():
        if "error" in result:
            failed_nodes.append(node_name)
            print(f"   ❌ {node_name}: {result['error']}")
        else:
            successful_nodes.append(node_name)
            print(f"   ✅ {node_name}: Success")
    
    if not successful_nodes:
        print("❌ No successful benchmark runs")
        return 1
    
    # Calculate distributed performance metrics
    total_samples = 0
    total_tokens = 0
    combined_throughput = 0
    combined_token_rate = 0
    avg_latency = 0
    total_gpu_memory = 0
    
    node_summaries = []
    
    for node_name in successful_nodes:
        node_result = results_container[node_name]
        
        # Extract metrics from node result
        samples = node_result.get('successful_samples', 0)
        throughput = node_result.get('throughput_samples_per_second', 0)
        tokens_per_sec = node_result.get('average_tokens_per_second', 0)
        latency = node_result.get('average_time_per_sample_ms', 0)
        gpu_memory = node_result.get('peak_gpu_memory_gb', 0)
        
        total_samples += samples
        combined_throughput += throughput
        combined_token_rate += tokens_per_sec
        avg_latency += latency
        total_gpu_memory += gpu_memory
        
        node_summaries.append({
            'node': node_name,
            'samples': samples,
            'throughput': throughput,
            'tokens_per_sec': tokens_per_sec,
            'latency': latency,
            'gpu_memory': gpu_memory
        })
    
    # Calculate averages
    num_successful = len(successful_nodes)
    avg_latency = avg_latency / num_successful if num_successful > 0 else 0
    
    # Create aggregated results
    aggregated_results = {
        "benchmark_info": {
            "benchmark": "Distributed MLPerf Inference - Simplified",
            "timestamp": timestamp,
            "total_time_seconds": total_time,
            "successful_nodes": successful_nodes,
            "failed_nodes": failed_nodes,
            "total_nodes": len(nodes),
            "world_size": len(nodes)
        },
        "distributed_metrics": {
            "total_samples": total_samples,
            "combined_throughput": combined_throughput,
            "combined_token_rate": combined_token_rate,
            "average_latency_ms": avg_latency,
            "total_gpu_memory_gb": total_gpu_memory,
            "scaling_efficiency": (combined_throughput / num_successful) / (combined_throughput / num_successful) if num_successful > 0 else 0
        },
        "node_results": results_container,
        "node_summaries": node_summaries
    }
    
    # Save aggregated results
    aggregated_file = results_dir / "distributed_aggregated_results.json"
    with open(aggregated_file, 'w') as f:
        json.dump(aggregated_results, f, indent=2)
    
    # Generate summary report
    print("\n" + "=" * 70)
    print("🎯 DISTRIBUTED BENCHMARK RESULTS")
    print("=" * 70)
    
    print(f"\n📊 Aggregate Performance:")
    print(f"   🌐 Successful Nodes: {len(successful_nodes)}/{len(nodes)}")
    print(f"   📈 Combined Throughput: {combined_throughput:.2f} samples/sec")
    print(f"   🚀 Combined Token Rate: {combined_token_rate:.2f} tokens/sec")
    print(f"   ⏱️  Average Latency: {avg_latency:.0f}ms")
    print(f"   💾 Total GPU Memory: {total_gpu_memory:.2f}GB")
    print(f"   🔢 Total Samples: {total_samples}")
    print(f"   ⏰ Total Time: {total_time:.2f}s")
    
    print(f"\n🖥️  Per-Node Results:")
    for summary in node_summaries:
        print(f"   {summary['node']}:")
        print(f"     Samples: {summary['samples']}")
        print(f"     Throughput: {summary['throughput']:.2f} samples/sec")
        print(f"     Tokens/sec: {summary['tokens_per_sec']:.2f}")
        print(f"     Latency: {summary['latency']:.0f}ms")
        print(f"     GPU Memory: {summary['gpu_memory']:.2f}GB")
    
    # Calculate scaling metrics
    if num_successful > 0:
        single_node_throughput = combined_throughput / num_successful
        scaling_factor = combined_throughput / single_node_throughput if single_node_throughput > 0 else 0
        scaling_efficiency = (scaling_factor / num_successful) * 100 if num_successful > 0 else 0
        
        print(f"\n📈 Scaling Analysis:")
        print(f"   Single Node Avg: {single_node_throughput:.2f} samples/sec")
        print(f"   Scaling Factor: {scaling_factor:.2f}x")
        print(f"   Scaling Efficiency: {scaling_efficiency:.1f}%")
    
    print(f"\n💾 Results saved to: {aggregated_file}")
    print("=" * 70)
    print("🎉 Distributed benchmark completed!")
    
    return 0

def main():
    """Main entry point"""
    try:
        return run_simple_distributed_benchmark()
    except KeyboardInterrupt:
        print("\n🛑 Benchmark interrupted by user")
        return 1
    except Exception as e:
        print(f"\n❌ Benchmark failed: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())