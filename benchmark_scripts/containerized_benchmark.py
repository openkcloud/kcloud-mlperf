#!/usr/bin/env python3
"""
Containerized MLPerf Llama-3.1-8B Benchmark
Optimized for Kubernetes deployment
"""
import os
import time
import json
import torch
import logging
from transformers import AutoTokenizer, AutoModelForCausalLM

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class LlamaBenchmark:
    def __init__(self, model_name="meta-llama/Llama-3.1-8B-Instruct"):
        self.model_name = model_name
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.results = {}
        
        # Environment variables
        self.hf_token = os.getenv('HF_TOKEN')
        self.num_samples = int(os.getenv('NUM_SAMPLES', '10'))
        self.max_tokens = int(os.getenv('MAX_TOKENS', '64'))
        self.batch_size = int(os.getenv('BATCH_SIZE', '1'))
        
        logger.info(f"Initializing benchmark with {self.num_samples} samples")
        logger.info(f"Device: {self.device}")
        logger.info(f"Max tokens: {self.max_tokens}")
    
    def check_environment(self):
        """Verify container environment"""
        logger.info("🔍 Checking environment...")
        
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
        
        # Check disk space
        import shutil
        free_space = shutil.disk_usage("/app").free / 1024**3
        logger.info(f"📁 Free disk space: {free_space:.1f}GB")
        
        return True
    
    def load_model(self):
        """Load Llama model and tokenizer"""
        logger.info(f"🚀 Loading {self.model_name}...")
        start_time = time.time()
        
        try:
            # Login if token provided
            if self.hf_token:
                from huggingface_hub import login
                login(token=self.hf_token)
            
            # Load tokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                cache_dir="/app/cache/transformers"
            )
            
            # Load model
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
                device_map="auto" if self.device == "cuda" else None,
                cache_dir="/app/cache/transformers"
            )
            
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token
            
            load_time = time.time() - start_time
            logger.info(f"✅ Model loaded in {load_time:.2f}s")
            
            if self.device == "cuda":
                memory_used = torch.cuda.memory_allocated() / 1024**3
                logger.info(f"🔥 GPU memory used: {memory_used:.2f}GB")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to load model: {e}")
            return False
    
    def prepare_samples(self):
        """Prepare test samples"""
        logger.info("📝 Preparing test samples...")
        
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
            }
        ]
        
        # Repeat samples to reach desired count
        self.samples = (base_samples * (self.num_samples // len(base_samples) + 1))[:self.num_samples]
        logger.info(f"✅ Prepared {len(self.samples)} samples")
        
        return self.samples
    
    def run_benchmark(self):
        """Execute the benchmark"""
        logger.info(f"🏃‍♂️ Starting benchmark with {len(self.samples)} samples...")
        
        start_time = time.time()
        results = []
        
        for i, sample in enumerate(self.samples):
            sample_start = time.time()
            
            # Prepare prompt
            prompt = f"<|begin_of_text|><|start_header_id|>user<|end_header_id|>\\n\\nSummarize the following article in one sentence:\\n{sample['article']}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\\n\\n"
            
            try:
                # Tokenize
                inputs = self.tokenizer(prompt, return_tensors="pt", truncation=True, max_length=1024)
                if self.device == "cuda":
                    inputs = {k: v.to(self.device) for k, v in inputs.items()}
                
                # Generate
                with torch.no_grad():
                    outputs = self.model.generate(
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
                    "input_length": input_length,
                    "output_length": output_length,
                    "time_ms": sample_time * 1000,
                    "tokens_per_second": output_length / sample_time if sample_time > 0 else 0,
                    "response": assistant_response[:100] + "..." if len(assistant_response) > 100 else assistant_response,
                    "success": True
                }
                
                results.append(result)
                
                if (i + 1) % 5 == 0 or i == len(self.samples) - 1:
                    logger.info(f"  Processed {i+1}/{len(self.samples)} samples (avg: {sample_time:.3f}s)")
                    
            except Exception as e:
                logger.error(f"❌ Sample {i} failed: {e}")
                results.append({
                    "sample_id": i,
                    "success": False,
                    "error": str(e)
                })
        
        total_time = time.time() - start_time
        successful_results = [r for r in results if r.get('success', False)]
        
        # Calculate metrics
        if successful_results:
            avg_time = total_time / len(successful_results)
            total_input_tokens = sum(r['input_length'] for r in successful_results)
            total_output_tokens = sum(r['output_length'] for r in successful_results)
            avg_tokens_per_second = sum(r['tokens_per_second'] for r in successful_results) / len(successful_results)
            throughput = len(successful_results) / total_time
            success_rate = len(successful_results) / len(results) * 100
            
            self.results = {
                "model": self.model_name,
                "device": self.device,
                "total_samples": len(results),
                "successful_samples": len(successful_results),
                "success_rate_percent": success_rate,
                "total_time_seconds": total_time,
                "average_time_per_sample_ms": avg_time * 1000,
                "throughput_samples_per_second": throughput,
                "average_input_tokens": total_input_tokens / len(successful_results),
                "average_output_tokens": total_output_tokens / len(successful_results),
                "average_tokens_per_second": avg_tokens_per_second,
                "peak_gpu_memory_gb": torch.cuda.max_memory_allocated() / 1024**3 if self.device == "cuda" else 0,
                "detailed_results": results
            }
        else:
            logger.error("❌ No successful samples")
            self.results = {"error": "No successful samples"}
        
        return self.results
    
    def save_results(self):
        """Save results to file"""
        results_file = "/app/results/benchmark_results.json"
        os.makedirs(os.path.dirname(results_file), exist_ok=True)
        
        with open(results_file, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        logger.info(f"💾 Results saved to {results_file}")
        
        # Also save summary
        summary_file = "/app/results/summary.txt"
        with open(summary_file, 'w') as f:
            if 'error' not in self.results:
                f.write(f"MLPerf Llama-3.1-8B Benchmark Results\\n")
                f.write(f"====================================\\n\\n")
                f.write(f"Model: {self.results['model']}\\n")
                f.write(f"Device: {self.results['device']}\\n")
                f.write(f"Success Rate: {self.results['success_rate_percent']:.1f}%\\n")
                f.write(f"Throughput: {self.results['throughput_samples_per_second']:.2f} samples/sec\\n")
                f.write(f"Avg Latency: {self.results['average_time_per_sample_ms']:.0f}ms\\n")
                f.write(f"Tokens/sec: {self.results['average_tokens_per_second']:.1f}\\n")
                f.write(f"GPU Memory: {self.results['peak_gpu_memory_gb']:.2f}GB\\n")
            else:
                f.write(f"Benchmark failed: {self.results['error']}\\n")
        
        logger.info(f"📊 Summary saved to {summary_file}")
    
    def print_results(self):
        """Print results to console"""
        if 'error' in self.results:
            logger.error(f"❌ Benchmark failed: {self.results['error']}")
            return
        
        print("\\n" + "="*60)
        print("🎯 CONTAINERIZED LLAMA-3.1-8B BENCHMARK RESULTS")
        print("="*60)
        print(f"📊 Model: {self.results['model']}")
        print(f"🖥️  Device: {self.results['device']}")
        print(f"✅ Success Rate: {self.results['success_rate_percent']:.1f}%")
        print(f"🔢 Samples: {self.results['successful_samples']}/{self.results['total_samples']}")
        print(f"⏱️  Total Time: {self.results['total_time_seconds']:.2f}s")
        print(f"⚡ Throughput: {self.results['throughput_samples_per_second']:.2f} samples/sec")
        print(f"📈 Avg Latency: {self.results['average_time_per_sample_ms']:.0f}ms")
        print(f"🚀 Tokens/sec: {self.results['average_tokens_per_second']:.1f}")
        print(f"🔥 GPU Memory: {self.results['peak_gpu_memory_gb']:.2f}GB")
        print("="*60)

def main():
    """Main benchmark execution"""
    logger.info("🐳 Starting containerized MLPerf Llama benchmark...")
    
    # Initialize benchmark
    benchmark = LlamaBenchmark()
    
    # Check environment
    if not benchmark.check_environment():
        logger.error("❌ Environment check failed")
        return 1
    
    # Load model
    if not benchmark.load_model():
        logger.error("❌ Model loading failed")
        return 1
    
    # Prepare samples
    benchmark.prepare_samples()
    
    # Run benchmark
    results = benchmark.run_benchmark()
    
    # Save and display results
    benchmark.save_results()
    benchmark.print_results()
    
    logger.info("✅ Benchmark completed successfully!")
    return 0

if __name__ == "__main__":
    exit(main())