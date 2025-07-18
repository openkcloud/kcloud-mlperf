#!/usr/bin/env python3
"""
Performance Analyzer for Hybrid GPU+NPU MLPerf Results
Provides comprehensive comparison and analysis tools
"""

import os
import json
import csv
import logging
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import statistics

logger = logging.getLogger(__name__)

@dataclass
class PerformanceMetrics:
    """Performance metrics for a single device/node"""
    device_type: str  # 'nvidia', 'furiosa', etc.
    device_model: str  # 'A30', 'Warboy', etc.
    node_name: str
    scenario: str  # 'server', 'offline'
    
    # Core MLPerf metrics
    qps: float
    latency_p50_ms: float
    latency_p90_ms: float
    latency_p99_ms: float
    tokens_per_second: float
    
    # Resource utilization
    gpu_utilization_pct: float = 0.0
    npu_utilization_pct: float = 0.0
    memory_utilization_pct: float = 0.0
    power_watts: float = 0.0
    
    # Additional metrics
    ttft_ms: float = 0.0  # Time to First Token
    tpot_ms: float = 0.0  # Time Per Output Token
    accuracy_score: float = 0.0
    
    # Cost metrics (if available)
    cost_per_query: float = 0.0
    power_efficiency: float = 0.0  # QPS per Watt

@dataclass
class ComparisonResult:
    """Result of comparing different hardware configurations"""
    baseline_device: str
    comparison_device: str
    scenario: str
    
    qps_improvement: float  # % improvement
    latency_improvement: float  # % improvement (negative = worse)
    efficiency_improvement: float  # QPS/Watt improvement
    cost_effectiveness: float  # Performance per cost unit
    
    recommendation: str
    confidence_score: float

class PerformanceAnalyzer:
    """Analyzes and compares MLPerf results across different hardware"""
    
    def __init__(self, results_dir: str = "./results"):
        self.results_dir = Path(results_dir)
        self.metrics: List[PerformanceMetrics] = []
        self._setup_logging()
    
    def _setup_logging(self):
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
    
    def load_results(self, pattern: str = "mlperf_result_*.json") -> int:
        """Load MLPerf results from files"""
        logger.info(f"🔍 Loading results from {self.results_dir}")
        
        count = 0
        for result_file in self.results_dir.glob(pattern):
            try:
                with open(result_file, 'r') as f:
                    data = json.load(f)
                
                metrics = self._parse_mlperf_result(data, result_file.name)
                if metrics:
                    self.metrics.extend(metrics)
                    count += 1
                    logger.info(f"✅ Loaded {result_file.name}")
                    
            except Exception as e:
                logger.error(f"❌ Failed to load {result_file}: {e}")
        
        logger.info(f"📊 Loaded {len(self.metrics)} performance metrics from {count} files")
        return len(self.metrics)
    
    def _parse_mlperf_result(self, data: Dict[str, Any], filename: str) -> List[PerformanceMetrics]:
        """Parse MLPerf result data into PerformanceMetrics objects"""
        metrics = []
        
        try:
            # Extract device information
            device_info = data.get('device_info', {})
            device_type = device_info.get('accelerator_type', 'unknown')
            device_model = device_info.get('model', 'unknown')
            node_name = data.get('node_name', filename.replace('.json', ''))
            
            # Process each scenario
            for scenario_name, scenario_data in data.get('scenarios', {}).items():
                if not isinstance(scenario_data, dict):
                    continue
                
                # Extract core metrics
                qps = scenario_data.get('queries_per_second', 0.0)
                latencies = scenario_data.get('latency_percentiles', {})
                
                metrics.append(PerformanceMetrics(
                    device_type=device_type,
                    device_model=device_model,
                    node_name=node_name,
                    scenario=scenario_name,
                    qps=qps,
                    latency_p50_ms=latencies.get('50', 0.0),
                    latency_p90_ms=latencies.get('90', 0.0),
                    latency_p99_ms=latencies.get('99', 0.0),
                    tokens_per_second=scenario_data.get('tokens_per_second', 0.0),
                    ttft_ms=scenario_data.get('time_to_first_token_ms', 0.0),
                    tpot_ms=scenario_data.get('time_per_output_token_ms', 0.0),
                    accuracy_score=scenario_data.get('accuracy', 0.0),
                    gpu_utilization_pct=scenario_data.get('gpu_utilization', 0.0),
                    npu_utilization_pct=scenario_data.get('npu_utilization', 0.0),
                    memory_utilization_pct=scenario_data.get('memory_utilization', 0.0),
                    power_watts=scenario_data.get('power_consumption', 0.0)
                ))
                
        except Exception as e:
            logger.error(f"Error parsing {filename}: {e}")
        
        return metrics
    
    def compare_devices(self, device1: str, device2: str, scenario: str = "server") -> Optional[ComparisonResult]:
        """Compare performance between two device types"""
        
        # Find metrics for each device
        metrics1 = [m for m in self.metrics if m.device_type == device1 and m.scenario == scenario]
        metrics2 = [m for m in self.metrics if m.device_type == device2 and m.scenario == scenario]
        
        if not metrics1 or not metrics2:
            logger.warning(f"Insufficient data to compare {device1} vs {device2} for {scenario}")
            return None
        
        # Calculate averages
        avg1 = self._calculate_average_metrics(metrics1)
        avg2 = self._calculate_average_metrics(metrics2)
        
        # Calculate improvements (percentage)
        qps_improvement = ((avg2.qps - avg1.qps) / avg1.qps) * 100 if avg1.qps > 0 else 0
        latency_improvement = ((avg1.latency_p99_ms - avg2.latency_p99_ms) / avg1.latency_p99_ms) * 100 if avg1.latency_p99_ms > 0 else 0
        
        # Calculate efficiency (QPS per Watt)
        eff1 = avg1.qps / avg1.power_watts if avg1.power_watts > 0 else 0
        eff2 = avg2.qps / avg2.power_watts if avg2.power_watts > 0 else 0
        efficiency_improvement = ((eff2 - eff1) / eff1) * 100 if eff1 > 0 else 0
        
        # Generate recommendation
        recommendation = self._generate_recommendation(qps_improvement, latency_improvement, efficiency_improvement)
        confidence_score = self._calculate_confidence(len(metrics1), len(metrics2))
        
        return ComparisonResult(
            baseline_device=device1,
            comparison_device=device2,
            scenario=scenario,
            qps_improvement=qps_improvement,
            latency_improvement=latency_improvement,
            efficiency_improvement=efficiency_improvement,
            cost_effectiveness=0.0,  # Would need cost data
            recommendation=recommendation,
            confidence_score=confidence_score
        )
    
    def _calculate_average_metrics(self, metrics_list: List[PerformanceMetrics]) -> PerformanceMetrics:
        """Calculate average metrics from a list"""
        if not metrics_list:
            raise ValueError("Empty metrics list")
        
        # Use the first metric as template
        template = metrics_list[0]
        
        return PerformanceMetrics(
            device_type=template.device_type,
            device_model=template.device_model,
            node_name="average",
            scenario=template.scenario,
            qps=statistics.mean([m.qps for m in metrics_list]),
            latency_p50_ms=statistics.mean([m.latency_p50_ms for m in metrics_list]),
            latency_p90_ms=statistics.mean([m.latency_p90_ms for m in metrics_list]),
            latency_p99_ms=statistics.mean([m.latency_p99_ms for m in metrics_list]),
            tokens_per_second=statistics.mean([m.tokens_per_second for m in metrics_list]),
            gpu_utilization_pct=statistics.mean([m.gpu_utilization_pct for m in metrics_list]),
            npu_utilization_pct=statistics.mean([m.npu_utilization_pct for m in metrics_list]),
            memory_utilization_pct=statistics.mean([m.memory_utilization_pct for m in metrics_list]),
            power_watts=statistics.mean([m.power_watts for m in metrics_list]),
            ttft_ms=statistics.mean([m.ttft_ms for m in metrics_list]),
            tpot_ms=statistics.mean([m.tpot_ms for m in metrics_list]),
            accuracy_score=statistics.mean([m.accuracy_score for m in metrics_list])
        )
    
    def _generate_recommendation(self, qps_imp: float, lat_imp: float, eff_imp: float) -> str:
        """Generate hardware recommendation based on metrics"""
        if qps_imp > 20 and lat_imp > 0 and eff_imp > 0:
            return "STRONG_RECOMMEND: Significantly better performance and efficiency"
        elif qps_imp > 10 and lat_imp > -10:
            return "RECOMMEND: Better throughput with acceptable latency trade-off"
        elif qps_imp < -10 or lat_imp < -20:
            return "NOT_RECOMMEND: Lower performance or significantly higher latency"
        elif abs(qps_imp) < 5 and abs(lat_imp) < 10:
            return "EQUIVALENT: Similar performance, choose based on cost/availability"
        else:
            return "CONSIDER: Mixed results, evaluate based on specific use case"
    
    def _calculate_confidence(self, n1: int, n2: int) -> float:
        """Calculate confidence score based on sample sizes"""
        min_samples = min(n1, n2)
        if min_samples >= 5:
            return 0.95
        elif min_samples >= 3:
            return 0.80
        elif min_samples >= 2:
            return 0.65
        else:
            return 0.50
    
    def generate_comparison_report(self, output_file: str = "performance_comparison.md") -> str:
        """Generate comprehensive comparison report"""
        
        output_path = self.results_dir / output_file
        
        with open(output_path, 'w') as f:
            f.write("# MLPerf Performance Comparison Report\n\n")
            f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            
            # Summary table
            f.write("## Performance Summary\n\n")
            f.write("| Device | Model | Scenario | QPS | P99 Latency (ms) | Tokens/sec | Utilization |\n")
            f.write("|--------|--------|----------|-----|------------------|------------|-------------|\n")
            
            for metric in self.metrics:
                utilization = max(metric.gpu_utilization_pct, metric.npu_utilization_pct)
                f.write(f"| {metric.device_type} | {metric.device_model} | {metric.scenario} | "
                       f"{metric.qps:.2f} | {metric.latency_p99_ms:.1f} | "
                       f"{metric.tokens_per_second:.1f} | {utilization:.1f}% |\n")
            
            f.write("\n")
            
            # Device comparisons
            device_types = list(set(m.device_type for m in self.metrics))
            
            if len(device_types) >= 2:
                f.write("## Device Comparisons\n\n")
                
                for i, device1 in enumerate(device_types):
                    for device2 in device_types[i+1:]:
                        for scenario in ['server', 'offline']:
                            comparison = self.compare_devices(device1, device2, scenario)
                            if comparison:
                                f.write(f"### {device1.upper()} vs {device2.upper()} ({scenario.title()} Scenario)\n\n")
                                f.write(f"**QPS Improvement**: {comparison.qps_improvement:+.1f}%\n")
                                f.write(f"**Latency Improvement**: {comparison.latency_improvement:+.1f}%\n")
                                f.write(f"**Efficiency Improvement**: {comparison.efficiency_improvement:+.1f}%\n")
                                f.write(f"**Recommendation**: {comparison.recommendation}\n")
                                f.write(f"**Confidence**: {comparison.confidence_score:.0%}\n\n")
            
            # Hardware utilization analysis
            f.write("## Hardware Utilization Analysis\n\n")
            for device_type in device_types:
                device_metrics = [m for m in self.metrics if m.device_type == device_type]
                if device_metrics:
                    avg_util = statistics.mean([max(m.gpu_utilization_pct, m.npu_utilization_pct) for m in device_metrics])
                    f.write(f"**{device_type.upper()}**: Average utilization {avg_util:.1f}%\n")
                    
                    if avg_util < 70:
                        f.write("  - ⚠️ Low utilization detected - consider increasing batch size or concurrent queries\n")
                    elif avg_util > 90:
                        f.write("  - ✅ High utilization - good resource usage\n")
            
            f.write("\n")
            
            # Recommendations
            f.write("## Hardware Selection Recommendations\n\n")
            f.write("Based on the performance analysis:\n\n")
            
            # Find best performer for each scenario
            for scenario in ['server', 'offline']:
                scenario_metrics = [m for m in self.metrics if m.scenario == scenario]
                if scenario_metrics:
                    best_qps = max(scenario_metrics, key=lambda x: x.qps)
                    best_latency = min(scenario_metrics, key=lambda x: x.latency_p99_ms)
                    
                    f.write(f"**{scenario.title()} Scenario**:\n")
                    f.write(f"- Highest QPS: {best_qps.device_type} ({best_qps.qps:.2f} QPS)\n")
                    f.write(f"- Lowest Latency: {best_latency.device_type} ({best_latency.latency_p99_ms:.1f}ms P99)\n\n")
        
        logger.info(f"📋 Generated comparison report: {output_path}")
        return str(output_path)
    
    def export_metrics_csv(self, output_file: str = "performance_metrics.csv") -> str:
        """Export metrics to CSV for further analysis"""
        
        output_path = self.results_dir / output_file
        
        with open(output_path, 'w', newline='') as f:
            if not self.metrics:
                logger.warning("No metrics to export")
                return str(output_path)
            
            writer = csv.DictWriter(f, fieldnames=asdict(self.metrics[0]).keys())
            writer.writeheader()
            
            for metric in self.metrics:
                writer.writerow(asdict(metric))
        
        logger.info(f"📊 Exported {len(self.metrics)} metrics to {output_path}")
        return str(output_path)

def main():
    parser = argparse.ArgumentParser(description="Analyze MLPerf performance results")
    parser.add_argument("--results-dir", default="./results", 
                       help="Directory containing MLPerf result files")
    parser.add_argument("--output-format", choices=["markdown", "csv", "both"], 
                       default="both", help="Output format")
    parser.add_argument("--compare", nargs=2, metavar=("DEVICE1", "DEVICE2"),
                       help="Compare two specific devices")
    parser.add_argument("--scenario", choices=["server", "offline"], default="server",
                       help="Scenario to analyze")
    
    args = parser.parse_args()
    
    analyzer = PerformanceAnalyzer(args.results_dir)
    
    # Load results
    if analyzer.load_results() == 0:
        logger.error("No results found to analyze")
        return 1
    
    # Generate outputs
    if args.output_format in ["markdown", "both"]:
        analyzer.generate_comparison_report()
    
    if args.output_format in ["csv", "both"]:
        analyzer.export_metrics_csv()
    
    # Specific comparison if requested
    if args.compare:
        device1, device2 = args.compare
        comparison = analyzer.compare_devices(device1, device2, args.scenario)
        if comparison:
            print(f"\n🔍 {device1.upper()} vs {device2.upper()} ({args.scenario} scenario):")
            print(f"  QPS Improvement: {comparison.qps_improvement:+.1f}%")
            print(f"  Latency Improvement: {comparison.latency_improvement:+.1f}%")
            print(f"  Recommendation: {comparison.recommendation}")
            print(f"  Confidence: {comparison.confidence_score:.0%}")
        else:
            print(f"❌ Cannot compare {device1} vs {device2} - insufficient data")
    
    return 0

if __name__ == "__main__":
    exit(main())