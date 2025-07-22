#!/usr/bin/env python3
"""
MLPerf Configuration Manager
===========================
Manages infrastructure configuration for MLPerf benchmarks across different environments.
"""

import yaml
import os
import sys
from pathlib import Path
from typing import Dict, List, Any

class MLPerfConfigManager:
    """Manages MLPerf benchmark configuration for different infrastructures"""
    
    def __init__(self, config_file: str = "config.yaml"):
        self.config_file = Path(config_file)
        self.config = self.load_config()
    
    def load_config(self) -> Dict[str, Any]:
        """Load configuration from YAML file"""
        if not self.config_file.exists():
            print(f"❌ Configuration file {self.config_file} not found!")
            print(f"📝 Please create {self.config_file} based on config.yaml.example")
            sys.exit(1)
        
        try:
            with open(self.config_file, 'r') as f:
                config = yaml.safe_load(f)
            return config
        except yaml.YAMLError as e:
            print(f"❌ Error parsing configuration file: {e}")
            sys.exit(1)
    
    def validate_config(self) -> bool:
        """Validate configuration completeness"""
        required_sections = ['infrastructure', 'benchmark', 'directories']
        
        for section in required_sections:
            if section not in self.config:
                print(f"❌ Missing required section: {section}")
                return False
        
        # Validate GPU nodes
        if 'gpu_nodes' not in self.config['infrastructure']:
            print(f"❌ No GPU nodes configured")
            return False
        
        gpu_nodes = self.config['infrastructure']['gpu_nodes']
        if not gpu_nodes or len(gpu_nodes) == 0:
            print(f"❌ At least one GPU node must be configured")
            return False
        
        # Validate each GPU node
        required_node_fields = ['name', 'ip', 'ssh_user']
        for i, node in enumerate(gpu_nodes):
            for field in required_node_fields:
                if field not in node:
                    print(f"❌ GPU node {i+1} missing required field: {field}")
                    return False
        
        return True
    
    def get_gpu_nodes(self) -> List[Dict[str, str]]:
        """Get list of configured GPU nodes"""
        return self.config['infrastructure']['gpu_nodes']
    
    def get_deployment_type(self) -> str:
        """Get deployment type"""
        return self.config['infrastructure'].get('deployment_type', 'ssh')
    
    def get_benchmark_config(self) -> Dict[str, Any]:
        """Get benchmark configuration"""
        return self.config['benchmark']
    
    def get_directories(self) -> Dict[str, str]:
        """Get directory configuration"""
        return self.config['directories']
    
    def get_monitoring_config(self) -> Dict[str, Any]:
        """Get monitoring configuration"""
        return self.config.get('monitoring', {})
    
    def generate_monitoring_script(self) -> str:
        """Generate monitoring script based on configuration"""
        gpu_nodes = self.get_gpu_nodes()
        deployment_type = self.get_deployment_type()
        directories = self.get_directories()
        
        script_content = f"""#!/bin/bash
#
# Auto-generated MLPerf Benchmark Monitor
# Generated from configuration: {self.config_file}
# Deployment type: {deployment_type}
#

"""
        
        # Add node configurations
        for i, node in enumerate(gpu_nodes):
            script_content += f'{node["name"].upper()}_IP="{node["ip"]}"\n'
            script_content += f'{node["name"].upper()}_USER="{node["ssh_user"]}"\n'
        
        script_content += f'RESULTS_DIR="{directories["local_results_dir"]}"\n'
        script_content += f'REMOTE_DIR="{directories["remote_mlperf_dir"]}"\n\n'
        
        # Add monitoring functions
        script_content += """
echo "🚀 MLPerf Benchmark Monitor (Auto-configured)"
echo "=============================================="
echo "Monitoring MLPerf benchmarks across configured infrastructure"
echo ""

mkdir -p "$RESULTS_DIR"

function check_progress() {
    echo "📊 $(date): Checking benchmark progress..."
"""
        
        # Generate progress check for each node
        for i, node in enumerate(gpu_nodes):
            node_var = node["name"].upper()
            script_content += f"""    
    # Check {node["name"]} ({node["ip"]})
    echo "🔍 {node["name"]} ({node["ip"]}):"
    if ssh ${node_var}_USER@${{{node_var}_IP}} "ps aux | grep -q 'python3.*main.py'"; then
        LAST_REQUEST=$(ssh ${node_var}_USER@${{{node_var}_IP}} "cd $REMOTE_DIR && tail -5 {node["name"]}_benchmark.log 2>/dev/null | grep 'Added request' | tail -1 | sed 's/.*request //' | sed 's/\.//' || echo '0'")
        echo "  ✅ RUNNING - Processing request: $LAST_REQUEST/13,368"
        ssh ${node_var}_USER@${{{node_var}_IP}} "cd $REMOTE_DIR && tail -3 {node["name"]}_benchmark.log 2>/dev/null | grep 'throughput' | tail -1" || echo "  📊 Performance data loading..."
    else
        echo "  🏁 COMPLETED or STOPPED"
        # Copy results if completed
        if ssh ${node_var}_USER@${{{node_var}_IP}} "[ -f $REMOTE_DIR/{node["name"]}_results/mlperf_log_summary.txt ]"; then
            echo "  📁 Copying results..."
            mkdir -p "$RESULTS_DIR/{node["name"]}_official"
            scp -r ${node_var}_USER@${{{node_var}_IP}}:$REMOTE_DIR/{node["name"]}_results/* "$RESULTS_DIR/{node["name"]}_official/" 2>/dev/null
            scp ${node_var}_USER@${{{node_var}_IP}}:$REMOTE_DIR/{node["name"]}_benchmark.log "$RESULTS_DIR/{node["name"]}_official/" 2>/dev/null
            echo "  📊 Auto-generating visual reports for {node["name"]}..."
            python3 generate_visual_reports.py "$RESULTS_DIR/{node["name"]}_official" > /dev/null 2>&1
        fi
    fi
    echo ""
"""
        
        script_content += """
}

function main() {
    case "${1:-status}" in
        "status")
            check_progress
            ;;
        "watch")
            while true; do
                clear
                check_progress
                echo "🔄 Auto-refreshing every 60 seconds... (Ctrl+C to stop)"
                sleep 60
            done
            ;;
        "results")
            echo "📊 Collecting final results..."
            check_progress
            
            # Check if all benchmarks completed
            completed_count=0
"""
        
        # Add completion check for each node
        for node in gpu_nodes:
            script_content += f"""            if [ -d "$RESULTS_DIR/{node["name"]}_official" ]; then
                completed_count=$((completed_count + 1))
            fi
"""
        
        script_content += f"""            
            if [ "$completed_count" -eq {len(gpu_nodes)} ]; then
                echo "🎉 All benchmarks completed! Generating comprehensive report..."
                echo "📊 Generating comprehensive visual reports..."
                python3 generate_visual_reports.py "$RESULTS_DIR" > /dev/null 2>&1
                echo "✅ Visual reports generated and saved to results/visual_reports_*/"
            else
                echo "⏳ $completed_count/{len(gpu_nodes)} benchmarks completed"
            fi
            ;;
        *)
            echo "Usage: $0 [status|watch|results]"
            echo ""
            echo "Commands:"
            echo "  status   - Check current benchmark progress (default)"
            echo "  watch    - Monitor benchmarks with auto-refresh"  
            echo "  results  - Collect final results and generate report"
            ;;
    esac
}}

main "$@"
"""
        
        return script_content
    
    def generate_benchmark_script(self) -> str:
        """Generate benchmark execution script based on configuration"""
        gpu_nodes = self.get_gpu_nodes()
        benchmark_config = self.get_benchmark_config()
        directories = self.get_directories()
        
        script_content = f"""#!/bin/bash
#
# Auto-generated MLPerf Benchmark Runner
# Generated from configuration: {self.config_file}
#

echo "🚀 Starting MLPerf Benchmarks on Configured Infrastructure"
echo "=========================================================="
echo "Model: {benchmark_config['model']}"
echo "Scenario: {benchmark_config['scenario']}"
echo "Dataset: {benchmark_config['dataset']['name']} ({benchmark_config['dataset']['total_samples']} samples)"
echo "GPU Nodes: {len(gpu_nodes)}"
echo ""

"""
        
        # Generate execution commands for each node
        for i, node in enumerate(gpu_nodes):
            script_content += f"""
echo "🎯 Starting benchmark on {node['name']} ({node['ip']})..."
ssh {node['ssh_user']}@{node['ip']} "cd {directories['remote_mlperf_dir']} && \\
    nohup python3 main.py \\
        --scenario {benchmark_config['scenario']} \\
        --model-path {benchmark_config['model']} \\
        --total-sample-count {benchmark_config['dataset']['total_samples']} \\
        --dataset-path {benchmark_config['dataset']['file_path']} \\
        --vllm > {node['name']}_benchmark.log 2>&1 &"

echo "✅ Benchmark started on {node['name']}"
"""
        
        script_content += f"""
echo ""
echo "🎯 All benchmarks started successfully!"
echo "📊 Monitor progress with: ./monitor_benchmarks.sh watch"
echo "📋 Check status with: ./monitor_benchmarks.sh status"
echo "📈 Collect results with: ./monitor_benchmarks.sh results"
echo ""
echo "⏰ Started at: $(date)"
"""
        
        return script_content
    
    def create_example_config(self):
        """Create example configuration file"""
        example_config = {
            'infrastructure': {
                'deployment_type': 'ssh',
                'gpu_nodes': [
                    {
                        'name': 'gpu-node-1',
                        'ip': '192.168.1.100',
                        'ssh_user': 'your-username',
                        'gpu_type': 'NVIDIA A30',
                        'gpu_memory': '24GB'
                    },
                    {
                        'name': 'gpu-node-2', 
                        'ip': '192.168.1.101',
                        'ssh_user': 'your-username',
                        'gpu_type': 'NVIDIA A30',
                        'gpu_memory': '24GB'
                    }
                ]
            },
            'benchmark': {
                'model': 'meta-llama/Llama-3.1-8B-Instruct',
                'scenario': 'Server',
                'dataset': {
                    'name': 'CNN DailyMail',
                    'total_samples': 13368,
                    'file_path': 'cnn_eval.json'
                }
            },
            'directories': {
                'remote_mlperf_dir': '~/official_mlperf/inference/language/llama3.1-8b',
                'local_results_dir': './results',
                'visual_reports_dir': './results/visual_reports'
            },
            'monitoring': {
                'check_interval': 60,
                'auto_generate_reports': True,
                'save_logs': True
            }
        }
        
        with open('config.yaml.example', 'w') as f:
            yaml.dump(example_config, f, default_flow_style=False, sort_keys=False)
        
        print(f"✅ Example configuration created: config.yaml.example")
        print(f"📝 Copy this to config.yaml and modify for your infrastructure")

def main():
    """Main configuration management interface"""
    import argparse
    
    parser = argparse.ArgumentParser(description='MLPerf Configuration Manager')
    parser.add_argument('--config', default='config.yaml', help='Configuration file path')
    parser.add_argument('--validate', action='store_true', help='Validate configuration')
    parser.add_argument('--generate-scripts', action='store_true', help='Generate monitoring and benchmark scripts')
    parser.add_argument('--create-example', action='store_true', help='Create example configuration')
    
    args = parser.parse_args()
    
    if args.create_example:
        manager = MLPerfConfigManager.__new__(MLPerfConfigManager)
        manager.create_example_config()
        return
    
    manager = MLPerfConfigManager(args.config)
    
    if args.validate:
        if manager.validate_config():
            print("✅ Configuration is valid!")
            
            # Print summary
            gpu_nodes = manager.get_gpu_nodes()
            print(f"\n📋 Configuration Summary:")
            print(f"   Deployment Type: {manager.get_deployment_type()}")
            print(f"   GPU Nodes: {len(gpu_nodes)}")
            for node in gpu_nodes:
                print(f"     - {node['name']}: {node['ip']} ({node.get('gpu_type', 'Unknown GPU')})")
        else:
            print("❌ Configuration validation failed!")
            sys.exit(1)
    
    if args.generate_scripts:
        if not manager.validate_config():
            print("❌ Cannot generate scripts - configuration is invalid")
            sys.exit(1)
        
        # Generate monitoring script
        monitor_script = manager.generate_monitoring_script()
        with open('monitor_benchmarks.sh', 'w') as f:
            f.write(monitor_script)
        os.chmod('monitor_benchmarks.sh', 0o755)
        print("✅ Generated: monitor_benchmarks.sh")
        
        # Generate benchmark script  
        benchmark_script = manager.generate_benchmark_script()
        with open('run_benchmarks.sh', 'w') as f:
            f.write(benchmark_script)
        os.chmod('run_benchmarks.sh', 0o755)
        print("✅ Generated: run_benchmarks.sh")
        
        print(f"\n🎯 Next Steps:")
        print(f"   1. Start benchmarks: ./run_benchmarks.sh")
        print(f"   2. Monitor progress: ./monitor_benchmarks.sh watch")
        print(f"   3. Collect results: ./monitor_benchmarks.sh results")

if __name__ == "__main__":
    main()