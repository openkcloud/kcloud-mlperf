#!/usr/bin/env python3
"""
MLPerf Configuration Management
==============================

Centralized configuration for MLPerf benchmarking framework.
Supports environment variables and .env files for easy deployment.
"""

import os
import sys
from pathlib import Path
from typing import Dict, Optional
import logging

# Try to import python-dotenv
try:
    from dotenv import load_dotenv
    HAS_DOTENV = True
except ImportError:
    HAS_DOTENV = False
    print("Warning: python-dotenv not installed. Using environment variables only.")

class MLPerfConfig:
    """Configuration manager for MLPerf benchmarks"""
    
    def __init__(self, env_file: Optional[str] = None):
        """Initialize configuration from environment"""
        self.logger = logging.getLogger(__name__)
        
        # Load .env file if available
        if HAS_DOTENV:
            env_path = env_file or Path(__file__).parent.parent / ".env"
            if env_path.exists():
                load_dotenv(env_path)
                self.logger.info(f"Loaded configuration from {env_path}")
        
        # HuggingFace configuration
        self.hf_token = os.getenv('HF_TOKEN', '')
        if not self.hf_token:
            self.logger.warning("HF_TOKEN not set. Some features may be limited.")
        
        # User configuration
        self.username = os.getenv('MLPERF_USERNAME', os.getenv('USER', 'user'))
        self.remote_dir = os.getenv('MLPERF_REMOTE_DIR', '~/MLPerf_local_test')
        
        # Node configuration (can be overridden)
        self.nodes = {
            'jw1': os.getenv('JW1_IP', 'localhost'),
            'jw2': os.getenv('JW2_IP', 'localhost'),
            'jw3': os.getenv('JW3_IP', 'localhost')
        }
        
        # Build node addresses
        self.node_addresses = {}
        for node, ip in self.nodes.items():
            if ip != 'localhost':
                self.node_addresses[node] = f"{self.username}@{ip}"
            else:
                self.node_addresses[node] = 'localhost'
        
        # Benchmark configuration
        self.max_tokens = int(os.getenv('MAX_TOKENS', '64'))
        self.server_target_qps = float(os.getenv('SERVER_TARGET_QPS', '1.0'))
        self.offline_target_qps = float(os.getenv('OFFLINE_TARGET_QPS', '10.0'))
        
        # CUDA configuration
        self.cuda_devices = os.getenv('CUDA_VISIBLE_DEVICES', '0')
        
        # Paths
        self.project_root = Path(__file__).parent.parent
        self.results_dir = self.project_root / "results"
        self.reports_dir = self.project_root / "reports"
        self.cache_dir = self.project_root / "cache"
        self.dataset_dir = self.project_root / "dataset"
        
        # MLPerf paths
        self.mlperf_dir = self.project_root / "official_mlperf"
        self.mlperf_inference_dir = self.mlperf_dir  # MLPerf main.py is directly in official_mlperf
        
        # Model configuration
        self.model_name = os.getenv('MODEL_NAME', 'meta-llama/Llama-3.1-8B-Instruct')
        self.batch_size = int(os.getenv('BATCH_SIZE', '1'))
        self.dtype = os.getenv('DTYPE', 'float16')
        self.tensor_parallel_size = int(os.getenv('TENSOR_PARALLEL_SIZE', '1'))
        
        # Create directories if they don't exist
        for dir_path in [self.results_dir, self.reports_dir, self.cache_dir, self.dataset_dir]:
            dir_path.mkdir(exist_ok=True, parents=True)
    
    def get_node_address(self, node_name: str) -> Optional[str]:
        """Get the SSH address for a node"""
        return self.node_addresses.get(node_name)
    
    def is_local_run(self) -> bool:
        """Check if running locally (no remote nodes configured)"""
        return all(ip == 'localhost' for ip in self.nodes.values())
    
    def get_mlperf_command(self, samples: int, accuracy: bool = False, 
                          output_dir: str = "results") -> list:
        """Build MLPerf benchmark command"""
        cmd = [
            "python3", "main.py",
            "--scenario", "Server",
            "--model-path", self.model_name,
            "--batch-size", str(self.batch_size),
            "--dtype", self.dtype,
            "--total-sample-count", str(samples),
            "--dataset-path", "cnn_eval.json",
            "--output-log-dir", output_dir,
            "--tensor-parallel-size", str(self.tensor_parallel_size),
            "--vllm",
            "--user-conf", "user.conf"
        ]
        
        if accuracy:
            cmd.append("--accuracy")
        
        return cmd
    
    def get_env_vars(self) -> Dict[str, str]:
        """Get environment variables for MLPerf execution"""
        env = os.environ.copy()
        
        # Add HF token if available
        if self.hf_token:
            env['HF_TOKEN'] = self.hf_token
            env['HUGGING_FACE_HUB_TOKEN'] = self.hf_token
        
        # CUDA configuration
        env['CUDA_VISIBLE_DEVICES'] = self.cuda_devices
        
        # Add CUDA paths if available
        cuda_paths = [
            "/usr/local/cuda/bin",
            "/usr/local/cuda-12.9/bin",
            "/usr/local/cuda-12/bin",
            "/usr/local/cuda-11/bin"
        ]
        
        for cuda_path in cuda_paths:
            if Path(cuda_path).exists():
                env['PATH'] = f"{cuda_path}:{env.get('PATH', '')}"
                cuda_lib = Path(cuda_path).parent / "targets/x86_64-linux/lib"
                if cuda_lib.exists():
                    env['LD_LIBRARY_PATH'] = f"{cuda_lib}:{env.get('LD_LIBRARY_PATH', '')}"
                break
        
        return env
    
    def to_dict(self) -> dict:
        """Export configuration as dictionary"""
        return {
            'username': self.username,
            'nodes': self.nodes,
            'model': self.model_name,
            'max_tokens': self.max_tokens,
            'server_target_qps': self.server_target_qps,
            'offline_target_qps': self.offline_target_qps,
            'batch_size': self.batch_size,
            'dtype': self.dtype,
            'tensor_parallel_size': self.tensor_parallel_size,
            'is_local': self.is_local_run()
        }
    
    def print_config(self):
        """Print current configuration"""
        print("\n=== MLPerf Configuration ===")
        print(f"Username: {self.username}")
        print(f"Model: {self.model_name}")
        print(f"Local Run: {self.is_local_run()}")
        
        if not self.is_local_run():
            print("\nNodes:")
            for node, ip in self.nodes.items():
                print(f"  {node}: {ip}")
        
        print(f"\nBenchmark Settings:")
        print(f"  Max Tokens: {self.max_tokens}")
        print(f"  Batch Size: {self.batch_size}")
        print(f"  Data Type: {self.dtype}")
        print(f"  Tensor Parallel: {self.tensor_parallel_size}")
        print(f"  Server Target QPS: {self.server_target_qps}")
        print("===========================\n")

# Global configuration instance
config = MLPerfConfig()

if __name__ == "__main__":
    # Test configuration
    config.print_config()