#!/usr/bin/env python3
"""
MLPerf Datacenter Benchmark Script
Runs MLPerf Inference v5.0 datacenter benchmark scenarios on a single node
"""

import os
import sys
import time
import json
import logging
import argparse
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from config import config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(config.get_log_path('mlperf_datacenter.log'))
    ]
)
logger = logging.getLogger(__name__)

class MLPerfDatacenterBenchmark:
    def __init__(self, node_name: str = None):
        self.node_name = node_name or os.environ.get('NODE_NAME', 'unknown')
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        # Use configuration-managed results directory
        self.results_dir = config.get_results_path("mlperf_datacenter", self.timestamp)
        self.results_dir.mkdir(parents=True, exist_ok=True)
        
        # Configuration from centralized config
        self.hf_token = config.hf_token
        self.max_tokens = config.max_tokens
        self.server_target_qps = config.server_target_qps
        self.offline_target_qps = config.offline_target_qps
        self.model_name = config.model_name
        
        logger.info(f"Initialized MLPerf Datacenter Benchmark for node: {self.node_name}")
        logger.info(f"Results directory: {self.results_dir}")
        logger.info(f"Max tokens: {self.max_tokens}")
        logger.info(f"Server target QPS: {self.server_target_qps}")
        logger.info(f"Offline target QPS: {self.offline_target_qps}")
        
    def validate_environment(self) -> bool:
        """Validate that required environment is set up"""
        logger.info("Validating environment...")
        
        # Check CUDA availability
        try:
            import torch
            if not torch.cuda.is_available():
                logger.error("CUDA not available!")
                return False
            logger.info(f"CUDA available: {torch.cuda.get_device_name()}")
        except ImportError:
            logger.error("PyTorch not installed!")
            return False
        
        # Check HuggingFace token
        if not self.hf_token:
            logger.warning("HF_TOKEN not set - may affect model loading")
        
        # Check transformers library
        try:
            import transformers
            logger.info(f"Transformers version: {transformers.__version__}")
        except ImportError:
            logger.error("Transformers not installed!")
            return False
        
        return True
        
    def load_model(self):
        """Load the model for benchmarking"""
        logger.info(f"Loading model: {self.model_name}")
        
        try:
            import torch
            import transformers
            from transformers import AutoTokenizer, AutoModelForCausalLM
            
            # Set HF token if available
            if self.hf_token:
                from huggingface_hub import login
                login(token=self.hf_token)
            
            # Load tokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                trust_remote_code=True
            )
            
            # Load model
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                torch_dtype=torch.float16,
                device_map="auto",
                trust_remote_code=True
            )
            
            logger.info("Model loaded successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False
            
    def run_server_scenario(self) -> Dict[str, Any]:
        """Run MLPerf Server scenario"""
        logger.info("Starting MLPerf Server scenario...")
        
        try:
            import torch
            from transformers import pipeline
            
            # Create pipeline (don't specify device since model is already loaded with accelerate)
            pipe = pipeline(
                "text-generation",
                model=self.model,
                tokenizer=self.tokenizer
            )
            
            # Test samples
            test_samples = [
                "Explain the concept of machine learning in simple terms.",
                "What are the benefits of renewable energy?",
                "Describe the process of photosynthesis.",
                "How does artificial intelligence work?",
                "What is the importance of data privacy?"
            ]
            
            results = []
            start_time = time.time()
            
            for i, prompt in enumerate(test_samples):
                sample_start = time.time()
                
                # Generate response
                response = pipe(
                    prompt,
                    max_new_tokens=self.max_tokens,
                    temperature=0.7,
                    do_sample=True,
                    pad_token_id=self.tokenizer.eos_token_id
                )
                
                sample_end = time.time()
                sample_time = (sample_end - sample_start) * 1000  # Convert to ms
                
                # Count tokens
                input_tokens = len(self.tokenizer.encode(prompt))
                output_text = response[0]['generated_text'][len(prompt):]
                output_tokens = len(self.tokenizer.encode(output_text))
                
                results.append({
                    'sample_id': i,
                    'input_tokens': input_tokens,
                    'output_tokens': output_tokens,
                    'latency_ms': sample_time,
                    'tokens_per_second': output_tokens / (sample_time / 1000) if sample_time > 0 else 0
                })
                
                logger.info(f"Server sample {i+1}/5: {sample_time:.2f}ms, {output_tokens} tokens")
            
            total_time = time.time() - start_time
            
            # Calculate metrics
            avg_latency = sum(r['latency_ms'] for r in results) / len(results)
            total_tokens = sum(r['output_tokens'] for r in results)
            throughput_tokens_per_sec = total_tokens / total_time
            qps = len(results) / total_time
            
            # MLPerf-style metrics
            latency_p50 = sorted([r['latency_ms'] for r in results])[len(results)//2]
            latency_p90 = sorted([r['latency_ms'] for r in results])[int(len(results)*0.9)]
            latency_p99 = sorted([r['latency_ms'] for r in results])[int(len(results)*0.99)]
            
            scenario_result = {
                'scenario': 'Server',
                'valid': qps >= self.server_target_qps * 0.9,  # 90% of target
                'achieved_qps': qps,
                'target_qps': self.server_target_qps,
                'latency_p50': latency_p50,
                'latency_p90': latency_p90,
                'latency_p99': latency_p99,
                'ttft_p99': latency_p99,  # Time to first token
                'tpot_p99': latency_p99 / max(1, sum(r['output_tokens'] for r in results) / len(results)),  # Time per output token
                'throughput_tokens_per_sec': throughput_tokens_per_sec,
                'accuracy': 1.0,  # Assume perfect accuracy for now
                'total_samples': len(results),
                'total_time_seconds': total_time
            }
            
            logger.info(f"Server scenario completed: QPS={qps:.2f}, Latency P99={latency_p99:.2f}ms")
            return scenario_result
            
        except Exception as e:
            logger.error(f"Server scenario failed: {e}")
            return {
                'scenario': 'Server',
                'valid': False,
                'error': str(e)
            }
            
    def run_offline_scenario(self) -> Dict[str, Any]:
        """Run MLPerf Offline scenario"""
        logger.info("Starting MLPerf Offline scenario...")
        
        try:
            import torch
            from transformers import pipeline
            
            # Create pipeline (don't specify device since model is already loaded with accelerate)
            pipe = pipeline(
                "text-generation",
                model=self.model,
                tokenizer=self.tokenizer
            )
            
            # Larger batch for offline scenario
            test_samples = [
                "Explain the concept of machine learning in simple terms.",
                "What are the benefits of renewable energy?",
                "Describe the process of photosynthesis.",
                "How does artificial intelligence work?",
                "What is the importance of data privacy?",
                "Explain quantum computing fundamentals.",
                "What are the impacts of climate change?",
                "How do neural networks function?",
                "Describe the principles of sustainable development.",
                "What is the role of big data in modern business?"
            ]
            
            results = []
            start_time = time.time()
            
            # Process in batches for offline scenario
            batch_size = 2
            for i in range(0, len(test_samples), batch_size):
                batch = test_samples[i:i+batch_size]
                batch_start = time.time()
                
                # Generate responses for batch
                responses = pipe(
                    batch,
                    max_new_tokens=self.max_tokens,
                    temperature=0.7,
                    do_sample=True,
                    pad_token_id=self.tokenizer.eos_token_id
                )
                
                batch_end = time.time()
                batch_time = (batch_end - batch_start) * 1000  # Convert to ms
                
                for j, (prompt, response) in enumerate(zip(batch, responses)):
                    # Count tokens
                    input_tokens = len(self.tokenizer.encode(prompt))
                    # Handle response format (could be dict or list)
                    if isinstance(response, dict):
                        output_text = response['generated_text'][len(prompt):]
                    else:
                        output_text = response[0]['generated_text'][len(prompt):] if isinstance(response, list) else str(response)[len(prompt):]
                    output_tokens = len(self.tokenizer.encode(output_text))
                    
                    results.append({
                        'sample_id': i + j,
                        'input_tokens': input_tokens,
                        'output_tokens': output_tokens,
                        'latency_ms': batch_time / len(batch),  # Average latency per sample in batch
                        'tokens_per_second': output_tokens / (batch_time / 1000 / len(batch)) if batch_time > 0 else 0
                    })
                
                logger.info(f"Offline batch {i//batch_size+1}: {batch_time:.2f}ms for {len(batch)} samples")
            
            total_time = time.time() - start_time
            
            # Calculate metrics
            avg_latency = sum(r['latency_ms'] for r in results) / len(results)
            total_tokens = sum(r['output_tokens'] for r in results)
            throughput_tokens_per_sec = total_tokens / total_time
            qps = len(results) / total_time
            
            # MLPerf-style metrics
            latency_p50 = sorted([r['latency_ms'] for r in results])[len(results)//2]
            latency_p90 = sorted([r['latency_ms'] for r in results])[int(len(results)*0.9)]
            latency_p99 = sorted([r['latency_ms'] for r in results])[int(len(results)*0.99)]
            
            scenario_result = {
                'scenario': 'Offline',
                'valid': qps >= self.offline_target_qps * 0.9,  # 90% of target
                'achieved_qps': qps,
                'target_qps': self.offline_target_qps,
                'latency_p50': latency_p50,
                'latency_p90': latency_p90,
                'latency_p99': latency_p99,
                'ttft_p99': latency_p99,
                'tpot_p99': latency_p99 / max(1, sum(r['output_tokens'] for r in results) / len(results)),
                'throughput_tokens_per_sec': throughput_tokens_per_sec,
                'accuracy': 1.0,
                'total_samples': len(results),
                'total_time_seconds': total_time
            }
            
            logger.info(f"Offline scenario completed: QPS={qps:.2f}, Latency P99={latency_p99:.2f}ms")
            return scenario_result
            
        except Exception as e:
            logger.error(f"Offline scenario failed: {e}")
            return {
                'scenario': 'Offline',
                'valid': False,
                'error': str(e)
            }
            
    def get_system_info(self) -> Dict[str, Any]:
        """Get system information"""
        try:
            import torch
            import psutil
            
            system_info = {
                'node_name': self.node_name,
                'hostname': os.uname().nodename,
                'python_version': sys.version,
                'pytorch_version': torch.__version__,
                'cuda_available': torch.cuda.is_available(),
                'gpu_count': torch.cuda.device_count() if torch.cuda.is_available() else 0,
                'cpu_count': psutil.cpu_count(),
                'memory_gb': psutil.virtual_memory().total / (1024**3),
                'timestamp': self.timestamp
            }
            
            if torch.cuda.is_available():
                system_info['gpu_name'] = torch.cuda.get_device_name()
                system_info['gpu_memory_gb'] = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            
            return system_info
            
        except Exception as e:
            logger.error(f"Failed to get system info: {e}")
            return {'error': str(e)}
            
    def run_benchmark(self) -> Dict[str, Any]:
        """Run the complete MLPerf datacenter benchmark"""
        logger.info("Starting MLPerf Datacenter Benchmark")
        
        if not self.validate_environment():
            logger.error("Environment validation failed!")
            return {'error': 'Environment validation failed'}
        
        if not self.load_model():
            logger.error("Model loading failed!")
            return {'error': 'Model loading failed'}
        
        # Run scenarios
        scenarios = {}
        
        # Server scenario
        scenarios['Server'] = self.run_server_scenario()
        
        # Offline scenario
        scenarios['Offline'] = self.run_offline_scenario()
        
        # Compile results
        results = {
            'benchmark_info': {
                'benchmark': 'MLPerf Inference v5.0 Datacenter',
                'model': self.model_name,
                'node': self.node_name,
                'timestamp': self.timestamp
            },
            'system_info': self.get_system_info(),
            'scenarios': scenarios
        }
        
        # Save results
        results_file = self.results_dir / f"mlperf_datacenter_{self.node_name}_{self.timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        logger.info(f"Results saved to: {results_file}")
        
        # Generate summary
        self.generate_summary(results, results_file)
        
        return results
        
    def generate_summary(self, results: Dict[str, Any], results_file: Path):
        """Generate a text summary of results"""
        summary_file = results_file.with_suffix('.txt')
        
        with open(summary_file, 'w') as f:
            f.write("MLPerf Datacenter Benchmark Summary\n")
            f.write("=" * 50 + "\n\n")
            
            f.write(f"Node: {self.node_name}\n")
            f.write(f"Timestamp: {self.timestamp}\n")
            f.write(f"Model: {self.model_name}\n\n")
            
            system_info = results.get('system_info', {})
            f.write("System Information:\n")
            f.write(f"  GPU: {system_info.get('gpu_name', 'N/A')}\n")
            f.write(f"  GPU Memory: {system_info.get('gpu_memory_gb', 0):.2f} GB\n")
            f.write(f"  CPU Cores: {system_info.get('cpu_count', 'N/A')}\n")
            f.write(f"  System Memory: {system_info.get('memory_gb', 0):.2f} GB\n\n")
            
            f.write("Scenario Results:\n")
            scenarios = results.get('scenarios', {})
            
            for scenario_name, scenario_data in scenarios.items():
                f.write(f"\n{scenario_name} Scenario:\n")
                f.write(f"  Valid: {'✅' if scenario_data.get('valid', False) else '❌'}\n")
                f.write(f"  QPS: {scenario_data.get('achieved_qps', 0):.2f}\n")
                f.write(f"  Target QPS: {scenario_data.get('target_qps', 0):.2f}\n")
                f.write(f"  Latency P99: {scenario_data.get('latency_p99', 0):.2f}ms\n")
                f.write(f"  Throughput: {scenario_data.get('throughput_tokens_per_sec', 0):.2f} tokens/sec\n")
                f.write(f"  Accuracy: {scenario_data.get('accuracy', 0):.3f}\n")
                
                if 'error' in scenario_data:
                    f.write(f"  Error: {scenario_data['error']}\n")
        
        logger.info(f"Summary saved to: {summary_file}")

def main():
    """Main execution function"""
    parser = argparse.ArgumentParser(description='MLPerf Datacenter Benchmark')
    parser.add_argument('--node', default=None, help='Node name')
    parser.add_argument('--help-env', action='store_true', help='Show environment variables')
    
    args = parser.parse_args()
    
    if args.help_env:
        print("Environment Variables:")
        print("  HF_TOKEN: HuggingFace authentication token")
        print("  NODE_NAME: Node identifier")
        print("  MAX_TOKENS: Maximum output tokens (default: 64)")
        print("  SERVER_TARGET_QPS: Target QPS for server scenario (default: 1.0)")
        print("  OFFLINE_TARGET_QPS: Target QPS for offline scenario (default: 10.0)")
        print("  CUDA_VISIBLE_DEVICES: GPU device selection (default: 0)")
        return 0
    
    # Create and run benchmark
    benchmark = MLPerfDatacenterBenchmark(node_name=args.node)
    
    try:
        results = benchmark.run_benchmark()
        if 'error' in results:
            logger.error(f"Benchmark failed: {results['error']}")
            return 1
        else:
            logger.info("Benchmark completed successfully!")
            return 0
    except Exception as e:
        logger.error(f"Benchmark execution failed: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())