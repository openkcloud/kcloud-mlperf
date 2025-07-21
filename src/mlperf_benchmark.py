#!/usr/bin/env python3
"""
MLPerf Benchmark Runner - Simplified Unified Interface
Supports single-GPU, multi-GPU, distributed, and datacenter benchmarks
With automated report generation
"""
import os
import sys
import argparse
import importlib.util
from pathlib import Path
from report_generator import MLPerfReportGenerator

def load_benchmark_module(benchmark_type):
    """Dynamically load the appropriate benchmark module"""
    script_mapping = {
        'single': '../run_benchmark_auto.py',
        'coordinated': '../run_coordinated_benchmark.py', 
        'distributed': '../run_distributed_benchmark_simple.py',
        'datacenter': '../run_datacenter_benchmark.py'
    }
    
    if benchmark_type not in script_mapping:
        raise ValueError(f"Unknown benchmark type: {benchmark_type}")
    
    script_path = Path(__file__).parent / script_mapping[benchmark_type]
    
    spec = importlib.util.spec_from_file_location("benchmark", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    
    return module

def main():
    parser = argparse.ArgumentParser(
        description="MLPerf Benchmark Runner - Simplified Interface",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Benchmark Types:
  single      - Single GPU benchmark (default)
  coordinated - Multi-GPU coordinated benchmark  
  distributed - Distributed multi-node benchmark
  datacenter  - MLPerf datacenter benchmark

Examples:
  python src/mlperf_benchmark.py --type single --samples 10
  python src/mlperf_benchmark.py --type coordinated --nodes jw2,jw3
  python src/mlperf_benchmark.py --type distributed --world-size 2
  python src/mlperf_benchmark.py --type datacenter
  python src/mlperf_benchmark.py --type coordinated --no-reports
        """
    )
    
    parser.add_argument(
        '--type', '-t',
        choices=['single', 'coordinated', 'distributed', 'datacenter'],
        default='single',
        help='Type of benchmark to run (default: single)'
    )
    
    parser.add_argument(
        '--samples', '-s',
        type=int,
        default=10,
        help='Number of samples to process (default: 10)'
    )
    
    parser.add_argument(
        '--nodes', '-n',
        type=str,
        help='Comma-separated list of node names (for coordinated benchmarks)'
    )
    
    parser.add_argument(
        '--world-size', '-w',
        type=int,
        default=2,
        help='World size for distributed benchmarks (default: 2)'
    )
    
    parser.add_argument(
        '--config', '-c',
        type=str,
        help='Path to configuration file'
    )
    
    parser.add_argument(
        '--output-dir', '-o',
        type=str,
        default='results/latest',
        help='Output directory for results (default: results/latest)'
    )
    
    parser.add_argument(
        '--list-configs',
        action='store_true',
        help='List available configuration files'
    )
    
    parser.add_argument(
        '--generate-reports',
        action='store_true',
        default=True,
        help='Generate automated reports after benchmark completion (default: True)'
    )
    
    parser.add_argument(
        '--no-reports',
        action='store_true',
        help='Skip report generation'
    )
    
    args = parser.parse_args()
    
    if args.list_configs:
        print("Available configurations:")
        config_dir = Path("configs/benchmark-configs")
        if config_dir.exists():
            for config in config_dir.glob("*.yaml"):
                print(f"  {config.name}")
        return
    
    # Handle report generation settings
    generate_reports = args.generate_reports and not args.no_reports
    
    # Set environment variables based on arguments
    if args.samples:
        os.environ['NUM_SAMPLES'] = str(args.samples)
    
    print(f"🚀 Starting MLPerf {args.type} benchmark...")
    print(f"📊 Configuration:")
    print(f"   Type: {args.type}")
    print(f"   Samples: {args.samples}")
    print(f"   Output: {args.output_dir}")
    print(f"   Reports: {'✅ Enabled' if generate_reports else '❌ Disabled'}")
    
    if args.nodes:
        print(f"   Nodes: {args.nodes}")
    
    if args.config:
        print(f"   Config: {args.config}")
    
    try:
        # Load and run the appropriate benchmark
        benchmark_module = load_benchmark_module(args.type)
        
        # Create output directory
        Path(args.output_dir).mkdir(parents=True, exist_ok=True)
        
        # Run the benchmark
        if hasattr(benchmark_module, 'main'):
            result = benchmark_module.main()
        elif args.type == 'datacenter' and hasattr(benchmark_module, 'run_coordinated_datacenter_benchmark'):
            result = benchmark_module.run_coordinated_datacenter_benchmark()
        else:
            print("❌ Error: Benchmark module does not have a main() function")
            return 1
            
        print(f"✅ Benchmark completed successfully!")
        
        # Generate reports if enabled
        if generate_reports:
            print(f"📊 Generating automated reports...")
            try:
                report_generator = MLPerfReportGenerator(
                    results_dir=args.output_dir
                )
                report_generator.generate_all_reports()
                print(f"✅ Reports generated successfully!")
            except Exception as e:
                print(f"⚠️ Report generation failed: {e}")
                print("🔍 Benchmark completed but reports unavailable")
        
        return result if result is not None else 0
        
    except Exception as e:
        print(f"❌ Error running benchmark: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())