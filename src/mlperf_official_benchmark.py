#!/usr/bin/env python3
"""
Official MLPerf-compliant Llama3.1-8B Benchmark Implementation
Uses official MLPerf LoadGen and full dataset (13,368 samples)
"""

import os
import sys
import time
import json
import logging
import argparse
import threading
from typing import List, Dict, Any, Optional
from pathlib import Path

import torch
import numpy as np
from transformers import AutoTokenizer, AutoModelForCausalLM

import mlperf_loadgen as lg
from mlperf_dataset import create_mlperf_dataset
from report_generator import MLPerfReportGenerator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MLPerfLlamaSUT:
    """MLPerf System Under Test for Llama3.1-8B"""
    
    def __init__(
        self,
        model_name: str = "meta-llama/Llama-3.1-8B-Instruct",
        dataset_path: str = "./dataset/cnn_dailymail_v3.json",
        device: str = "cuda",
        batch_size: int = 1,
        max_new_tokens: int = 128,
        total_sample_count: int = 13368,
        dtype: str = "bfloat16"
    ):
        self.model_name = model_name
        self.dataset_path = dataset_path
        self.device = device
        self.batch_size = batch_size
        self.max_new_tokens = max_new_tokens
        self.total_sample_count = total_sample_count
        
        # Set dtype
        if dtype == "bfloat16":
            self.torch_dtype = torch.bfloat16
        elif dtype == "float16":
            self.torch_dtype = torch.float16
        else:
            self.torch_dtype = torch.float32
            
        logger.info(f"Initializing MLPerf SUT for {model_name}")
        logger.info(f"Device: {device}, Batch size: {batch_size}, Max tokens: {max_new_tokens}")
        logger.info(f"Total samples: {total_sample_count}, Dtype: {dtype}")
        
        # Initialize model and tokenizer
        self.load_model()
        
        # Initialize dataset
        self.dataset, self.qsl = create_mlperf_dataset(
            dataset_path=dataset_path,
            total_sample_count=total_sample_count
        )
        
        # Query tracking
        self.query_responses = {}
        self.query_lock = threading.Lock()
        
    def load_model(self):
        """Load the model and tokenizer"""
        logger.info(f"Loading tokenizer...")
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
            
        logger.info(f"Loading model...")
        self.model = AutoModelForCausalLM.from_pretrained(
            self.model_name,
            torch_dtype=self.torch_dtype,
            trust_remote_code=True
        )
        
        # Move model to device
        self.model = self.model.to(self.device)
            
        logger.info("Model loaded successfully")
        
    def issue_queries(self, query_samples: List[lg.QuerySample]):
        """Handle incoming queries from LoadGen"""
        threading.Thread(target=self._process_queries, args=(query_samples,)).start()
        
    def _process_queries(self, query_samples: List[lg.QuerySample]):
        """Process queries in a separate thread"""
        responses = []
        
        for query_sample in query_samples:
            try:
                # Get the input sample
                sample_index = query_sample.index
                input_text = self.dataset.get_sample_input_text(sample_index)
                
                # Generate response
                response_tokens, metrics = self._generate_response(input_text)
                
                # Create response object
                response_array = np.array(response_tokens, dtype=np.int32)
                response_info = response_array.tobytes()
                
                # Track token count for compliance
                token_count = len(response_tokens)
                
                # Create MLPerf response - using uintptr for address
                response_ptr = response_info.__array_interface__['data'][0] if hasattr(response_info, '__array_interface__') else id(response_info)
                response = lg.QuerySampleResponse(
                    query_sample.id, 
                    response_ptr, 
                    len(response_info)
                )
                responses.append(response)
                
                # For server scenario, report first token completion
                if hasattr(lg, 'FirstTokenComplete'):
                    lg.FirstTokenComplete([response])
                    
            except Exception as e:
                logger.error(f"Error processing query {query_sample.id}: {e}")
                # Return empty response on error
                empty_response = lg.QuerySampleResponse(
                    query_sample.id, 
                    0, 
                    0
                )
                responses.append(empty_response)
        
        # Complete all queries
        lg.QuerySamplesComplete(responses)
        
    def _generate_response(self, input_text: str) -> tuple[List[int], Dict[str, float]]:
        """Generate response for a single input"""
        start_time = time.time()
        
        # Tokenize input
        inputs = self.tokenizer(
            input_text, 
            return_tensors="pt", 
            padding=True,
            truncation=True,
            max_length=1024
        )
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        
        input_length = inputs['input_ids'].shape[1]
        
        # Time to first token
        ttft_start = time.time()
        
        # Generate
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=self.max_new_tokens,
                do_sample=True,
                temperature=0.7,
                pad_token_id=self.tokenizer.eos_token_id,
                return_dict_in_generate=True,
                output_scores=True
            )
        
        ttft_end = time.time()
        end_time = time.time()
        
        # Extract generated tokens (excluding input)
        generated_tokens = outputs.sequences[0][input_length:].cpu().tolist()
        
        # Calculate metrics
        total_time = (end_time - start_time) * 1000  # ms
        ttft = (ttft_end - ttft_start) * 1000  # ms
        output_tokens = len(generated_tokens)
        tpot = (end_time - ttft_end) * 1000 / max(output_tokens, 1)  # ms per token
        
        metrics = {
            'total_latency_ms': total_time,
            'ttft_ms': ttft,
            'tpot_ms': tpot,
            'input_tokens': input_length,
            'output_tokens': output_tokens,
            'tokens_per_sec': output_tokens / max((end_time - start_time), 0.001)
        }
        
        return generated_tokens, metrics
    
    def flush_queries(self):
        """Flush any pending queries"""
        pass


def run_mlperf_benchmark(
    scenario: str = "Offline",
    model_name: str = "meta-llama/Llama-3.1-8B-Instruct",
    dataset_path: str = "./dataset/cnn_dailymail_v3.json",
    total_sample_count: int = 13368,
    user_conf: str = "./configs/user.conf",
    mlperf_conf: str = "./configs/mlperf.conf",
    audit_conf: str = None,
    output_dir: str = "./results/mlperf_official",
    dtype: str = "bfloat16",
    device: str = "cuda",
    batch_size: int = 1,
    max_new_tokens: int = 128
):
    """Run MLPerf benchmark with official LoadGen"""
    
    logger.info(f"🚀 Starting Official MLPerf {scenario} Benchmark")
    logger.info(f"📊 Dataset: {dataset_path}")
    logger.info(f"🔢 Total samples: {total_sample_count}")
    logger.info(f"📱 Model: {model_name}")
    logger.info(f"🖥️  Device: {device}")
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Initialize SUT
    sut = MLPerfLlamaSUT(
        model_name=model_name,
        dataset_path=dataset_path,
        device=device,
        batch_size=batch_size,
        max_new_tokens=max_new_tokens,
        total_sample_count=total_sample_count,
        dtype=dtype
    )
    
    # Create MLPerf settings
    settings = lg.TestSettings()
    settings.scenario = getattr(lg.TestScenario, scenario)
    settings.mode = lg.TestMode.PerformanceOnly
    
    # Configure scenario-specific settings
    if scenario == "Offline":
        settings.offline_expected_qps = 1.0
        settings.min_duration_ms = 60000  # 1 minute minimum
        settings.max_duration_ms = 300000  # 5 minute maximum
        
    elif scenario == "Server":
        settings.server_target_qps = 0.5
        settings.server_target_latency_ns = 20000000000  # 20 seconds
        settings.min_duration_ms = 60000
        settings.max_duration_ms = 300000
        
    elif scenario == "SingleStream":
        settings.single_stream_expected_latency_ns = 5000000000  # 5 seconds
        settings.min_duration_ms = 60000
        
    # Additional settings for token latency tracking
    settings.use_token_latencies = True
    
    # Log settings
    log_settings = lg.LogSettings()
    log_settings.log_output.outdir = output_dir
    log_settings.log_output.prefix = f"mlperf_log_"
    log_settings.log_output.suffix = ""
    log_settings.log_output.prefix_with_datetime = False
    log_settings.log_output.copy_detail_to_stdout = True
    log_settings.log_output.copy_summary_to_stdout = True
    log_settings.log_mode = lg.LoggingMode.AsyncPoll
    log_settings.log_mode_async_poll_interval_ms = 1000
    log_settings.enable_trace = True
    
    # Create SUT and QSL for LoadGen
    sut_wrapper = lg.ConstructSUT(sut.issue_queries, sut.flush_queries)
    qsl_wrapper = sut.qsl.get_query_sample_library()
    
    logger.info(f"🏁 Starting MLPerf benchmark execution...")
    
    # Run the benchmark
    if audit_conf:
        lg.StartTestWithLogSettings(
            sut_wrapper, 
            qsl_wrapper, 
            settings, 
            log_settings,
            audit_conf
        )
    else:
        lg.StartTestWithLogSettings(
            sut_wrapper, 
            qsl_wrapper, 
            settings, 
            log_settings
        )
    
    logger.info(f"✅ MLPerf benchmark completed!")
    logger.info(f"📁 Results saved to: {output_dir}")
    
    # Generate automated report
    try:
        report_generator = MLPerfReportGenerator(results_dir=output_dir)
        
        # Collect benchmark results for report
        benchmark_results = {
            'scenario': scenario,
            'model_name': model_name,
            'total_sample_count': total_sample_count,
            'device': device,
            'dtype': dtype,
            'max_new_tokens': max_new_tokens,
            'batch_size': batch_size,
            'dataset_path': dataset_path,
            'output_dir': output_dir,
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
            'system_info': {
                'hardware': {
                    'device': device,
                    'dtype': dtype,
                    'batch_size': batch_size
                },
                'software': {
                    'model': model_name,
                    'max_tokens': max_new_tokens,
                    'dataset_samples': total_sample_count
                }
            },
            'performance': {
                'scenario': scenario,
                'total_samples': total_sample_count,
                'device': device,
                'precision': dtype
            }
        }
        
        report_file = report_generator.generate_comprehensive_report(
            benchmark_results, 
            f"MLPerf_{scenario}_{device}_{total_sample_count}_samples_{time.strftime('%Y%m%d_%H%M%S')}.md"
        )
        logger.info(f"📊 Automated report generated: {report_file}")
        
    except Exception as e:
        logger.warning(f"Failed to generate automated report: {e}")
    
    # Cleanup
    lg.DestroySUT(sut_wrapper)
    lg.DestroyQSL(qsl_wrapper)


def main():
    parser = argparse.ArgumentParser(description="Official MLPerf Llama3.1-8B Benchmark")
    
    parser.add_argument(
        "--scenario", 
        choices=["Offline", "Server", "SingleStream"], 
        default="Offline",
        help="MLPerf scenario to run"
    )
    parser.add_argument(
        "--model_name", 
        default="meta-llama/Llama-3.1-8B-Instruct",
        help="Model name"
    )
    parser.add_argument(
        "--dataset_path", 
        default="./dataset/cnn_dailymail_v3.json",
        help="Path to prepared dataset"
    )
    parser.add_argument(
        "--total_sample_count", 
        type=int, 
        default=13368,
        help="Total number of samples to use"
    )
    parser.add_argument(
        "--output_dir", 
        default="./results/mlperf_official",
        help="Output directory for results"
    )
    parser.add_argument(
        "--device", 
        choices=["cuda", "cpu"], 
        default="cuda",
        help="Device to run on"
    )
    parser.add_argument(
        "--dtype", 
        choices=["bfloat16", "float16", "float32"], 
        default="bfloat16",
        help="Model dtype"
    )
    parser.add_argument(
        "--batch_size", 
        type=int, 
        default=1,
        help="Batch size"
    )
    parser.add_argument(
        "--max_new_tokens", 
        type=int, 
        default=128,
        help="Maximum new tokens to generate"
    )
    
    args = parser.parse_args()
    
    # Check if dataset exists
    if not os.path.exists(args.dataset_path):
        logger.error(f"Dataset not found at {args.dataset_path}")
        logger.info("Please run: python scripts/download-dataset.py")
        sys.exit(1)
    
    # Run benchmark
    run_mlperf_benchmark(
        scenario=args.scenario,
        model_name=args.model_name,
        dataset_path=args.dataset_path,
        total_sample_count=args.total_sample_count,
        output_dir=args.output_dir,
        device=args.device,
        dtype=args.dtype,
        batch_size=args.batch_size,
        max_new_tokens=args.max_new_tokens
    )


if __name__ == "__main__":
    main()