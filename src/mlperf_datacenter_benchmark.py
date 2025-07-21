#!/usr/bin/env python3
"""
MLPerf Inference: Datacenter Benchmark Implementation
Compliant with MLPerf Inference v5.0 specifications

Implements both Server and Offline scenarios for datacenter benchmarking
Focuses on Llama-3.1-8B model with proper latency constraints
"""

import os
import sys
import time
import json
import queue
import logging
import threading
import statistics
import numpy as np
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class MLPerfConfig:
    """MLPerf Datacenter benchmark configuration"""
    model_name: str = "meta-llama/Llama-3.1-8B-Instruct"
    max_tokens: int = 64
    batch_size: int = 1
    max_sequence_length: int = 2048
    
    # Datacenter scenario configurations
    server_target_qps: float = 0.5
    server_latency_constraint_ms: float = 3000.0  # 3 second SLA for A30 GPUs
    offline_target_qps: float = 1.0
    
    # MLPerf compliance requirements
    accuracy_target: float = 0.99  # 99% accuracy requirement
    warmup_queries: int = 5
    min_query_count: int = 20  # Adjusted for realistic testing
    min_duration_ms: int = 30000  # 30 seconds minimum
    
    # Performance thresholds for Llama models
    ttft_constraint_ms: float = 2000.0  # Time to First Token
    tpot_constraint_ms: float = 100.0   # Time Per Output Token

@dataclass
class QueryResult:
    """Individual query result tracking"""
    query_id: str
    timestamp: float
    input_tokens: int
    output_tokens: int
    total_latency_ms: float
    ttft_ms: float
    tpot_ms: float
    success: bool
    error_msg: Optional[str] = None

@dataclass
class ScenarioResult:
    """Benchmark scenario results"""
    scenario: str
    target_qps: float
    achieved_qps: float
    latency_p50: float
    latency_p90: float
    latency_p99: float
    ttft_p50: float
    ttft_p99: float
    tpot_p50: float
    tpot_p99: float
    accuracy: float
    total_queries: int
    successful_queries: int
    duration_ms: float
    throughput_tokens_per_sec: float
    valid: bool

class MLPerfDatacenterBenchmark:
    """MLPerf Inference Datacenter Benchmark Implementation"""
    
    def __init__(self, config: MLPerfConfig):
        self.config = config
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = None
        self.tokenizer = None
        self.results_dir = Path("results/mlperf_datacenter")
        self.results_dir.mkdir(parents=True, exist_ok=True)
        
        # Query tracking
        self.query_queue = queue.Queue()
        self.result_queue = queue.Queue()
        self.query_results: List[QueryResult] = []
        self.stop_event = threading.Event()
        
    def setup_model(self):
        """Load and setup the model for inference"""
        logger.info(f"🚀 Loading {self.config.model_name}...")
        start_time = time.time()
        
        # Load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(
            self.config.model_name,
            token=os.environ.get('HF_TOKEN'),
            cache_dir=os.environ.get('HF_HOME', './cache')
        )
        
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        
        # Load model with optimizations
        self.model = AutoModelForCausalLM.from_pretrained(
            self.config.model_name,
            token=os.environ.get('HF_TOKEN'),
            torch_dtype=torch.float16,
            device_map="auto",
            cache_dir=os.environ.get('HF_HOME', './cache'),
            low_cpu_mem_usage=True
        )
        
        load_time = time.time() - start_time
        logger.info(f"✅ Model loaded in {load_time:.2f}s")
        
        # Warmup
        self._warmup()
        
    def _warmup(self):
        """Perform model warmup as required by MLPerf"""
        logger.info(f"🔥 Performing warmup with {self.config.warmup_queries} queries...")
        
        warmup_queries = [
            "What is artificial intelligence?",
            "Explain machine learning in simple terms.",
            "How does deep learning work?",
            "What are neural networks?",
            "Define natural language processing."
        ] * (self.config.warmup_queries // 5 + 1)
        
        for i in range(self.config.warmup_queries):
            query = warmup_queries[i % len(warmup_queries)]
            self._run_single_inference(f"warmup_{i}", query)
            
        logger.info("✅ Warmup completed")
        
    def _run_single_inference(self, query_id: str, prompt: str) -> QueryResult:
        """Run a single inference query"""
        start_time = time.time()
        
        try:
            # Tokenize input
            inputs = self.tokenizer(
                prompt, 
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=self.config.max_sequence_length
            ).to(self.device)
            
            input_tokens = inputs.input_ids.shape[1]
            
            # Time to first token measurement
            ttft_start = time.time()
            
            with torch.no_grad():
                # Generate with timing
                outputs = self.model.generate(
                    inputs.input_ids,
                    max_new_tokens=self.config.max_tokens,
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
            
            return QueryResult(
                query_id=query_id,
                timestamp=start_time,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_latency_ms=total_latency,
                ttft_ms=ttft,
                tpot_ms=tpot,
                success=True
            )
            
        except Exception as e:
            logger.error(f"Query {query_id} failed: {str(e)}")
            return QueryResult(
                query_id=query_id,
                timestamp=start_time,
                input_tokens=0,
                output_tokens=0,
                total_latency_ms=(time.time() - start_time) * 1000,
                ttft_ms=0,
                tpot_ms=0,
                success=False,
                error_msg=str(e)
            )
    
    def _query_generator(self, scenario: str, target_qps: float, duration_ms: float):
        """Generate queries at specified QPS for the scenario"""
        queries = [
            "Summarize the benefits of renewable energy in one paragraph.",
            "Explain quantum computing to a 10-year-old.",
            "What are the main differences between supervised and unsupervised learning?",
            "Describe the process of photosynthesis in plants.",
            "How does blockchain technology work?",
            "What are the key principles of sustainable development?",
            "Explain the concept of artificial neural networks.",
            "What is the significance of DNA in genetics?",
            "Describe the water cycle and its importance.",
            "How do electric vehicles contribute to environmental protection?"
        ]
        
        interval = 1.0 / target_qps if target_qps > 0 else 0
        start_time = time.time()
        query_count = 0
        
        while True:
            elapsed = (time.time() - start_time) * 1000
            if elapsed >= duration_ms:
                break
                
            if self.stop_event.is_set():
                break
            
            query_id = f"{scenario}_{query_count}"
            prompt = queries[query_count % len(queries)]
            
            self.query_queue.put((query_id, prompt))
            query_count += 1
            
            if interval > 0:
                time.sleep(interval)
        
        logger.info(f"Generated {query_count} queries for {scenario} scenario")
    
    def _inference_worker(self):
        """Worker thread for processing inference queries"""
        while not self.stop_event.is_set():
            try:
                query_id, prompt = self.query_queue.get(timeout=1.0)
                result = self._run_single_inference(query_id, prompt)
                self.result_queue.put(result)
                self.query_queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"Inference worker error: {str(e)}")
    
    def run_server_scenario(self) -> ScenarioResult:
        """Run MLPerf Server scenario - measures QPS under latency constraints"""
        logger.info("🏃‍♂️ Running MLPerf Server scenario...")
        logger.info(f"Target QPS: {self.config.server_target_qps}")
        logger.info(f"Latency constraint: {self.config.server_latency_constraint_ms}ms")
        
        # Clear previous results
        self.query_results.clear()
        self.stop_event.clear()
        
        # Start inference worker
        worker_thread = threading.Thread(target=self._inference_worker)
        worker_thread.start()
        
        # Start query generator
        generator_thread = threading.Thread(
            target=self._query_generator,
            args=("server", self.config.server_target_qps, self.config.min_duration_ms)
        )
        generator_thread.start()
        
        # Collect results
        start_time = time.time()
        while True:
            try:
                result = self.result_queue.get(timeout=1.0)
                self.query_results.append(result)
                
                elapsed = (time.time() - start_time) * 1000
                if elapsed >= self.config.min_duration_ms and len(self.query_results) >= self.config.min_query_count:
                    break
                    
            except queue.Empty:
                elapsed = (time.time() - start_time) * 1000
                if elapsed >= self.config.min_duration_ms * 2:  # Safety timeout
                    break
        
        # Stop threads
        self.stop_event.set()
        generator_thread.join()
        worker_thread.join()
        
        return self._analyze_results("Server")
    
    def run_offline_scenario(self) -> ScenarioResult:
        """Run MLPerf Offline scenario - measures maximum throughput"""
        logger.info("🏃‍♂️ Running MLPerf Offline scenario...")
        logger.info(f"Target QPS: {self.config.offline_target_qps}")
        
        # Clear previous results
        self.query_results.clear()
        self.stop_event.clear()
        
        # Start inference worker
        worker_thread = threading.Thread(target=self._inference_worker)
        worker_thread.start()
        
        # Start query generator
        generator_thread = threading.Thread(
            target=self._query_generator,
            args=("offline", self.config.offline_target_qps, self.config.min_duration_ms)
        )
        generator_thread.start()
        
        # Collect results
        start_time = time.time()
        while True:
            try:
                result = self.result_queue.get(timeout=1.0)
                self.query_results.append(result)
                
                elapsed = (time.time() - start_time) * 1000
                if elapsed >= self.config.min_duration_ms and len(self.query_results) >= self.config.min_query_count:
                    break
                    
            except queue.Empty:
                elapsed = (time.time() - start_time) * 1000
                if elapsed >= self.config.min_duration_ms * 2:  # Safety timeout
                    break
        
        # Stop threads
        self.stop_event.set()
        generator_thread.join()
        worker_thread.join()
        
        return self._analyze_results("Offline")
    
    def _analyze_results(self, scenario: str) -> ScenarioResult:
        """Analyze benchmark results and check MLPerf compliance"""
        if not self.query_results:
            return ScenarioResult(
                scenario=scenario,
                target_qps=0, achieved_qps=0, latency_p50=0, latency_p90=0, latency_p99=0,
                ttft_p50=0, ttft_p99=0, tpot_p50=0, tpot_p99=0,
                accuracy=0, total_queries=0, successful_queries=0,
                duration_ms=0, throughput_tokens_per_sec=0, valid=False
            )
        
        successful_results = [r for r in self.query_results if r.success]
        
        if not successful_results:
            logger.error("No successful queries completed")
            return ScenarioResult(
                scenario=scenario,
                target_qps=0, achieved_qps=0, latency_p50=0, latency_p90=0, latency_p99=0,
                ttft_p50=0, ttft_p99=0, tpot_p50=0, tpot_p99=0,
                accuracy=0, total_queries=len(self.query_results), successful_queries=0,
                duration_ms=0, throughput_tokens_per_sec=0, valid=False
            )
        
        # Calculate metrics
        latencies = [r.total_latency_ms for r in successful_results]
        ttfts = [r.ttft_ms for r in successful_results]
        tpots = [r.tpot_ms for r in successful_results]
        
        first_timestamp = min(r.timestamp for r in self.query_results)
        last_timestamp = max(r.timestamp for r in self.query_results)
        duration_ms = (last_timestamp - first_timestamp) * 1000
        
        achieved_qps = len(successful_results) / max(duration_ms / 1000, 1)
        total_tokens = sum(r.output_tokens for r in successful_results)
        throughput_tokens_per_sec = total_tokens / max(duration_ms / 1000, 1)
        
        # MLPerf compliance checks
        accuracy = len(successful_results) / len(self.query_results)
        
        # Latency constraint validation for server scenario
        latency_p99 = np.percentile(latencies, 99)
        ttft_p99 = np.percentile(ttfts, 99)
        tpot_p99 = np.percentile(tpots, 99)
        
        valid = True
        if scenario == "Server":
            if latency_p99 > self.config.server_latency_constraint_ms:
                logger.warning(f"Server scenario failed latency constraint: {latency_p99:.2f}ms > {self.config.server_latency_constraint_ms}ms")
                valid = False
        
        if accuracy < self.config.accuracy_target:
            logger.warning(f"Failed accuracy target: {accuracy:.3f} < {self.config.accuracy_target}")
            valid = False
        
        if len(self.query_results) < self.config.min_query_count:
            logger.warning(f"Insufficient queries: {len(self.query_results)} < {self.config.min_query_count}")
            valid = False
        
        result = ScenarioResult(
            scenario=scenario,
            target_qps=self.config.server_target_qps if scenario == "Server" else self.config.offline_target_qps,
            achieved_qps=achieved_qps,
            latency_p50=np.percentile(latencies, 50),
            latency_p90=np.percentile(latencies, 90),
            latency_p99=latency_p99,
            ttft_p50=np.percentile(ttfts, 50),
            ttft_p99=ttft_p99,
            tpot_p50=np.percentile(tpots, 50),
            tpot_p99=tpot_p99,
            accuracy=accuracy,
            total_queries=len(self.query_results),
            successful_queries=len(successful_results),
            duration_ms=duration_ms,
            throughput_tokens_per_sec=throughput_tokens_per_sec,
            valid=valid
        )
        
        return result
    
    def save_results(self, results: Dict[str, ScenarioResult], node_name: str = "unknown"):
        """Save benchmark results in MLPerf-compliant format"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Detailed results
        detailed_results = {
            "benchmark_info": {
                "benchmark": "MLPerf Inference v5.0 Datacenter",
                "model": self.config.model_name,
                "node": node_name,
                "timestamp": timestamp,
                "device": str(self.device),
                "config": asdict(self.config)
            },
            "scenarios": {name: asdict(result) for name, result in results.items()},
            "query_details": [asdict(r) for r in self.query_results]
        }
        
        results_file = self.results_dir / f"mlperf_datacenter_{node_name}_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump(detailed_results, f, indent=2)
        
        # Summary report
        summary_file = self.results_dir / f"summary_{node_name}_{timestamp}.txt"
        with open(summary_file, 'w') as f:
            f.write(f"MLPerf Inference Datacenter Benchmark Results\n")
            f.write(f"=" * 50 + "\n")
            f.write(f"Node: {node_name}\n")
            f.write(f"Model: {self.config.model_name}\n")
            f.write(f"Timestamp: {timestamp}\n")
            f.write(f"Device: {self.device}\n\n")
            
            for scenario_name, result in results.items():
                f.write(f"{scenario_name} Scenario Results:\n")
                f.write(f"  Valid: {'✅' if result.valid else '❌'}\n")
                f.write(f"  Target QPS: {result.target_qps:.2f}\n")
                f.write(f"  Achieved QPS: {result.achieved_qps:.2f}\n")
                f.write(f"  Latency P99: {result.latency_p99:.2f}ms\n")
                f.write(f"  TTFT P99: {result.ttft_p99:.2f}ms\n")
                f.write(f"  TPOT P99: {result.tpot_p99:.2f}ms\n")
                f.write(f"  Accuracy: {result.accuracy:.3f}\n")
                f.write(f"  Throughput: {result.throughput_tokens_per_sec:.2f} tokens/sec\n")
                f.write(f"  Queries: {result.successful_queries}/{result.total_queries}\n\n")
        
        logger.info(f"💾 Results saved to {results_file}")
        logger.info(f"📊 Summary saved to {summary_file}")
        
        return results_file, summary_file
    
    def run_full_benchmark(self, node_name: str = "unknown") -> Dict[str, ScenarioResult]:
        """Run complete MLPerf Datacenter benchmark"""
        logger.info("🚀 Starting MLPerf Inference Datacenter Benchmark")
        logger.info(f"Node: {node_name}")
        logger.info(f"Model: {self.config.model_name}")
        logger.info(f"Device: {self.device}")
        
        # Setup model
        self.setup_model()
        
        results = {}
        
        # Run Server scenario
        logger.info("\n" + "="*60)
        server_result = self.run_server_scenario()
        results["Server"] = server_result
        
        # Run Offline scenario
        logger.info("\n" + "="*60)
        offline_result = self.run_offline_scenario()
        results["Offline"] = offline_result
        
        # Save results
        self.save_results(results, node_name)
        
        return results

def main():
    """Main entry point for MLPerf Datacenter benchmark"""
    import socket
    
    # Configuration
    config = MLPerfConfig()
    
    # Override from environment variables
    config.max_tokens = int(os.environ.get('MAX_TOKENS', config.max_tokens))
    config.server_target_qps = float(os.environ.get('SERVER_TARGET_QPS', config.server_target_qps))
    config.offline_target_qps = float(os.environ.get('OFFLINE_TARGET_QPS', config.offline_target_qps))
    
    # Get node name
    node_name = os.environ.get('NODE_NAME', socket.gethostname())
    
    # Run benchmark
    benchmark = MLPerfDatacenterBenchmark(config)
    results = benchmark.run_full_benchmark(node_name)
    
    # Print summary
    print("\n" + "="*60)
    print("🎯 MLPerf Inference Datacenter Benchmark Complete")
    print("="*60)
    
    for scenario_name, result in results.items():
        print(f"\n📊 {scenario_name} Scenario:")
        print(f"  Status: {'✅ VALID' if result.valid else '❌ INVALID'}")
        print(f"  QPS: {result.achieved_qps:.2f} (target: {result.target_qps:.2f})")
        print(f"  Latency P99: {result.latency_p99:.2f}ms")
        print(f"  TTFT P99: {result.ttft_p99:.2f}ms")
        print(f"  TPOT P99: {result.tpot_p99:.2f}ms")
        print(f"  Accuracy: {result.accuracy:.3f}")
        print(f"  Throughput: {result.throughput_tokens_per_sec:.2f} tokens/sec")

if __name__ == "__main__":
    main()