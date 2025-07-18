#!/usr/bin/env python3
"""
MLPerf Datacenter Benchmark Coordinator
Runs MLPerf Inference Datacenter benchmarks across multiple GPU nodes
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

def run_datacenter_benchmark_on_node(node_name: str, node_ip: str, log_file: str, results_container: Dict):
    """Run MLPerf datacenter benchmark on a single node"""
    try:
        env_vars = {
            'HF_TOKEN': os.environ.get('HF_TOKEN', ''),
            'NODE_NAME': node_name,
            'MAX_TOKENS': os.environ.get('MAX_TOKENS', '64'),
            'SERVER_TARGET_QPS': os.environ.get('SERVER_TARGET_QPS', '1.0'),
            'OFFLINE_TARGET_QPS': os.environ.get('OFFLINE_TARGET_QPS', '10.0'),
            'CUDA_VISIBLE_DEVICES': '0'
        }
        
        env_str = ' && '.join([f'export {k}={v}' for k, v in env_vars.items()])
        
        cmd = [
            'ssh', '-o', 'StrictHostKeyChecking=no',
            f'jungwooshim@{node_ip}',
            f'cd /home/jungwooshim/mlperf-benchmark && '
            f'source venv/bin/activate && '
            f'{env_str} && '
            f'python mlperf_datacenter_benchmark.py'
        ]
        
        print(f"🚀 Starting MLPerf Datacenter benchmark on {node_name}...")
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
                collect_results_from_node(node_name, node_ip, results_container)
            else:
                print(f"❌ {node_name} failed with return code {return_code}")
                results_container[node_name] = {"error": f"Process failed with code {return_code}"}
                
    except Exception as e:
        print(f"❌ {node_name} failed with error: {str(e)}")
        results_container[node_name] = {"error": str(e)}

def collect_results_from_node(node_name: str, node_ip: str, results_container: Dict):
    """Collect benchmark results from remote node"""
    try:
        # Get the latest results file
        cmd = [
            'ssh', '-o', 'StrictHostKeyChecking=no',
            f'jungwooshim@{node_ip}',
            f'ls -t /home/jungwooshim/mlperf-benchmark/results/mlperf_datacenter/mlperf_datacenter_{node_name}_*.json | head -1'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            remote_file = result.stdout.strip()
            
            # Copy results file
            local_results_dir = Path(f"results/datacenter_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
            local_results_dir.mkdir(parents=True, exist_ok=True)
            
            copy_cmd = [
                'scp', '-o', 'StrictHostKeyChecking=no',
                f'jungwooshim@{node_ip}:{remote_file}',
                str(local_results_dir / f"{node_name}_results.json")
            ]
            
            copy_result = subprocess.run(copy_cmd, capture_output=True)
            if copy_result.returncode == 0:
                # Load and store results
                local_file = local_results_dir / f"{node_name}_results.json"
                with open(local_file, 'r') as f:
                    results_container[node_name] = json.load(f)
                print(f"📊 Results collected from {node_name}")
            else:
                print(f"⚠️  Failed to copy results from {node_name}")
                results_container[node_name] = {"error": "Failed to copy results"}
        else:
            print(f"⚠️  No results file found on {node_name}")
            results_container[node_name] = {"error": "No results file found"}
            
    except Exception as e:
        print(f"❌ Error collecting results from {node_name}: {str(e)}")
        results_container[node_name] = {"error": f"Collection failed: {str(e)}"}

def run_coordinated_datacenter_benchmark():
    """Run coordinated MLPerf datacenter benchmark across all GPU nodes"""
    print("=" * 60)
    print("🌐 MLPerf Inference Datacenter Benchmark")
    print("=" * 60)
    
    # Node configuration
    nodes = [
        {"name": "jw2", "ip": "129.254.202.252"},
        {"name": "jw3", "ip": "129.254.202.253"}
    ]
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_dir = Path(f"results/datacenter_{timestamp}")
    results_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"📊 Configuration:")
    print(f"   Nodes: {[node['name'] for node in nodes]}")
    print(f"   Results directory: {results_dir}")
    
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
                return
        except Exception as e:
            print(f"   ❌ {node['name']} ({node['ip']}): {str(e)}")
            return
    
    # Start coordinated benchmarks
    print(f"\n🚀 Starting coordinated MLPerf datacenter benchmarks...")
    
    results_container = {}
    threads = []
    
    start_time = time.time()
    
    for node in nodes:
        log_file = results_dir / f"{node['name']}_datacenter_benchmark.log"
        thread = threading.Thread(
            target=run_datacenter_benchmark_on_node,
            args=(node['name'], node['ip'], str(log_file), results_container)
        )
        thread.start()
        threads.append(thread)
        print(f"🚀 Starting benchmark on {node['name']}...")
    
    # Wait for all benchmarks to complete
    for thread in threads:
        thread.join()
    
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
        return
    
    # Create aggregated report
    aggregated_results = {
        "benchmark_info": {
            "benchmark": "MLPerf Inference v5.0 Datacenter - Coordinated",
            "timestamp": timestamp,
            "total_time_seconds": total_time,
            "successful_nodes": successful_nodes,
            "failed_nodes": failed_nodes,
            "total_nodes": len(nodes)
        },
        "node_results": results_container
    }
    
    # Save aggregated results
    aggregated_file = results_dir / "aggregated_datacenter_results.json"
    with open(aggregated_file, 'w') as f:
        json.dump(aggregated_results, f, indent=2)
    
    # Generate summary report
    print("\n" + "=" * 60)
    print("🎯 MLPerf DATACENTER BENCHMARK RESULTS")
    print("=" * 60)
    
    summary_lines = []
    summary_lines.append(f"Benchmark: MLPerf Inference v5.0 Datacenter")
    summary_lines.append(f"Total Time: {total_time:.2f}s")
    summary_lines.append(f"Successful Nodes: {len(successful_nodes)}/{len(nodes)}")
    summary_lines.append("")
    
    total_server_qps = 0
    total_offline_qps = 0
    total_throughput = 0
    
    for node_name in successful_nodes:
        node_result = results_container[node_name]
        scenarios = node_result.get("scenarios", {})
        
        print(f"\n🖥️  {node_name} Results:")
        summary_lines.append(f"{node_name} Results:")
        
        for scenario_name, scenario_data in scenarios.items():
            valid_status = "✅ VALID" if scenario_data.get("valid", False) else "❌ INVALID"
            qps = scenario_data.get("achieved_qps", 0)
            latency_p99 = scenario_data.get("latency_p99", 0)
            ttft_p99 = scenario_data.get("ttft_p99", 0)
            tpot_p99 = scenario_data.get("tpot_p99", 0)
            accuracy = scenario_data.get("accuracy", 0)
            throughput = scenario_data.get("throughput_tokens_per_sec", 0)
            
            print(f"   {scenario_name}: {valid_status}")
            print(f"     QPS: {qps:.2f}")
            print(f"     Latency P99: {latency_p99:.2f}ms")
            print(f"     TTFT P99: {ttft_p99:.2f}ms")
            print(f"     TPOT P99: {tpot_p99:.2f}ms")
            print(f"     Accuracy: {accuracy:.3f}")
            print(f"     Throughput: {throughput:.2f} tokens/sec")
            
            summary_lines.append(f"  {scenario_name}: {valid_status}")
            summary_lines.append(f"    QPS: {qps:.2f}, Latency P99: {latency_p99:.2f}ms")
            summary_lines.append(f"    TTFT P99: {ttft_p99:.2f}ms, TPOT P99: {tpot_p99:.2f}ms")
            summary_lines.append(f"    Accuracy: {accuracy:.3f}, Throughput: {throughput:.2f} tokens/sec")
            
            if scenario_name == "Server":
                total_server_qps += qps
            elif scenario_name == "Offline":
                total_offline_qps += qps
            
            total_throughput += throughput
    
    # Aggregate summary
    print(f"\n📊 Aggregate Performance:")
    print(f"   Combined Server QPS: {total_server_qps:.2f}")
    print(f"   Combined Offline QPS: {total_offline_qps:.2f}")
    print(f"   Total Throughput: {total_throughput:.2f} tokens/sec")
    print(f"   Average per GPU: {total_throughput/len(successful_nodes):.2f} tokens/sec")
    
    summary_lines.extend([
        "",
        "Aggregate Performance:",
        f"  Combined Server QPS: {total_server_qps:.2f}",
        f"  Combined Offline QPS: {total_offline_qps:.2f}",
        f"  Total Throughput: {total_throughput:.2f} tokens/sec",
        f"  Average per GPU: {total_throughput/len(successful_nodes):.2f} tokens/sec"
    ])
    
    # Save summary
    summary_file = results_dir / "benchmark_summary.txt"
    with open(summary_file, 'w') as f:
        f.write("\n".join(summary_lines))
    
    print(f"\n💾 Aggregated results saved to: {aggregated_file}")
    print(f"📊 Summary saved to: {summary_file}")
    print("=" * 60)
    print("🎉 MLPerf Datacenter benchmark completed successfully!")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("MLPerf Datacenter Benchmark Coordinator")
        print("Usage: python run_datacenter_benchmark.py")
        print("\nEnvironment Variables:")
        print("  HF_TOKEN: HuggingFace authentication token")
        print("  MAX_TOKENS: Maximum tokens per query (default: 64)")
        print("  SERVER_TARGET_QPS: Target QPS for server scenario (default: 1.0)")
        print("  OFFLINE_TARGET_QPS: Target QPS for offline scenario (default: 10.0)")
        sys.exit(0)
    
    run_coordinated_datacenter_benchmark()