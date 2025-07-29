#!/usr/bin/env python3
"""
MLPerf Report Generator
=======================

Generates comprehensive reports from MLPerf benchmark results.
Supports both mlcr output and custom benchmark results.
"""

import os
import json
import argparse
from pathlib import Path
from datetime import datetime
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MLPerfReportGenerator:
    def __init__(self, input_dir, output_dir):
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
    def parse_mlcr_output(self):
        """Parse mlcr command output files"""
        logger.info("🔍 Parsing mlcr output files...")
        
        results = {
            "performance": {},
            "accuracy": {},
            "logs": {}
        }
        
        # Look for common MLPerf output files
        mlperf_files = [
            "mlperf_log_summary.txt",
            "mlperf_log_detail.txt", 
            "mlperf_log_accuracy.json",
            "mlperf_log_trace.json"
        ]
        
        for file_name in mlperf_files:
            file_path = self.input_dir / file_name
            if file_path.exists():
                try:
                    if file_name.endswith('.json'):
                        with open(file_path) as f:
                            results["logs"][file_name] = json.load(f)
                    else:
                        with open(file_path) as f:
                            results["logs"][file_name] = f.read()
                    logger.info(f"✅ Parsed {file_name}")
                except Exception as e:
                    logger.warning(f"⚠️  Failed to parse {file_name}: {e}")
        
        # Parse performance metrics from summary
        if "mlperf_log_summary.txt" in results["logs"]:
            summary_text = results["logs"]["mlperf_log_summary.txt"]
            results["performance"] = self._extract_performance_metrics(summary_text)
        
        # Parse accuracy metrics from accuracy log
        if "mlperf_log_accuracy.json" in results["logs"]:
            accuracy_data = results["logs"]["mlperf_log_accuracy.json"]
            results["accuracy"] = self._calculate_accuracy_metrics(accuracy_data)
            
        return results
    
    def _extract_performance_metrics(self, summary_text):
        """Extract performance metrics from MLPerf summary"""
        metrics = {}
        
        lines = summary_text.split('\n')
        for line in lines:
            if 'samples per second' in line.lower():
                # Extract throughput
                parts = line.split(':')
                if len(parts) >= 2:
                    try:
                        throughput = float(parts[1].strip().split()[0])
                        metrics['throughput_samples_per_second'] = throughput
                    except:
                        pass
            elif 'latency' in line.lower():
                # Extract latency metrics
                parts = line.split(':')
                if len(parts) >= 2:
                    try:
                        latency = float(parts[1].strip().split()[0])
                        if 'mean' in line.lower():
                            metrics['mean_latency_ms'] = latency
                        elif 'p50' in line.lower():
                            metrics['p50_latency_ms'] = latency
                        elif 'p90' in line.lower():
                            metrics['p90_latency_ms'] = latency
                        elif 'p99' in line.lower():
                            metrics['p99_latency_ms'] = latency
                    except:
                        pass
        
        return metrics
    
    def _calculate_accuracy_metrics(self, accuracy_data):
        """Calculate accuracy metrics from MLPerf accuracy log"""
        if not accuracy_data:
            return {}
        
        try:
            # Calculate ROUGE scores if predictions are available
            from rouge_score import rouge_scorer
            
            predictions = []
            references = []
            
            for entry in accuracy_data:
                if 'prediction' in entry and 'reference' in entry:
                    predictions.append(entry['prediction'])
                    references.append(entry['reference'])
            
            if predictions and references:
                scorer = rouge_scorer.RougeScorer(['rouge1', 'rouge2', 'rougeL'], use_stemmer=True)
                rouge_scores = {"rouge1": [], "rouge2": [], "rougeL": []}
                
                for pred, ref in zip(predictions, references):
                    scores = scorer.score(ref, pred)
                    rouge_scores["rouge1"].append(scores["rouge1"].fmeasure)
                    rouge_scores["rouge2"].append(scores["rouge2"].fmeasure)
                    rouge_scores["rougeL"].append(scores["rougeL"].fmeasure)
                
                return {
                    "rouge1": sum(rouge_scores["rouge1"]) / len(rouge_scores["rouge1"]),
                    "rouge2": sum(rouge_scores["rouge2"]) / len(rouge_scores["rouge2"]),
                    "rougeL": sum(rouge_scores["rougeL"]) / len(rouge_scores["rougeL"]),
                    "samples_evaluated": len(predictions)
                }
        except Exception as e:
            logger.warning(f"⚠️  Accuracy calculation failed: {e}")
        
        return {"samples_evaluated": len(accuracy_data) if isinstance(accuracy_data, list) else 0}
    
    def parse_custom_results(self):
        """Parse custom benchmark results"""
        logger.info("🔍 Parsing custom benchmark results...")
        
        # Look for JSON result files
        result_files = list(self.input_dir.glob("benchmark_results_*.json"))
        
        if not result_files:
            logger.warning("⚠️  No custom result files found")
            return {}
        
        # Use the most recent result file
        latest_file = max(result_files, key=lambda x: x.stat().st_mtime)
        
        try:
            with open(latest_file) as f:
                results = json.load(f)
            logger.info(f"✅ Parsed custom results from {latest_file.name}")
            return results
        except Exception as e:
            logger.error(f"❌ Failed to parse custom results: {e}")
            return {}
    
    def generate_html_report(self, results):
        """Generate HTML report"""
        logger.info("📋 Generating HTML report...")
        
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MLPerf LLaMA3.1-8B Benchmark Report</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 40px; background-color: #f5f5f5; }}
        .container {{ max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
        h1 {{ color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }}
        h2 {{ color: #34495e; margin-top: 30px; }}
        .metric-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }}
        .metric-card {{ background: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 4px solid #3498db; }}
        .metric-value {{ font-size: 24px; font-weight: bold; color: #2c3e50; }}
        .metric-label {{ color: #7f8c8d; font-size: 14px; margin-top: 5px; }}
        .info-section {{ background: #ecf0f1; padding: 15px; border-radius: 6px; margin: 15px 0; }}
        .accuracy-scores {{ background: #e8f5e8; padding: 15px; border-radius: 6px; border-left: 4px solid #27ae60; }}
        .performance-metrics {{ background: #fff3cd; padding: 15px; border-radius: 6px; border-left: 4px solid #ffc107; }}
        table {{ width: 100%; border-collapse: collapse; margin: 15px 0; }}
        th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }}
        th {{ background-color: #f8f9fa; font-weight: bold; }}
        .timestamp {{ color: #7f8c8d; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 MLPerf LLaMA3.1-8B Benchmark Report</h1>
        <p class="timestamp">Generated on: {timestamp}</p>
        
        <div class="info-section">
            <h2>📊 Benchmark Information</h2>
            <p><strong>Model:</strong> meta-llama/Llama-3.1-8B-Instruct</p>
            <p><strong>Dataset:</strong> CNN-DailyMail</p>
            <p><strong>Framework:</strong> VLLM</p>
            <p><strong>Device:</strong> CUDA</p>
        </div>
"""
        
        # Add performance metrics
        if 'performance' in results and results['performance']:
            perf_data = results['performance']
            html_content += """
        <div class="performance-metrics">
            <h2>⚡ Performance Metrics</h2>
            <div class="metric-grid">
"""
            
            if 'throughput_samples_per_second' in perf_data:
                html_content += f"""
                <div class="metric-card">
                    <div class="metric-value">{perf_data['throughput_samples_per_second']:.2f}</div>
                    <div class="metric-label">Samples/Second</div>
                </div>
"""
            
            if 'total_time_seconds' in perf_data:
                html_content += f"""
                <div class="metric-card">
                    <div class="metric-value">{perf_data['total_time_seconds']:.1f}s</div>
                    <div class="metric-label">Total Time</div>
                </div>
"""
            
            if 'samples_processed' in perf_data:
                html_content += f"""
                <div class="metric-card">
                    <div class="metric-value">{perf_data['samples_processed']}</div>
                    <div class="metric-label">Samples Processed</div>
                </div>
"""
            
            html_content += "</div></div>"
        
        # Add accuracy metrics
        if 'accuracy' in results and results['accuracy']:
            acc_data = results['accuracy']
            html_content += """
        <div class="accuracy-scores">
            <h2>🎯 Accuracy Metrics</h2>
            <div class="metric-grid">
"""
            
            if 'rouge_scores' in acc_data:
                rouge_scores = acc_data['rouge_scores']
                for metric, score in rouge_scores.items():
                    html_content += f"""
                <div class="metric-card">
                    <div class="metric-value">{score:.4f}</div>
                    <div class="metric-label">{metric.upper()}</div>
                </div>
"""
            elif 'rouge1' in acc_data:
                # Direct ROUGE scores
                for metric in ['rouge1', 'rouge2', 'rougeL']:
                    if metric in acc_data:
                        html_content += f"""
                <div class="metric-card">
                    <div class="metric-value">{acc_data[metric]:.4f}</div>
                    <div class="metric-label">{metric.upper()}</div>
                </div>
"""
            
            html_content += "</div></div>"
        
        # Add system information
        html_content += """
        <div class="info-section">
            <h2>💻 System Information</h2>
            <table>
                <tr><th>Property</th><th>Value</th></tr>
"""
        
        # Try to get system info
        try:
            import torch
            if torch.cuda.is_available():
                gpu_name = torch.cuda.get_device_name(0)
                gpu_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
                html_content += f"""
                <tr><td>GPU</td><td>{gpu_name}</td></tr>
                <tr><td>GPU Memory</td><td>{gpu_memory:.1f} GB</td></tr>
"""
        except:
            pass
        
        html_content += """
            </table>
        </div>
    </div>
</body>
</html>
"""
        
        # Save HTML report
        timestamp_file = datetime.now().strftime("%Y%m%d_%H%M%S")
        html_file = self.output_dir / f"mlperf_report_{timestamp_file}.html"
        
        with open(html_file, 'w') as f:
            f.write(html_content)
        
        logger.info(f"✅ HTML report saved to: {html_file}")
        return html_file
    
    def generate_json_report(self, results):
        """Generate JSON report"""
        logger.info("📋 Generating JSON report...")
        
        # Create comprehensive report
        report = {
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "benchmark_type": "MLPerf LLaMA3.1-8B Inference",
                "model": "meta-llama/Llama-3.1-8B-Instruct",
                "dataset": "CNN-DailyMail",
                "framework": "VLLM"
            },
            "results": results,
            "summary": {
                "performance_completed": bool(results.get('performance')),
                "accuracy_completed": bool(results.get('accuracy')),
                "total_samples": results.get('metadata', {}).get('samples', 0)
            }
        }
        
        # Save JSON report
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        json_file = self.output_dir / f"mlperf_report_{timestamp}.json"
        
        with open(json_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        logger.info(f"✅ JSON report saved to: {json_file}")
        return json_file
    
    def generate_reports(self):
        """Generate all reports"""
        logger.info("🎯 Starting report generation...")
        
        # Try to parse mlcr output first
        results = self.parse_mlcr_output()
        
        # If no mlcr results, try custom results
        if not results or not any(results.values()):
            results = self.parse_custom_results()
        
        if not results:
            logger.error("❌ No results found to generate reports")
            return False
        
        # Generate reports
        try:
            html_file = self.generate_html_report(results)
            json_file = self.generate_json_report(results)
            
            logger.info("🎉 Report generation completed successfully!")
            logger.info(f"📋 HTML Report: {html_file}")
            logger.info(f"📋 JSON Report: {json_file}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Report generation failed: {e}")
            return False

def main():
    parser = argparse.ArgumentParser(description="MLPerf Report Generator")
    parser.add_argument("--input-dir", required=True, help="Input directory with benchmark results")
    parser.add_argument("--output-dir", required=True, help="Output directory for reports")
    
    args = parser.parse_args()
    
    generator = MLPerfReportGenerator(args.input_dir, args.output_dir)
    success = generator.generate_reports()
    
    return 0 if success else 1

if __name__ == "__main__":
    exit(main())