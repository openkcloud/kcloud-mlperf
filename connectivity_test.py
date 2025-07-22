#!/usr/bin/env python3
"""
Infrastructure Connectivity Tester
==================================
Tests connectivity to all configured infrastructure nodes and validates configuration.
"""

import yaml
import subprocess
import socket
import time
from pathlib import Path
import json

class ConnectivityTester:
    """Tests connectivity based on config.yaml configuration"""
    
    def __init__(self, config_file="config.yaml"):
        self.config_file = config_file
        self.config = self.load_config()
        
    def load_config(self):
        """Load configuration from YAML file"""
        try:
            with open(self.config_file, 'r') as f:
                return yaml.safe_load(f)
        except Exception as e:
            print(f"❌ Error loading config: {e}")
            return None
    
    def test_ping(self, ip):
        """Test ping connectivity"""
        try:
            result = subprocess.run(['ping', '-c', '2', '-W', '3', ip], 
                                  capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                # Extract latency
                lines = result.stdout.split('\n')
                for line in lines:
                    if 'rtt min/avg/max/mdev' in line:
                        avg_latency = line.split('/')[5].split('/')[1]
                        return {'status': 'SUCCESS', 'latency': f"{avg_latency}ms"}
                return {'status': 'SUCCESS', 'latency': 'N/A'}
            else:
                return {'status': 'FAILED', 'error': 'No response'}
        except Exception as e:
            return {'status': 'ERROR', 'error': str(e)}
    
    def test_ssh(self, ip, user):
        """Test SSH connectivity"""
        try:
            cmd = f'ssh -o ConnectTimeout=5 -o BatchMode=yes {user}@{ip} "echo Connected"'
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
            if result.returncode == 0 and 'Connected' in result.stdout:
                return {'status': 'SUCCESS'}
            else:
                return {'status': 'FAILED', 'error': result.stderr.strip() or 'SSH connection failed'}
        except Exception as e:
            return {'status': 'ERROR', 'error': str(e)}
    
    def test_gpu_access(self, ip, user):
        """Test GPU access on remote node"""
        try:
            cmd = f'ssh -o ConnectTimeout=5 {user}@{ip} "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader"'
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
            if result.returncode == 0:
                gpu_info = result.stdout.strip()
                return {'status': 'SUCCESS', 'gpu_info': gpu_info}
            else:
                return {'status': 'FAILED', 'error': 'GPU not accessible'}
        except Exception as e:
            return {'status': 'ERROR', 'error': str(e)}
    
    def test_mlperf_installation(self, ip, user):
        """Test MLPerf installation on remote node"""
        try:
            remote_dir = self.config.get('directories', {}).get('remote_mlperf_dir', '~/official_mlperf/inference/language/llama3.1-8b')
            cmd = f'ssh -o ConnectTimeout=5 {user}@{ip} "cd {remote_dir} && python3 main.py --help | head -2"'
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
            if result.returncode == 0 and 'main.py' in result.stdout:
                return {'status': 'SUCCESS'}
            else:
                return {'status': 'FAILED', 'error': 'MLPerf not found or not working'}
        except Exception as e:
            return {'status': 'ERROR', 'error': str(e)}
    
    def run_connectivity_tests(self):
        """Run comprehensive connectivity tests"""
        if not self.config:
            return None
        
        print("🔍 Testing Infrastructure Connectivity")
        print("=" * 60)
        print(f"📁 Config file: {self.config_file}")
        print(f"🚀 Deployment type: {self.config.get('infrastructure', {}).get('deployment_type', 'Unknown')}")
        print()
        
        gpu_nodes = self.config.get('infrastructure', {}).get('gpu_nodes', [])
        if not gpu_nodes:
            print("❌ No GPU nodes configured")
            return None
        
        results = {}
        
        for i, node in enumerate(gpu_nodes, 1):
            node_name = node.get('name', f'node-{i}')
            ip = node.get('ip')
            user = node.get('ssh_user')
            
            print(f"📡 Testing {node_name} ({ip})")
            print("-" * 40)
            
            node_results = {}
            
            # Test 1: Ping
            print(f"  🔸 Ping test... ", end='', flush=True)
            ping_result = self.test_ping(ip)
            node_results['ping'] = ping_result
            if ping_result['status'] == 'SUCCESS':
                print(f"✅ {ping_result.get('latency', 'OK')}")
            else:
                print(f"❌ {ping_result.get('error', 'Failed')}")
            
            # Test 2: SSH
            if user:
                print(f"  🔸 SSH test... ", end='', flush=True)
                ssh_result = self.test_ssh(ip, user)
                node_results['ssh'] = ssh_result
                if ssh_result['status'] == 'SUCCESS':
                    print("✅ Connected")
                else:
                    print(f"❌ {ssh_result.get('error', 'Failed')}")
                
                # Test 3: GPU Access (only if SSH works)
                if ssh_result['status'] == 'SUCCESS':
                    print(f"  🔸 GPU access... ", end='', flush=True)
                    gpu_result = self.test_gpu_access(ip, user)
                    node_results['gpu'] = gpu_result
                    if gpu_result['status'] == 'SUCCESS':
                        print(f"✅ {gpu_result.get('gpu_info', 'Available')}")
                    else:
                        print(f"❌ {gpu_result.get('error', 'Failed')}")
                    
                    # Test 4: MLPerf Installation
                    print(f"  🔸 MLPerf setup... ", end='', flush=True)
                    mlperf_result = self.test_mlperf_installation(ip, user)
                    node_results['mlperf'] = mlperf_result
                    if mlperf_result['status'] == 'SUCCESS':
                        print("✅ Ready")
                    else:
                        print(f"❌ {mlperf_result.get('error', 'Failed')}")
            
            results[node_name] = node_results
            print()
        
        # Summary
        self.print_connectivity_summary(results)
        return results
    
    def print_connectivity_summary(self, results):
        """Print connectivity test summary"""
        print("📊 Connectivity Summary")
        print("=" * 60)
        
        total_nodes = len(results)
        fully_ready = 0
        issues = []
        
        for node_name, node_results in results.items():
            all_tests_passed = all(
                test_result.get('status') == 'SUCCESS' 
                for test_result in node_results.values()
            )
            
            if all_tests_passed:
                fully_ready += 1
                print(f"✅ {node_name}: FULLY READY")
            else:
                failed_tests = [
                    test_name for test_name, test_result in node_results.items()
                    if test_result.get('status') != 'SUCCESS'
                ]
                print(f"⚠️  {node_name}: ISSUES - {', '.join(failed_tests)}")
                issues.extend(failed_tests)
        
        print()
        print(f"📋 Results: {fully_ready}/{total_nodes} nodes fully ready")
        
        if fully_ready == total_nodes:
            print("🎉 All nodes are ready for MLPerf benchmarking!")
        else:
            print("⚠️  Some nodes have connectivity issues. Check configuration and setup.")
            print(f"🔧 Common issues: {', '.join(set(issues))}")

def main():
    tester = ConnectivityTester()
    results = tester.run_connectivity_tests()
    
    if results:
        # Save results for other tools
        timestamp = int(time.time())
        results_file = f"connectivity_test_results_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump({
                'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
                'results': results
            }, f, indent=2)
        print(f"📁 Detailed results saved: {results_file}")

if __name__ == "__main__":
    main()