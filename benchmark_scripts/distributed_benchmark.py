#!/usr/bin/env python3
"""
Distributed Multi-GPU MLPerf Llama-3.1-8B Benchmark
Coordinates inference across multiple GPUs on different servers
"""
import os
import sys
import time
import json
import torch
import torch.distributed as dist
import torch.multiprocessing as mp
from torch.nn.parallel import DistributedDataParallel as DDP
import logging
import socket
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForCausalLM
import argparse

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class DistributedLlamaBenchmark:
    def __init__(self, rank, world_size, master_addr, master_port, model_name="meta-llama/Llama-3.1-8B-Instruct", base_dir=None):
        self.rank = rank
        self.world_size = world_size
        self.master_addr = master_addr
        self.master_port = master_port
        self.model_name = model_name
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.hostname = socket.gethostname()
        self.results = {}
        
        # Set base directory
        if base_dir is None:
            self.base_dir = Path.cwd()
        else:
            self.base_dir = Path(base_dir)
        
        # Create cache and results directories
        self.cache_dir = self.base_dir / "cache"
        self.results_dir = self.base_dir / "results" / f"distributed_{self.hostname}_rank{rank}"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.results_dir.mkdir(parents=True, exist_ok=True)
        
        # Environment variables
        self.hf_token = os.getenv('HF_TOKEN')
        self.num_samples = int(os.getenv('NUM_SAMPLES', '10'))
        self.max_tokens = int(os.getenv('MAX_TOKENS', '32'))
        self.batch_size = int(os.getenv('BATCH_SIZE', '1'))
        
        logger.info(f"Initializing distributed benchmark on {self.hostname} rank {rank}/{world_size}")
        logger.info(f"Master: {master_addr}:{master_port}")
        logger.info(f"Device: {self.device}")
        logger.info(f"Samples: {self.num_samples}")
    
    def setup_distributed(self):
        """Initialize distributed training"""
        logger.info(f"Setting up distributed training for rank {self.rank}")
        
        # Initialize process group
        os.environ['MASTER_ADDR'] = self.master_addr
        os.environ['MASTER_PORT'] = str(self.master_port)
        os.environ['WORLD_SIZE'] = str(self.world_size)
        os.environ['RANK'] = str(self.rank)
        
        # Initialize the process group
        dist.init_process_group(
            backend='nccl' if torch.cuda.is_available() else 'gloo',
            rank=self.rank,
            world_size=self.world_size,
            timeout=torch.distributed.default_pg_timeout
        )
        
        # Set device (each node has only 1 GPU at device 0)
        if torch.cuda.is_available():
            torch.cuda.set_device(0)
        
        logger.info(f"Distributed setup complete for rank {self.rank}")
    
    def check_environment(self):
        """Verify environment"""
        logger.info("🔍 Checking distributed environment...")
        
        # Check GPU
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            gpu_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
            logger.info(f"✅ GPU: {gpu_name} ({gpu_memory:.1f}GB)")
        else:
            logger.warning("⚠️ No GPU detected - using CPU")
        
        # Check HuggingFace token
        if not self.hf_token:
            logger.warning("⚠️ No HF_TOKEN found - may need authentication")
        else:
            logger.info("✅ HuggingFace token configured")
        
        # Check distributed setup
        if dist.is_initialized():
            logger.info(f"✅ Distributed: rank {self.rank}/{self.world_size}")
        else:
            logger.error("❌ Distributed not initialized")
            return False
        
        return True
    
    def load_model(self):
        """Load Llama model and tokenizer with distributed support"""
        logger.info(f"🚀 Loading {self.model_name} on rank {self.rank}...")
        start_time = time.time()
        
        try:
            # Only rank 0 downloads the model to avoid conflicts
            if self.rank == 0:
                logger.info("Rank 0 downloading model...")
                
                # Login if token provided
                if self.hf_token:
                    from huggingface_hub import login
                    login(token=self.hf_token)
                
                # Load tokenizer
                self.tokenizer = AutoTokenizer.from_pretrained(
                    self.model_name,
                    cache_dir=str(self.cache_dir / "transformers")
                )
                
                # Load model
                self.model = AutoModelForCausalLM.from_pretrained(
                    self.model_name,
                    torch_dtype=torch.float16 if self.device.startswith("cuda") else torch.float32,
                    cache_dir=str(self.cache_dir / "transformers")
                )
                
                if self.tokenizer.pad_token is None:
                    self.tokenizer.pad_token = self.tokenizer.eos_token
            
            # Synchronize all processes
            dist.barrier()
            
            # Non-rank 0 processes load from cache
            if self.rank != 0:
                logger.info(f"Rank {self.rank} loading from cache...")
                
                # Login if token provided
                if self.hf_token:
                    from huggingface_hub import login
                    login(token=self.hf_token)
                
                # Load tokenizer
                self.tokenizer = AutoTokenizer.from_pretrained(
                    self.model_name,
                    cache_dir=str(self.cache_dir / "transformers")
                )
                
                # Load model
                self.model = AutoModelForCausalLM.from_pretrained(
                    self.model_name,
                    torch_dtype=torch.float16 if self.device.startswith("cuda") else torch.float32,
                    cache_dir=str(self.cache_dir / "transformers")
                )
                
                if self.tokenizer.pad_token is None:
                    self.tokenizer.pad_token = self.tokenizer.eos_token
            
            # Move model to device
            self.model.to(self.device)
            
            # Wrap with DDP (each node has GPU at device 0)
            self.model = DDP(self.model, device_ids=[0] if self.device.startswith("cuda") else None)
            
            load_time = time.time() - start_time
            logger.info(f"✅ Model loaded on rank {self.rank} in {load_time:.2f}s")
            
            if self.device.startswith("cuda"):
                memory_used = torch.cuda.memory_allocated() / 1024**3
                logger.info(f"🔥 GPU memory used on rank {self.rank}: {memory_used:.2f}GB")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to load model on rank {self.rank}: {e}")
            return False
    
    def prepare_samples(self):
        """Prepare test samples distributed across ranks"""
        logger.info(f"📝 Preparing test samples for rank {self.rank}...")
        
        base_samples = [
            {
                "article": "Scientists at a major university have discovered a new species of butterfly in the Amazon rainforest. The butterfly has unique wing patterns that help it camouflage among the forest leaves. Researchers believe this discovery could help in conservation efforts.",
                "target": "New butterfly species discovered in Amazon rainforest."
            },
            {
                "article": "The weather department has issued a warning for heavy rainfall in coastal regions. Residents are advised to stay indoors and avoid unnecessary travel. The storm is expected to last for two days with wind speeds reaching up to 70 mph.",
                "target": "Heavy rainfall warning issued for coastal regions."
            },
            {
                "article": "Technology companies reported strong quarterly earnings this week. Several major firms exceeded analyst expectations due to increased demand for cloud services and artificial intelligence solutions. The market responded positively to these results.",
                "target": "Tech companies report strong quarterly earnings."
            },
            {
                "article": "A new study published in a medical journal suggests that regular exercise can significantly reduce the risk of heart disease. The research followed over 10,000 participants for five years and found that those who exercised regularly had 40% lower risk.",
                "target": "Study shows regular exercise reduces heart disease risk."
            },
            {
                "article": "Local authorities have announced plans to build a new public library in the downtown area. The project is expected to cost $15 million and will include modern facilities such as computer labs and study spaces. Construction is scheduled to begin next year.",
                "target": "New $15 million public library planned for downtown."
            },
            {
                "article": "A breakthrough in renewable energy technology has been achieved by researchers at MIT. The new solar panel design can generate 40% more electricity than traditional panels while being 30% cheaper to manufacture.",
                "target": "MIT develops more efficient and cheaper solar panels."
            },
            {
                "article": "Global food prices have risen by 25% this year due to supply chain disruptions and extreme weather conditions. The increase is affecting developing countries the most, with millions facing food insecurity.",
                "target": "Global food prices rise 25% due to supply disruptions."
            },
            {
                "article": "The space agency announced successful completion of its Mars rover mission. The rover collected valuable samples and transmitted important data about the planet's geology and potential for past life.",
                "target": "Mars rover mission completed successfully."
            }
        ]
        
        # Distribute samples across ranks
        total_samples = self.num_samples
        samples_per_rank = total_samples // self.world_size
        start_idx = self.rank * samples_per_rank
        end_idx = start_idx + samples_per_rank
        
        # Handle remainder for last rank
        if self.rank == self.world_size - 1:
            end_idx = total_samples
        
        # Create samples for this rank
        extended_samples = (base_samples * (total_samples // len(base_samples) + 1))[:total_samples]
        self.samples = extended_samples[start_idx:end_idx]
        
        logger.info(f"✅ Rank {self.rank} prepared {len(self.samples)} samples (indices {start_idx}-{end_idx-1})")
        
        return self.samples
    
    def run_benchmark(self):
        """Execute the distributed benchmark"""
        logger.info(f"🏃‍♂️ Starting distributed benchmark on rank {self.rank} with {len(self.samples)} samples...")
        
        start_time = time.time()
        results = []
        
        for i, sample in enumerate(self.samples):
            sample_start = time.time()
            
            # Prepare prompt
            prompt = f"<|begin_of_text|><|start_header_id|>user<|end_header_id|>\\n\\nSummarize the following article in one sentence:\\n{sample['article']}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\\n\\n"
            
            try:
                # Tokenize
                inputs = self.tokenizer(prompt, return_tensors="pt", truncation=True, max_length=1024)
                if self.device.startswith("cuda"):
                    inputs = {k: v.to(self.device) for k, v in inputs.items()}
                
                # Generate
                with torch.no_grad():
                    outputs = self.model.module.generate(  # Use .module to access underlying model
                        **inputs,
                        max_new_tokens=self.max_tokens,
                        do_sample=True,
                        temperature=0.7,
                        pad_token_id=self.tokenizer.eos_token_id
                    )
                
                # Decode response
                full_response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
                assistant_response = full_response.split("assistant<|end_header_id|>")[-1].strip()
                
                sample_time = time.time() - sample_start
                input_length = len(inputs['input_ids'][0])
                output_length = len(outputs[0]) - input_length
                
                result = {
                    "sample_id": i,
                    "global_sample_id": self.rank * (self.num_samples // self.world_size) + i,
                    "rank": self.rank,
                    "hostname": self.hostname,
                    "input_length": input_length,
                    "output_length": output_length,
                    "time_ms": sample_time * 1000,
                    "tokens_per_second": output_length / sample_time if sample_time > 0 else 0,
                    "response": assistant_response[:100] + "..." if len(assistant_response) > 100 else assistant_response,
                    "success": True
                }
                
                results.append(result)
                
                logger.info(f"  Rank {self.rank} Sample {i+1}/{len(self.samples)}: {sample_time:.3f}s, {output_length} tokens")
                    
            except Exception as e:
                logger.error(f"❌ Rank {self.rank} Sample {i} failed: {e}")
                results.append({
                    "sample_id": i,
                    "global_sample_id": self.rank * (self.num_samples // self.world_size) + i,
                    "rank": self.rank,
                    "hostname": self.hostname,
                    "success": False,
                    "error": str(e)
                })
        
        total_time = time.time() - start_time
        successful_results = [r for r in results if r.get('success', False)]
        
        # Calculate metrics for this rank
        if successful_results:
            avg_time = total_time / len(successful_results)
            total_input_tokens = sum(r['input_length'] for r in successful_results)
            total_output_tokens = sum(r['output_length'] for r in successful_results)
            avg_tokens_per_second = sum(r['tokens_per_second'] for r in successful_results) / len(successful_results)
            throughput = len(successful_results) / total_time
            success_rate = len(successful_results) / len(results) * 100
            
            self.results = {
                "rank": self.rank,
                "hostname": self.hostname,
                "model": self.model_name,
                "device": self.device,
                "world_size": self.world_size,
                "total_samples": len(results),
                "successful_samples": len(successful_results),
                "success_rate_percent": success_rate,
                "total_time_seconds": total_time,
                "average_time_per_sample_ms": avg_time * 1000,
                "throughput_samples_per_second": throughput,
                "average_input_tokens": total_input_tokens / len(successful_results),
                "average_output_tokens": total_output_tokens / len(successful_results),
                "average_tokens_per_second": avg_tokens_per_second,
                "peak_gpu_memory_gb": torch.cuda.max_memory_allocated() / 1024**3 if self.device.startswith("cuda") else 0,
                "detailed_results": results,
                "timestamp": int(time.time())
            }
        else:
            logger.error(f"❌ No successful samples on rank {self.rank}")
            self.results = {
                "rank": self.rank,
                "hostname": self.hostname,
                "error": "No successful samples"
            }
        
        return self.results
    
    def save_results(self):
        """Save results to file"""
        timestamp = int(time.time())
        results_file = self.results_dir / f"distributed_results_rank{self.rank}_{timestamp}.json"
        
        with open(results_file, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        logger.info(f"💾 Results saved to {results_file}")
        
        # Also save summary
        summary_file = self.results_dir / f"distributed_summary_rank{self.rank}_{timestamp}.txt"
        with open(summary_file, 'w') as f:
            if 'error' not in self.results:
                f.write(f"Distributed MLPerf Llama-3.1-8B Results - Rank {self.rank} ({self.hostname})\\n")
                f.write(f"=" * 70 + "\\n\\n")
                f.write(f"Model: {self.results['model']}\\n")
                f.write(f"Device: {self.results['device']}\\n")
                f.write(f"World Size: {self.results['world_size']}\\n")
                f.write(f"Rank: {self.rank}\\n")
                f.write(f"Node: {self.hostname}\\n")
                f.write(f"Success Rate: {self.results['success_rate_percent']:.1f}%\\n")
                f.write(f"Throughput: {self.results['throughput_samples_per_second']:.2f} samples/sec\\n")
                f.write(f"Avg Latency: {self.results['average_time_per_sample_ms']:.0f}ms\\n")
                f.write(f"Tokens/sec: {self.results['average_tokens_per_second']:.1f}\\n")
                f.write(f"GPU Memory: {self.results['peak_gpu_memory_gb']:.2f}GB\\n")
            else:
                f.write(f"Benchmark failed on rank {self.rank} ({self.hostname}): {self.results['error']}\\n")
        
        logger.info(f"📊 Summary saved to {summary_file}")
        
        return results_file, summary_file
    
    def print_results(self):
        """Print results to console"""
        if 'error' in self.results:
            logger.error(f"❌ Benchmark failed on rank {self.rank}: {self.results['error']}")
            return
        
        print("\\n" + "="*70)
        print(f"🎯 DISTRIBUTED LLAMA-3.1-8B RESULTS - Rank {self.rank} ({self.hostname})")
        print("="*70)
        print(f"📊 Model: {self.results['model']}")
        print(f"🖥️  Device: {self.results['device']}")
        print(f"🌐 World Size: {self.results['world_size']}")
        print(f"✅ Success Rate: {self.results['success_rate_percent']:.1f}%")
        print(f"🔢 Samples: {self.results['successful_samples']}/{self.results['total_samples']}")
        print(f"⏱️  Total Time: {self.results['total_time_seconds']:.2f}s")
        print(f"⚡ Throughput: {self.results['throughput_samples_per_second']:.2f} samples/sec")
        print(f"📈 Avg Latency: {self.results['average_time_per_sample_ms']:.0f}ms")
        print(f"🚀 Tokens/sec: {self.results['average_tokens_per_second']:.1f}")
        print(f"🔥 GPU Memory: {self.results['peak_gpu_memory_gb']:.2f}GB")
        print("="*70)
    
    def cleanup(self):
        """Clean up distributed resources"""
        if dist.is_initialized():
            dist.destroy_process_group()
        logger.info(f"Cleaned up distributed resources for rank {self.rank}")

def run_distributed_benchmark(rank, world_size, master_addr, master_port):
    """Main function for distributed benchmark"""
    benchmark = DistributedLlamaBenchmark(rank, world_size, master_addr, master_port)
    
    try:
        # Setup distributed training
        benchmark.setup_distributed()
        
        # Check environment
        if not benchmark.check_environment():
            logger.error(f"❌ Environment check failed on rank {rank}")
            return
        
        # Load model
        if not benchmark.load_model():
            logger.error(f"❌ Model loading failed on rank {rank}")
            return
        
        # Prepare samples
        benchmark.prepare_samples()
        
        # Run benchmark
        results = benchmark.run_benchmark()
        
        # Save and display results
        benchmark.save_results()
        benchmark.print_results()
        
        logger.info(f"✅ Distributed benchmark completed successfully on rank {rank}!")
        
    except Exception as e:
        logger.error(f"❌ Distributed benchmark failed on rank {rank}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        benchmark.cleanup()

def main():
    """Main execution"""
    parser = argparse.ArgumentParser(description='Distributed MLPerf Llama-3.1-8B Benchmark')
    parser.add_argument('--rank', type=int, required=True, help='Rank of this process')
    parser.add_argument('--world-size', type=int, required=True, help='Total number of processes')
    parser.add_argument('--master-addr', type=str, required=True, help='Master node address')
    parser.add_argument('--master-port', type=int, default=29500, help='Master node port')
    
    args = parser.parse_args()
    
    logger.info(f"🚀 Starting distributed benchmark: rank {args.rank}/{args.world_size}")
    logger.info(f"Master: {args.master_addr}:{args.master_port}")
    
    run_distributed_benchmark(args.rank, args.world_size, args.master_addr, args.master_port)

if __name__ == "__main__":
    main()