#!/usr/bin/env python3
"""
Universal MLPerf Benchmark Runner
=================================

Runs MLPerf benchmarks either locally or on remote nodes.
Automatically detects environment and adjusts accordingly.
"""

import os
import sys
import argparse
import subprocess
import time
import json
from pathlib import Path
from datetime import datetime
import logging
from typing import Optional, Dict, Tuple

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from config import config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class UniversalBenchmarkRunner:
    """Runs MLPerf benchmarks in any environment"""
    
    def __init__(self):
        self.config = config
        self.results_dir = Path("results")
        self.results_dir.mkdir(exist_ok=True)
        self.reports_dir = Path("reports") 
        self.reports_dir.mkdir(exist_ok=True)
        
    def check_environment(self) -> Dict[str, bool]:
        """Check current environment capabilities"""
        checks = {
            'cuda_available': False,
            'gpu_available': False,
            'mlperf_installed': False,
            'dataset_available': False,
            'model_cached': False
        }
        
        # Check CUDA
        try:
            result = subprocess.run(['nvidia-smi'], capture_output=True, text=True)
            checks['cuda_available'] = result.returncode == 0
            if checks['cuda_available']:
                checks['gpu_available'] = 'NVIDIA' in result.stdout
        except FileNotFoundError:
            logger.warning("nvidia-smi not found. GPU support disabled.")
        
        # Check MLPerf installation
        mlperf_main = self.config.mlperf_inference_dir / "main.py"
        checks['mlperf_installed'] = mlperf_main.exists()
        
        # Check dataset
        dataset_file = self.config.mlperf_inference_dir / "cnn_eval.json"
        checks['dataset_available'] = dataset_file.exists()
        
        # Check model cache
        model_cache = self.config.cache_dir / f"models--{self.config.model_name.replace('/', '--')}"
        checks['model_cached'] = model_cache.exists()
        
        return checks
    
    def setup_environment(self) -> bool:
        """Setup environment for benchmarking"""
        logger.info("🔧 Setting up environment...")
        
        # Check environment
        env_status = self.check_environment()
        
        # Report status
        logger.info("Environment Status:")
        for check, status in env_status.items():
            status_icon = "✅" if status else "❌"
            logger.info(f"  {status_icon} {check}: {status}")
        
        # Check if we can run
        if not env_status['mlperf_installed']:
            logger.error("MLPerf not installed! Run setup.sh first.")
            return False
        
        if not env_status['dataset_available']:
            logger.warning("Dataset not found. Attempting to download...")
            if not self.download_dataset():
                return False
        
        if not env_status['gpu_available'] and not self.config.is_local_run():
            logger.warning("No GPU detected locally. Will use CPU or remote execution.")
        
        return True
    
    def download_dataset(self) -> bool:
        """Download CNN/DailyMail dataset"""
        logger.info("📥 Downloading CNN/DailyMail dataset...")
        
        download_script = self.config.mlperf_dir / "download_cnndm.py"
        if not download_script.exists():
            logger.error(f"Download script not found: {download_script}")
            return False
        
        try:
            # Change to MLPerf directory
            original_dir = os.getcwd()
            os.chdir(self.config.mlperf_inference_dir)
            
            # Run download script
            result = subprocess.run(
                [sys.executable, str(download_script)],
                env=self.config.get_env_vars(),
                capture_output=True,
                text=True
            )
            
            os.chdir(original_dir)
            
            if result.returncode == 0:
                logger.info("✅ Dataset downloaded successfully")
                return True
            else:
                logger.error(f"Dataset download failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Dataset download error: {e}")
            return False
    
    def run_local_benchmark(self, samples: int, accuracy: bool = False) -> Tuple[bool, Optional[Dict]]:
        """Run benchmark locally"""
        logger.info("🚀 Running local benchmark...")
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_dir = f"local_benchmark_{timestamp}"
        full_output_path = self.results_dir / output_dir
        full_output_path.mkdir(exist_ok=True)
        
        # Build command
        cmd = self.config.get_mlperf_command(samples, accuracy, output_dir)
        
        # Log configuration
        logger.info(f"Configuration:")
        logger.info(f"  Samples: {samples}")
        logger.info(f"  Accuracy: {accuracy}")
        logger.info(f"  Output: {full_output_path}")
        
        # Change to MLPerf directory
        original_dir = os.getcwd()
        try:
            os.chdir(self.config.mlperf_inference_dir)
            
            # Run benchmark
            start_time = time.time()
            result = subprocess.run(
                cmd,
                env=self.config.get_env_vars(),
                capture_output=True,
                text=True
            )
            duration = time.time() - start_time
            
            os.chdir(original_dir)
            
            if result.returncode == 0:
                logger.info(f"✅ Benchmark completed in {duration:.1f}s")
                
                # Generate report
                report_data = self.generate_report(
                    'local', full_output_path, samples, accuracy, duration
                )
                
                return True, report_data
            else:
                logger.error(f"❌ Benchmark failed: {result.stderr}")
                return False, None
                
        except Exception as e:
            logger.error(f"❌ Benchmark error: {e}")
            os.chdir(original_dir)
            return False, None
    
    def run_remote_benchmark(self, node: str, samples: int, accuracy: bool = False) -> Tuple[bool, Optional[Dict]]:
        """Run benchmark on remote node"""
        node_address = self.config.get_node_address(node)
        if not node_address or node_address == 'localhost':
            logger.warning(f"Node {node} not configured. Running locally instead.")
            return self.run_local_benchmark(samples, accuracy)
        
        logger.info(f"🚀 Running remote benchmark on {node}...")
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        remote_output_dir = f"{node}_benchmark_{timestamp}"
        
        # Build remote command
        remote_cmd = [
            "ssh", node_address,
            f"cd {self.config.remote_dir}/official_mlperf && " +
            " ".join(self.config.get_mlperf_command(samples, accuracy, remote_output_dir))
        ]
        
        logger.info(f"Configuration:")
        logger.info(f"  Node: {node} ({node_address})")
        logger.info(f"  Samples: {samples}")
        logger.info(f"  Accuracy: {accuracy}")
        
        start_time = time.time()
        
        try:
            result = subprocess.run(
                remote_cmd,
                capture_output=True,
                text=True,
                timeout=3600  # 1 hour timeout
            )
            duration = time.time() - start_time
            
            if result.returncode == 0:
                logger.info(f"✅ Remote benchmark completed in {duration:.1f}s")
                
                # Copy results back
                local_results_dir = self.results_dir / f"{node}_{timestamp}"
                local_results_dir.mkdir(exist_ok=True)
                
                copy_cmd = [
                    "scp", "-r",
                    f"{node_address}:{self.config.remote_dir}/official_mlperf/inference/language/llama3.1-8b/{remote_output_dir}/*",
                    str(local_results_dir)
                ]
                
                subprocess.run(copy_cmd, check=True)
                logger.info(f"📊 Results copied to: {local_results_dir}")
                
                # Generate report
                report_data = self.generate_report(
                    node, local_results_dir, samples, accuracy, duration
                )
                
                return True, report_data
            else:
                logger.error(f"❌ Remote benchmark failed: {result.stderr}")
                return False, None
                
        except subprocess.TimeoutExpired:
            logger.error(f"❌ Remote benchmark timed out after 1 hour")
            return False, None
        except Exception as e:
            logger.error(f"❌ Remote benchmark error: {e}")
            return False, None
    
    def generate_report(self, node: str, results_dir: Path, samples: int, 
                       accuracy: bool, duration: float) -> Dict:
        """Generate benchmark report"""
        report_file = self.reports_dir / f"{node}_benchmark_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        
        # Read MLPerf results if available
        summary_file = results_dir / "mlperf_log_summary.txt"
        accuracy_file = results_dir / "mlperf_log_accuracy.json"
        
        report_data = {
            'node': node,
            'timestamp': datetime.now().isoformat(),
            'samples': samples,
            'accuracy_enabled': accuracy,
            'duration_seconds': duration,
            'results_dir': str(results_dir),
            'report_file': str(report_file)
        }
        
        # Parse performance results
        if summary_file.exists():
            with open(summary_file, 'r') as f:
                summary_text = f.read()
                # Extract key metrics
                if 'Samples per second:' in summary_text:
                    for line in summary_text.split('\n'):
                        if 'Samples per second:' in line:
                            try:
                                sps = float(line.split(':')[1].strip())
                                report_data['samples_per_second'] = sps
                            except:
                                pass
        
        # Write report
        with open(report_file, 'w') as f:
            f.write(f"# MLPerf Benchmark Report - {node.upper()}\n\n")
            f.write(f"**Generated**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write(f"## Configuration\n")
            f.write(f"- **Node**: {node}\n")
            f.write(f"- **Samples**: {samples}\n")
            f.write(f"- **Accuracy**: {'Enabled' if accuracy else 'Disabled'}\n")
            f.write(f"- **Duration**: {duration:.1f} seconds\n")
            f.write(f"- **Model**: {self.config.model_name}\n\n")
            
            if summary_file.exists():
                f.write(f"## Performance Results\n")
                with open(summary_file, 'r') as s:
                    f.write(f"```\n{s.read()}```\n\n")
            
            if accuracy_file.exists():
                f.write(f"## Accuracy Results\n")
                f.write(f"- Accuracy log available: `{accuracy_file.name}`\n\n")
            
            f.write(f"## Generated Files\n")
            for file in results_dir.glob("*"):
                if file.is_file():
                    f.write(f"- `{file.name}` ({file.stat().st_size:,} bytes)\n")
        
        logger.info(f"📑 Report generated: {report_file}")
        
        # Also save JSON summary
        json_file = report_file.with_suffix('.json')
        with open(json_file, 'w') as f:
            json.dump(report_data, f, indent=2)
        
        return report_data

def main():
    parser = argparse.ArgumentParser(
        description='Universal MLPerf Benchmark Runner',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run locally with 100 samples
  python3 run_benchmark.py --samples 100
  
  # Run on specific node
  python3 run_benchmark.py --node jw2 --samples 100
  
  # Run with accuracy evaluation
  python3 run_benchmark.py --samples 50 --accuracy
  
  # Quick test
  python3 run_benchmark.py --samples 10
        """
    )
    
    parser.add_argument('--node', type=str, default='local',
                       help='Node to run on (local, jw2, jw3, or configured node name)')
    parser.add_argument('--samples', type=int, default=100,
                       help='Number of samples to process')
    parser.add_argument('--accuracy', action='store_true',
                       help='Enable accuracy evaluation')
    parser.add_argument('--setup-only', action='store_true',
                       help='Only check/setup environment, don\'t run benchmark')
    
    args = parser.parse_args()
    
    # Create runner
    runner = UniversalBenchmarkRunner()
    
    # Print configuration
    logger.info("🔧 MLPerf Universal Benchmark Runner")
    config.print_config()
    
    # Setup environment
    if not runner.setup_environment():
        logger.error("Environment setup failed!")
        sys.exit(1)
    
    if args.setup_only:
        logger.info("✅ Environment setup complete")
        sys.exit(0)
    
    # Run benchmark
    if args.node == 'local':
        success, result = runner.run_local_benchmark(args.samples, args.accuracy)
    else:
        success, result = runner.run_remote_benchmark(args.node, args.samples, args.accuracy)
    
    if success:
        logger.info("🏆 Benchmark completed successfully!")
        if result:
            logger.info(f"Results saved to: {result['results_dir']}")
            logger.info(f"Report available at: {result['report_file']}")
    else:
        logger.error("💥 Benchmark failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()