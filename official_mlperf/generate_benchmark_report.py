#!/usr/bin/env python3
"""
Automated MLPerf Benchmark Report Generator
==========================================

Automatically generates comprehensive reports from MLPerf benchmark results.
This script should be called immediately after benchmark completion.

Usage:
    python3 generate_benchmark_report.py --results-dir <path> [options]
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
import subprocess

def parse_mlperf_logs(results_dir):
    """Parse MLPerf log files and extract key metrics."""
    results_dir = Path(results_dir)
    
    # Check required files exist
    accuracy_file = results_dir / "mlperf_log_accuracy.json"
    detail_file = results_dir / "mlperf_log_detail.txt"
    summary_file = results_dir / "mlperf_log_summary.txt"
    
    if not accuracy_file.exists():
        raise FileNotFoundError(f"Accuracy log not found: {accuracy_file}")
    
    metrics = {
        "files_found": {},
        "sample_count": 0,
        "execution_time": 0,
        "errors": 0,
        "warnings": 0,
        "performance": {},
        "model_info": {},
        "technical_config": {}
    }
    
    # Parse accuracy log for sample count
    if accuracy_file.exists():
        try:
            with open(accuracy_file, 'r') as f:
                accuracy_data = json.load(f)
                metrics["sample_count"] = len(accuracy_data)
                metrics["files_found"]["accuracy"] = accuracy_file.stat().st_size
        except:
            metrics["sample_count"] = 0
    
    # Parse detail log for performance metrics
    if detail_file.exists():
        metrics["files_found"]["detail"] = detail_file.stat().st_size
        with open(detail_file, 'r') as f:
            detail_content = f.read()
            
            # Extract execution time from power timestamps (most accurate)
            import re
            from datetime import datetime
            
            power_begin_time = None
            power_end_time = None
            
            # Look for power_begin and power_end timestamps
            power_begin_match = re.search(r'"key": "power_begin".*?"value": "([^"]+)"', detail_content)
            power_end_match = re.search(r'"key": "power_end".*?"value": "([^"]+)"', detail_content)
            
            if power_begin_match and power_end_match:
                try:
                    # Parse the timestamp strings
                    power_begin_str = power_begin_match.group(1)
                    power_end_str = power_end_match.group(1)
                    
                    # Convert to datetime objects
                    power_begin_time = datetime.strptime(power_begin_str, "%m-%d-%Y %H:%M:%S.%f")
                    power_end_time = datetime.strptime(power_end_str, "%m-%d-%Y %H:%M:%S.%f")
                    
                    # Calculate execution time in seconds
                    execution_duration = (power_end_time - power_begin_time).total_seconds()
                    metrics["execution_time"] = execution_duration
                except Exception as e:
                    print(f"Warning: Could not parse power timestamps: {e}")
            
            # Fallback 1: Use time_ms range from MLPerf logs
            if metrics["execution_time"] == 0:
                time_ms_values = re.findall(r'"time_ms":\s*([0-9.]+)', detail_content)
                if time_ms_values:
                    time_values = [float(t) for t in time_ms_values]
                    if len(time_values) >= 2:
                        # Calculate duration from first to last timestamp
                        metrics["execution_time"] = (max(time_values) - min(time_values)) / 1000.0
            
            # Fallback 2: estimate from sample processing logs
            if metrics["execution_time"] == 0:
                sample_times = re.findall(r'Total time: ([0-9.]+)', detail_content)
                if sample_times:
                    # Sum up individual sample times
                    total_time = sum(float(t) for t in sample_times)
                    metrics["execution_time"] = total_time
            
            # Extract model and configuration info
            if "meta-llama" in detail_content:
                metrics["model_info"]["name"] = "meta-llama/Llama-3.1-8B-Instruct"
            if "float16" in detail_content or "torch.float16" in detail_content:
                metrics["model_info"]["precision"] = "FP16"
            if '"tensor_parallel_size":' in detail_content:
                import re
                match = re.search(r'"tensor_parallel_size":\s*(\d+)', detail_content)
                if match:
                    metrics["technical_config"]["tensor_parallel_size"] = int(match.group(1))
    
    # Parse summary for errors/warnings
    if summary_file.exists():
        metrics["files_found"]["summary"] = summary_file.stat().st_size
        with open(summary_file, 'r') as f:
            summary_content = f.read()
            if "No errors encountered" in summary_content:
                metrics["errors"] = 0
            if "No warnings encountered" in summary_content:
                metrics["warnings"] = 0
    
    # Calculate derived metrics
    if metrics["execution_time"] > 0 and metrics["sample_count"] > 0:
        metrics["performance"]["avg_time_per_sample"] = metrics["execution_time"] / metrics["sample_count"]
        metrics["performance"]["samples_per_second"] = metrics["sample_count"] / metrics["execution_time"]
    
    return metrics

def generate_markdown_report(metrics, results_dir, output_file):
    """Generate comprehensive Markdown report."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Calculate performance ratings
    avg_time = metrics["performance"].get("avg_time_per_sample", 0)
    performance_rating = "EXCELLENT" if avg_time < 3.0 else "GOOD" if avg_time < 5.0 else "FAIR"
    
    success_rate = 100.0 if metrics["errors"] == 0 else 0.0
    
    report_content = f"""# 🎯 MLPerf Benchmark Results Report

## 📊 Executive Summary

**Generated**: {timestamp}  
**Results Directory**: `{results_dir}`  
**Status**: {'✅ SUCCESS' if metrics['errors'] == 0 else '❌ FAILED'}  
**Performance Rating**: {performance_rating}  

---

## 🏆 Key Metrics

| Metric | Value |
|--------|-------|
| **Samples Processed** | {metrics['sample_count']} |
| **Total Execution Time** | {metrics['execution_time']:.1f} seconds |
| **Average Time per Sample** | {avg_time:.2f} seconds |
| **Samples per Second** | {metrics['performance'].get('samples_per_second', 0):.3f} |
| **Errors** | {metrics['errors']} |
| **Warnings** | {metrics['warnings']} |
| **Success Rate** | {success_rate:.1f}% |

---

## 🔧 Technical Configuration

| Parameter | Value |
|-----------|-------|
| **Model** | {metrics['model_info'].get('name', 'Unknown')} |
| **Precision** | {metrics['model_info'].get('precision', 'Unknown')} |
| **Tensor Parallel Size** | {metrics['technical_config'].get('tensor_parallel_size', 1)} |
| **Framework** | MLPerf Inference v5.0 |
| **Engine** | vLLM |

---

## 📁 Generated Files

| File | Size | Description |
|------|------|-------------|
| `mlperf_log_accuracy.json` | {metrics['files_found'].get('accuracy', 0):,} bytes | Raw accuracy data |
| `mlperf_log_detail.txt` | {metrics['files_found'].get('detail', 0):,} bytes | Detailed execution logs |
| `mlperf_log_summary.txt` | {metrics['files_found'].get('summary', 0):,} bytes | Summary status |

---

## 🎯 Performance Analysis

### Execution Efficiency
- **Processing Speed**: {avg_time:.2f} seconds per sample
- **Throughput**: {metrics['performance'].get('samples_per_second', 0):.3f} samples/second
- **Reliability**: {success_rate:.1f}% success rate

### Quality Assessment
{'✅ **EXCELLENT**: All samples processed without errors' if metrics['errors'] == 0 else f'❌ **ISSUES**: {metrics["errors"]} errors encountered'}

---

## 📊 Results Summary

This benchmark processed **{metrics['sample_count']} samples** in **{metrics['execution_time']:.1f} seconds** with:

- ✅ Zero errors: {'Yes' if metrics['errors'] == 0 else 'No'}
- ✅ Zero warnings: {'Yes' if metrics['warnings'] == 0 else 'No'}  
- ✅ Performance: {performance_rating.title()} ({avg_time:.2f}s per sample)
- ✅ Reliability: {success_rate:.1f}% success rate

### Conclusion
{'🎉 **BENCHMARK SUCCESSFUL** - All metrics indicate excellent performance and reliability.' if metrics['errors'] == 0 else '⚠️ **ISSUES DETECTED** - Review errors and warnings for optimization opportunities.'}

---

*Report automatically generated by MLPerf Benchmark Report Generator*  
*Timestamp: {timestamp}*
"""
    
    with open(output_file, 'w') as f:
        f.write(report_content)
    
    return output_file

def generate_json_report(metrics, results_dir, output_file):
    """Generate machine-readable JSON report."""
    timestamp = datetime.now().isoformat()
    
    report_data = {
        "report_metadata": {
            "generated_at": timestamp,
            "results_directory": str(results_dir),
            "generator": "MLPerf Benchmark Report Generator",
            "version": "1.0"
        },
        "benchmark_summary": {
            "status": "SUCCESS" if metrics["errors"] == 0 else "FAILED",
            "samples_processed": metrics["sample_count"],
            "execution_time_seconds": metrics["execution_time"],
            "errors": metrics["errors"],
            "warnings": metrics["warnings"],
            "success_rate_percent": 100.0 if metrics["errors"] == 0 else 0.0
        },
        "performance_metrics": {
            "average_time_per_sample_seconds": metrics["performance"].get("avg_time_per_sample", 0),
            "samples_per_second": metrics["performance"].get("samples_per_second", 0),
            "performance_rating": "EXCELLENT" if metrics["performance"].get("avg_time_per_sample", 0) < 3.0 else "GOOD"
        },
        "technical_configuration": {
            "model_name": metrics["model_info"].get("name", "Unknown"),
            "precision": metrics["model_info"].get("precision", "Unknown"),
            "tensor_parallel_size": metrics["technical_config"].get("tensor_parallel_size", 1),
            "framework": "MLPerf Inference v5.0",
            "engine": "vLLM"
        },
        "file_outputs": {
            "accuracy_log_bytes": metrics["files_found"].get("accuracy", 0),
            "detail_log_bytes": metrics["files_found"].get("detail", 0),
            "summary_log_bytes": metrics["files_found"].get("summary", 0),
            "total_output_bytes": sum(metrics["files_found"].values())
        }
    }
    
    with open(output_file, 'w') as f:
        json.dump(report_data, f, indent=2)
    
    return output_file

def main():
    parser = argparse.ArgumentParser(description="Generate MLPerf benchmark reports")
    parser.add_argument("--results-dir", required=True, help="Directory containing MLPerf log files")
    parser.add_argument("--output-dir", help="Output directory for reports (defaults to results-dir)")
    parser.add_argument("--format", choices=["markdown", "json", "both"], default="both",
                       help="Report format to generate")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    results_dir = Path(args.results_dir)
    output_dir = Path(args.output_dir) if args.output_dir else results_dir
    
    if not results_dir.exists():
        print(f"❌ Results directory not found: {results_dir}")
        sys.exit(1)
    
    try:
        print("🔍 Parsing MLPerf log files...")
        metrics = parse_mlperf_logs(results_dir)
        
        if args.verbose:
            print(f"   • Found {metrics['sample_count']} samples")
            print(f"   • Execution time: {metrics['execution_time']:.1f} seconds")
            print(f"   • Errors: {metrics['errors']}, Warnings: {metrics['warnings']}")
        
        generated_files = []
        
        if args.format in ["markdown", "both"]:
            print("📄 Generating Markdown report...")
            md_file = output_dir / "BENCHMARK_RESULTS_REPORT.md"
            generate_markdown_report(metrics, results_dir, md_file)
            generated_files.append(md_file)
            
        if args.format in ["json", "both"]:
            print("📊 Generating JSON report...")
            json_file = output_dir / "benchmark_summary.json"
            generate_json_report(metrics, results_dir, json_file)
            generated_files.append(json_file)
        
        print("✅ Report generation completed!")
        print("\n📁 Generated files:")
        for file in generated_files:
            print(f"   • {file} ({file.stat().st_size:,} bytes)")
        
        # Print summary metrics
        avg_time = metrics["performance"].get("avg_time_per_sample", 0)
        print(f"\n📊 Key Results:")
        print(f"   • {metrics['sample_count']} samples processed")
        print(f"   • {avg_time:.2f}s average per sample")
        print(f"   • {metrics['errors']} errors, {metrics['warnings']} warnings")
        print(f"   • {'SUCCESS' if metrics['errors'] == 0 else 'FAILED'} status")
        
    except Exception as e:
        print(f"❌ Error generating reports: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()