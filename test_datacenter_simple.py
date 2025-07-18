#!/usr/bin/env python3
"""
Simplified MLPerf Datacenter Benchmark Test
Works with existing environment and dependencies
"""

import os
import sys
import time
import json
import logging
import threading
import queue
import socket
from datetime import datetime
from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class SimpleMlPerfDatacenter:
    def __init__(self):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = None
        self.tokenizer = None
        
        # Simplified config
        self.model_name = "meta-llama/Llama-3.1-8B-Instruct"
        self.max_tokens = int(os.environ.get('MAX_TOKENS', '32'))
        self.server_target_qps = float(os.environ.get('SERVER_TARGET_QPS', '0.5'))
        self.offline_target_qps = float(os.environ.get('OFFLINE_TARGET_QPS', '2.0'))
        self.min_duration_ms = 30000  # 30 seconds for testing
        self.min_queries = 20  # Reduced for testing
        
        # Results tracking
        self.query_results = []
        
    def setup_model(self):
        """Load model for benchmarking"""
        logger.info(f"🚀 Loading {self.model_name}...")
        start_time = time.time()
        
        # Load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(
            self.model_name,
            token=os.environ.get('HF_TOKEN'),
            cache_dir=os.environ.get('HF_HOME', './cache')
        )
        
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        
        # Load model
        self.model = AutoModelForCausalLM.from_pretrained(
            self.model_name,
            token=os.environ.get('HF_TOKEN'),
            torch_dtype=torch.float16,
            device_map="auto",
            cache_dir=os.environ.get('HF_HOME', './cache'),
            low_cpu_mem_usage=True
        )
        
        load_time = time.time() - start_time
        logger.info(f"✅ Model loaded in {load_time:.2f}s")
        
        # Quick warmup
        logger.info("🔥 Performing warmup...")
        for i in range(3):
            self._run_single_inference(f"warmup_{i}", "Hello, how are you?")
        logger.info("✅ Warmup completed")
        
    def _run_single_inference(self, query_id, prompt):
        """Run a single inference"""
        start_time = time.time()
        
        try:
            # Tokenize
            inputs = self.tokenizer(prompt, return_tensors="pt", padding=True, truncation=True, max_length=2048).to(self.device)
            input_tokens = inputs.input_ids.shape[1]
            
            # Time to first token
            ttft_start = time.time()
            
            with torch.no_grad():
                outputs = self.model.generate(
                    inputs.input_ids,
                    max_new_tokens=self.max_tokens,
                    do_sample=True,
                    temperature=0.7,
                    top_p=0.9,
                    pad_token_id=self.tokenizer.eos_token_id
                )
            
            ttft_end = time.time()
            generation_end = time.time()
            
            # Calculate metrics
            output_tokens = outputs.shape[1] - input_tokens
            total_latency = (generation_end - start_time) * 1000  # ms
            ttft = (ttft_end - ttft_start) * 1000  # ms
            tpot = (generation_end - ttft_end) * 1000 / max(output_tokens, 1)  # ms per token
            
            result = {
                'query_id': query_id,
                'timestamp': start_time,
                'input_tokens': input_tokens,
                'output_tokens': output_tokens,
                'total_latency_ms': total_latency,
                'ttft_ms': ttft,
                'tpot_ms': tpot,
                'success': True
            }
            
            return result
            
        except Exception as e:
            logger.error(f"Query {query_id} failed: {str(e)}")
            return {
                'query_id': query_id,
                'timestamp': start_time,
                'success': False,
                'error': str(e)
            }
    
    def run_server_scenario(self):
        """Run server scenario test"""
        logger.info("🏃‍♂️ Running MLPerf Server scenario test...")
        logger.info(f"Target QPS: {self.server_target_qps}, Duration: {self.min_duration_ms/1000}s")
        
        queries = [
            "Explain artificial intelligence in simple terms.",
            "What are the benefits of renewable energy?",
            "How does machine learning work?",
            "Describe the process of photosynthesis.",
            "What is quantum computing?"
        ]
        
        results = []
        start_time = time.time()
        query_count = 0
        
        while True:
            elapsed_ms = (time.time() - start_time) * 1000
            if elapsed_ms >= self.min_duration_ms and len(results) >= self.min_queries:
                break
            
            if elapsed_ms >= self.min_duration_ms * 2:  # Safety timeout
                break
                
            query_id = f"server_{query_count}"
            prompt = queries[query_count % len(queries)]
            
            result = self._run_single_inference(query_id, prompt)
            results.append(result)
            query_count += 1
            
            # QPS pacing
            if self.server_target_qps > 0:
                time.sleep(1.0 / self.server_target_qps)
        
        return self._analyze_results("Server", results)
    
    def run_offline_scenario(self):
        """Run offline scenario test"""
        logger.info("🏃‍♂️ Running MLPerf Offline scenario test...")
        logger.info(f"Target QPS: {self.offline_target_qps}, Duration: {self.min_duration_ms/1000}s")
        
        queries = [
            "Summarize the importance of data science.",
            "Explain cloud computing advantages.",
            "What is blockchain technology?",
            "Describe neural networks briefly.",
            "How do electric vehicles work?"
        ]
        
        results = []
        start_time = time.time()
        query_count = 0
        
        while True:
            elapsed_ms = (time.time() - start_time) * 1000
            if elapsed_ms >= self.min_duration_ms and len(results) >= self.min_queries:
                break
                
            if elapsed_ms >= self.min_duration_ms * 2:  # Safety timeout
                break
                
            query_id = f"offline_{query_count}"
            prompt = queries[query_count % len(queries)]
            
            result = self._run_single_inference(query_id, prompt)
            results.append(result)
            query_count += 1
            
            # Minimal delay for offline (maximize throughput)
            time.sleep(0.1)
        
        return self._analyze_results("Offline", results)
    
    def _analyze_results(self, scenario, results):
        """Analyze benchmark results"""
        successful_results = [r for r in results if r.get('success', False)]
        
        if not successful_results:
            return {
                'scenario': scenario,
                'valid': False,
                'error': 'No successful queries'
            }
        
        # Calculate metrics
        latencies = [r['total_latency_ms'] for r in successful_results]
        ttfts = [r['ttft_ms'] for r in successful_results]
        tpots = [r['tpot_ms'] for r in successful_results]
        
        first_timestamp = min(r['timestamp'] for r in results)
        last_timestamp = max(r['timestamp'] for r in results)
        duration_s = last_timestamp - first_timestamp
        
        # Simple percentile calculation (no numpy needed)
        def percentile(data, p):
            data_sorted = sorted(data)
            index = int(len(data_sorted) * p / 100)
            return data_sorted[min(index, len(data_sorted) - 1)]
        
        achieved_qps = len(successful_results) / max(duration_s, 1)
        total_tokens = sum(r['output_tokens'] for r in successful_results)
        throughput_tokens_per_sec = total_tokens / max(duration_s, 1)
        accuracy = len(successful_results) / len(results)
        
        # Validation
        latency_p99 = percentile(latencies, 99)
        valid = True
        if scenario == "Server" and latency_p99 > 1000:  # 1 second SLA
            valid = False
        if accuracy < 0.95:  # 95% for testing
            valid = False
        
        return {
            'scenario': scenario,
            'valid': valid,
            'achieved_qps': achieved_qps,
            'target_qps': self.server_target_qps if scenario == "Server" else self.offline_target_qps,
            'latency_p50': percentile(latencies, 50),
            'latency_p90': percentile(latencies, 90),
            'latency_p99': latency_p99,
            'ttft_p50': percentile(ttfts, 50),
            'ttft_p99': percentile(ttfts, 99),
            'tpot_p50': percentile(tpots, 50),
            'tpot_p99': percentile(tpots, 99),
            'accuracy': accuracy,
            'total_queries': len(results),
            'successful_queries': len(successful_results),
            'duration_s': duration_s,
            'throughput_tokens_per_sec': throughput_tokens_per_sec
        }
    
    def save_results(self, results, node_name):
        """Save results to file"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Create results directory
        results_dir = Path("results/datacenter_test")
        results_dir.mkdir(parents=True, exist_ok=True)
        
        # Save detailed results
        detailed_results = {
            "benchmark_info": {
                "benchmark": "MLPerf Datacenter Test",
                "model": self.model_name,
                "node": node_name,
                "timestamp": timestamp,
                "device": str(self.device)
            },
            "scenarios": results
        }
        
        results_file = results_dir / f"test_results_{node_name}_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump(detailed_results, f, indent=2)
        
        logger.info(f"💾 Results saved to {results_file}")
        return results_file
    
    def run_full_test(self):
        """Run complete test"""
        node_name = os.environ.get('NODE_NAME', socket.gethostname())
        
        logger.info("🚀 Starting MLPerf Datacenter Test")
        logger.info(f"Node: {node_name}")
        logger.info(f"Device: {self.device}")
        
        # Setup
        self.setup_model()
        
        results = {}
        
        # Run scenarios
        logger.info("\n" + "="*50)
        server_result = self.run_server_scenario()
        results["Server"] = server_result
        
        logger.info("\n" + "="*50)
        offline_result = self.run_offline_scenario()
        results["Offline"] = offline_result
        
        # Save results
        self.save_results(results, node_name)
        
        return results

def main():
    # Get node name
    node_name = os.environ.get('NODE_NAME', socket.gethostname())
    
    # Run test
    benchmark = SimpleMlPerfDatacenter()
    results = benchmark.run_full_test()
    
    # Print summary
    print("\n" + "="*60)
    print("🎯 MLPerf Datacenter Test Results")
    print("="*60)
    
    for scenario_name, result in results.items():
        if 'error' in result:
            print(f"\n❌ {scenario_name} Scenario: FAILED")
            print(f"   Error: {result['error']}")
            continue
            
        status = "✅ VALID" if result['valid'] else "❌ INVALID"
        print(f"\n📊 {scenario_name} Scenario: {status}")
        print(f"   QPS: {result['achieved_qps']:.2f} (target: {result['target_qps']:.2f})")
        print(f"   Latency P99: {result['latency_p99']:.2f}ms")
        print(f"   TTFT P99: {result['ttft_p99']:.2f}ms")
        print(f"   TPOT P99: {result['tpot_p99']:.2f}ms")
        print(f"   Accuracy: {result['accuracy']:.3f}")
        print(f"   Throughput: {result['throughput_tokens_per_sec']:.2f} tokens/sec")
        print(f"   Queries: {result['successful_queries']}/{result['total_queries']}")

if __name__ == "__main__":
    main()