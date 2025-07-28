#!/usr/bin/env python3
"""
MLPerf Multi-GPU Coordination Script - SERVER SCENARIO ONLY
===========================================================

This script coordinates MLPerf Inference v5.0 Server scenario benchmarks across 
multiple GPU nodes in a distributed cluster environment.

Multi-GPU Coordination Overview:
- Orchestrates parallel execution of benchmarks on multiple GPU nodes
- Aggregates results from all participating nodes
- Provides unified reporting and performance analysis
- Ensures synchronized execution and consistent configuration

Architecture:
┌─────────────┐    SSH Commands    ┌─────────────┐
│ Controller  │ ─────────────────> │    jw2      │
│ Node (jw1)  │                    │ (A30 GPU)   │
│             │ ─────────────────> │    jw3      │
└─────────────┘                    │ (A30 GPU)   │
                                   └─────────────┘

This implementation focuses on the Server scenario which provides the most
relevant metrics for real-world deployment performance.
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
from config import config

def run_datacenter_benchmark_on_node(node_name: str, node_ip: str, log_file: str, results_container: Dict):
    """
    Execute MLPerf Benchmark on Single GPU Node
    ===========================================
    
    This function handles the remote execution of MLPerf benchmark on a specific GPU node.
    
    Process Flow:
    1. **Environment Setup**: Configure environment variables for the target node
    2. **SSH Execution**: Execute benchmark script remotely via SSH
    3. **Monitoring**: Track execution progress and completion status
    4. **Result Collection**: Retrieve benchmark results from remote node
    
    Args:
        node_name (str): Identifier for the GPU node (e.g., 'jw2', 'jw3')
        node_ip (str): IP address of the target GPU node
        log_file (str): Path to store execution logs
        results_container (Dict): Shared container for storing results across threads
    
    Remote Environment Configuration:
    - HF_TOKEN: HuggingFace authentication (if available)
    - NODE_NAME: Identifies which GPU node is running
    - MAX_TOKENS: Token limit per inference request
    - SERVER_TARGET_QPS: Performance target for validation
    - CUDA_VISIBLE_DEVICES: GPU device selection
    """
    try:
        # =================================================================
        # Environment Variable Configuration for Remote Execution
        # =================================================================
        # These variables ensure consistent configuration across all nodes
        env_vars = {
            'HF_TOKEN': os.environ.get('HF_TOKEN', ''),           # Optional authentication
            'NODE_NAME': node_name,                                # Node identification
            'MAX_TOKENS': os.environ.get('MAX_TOKENS', '64'),     # Output token limit
            'SERVER_TARGET_QPS': os.environ.get('SERVER_TARGET_QPS', '0.5'),  # Performance target
            'CUDA_VISIBLE_DEVICES': '0'                           # Use first GPU
        }
        
        # Build environment setup command for remote execution
        env_str = ' && '.join([f'export {k}={v}' for k, v in env_vars.items()])
        
        # =================================================================
        # Remote Command Construction
        # =================================================================
        # The full command chain:
        # 1. Set environment variables
        # 2. Execute the MLPerf benchmark script
        ssh_command = f"{env_str} && python3 mlperf_datacenter_benchmark.py"
        cmd = config.get_ssh_command(node_name, ssh_command)
        
        print(f"🚀 Starting MLPerf Datacenter benchmark on {node_name}...")
        start_time = time.time()
        
        # =================================================================
        # Remote Execution with Logging
        # =================================================================
        # Execute benchmark remotely while capturing all output to log file
        with open(log_file, 'w') as f:
            process = subprocess.Popen(
                cmd,
                stdout=f,                    # Redirect output to log file
                stderr=subprocess.STDOUT     # Combine stderr with stdout
            )
            
            return_code = process.wait()     # Wait for completion
            elapsed = time.time() - start_time
            
            # =================================================================
            # Result Processing
            # =================================================================
            if return_code == 0:
                print(f"✅ {node_name} completed successfully in {elapsed:.2f}s")
                # Collect and store results from the remote node
                collect_results_from_node(node_name, node_ip, results_container)
            else:
                print(f"❌ {node_name} failed with return code {return_code}")
                results_container[node_name] = {"error": f"Process failed with code {return_code}"}
                
    except Exception as e:
        print(f"❌ {node_name} failed with error: {str(e)}")
        results_container[node_name] = {"error": str(e)}

def collect_results_from_node(node_name: str, node_ip: str, results_container: Dict):
    """
    Collect MLPerf Results from Remote GPU Node
    ===========================================
    
    This function retrieves benchmark results from a remote GPU node after
    successful execution completion.
    
    Collection Process:
    1. **File Discovery**: Find the latest results file on remote node
    2. **Secure Copy**: Transfer results file to controller node
    3. **Data Loading**: Parse JSON results and store in results container
    4. **Validation**: Ensure data integrity and completeness
    
    Args:
        node_name (str): Identifier for the GPU node
        node_ip (str): IP address of the target node
        results_container (Dict): Shared storage for all node results
    
    File Structure on Remote Node:
    {MLPERF_REMOTE_DIR}/results/mlperf_datacenter_<timestamp>/
    └── mlperf_datacenter_{node_name}_{timestamp}.json
    """
    try:
        # =================================================================
        # Discover Latest Results File on Remote Node
        # =================================================================
        # Find the most recent results file for this specific node
        cmd = [
            'ssh', '-o', 'StrictHostKeyChecking=no',
            f'{config.username}@{node_ip}',
            f'find ~/MLPerf_local_test/results -name "mlperf_datacenter_{node_name}_*.json" -type f | sort -r | head -1'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            remote_file = result.stdout.strip()
            
            # =================================================================
            # Transfer Results File to Controller Node
            # =================================================================
            # Create local results directory and copy file
            local_results_dir = config.get_results_path("datacenter")
            local_results_dir.mkdir(parents=True, exist_ok=True)
            
            copy_cmd = [
                'scp', '-o', 'StrictHostKeyChecking=no',
                f'{config.username}@{node_ip}:{remote_file}',
                str(local_results_dir / f"{node_name}_results.json")
            ]
            
            copy_result = subprocess.run(copy_cmd, capture_output=True)
            if copy_result.returncode == 0:
                # =================================================================
                # Load and Validate Results Data
                # =================================================================
                local_file = local_results_dir / f"{node_name}_results.json"
                with open(local_file, 'r') as f:
                    node_results = json.load(f)
                
                # Store results in shared container for aggregation
                results_container[node_name] = node_results
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
    """
    Orchestrate Multi-GPU MLPerf Benchmark Execution
    ===============================================
    
    This is the main coordination function that manages the entire multi-GPU
    benchmark process across the cluster.
    
    Coordination Process:
    
    1. **Infrastructure Validation**
       - Verify connectivity to all GPU nodes
       - Confirm SSH access and node availability
       - Validate cluster configuration
    
    2. **Parallel Execution**
       - Launch benchmark threads on all GPU nodes simultaneously
       - Monitor execution progress across all nodes
       - Handle failures and timeouts gracefully
    
    3. **Result Aggregation**
       - Collect results from all successful nodes
       - Aggregate performance metrics
       - Calculate cluster-wide performance statistics
    
    4. **Comprehensive Reporting**
       - Generate unified performance report
       - Document per-node and aggregate metrics
       - Save results in standardized formats
    
    Multi-GPU Benefits:
    - **Scalability**: Demonstrates performance across multiple GPUs
    - **Reliability**: Shows consistent performance characteristics
    - **Efficiency**: Parallel execution reduces total benchmark time
    - **Real-world Relevance**: Simulates production deployment scenarios
    """
    print("=" * 60)
    print("🌐 MLPerf Inference Datacenter Benchmark")
    print("=" * 60)
    
    # =================================================================
    # Cluster Configuration
    # =================================================================
    # Define GPU nodes participating in the benchmark
    # Currently configured for 2x NVIDIA A30 GPUs
    nodes = [
        {"name": "jw2", "ip": config.nodes["jw2"]},  # First A30 GPU
        {"name": "jw3", "ip": config.nodes["jw3"]}   # Second A30 GPU
    ]
    
    # Create unique timestamp for this benchmark run
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_dir = config.get_results_path("datacenter", timestamp)
    results_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"📊 Configuration:")
    print(f"   Nodes: {[node['name'] for node in nodes]}")
    print(f"   Results directory: {results_dir}")
    
    # =================================================================
    # Infrastructure Validation Phase
    # =================================================================
    # Verify that all GPU nodes are accessible and responsive
    print(f"\n🔍 Checking node connectivity...")
    for node in nodes:
        try:
            # Test SSH connectivity and basic functionality
            result = subprocess.run([
                'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5',
                f'{config.username}@{node["ip"]}', 'hostname'
            ], capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0:
                print(f"   ✅ {node['name']} ({node['ip']}): {result.stdout.strip()}")
            else:
                print(f"   ❌ {node['name']} ({node['ip']}): Connection failed")
                return  # Abort if any node is unreachable
        except Exception as e:
            print(f"   ❌ {node['name']} ({node['ip']}): {str(e)}")
            return  # Abort on connectivity issues
    
    # =================================================================
    # Parallel Benchmark Execution Phase
    # =================================================================
    print(f"\n🚀 Starting coordinated MLPerf datacenter benchmarks...")
    
    # Shared container for collecting results from all threads
    results_container = {}
    threads = []
    
    start_time = time.time()
    
    # Launch benchmark execution on each GPU node in parallel
    for node in nodes:
        log_file = results_dir / f"{node['name']}_datacenter_benchmark.log"
        
        # Create thread for parallel execution
        thread = threading.Thread(
            target=run_datacenter_benchmark_on_node,
            args=(node['name'], node['ip'], str(log_file), results_container)
        )
        thread.start()
        threads.append(thread)
        print(f"🚀 Starting benchmark on {node['name']}...")
    
    # =================================================================
    # Execution Monitoring and Completion
    # =================================================================
    # Wait for all benchmark threads to complete
    for thread in threads:
        thread.join()  # Block until thread completes
    
    total_time = time.time() - start_time
    print(f"\n🏁 All benchmarks completed in {total_time:.2f}s")
    
    # =================================================================
    # Result Analysis and Validation
    # =================================================================
    print(f"\n📊 Aggregating results...")
    
    successful_nodes = []
    failed_nodes = []
    
    # Categorize results by success/failure
    for node_name, result in results_container.items():
        if "error" in result:
            failed_nodes.append(node_name)
            print(f"   ❌ {node_name}: {result['error']}")
        else:
            successful_nodes.append(node_name)
            print(f"   ✅ {node_name}: Success")
    
    # Require at least one successful node to continue
    if not successful_nodes:
        print("❌ No successful benchmark runs")
        return
    
    # =================================================================
    # Comprehensive Result Aggregation
    # =================================================================
    # Create master results document containing all node data
    aggregated_results = {
        "benchmark_info": {
            "framework": "MLPerf Inference v5.0",
            "scenario": "Server (Multi-GPU Coordinated)",
            "model": "meta-llama/Llama-3.1-8B-Instruct",
            "timestamp": timestamp,
            "total_time_seconds": total_time,
            "successful_nodes": successful_nodes,
            "failed_nodes": failed_nodes,
            "total_nodes": len(nodes),
            "cluster_configuration": {
                "gpu_count": len(successful_nodes),
                "gpu_type": "NVIDIA A30",
                "coordination_method": "SSH-based parallel execution"
            }
        },
        "node_results": results_container
    }
    
    # =================================================================
    # Result Persistence
    # =================================================================
    # Save comprehensive results in JSON format
    aggregated_file = results_dir / "aggregated_datacenter_results.json"
    with open(aggregated_file, 'w') as f:
        json.dump(aggregated_results, f, indent=2)
    
    # =================================================================
    # Performance Analysis and Reporting
    # =================================================================
    print("\n" + "=" * 60)
    print("🎯 MLPerf DATACENTER BENCHMARK RESULTS")
    print("=" * 60)
    
    summary_lines = []
    summary_lines.append(f"MLPerf Inference v5.0 - Server Scenario (Multi-GPU)")
    summary_lines.append(f"Execution Time: {total_time:.2f}s")
    summary_lines.append(f"Successful Nodes: {len(successful_nodes)}/{len(nodes)}")
    summary_lines.append("")
    
    # Aggregate performance metrics across all successful nodes
    total_server_qps = 0
    total_throughput = 0
    
    # =================================================================
    # Per-Node Performance Analysis
    # =================================================================
    for node_name in successful_nodes:
        node_result = results_container[node_name]
        scenarios = node_result.get("scenarios", {})
        
        print(f"\n🖥️  {node_name} Results:")
        summary_lines.append(f"{node_name} Results:")
        
        # Process Server scenario results (our focus)
        if "Server" in scenarios:
            server_data = scenarios["Server"]
            valid_status = "✅ VALID" if server_data.get("valid", False) else "❌ INVALID"
            qps = server_data.get("achieved_qps", 0)
            latency_p99 = server_data.get("latency_p99", 0)
            ttft_p99 = server_data.get("ttft_p99", 0)
            tpot_p99 = server_data.get("tpot_p99", 0)
            accuracy = server_data.get("accuracy", 0)
            throughput = server_data.get("throughput_tokens_per_sec", 0)
            
            # Display detailed per-node metrics
            print(f"   Server: {valid_status}")
            print(f"     QPS: {qps:.2f}")
            print(f"     Latency P99: {latency_p99:.2f}ms")
            print(f"     TTFT P99: {ttft_p99:.2f}ms")
            print(f"     TPOT P99: {tpot_p99:.2f}ms")
            print(f"     Accuracy: {accuracy:.3f}")
            print(f"     Throughput: {throughput:.2f} tokens/sec")
            
            # Add to summary file
            summary_lines.append(f"  Server: {valid_status}")
            summary_lines.append(f"    QPS: {qps:.2f}, Latency P99: {latency_p99:.2f}ms")
            summary_lines.append(f"    TTFT P99: {ttft_p99:.2f}ms, TPOT P99: {tpot_p99:.2f}ms")
            summary_lines.append(f"    Accuracy: {accuracy:.3f}, Throughput: {throughput:.2f} tokens/sec")
            
            # Accumulate cluster-wide metrics
            total_server_qps += qps
            total_throughput += throughput
    
    # =================================================================
    # Cluster-Wide Performance Summary
    # =================================================================
    print(f"\n📊 Aggregate Performance:")
    print(f"   Combined Server QPS: {total_server_qps:.2f}")
    print(f"   Total Throughput: {total_throughput:.2f} tokens/sec")
    print(f"   Average per GPU: {total_throughput/len(successful_nodes):.2f} tokens/sec")
    
    # Evaluate cluster performance against targets
    cluster_target_qps = 0.5 * len(successful_nodes)  # 0.5 QPS per GPU
    cluster_performance_ratio = total_server_qps / cluster_target_qps if cluster_target_qps > 0 else 0
    
    print(f"   Cluster Target QPS: {cluster_target_qps:.2f}")
    print(f"   Performance Ratio: {cluster_performance_ratio:.2f}x target")
    
    summary_lines.extend([
        "",
        "Cluster Performance Summary:",
        f"  Combined Server QPS: {total_server_qps:.2f}",
        f"  Total Throughput: {total_throughput:.2f} tokens/sec",
        f"  Average per GPU: {total_throughput/len(successful_nodes):.2f} tokens/sec",
        f"  Cluster Target QPS: {cluster_target_qps:.2f}",
        f"  Performance Ratio: {cluster_performance_ratio:.2f}x target"
    ])
    
    # =================================================================
    # Report Generation and Persistence
    # =================================================================
    # Save human-readable summary
    summary_file = results_dir / "benchmark_summary.txt"
    with open(summary_file, 'w') as f:
        f.write("\n".join(summary_lines))
    
    print(f"\n💾 Aggregated results saved to: {aggregated_file}")
    print(f"📊 Summary saved to: {summary_file}")
    print("=" * 60)
    print("🎉 MLPerf Datacenter benchmark completed successfully!")

def main():
    """
    Main Entry Point for Multi-GPU MLPerf Benchmark Coordination
    
    This function serves as the primary interface for executing coordinated
    MLPerf benchmarks across multiple GPU nodes.
    """
    if len(sys.argv) > 1 and sys.argv[1] == "--help":
        print("MLPerf Datacenter Benchmark Coordinator - Server Scenario")
        print("=" * 55)
        print("")
        print("DESCRIPTION:")
        print("  Coordinates MLPerf Inference v5.0 Server scenario benchmarks")
        print("  across multiple NVIDIA A30 GPU nodes in a distributed cluster.")
        print("")
        print("USAGE:")
        print("  python run_datacenter_benchmark.py")
        print("")
        print("ENVIRONMENT VARIABLES:")
        print("  HF_TOKEN           HuggingFace authentication token (optional)")
        print("  MAX_TOKENS         Maximum tokens per query (default: 64)")
        print("  SERVER_TARGET_QPS  Target QPS for server scenario (default: 0.5)")
        print("")
        print("CLUSTER CONFIGURATION:")
        print("  - Controller Node: jw1 (orchestration only)")
        print("  - GPU Nodes: jw2, jw3 (NVIDIA A30)")
        print("  - Communication: SSH-based coordination")
        print("")
        print("OUTPUT:")
        print("  - Individual node results (JSON)")
        print("  - Aggregated cluster performance (JSON)")
        print("  - Human-readable summary report (TXT)")
        sys.exit(0)
    
    # Execute the coordinated benchmark
    run_coordinated_datacenter_benchmark()

if __name__ == "__main__":
    main()