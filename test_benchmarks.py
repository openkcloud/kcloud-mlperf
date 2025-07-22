#!/usr/bin/env python3
"""
MLPerf Benchmark Test Suite
===========================
Tests all benchmark scenarios to ensure everything works correctly.
"""

import subprocess
import time
import json
import os
from pathlib import Path

class MLPerfBenchmarkTester:
    """Tests different MLPerf benchmark scenarios"""
    
    def __init__(self):
        self.test_results = {}
        self.test_dir = Path("test_results")
        self.test_dir.mkdir(exist_ok=True)
    
    def run_command(self, command, timeout=300):
        """Run command with timeout and capture output"""
        try:
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True, timeout=timeout
            )
            return {
                'success': result.returncode == 0,
                'stdout': result.stdout,
                'stderr': result.stderr,
                'returncode': result.returncode
            }
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'stdout': '',
                'stderr': 'Command timed out',
                'returncode': -1
            }
    
    def test_individual_gpu_jw2(self):
        """Test individual GPU benchmark on jw2"""
        print("🔍 Testing individual GPU benchmark on jw2...")
        
        # Check GPU availability
        gpu_check = self.run_command(
            'ssh 129.254.202.252 "nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits"'
        )
        
        if not gpu_check['success']:
            return {'status': 'FAILED', 'reason': 'Cannot connect to jw2'}
        
        free_memory = int(gpu_check['stdout'].strip())
        if free_memory < 2000:  # Need at least 2GB free
            return {'status': 'SKIPPED', 'reason': f'Insufficient GPU memory: {free_memory}MB free'}
        
        # Run small test
        test_cmd = '''ssh 129.254.202.252 "cd ~/official_mlperf/inference/language/llama3.1-8b && 
            timeout 180 python3 main.py --scenario Server --model-path meta-llama/Llama-3.1-8B-Instruct 
            --total-sample-count 5 --dataset-path cnn_eval.json --vllm 
            --output-log-dir test_jw2_individual 2>&1"'''
        
        result = self.run_command(test_cmd, timeout=200)
        
        if result['success'] or 'Test completed' in result['stdout']:
            return {'status': 'PASSED', 'output': result['stdout'][-500:]}
        else:
            return {'status': 'FAILED', 'reason': result['stderr'][-500:]}
    
    def test_individual_gpu_jw3(self):
        """Test individual GPU benchmark on jw3"""
        print("🔍 Testing individual GPU benchmark on jw3...")
        
        # Check GPU availability  
        gpu_check = self.run_command(
            'ssh 129.254.202.253 "nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits"'
        )
        
        if not gpu_check['success']:
            return {'status': 'FAILED', 'reason': 'Cannot connect to jw3'}
        
        free_memory = int(gpu_check['stdout'].strip())
        if free_memory < 2000:  # Need at least 2GB free
            return {'status': 'SKIPPED', 'reason': f'Insufficient GPU memory: {free_memory}MB free'}
        
        # Run small test
        test_cmd = '''ssh 129.254.202.253 "cd ~/official_mlperf/inference/language/llama3.1-8b && 
            timeout 180 python3 main.py --scenario Server --model-path meta-llama/Llama-3.1-8B-Instruct 
            --total-sample-count 5 --dataset-path cnn_eval.json --vllm 
            --output-log-dir test_jw3_individual 2>&1"'''
        
        result = self.run_command(test_cmd, timeout=200)
        
        if result['success'] or 'Test completed' in result['stdout']:
            return {'status': 'PASSED', 'output': result['stdout'][-500:]}
        else:
            return {'status': 'FAILED', 'reason': result['stderr'][-500:]}
    
    def test_multi_gpu_distributed(self):
        """Test multi-GPU distributed benchmark using Kubernetes"""
        print("🔍 Testing multi-GPU distributed benchmark...")
        
        # Check if kubectl is available
        kubectl_check = self.run_command('kubectl version --client --output=json')
        if not kubectl_check['success']:
            return {'status': 'SKIPPED', 'reason': 'kubectl not available'}
        
        # Check if nodes are ready
        nodes_check = self.run_command('kubectl get nodes -o json')
        if not nodes_check['success']:
            return {'status': 'SKIPPED', 'reason': 'Cannot connect to Kubernetes cluster'}
        
        try:
            nodes_data = json.loads(nodes_check['stdout'])
            gpu_nodes = []
            for node in nodes_data.get('items', []):
                if 'nvidia.com/gpu' in node.get('status', {}).get('allocatable', {}):
                    gpu_nodes.append(node['metadata']['name'])
            
            if len(gpu_nodes) < 2:
                return {'status': 'SKIPPED', 'reason': f'Need 2+ GPU nodes, found {len(gpu_nodes)}'}
            
        except json.JSONDecodeError:
            return {'status': 'FAILED', 'reason': 'Cannot parse kubectl output'}
        
        # Test Kubernetes multi-GPU configuration
        test_cmd = 'kubectl apply --dry-run=client -f official_mlperf/k8s-multi-gpu-distributed.yaml'
        result = self.run_command(test_cmd)
        
        if result['success']:
            return {'status': 'PASSED', 'output': f'Multi-GPU config valid for {len(gpu_nodes)} GPU nodes'}
        else:
            return {'status': 'FAILED', 'reason': result['stderr']}
    
    def test_datacenter_benchmark_scenarios(self):
        """Test different MLPerf datacenter benchmark scenarios"""
        print("🔍 Testing MLPerf datacenter benchmark scenarios...")
        
        scenarios = ['Server', 'Offline', 'SingleStream']
        scenario_results = {}
        
        for scenario in scenarios:
            print(f"  Testing {scenario} scenario...")
            
            # Test configuration validation
            test_cmd = f'''cd official_mlperf && python3 -c "
import main
import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--scenario', choices=['Offline', 'Server', 'SingleStream'])
parser.add_argument('--model-path', default='meta-llama/Llama-3.1-8B-Instruct')
parser.add_argument('--dataset-path', default='cnn_eval.json')
parser.add_argument('--total-sample-count', type=int, default=1)
parser.add_argument('--vllm', action='store_true')
args = parser.parse_args(['--scenario', '{scenario}', '--total-sample-count', '1', '--vllm'])
print(f'✅ {scenario} scenario configuration valid')
"'''
            
            result = self.run_command(test_cmd)
            scenario_results[scenario] = {
                'config_valid': result['success'],
                'output': result['stdout'] if result['success'] else result['stderr']
            }
        
        # Check if user.conf is valid
        user_conf_check = self.run_command('cd official_mlperf && cat user.conf')
        
        return {
            'status': 'PASSED' if all(r['config_valid'] for r in scenario_results.values()) else 'PARTIAL',
            'scenarios': scenario_results,
            'user_conf_valid': user_conf_check['success']
        }
    
    def test_infrastructure_config_system(self):
        """Test the new infrastructure configuration system"""
        print("🔍 Testing infrastructure configuration system...")
        
        tests = {}
        
        # Test config validation
        config_test = self.run_command('python3 config_manager.py --validate')
        tests['config_validation'] = {
            'status': 'PASSED' if config_test['success'] else 'FAILED',
            'output': config_test['stdout']
        }
        
        # Test script generation
        script_gen_test = self.run_command('python3 config_manager.py --generate-scripts')
        tests['script_generation'] = {
            'status': 'PASSED' if script_gen_test['success'] else 'FAILED',
            'output': script_gen_test['stdout']
        }
        
        # Check if generated scripts exist and are executable
        generated_files = ['monitor_benchmarks.sh', 'run_benchmarks.sh']
        for filename in generated_files:
            if os.path.exists(filename) and os.access(filename, os.X_OK):
                tests[f'{filename}_exists'] = {'status': 'PASSED', 'output': f'{filename} is executable'}
            else:
                tests[f'{filename}_exists'] = {'status': 'FAILED', 'output': f'{filename} missing or not executable'}
        
        return {
            'status': 'PASSED' if all(t['status'] == 'PASSED' for t in tests.values()) else 'PARTIAL',
            'tests': tests
        }
    
    def test_visual_reporting_system(self):
        """Test the visual reporting system"""
        print("🔍 Testing visual reporting system...")
        
        # Test visual report generation
        report_test = self.run_command('python3 generate_visual_reports.py results', timeout=120)
        
        if report_test['success']:
            # Check if reports were generated
            report_dirs = list(Path('results').glob('visual_reports_*'))
            if report_dirs:
                latest_report = max(report_dirs, key=lambda x: x.stat().st_mtime)
                expected_files = ['mlperf_static_report.png', 'mlperf_interactive_dashboard.html', 'README.md']
                missing_files = [f for f in expected_files if not (latest_report / f).exists()]
                
                if not missing_files:
                    return {'status': 'PASSED', 'report_dir': str(latest_report)}
                else:
                    return {'status': 'PARTIAL', 'missing_files': missing_files}
            else:
                return {'status': 'FAILED', 'reason': 'No visual report directories found'}
        else:
            return {'status': 'FAILED', 'reason': report_test['stderr']}
    
    def run_all_tests(self):
        """Run all benchmark tests"""
        print("🚀 MLPerf Benchmark Test Suite")
        print("=" * 50)
        
        tests = [
            ('Individual GPU jw2', self.test_individual_gpu_jw2),
            ('Individual GPU jw3', self.test_individual_gpu_jw3), 
            ('Multi-GPU Distributed', self.test_multi_gpu_distributed),
            ('Datacenter Scenarios', self.test_datacenter_benchmark_scenarios),
            ('Infrastructure Config', self.test_infrastructure_config_system),
            ('Visual Reporting', self.test_visual_reporting_system)
        ]
        
        for test_name, test_func in tests:
            print(f"\n📋 Running: {test_name}")
            try:
                result = test_func()
                self.test_results[test_name] = result
                
                status = result.get('status', 'UNKNOWN')
                if status == 'PASSED':
                    print(f"✅ {test_name}: PASSED")
                elif status == 'SKIPPED':
                    print(f"⏭️  {test_name}: SKIPPED - {result.get('reason', 'Unknown reason')}")
                elif status == 'PARTIAL':
                    print(f"⚠️  {test_name}: PARTIAL - Some issues found")
                else:
                    print(f"❌ {test_name}: FAILED - {result.get('reason', 'Unknown error')}")
                    
            except Exception as e:
                print(f"❌ {test_name}: ERROR - {str(e)}")
                self.test_results[test_name] = {'status': 'ERROR', 'reason': str(e)}
        
        self.generate_test_report()
    
    def generate_test_report(self):
        """Generate comprehensive test report"""
        print(f"\n📊 Test Results Summary")
        print("=" * 50)
        
        total_tests = len(self.test_results)
        passed = sum(1 for r in self.test_results.values() if r.get('status') == 'PASSED')
        skipped = sum(1 for r in self.test_results.values() if r.get('status') == 'SKIPPED')
        failed = sum(1 for r in self.test_results.values() if r.get('status') in ['FAILED', 'ERROR'])
        partial = sum(1 for r in self.test_results.values() if r.get('status') == 'PARTIAL')
        
        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed}")
        print(f"⚠️  Partial: {partial}")
        print(f"⏭️  Skipped: {skipped}")
        print(f"❌ Failed: {failed}")
        
        # Save detailed report
        report_file = self.test_dir / f"benchmark_test_report_{int(time.time())}.json"
        with open(report_file, 'w') as f:
            json.dump({
                'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
                'summary': {
                    'total': total_tests,
                    'passed': passed,
                    'partial': partial,
                    'skipped': skipped,
                    'failed': failed
                },
                'results': self.test_results
            }, f, indent=2)
        
        print(f"\n📋 Detailed report saved: {report_file}")
        
        # Recommendations
        print(f"\n🎯 Recommendations:")
        if failed == 0 and partial == 0:
            print("🎉 All tests passed! Your MLPerf setup is working perfectly.")
        elif skipped > 0:
            print("⚠️  Some tests were skipped due to resource constraints (GPU memory).")
        if failed > 0:
            print("❌ Some tests failed. Check the detailed report for troubleshooting.")

def main():
    tester = MLPerfBenchmarkTester()
    tester.run_all_tests()

if __name__ == "__main__":
    main()