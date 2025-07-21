#!/usr/bin/env python3
"""
Configuration management for MLPerf benchmarks
Provides environment-agnostic configuration
"""

import os
from pathlib import Path

class MLPerfConfig:
    """Central configuration for MLPerf benchmarks"""
    
    def __init__(self):
        # Base project directory (where this config.py file is located)
        self.project_root = Path(__file__).parent.absolute()
        
        # User and deployment configuration
        self.username = os.environ.get('MLPERF_USERNAME', 'jungwooshim')
        self.remote_base_dir = os.environ.get('MLPERF_REMOTE_DIR', '~/MLPerf_local_test')
        
        # Node configuration
        self.nodes = {
            'jw1': os.environ.get('JW1_IP', '129.254.202.251'),
            'jw2': os.environ.get('JW2_IP', '129.254.202.252'), 
            'jw3': os.environ.get('JW3_IP', '129.254.202.253')
        }
        
        # Local directories (relative to project root)
        self.results_dir = self.project_root / "results"
        self.logs_dir = self.project_root / "logs"
        self.cache_dir = self.project_root / "cache"
        self.reports_dir = self.project_root / "reports"
        
        # Ensure directories exist
        for dir_path in [self.results_dir, self.logs_dir, self.cache_dir, self.reports_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)
        
        # Model configuration
        self.model_name = "meta-llama/Llama-3.1-8B-Instruct"
        self.hf_token = os.environ.get('HF_TOKEN', '')
        
        # Benchmark configuration
        self.max_tokens = int(os.environ.get('MAX_TOKENS', '64'))
        self.server_target_qps = float(os.environ.get('SERVER_TARGET_QPS', '1.0'))
        self.offline_target_qps = float(os.environ.get('OFFLINE_TARGET_QPS', '10.0'))
        
    def get_ssh_command(self, node_name: str, command: str) -> list:
        """Generate SSH command for remote execution"""
        node_ip = self.nodes.get(node_name)
        if not node_ip:
            raise ValueError(f"Unknown node: {node_name}")
        
        return [
            'ssh', '-o', 'StrictHostKeyChecking=no',
            f'{self.username}@{node_ip}',
            f'cd {self.remote_base_dir} && {command}'
        ]
    
    def get_results_path(self, benchmark_type: str, timestamp: str = None) -> Path:
        """Get standardized results path"""
        if timestamp is None:
            from datetime import datetime
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        return self.results_dir / f"{benchmark_type}_{timestamp}"
    
    def get_log_path(self, log_name: str) -> Path:
        """Get standardized log path"""
        return self.logs_dir / log_name

# Global configuration instance
config = MLPerfConfig()