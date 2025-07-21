#!/usr/bin/env python3
"""
Centralized MLPerf Report Generator
Generates comprehensive reports from benchmark results
"""

import os
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional
from config import config

class MLPerfReportGenerator:
    """Generate comprehensive reports from MLPerf benchmark results"""
    
    def __init__(self):
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.report_dir = config.reports_dir / self.timestamp
        self.report_dir.mkdir(parents=True, exist_ok=True)
        
    def collect_all_results(self) -> Dict[str, Any]:
        """Collect all benchmark results from the results directory"""
        all_results = {
            "datacenter": [],
            "coordinated": [],
            "distributed": [],
            "distributed_simple": []
        }
        
        # Scan results directory for benchmark outputs
        for benchmark_type in all_results.keys():
            pattern = f"{benchmark_type}_*"
            benchmark_dirs = list(config.results_dir.glob(pattern))
            
            for benchmark_dir in benchmark_dirs:
                if benchmark_dir.is_dir():
                    results = self._load_benchmark_results(benchmark_dir, benchmark_type)
                    if results:
                        all_results[benchmark_type].append(results)
        
        return all_results
    
    def _load_benchmark_results(self, result_dir: Path, benchmark_type: str) -> Optional[Dict]:
        """Load results from a specific benchmark directory"""
        try:
            # Look for JSON result files
            json_files = list(result_dir.glob("*.json"))
            if not json_files:
                return None
            
            # Load the first JSON file (or aggregate if multiple)
            if len(json_files) == 1:
                with open(json_files[0], 'r') as f:
                    data = json.load(f)
            else:
                # Multiple files - aggregate them
                data = {"aggregated_results": []}
                for json_file in json_files:
                    with open(json_file, 'r') as f:
                        data["aggregated_results"].append(json.load(f))
            
            # Add metadata
            data["benchmark_type"] = benchmark_type
            data["result_directory"] = str(result_dir)
            data["timestamp"] = result_dir.name.split("_")[-1] if "_" in result_dir.name else "unknown"
            
            return data
        except Exception as e:
            print(f"Error loading results from {result_dir}: {e}")
            return None
    
    def generate_summary_report(self, all_results: Dict[str, Any]) -> str:
        """Generate a comprehensive summary report"""
        
        # Calculate overall status
        total_benchmarks = sum(len(results) for results in all_results.values())
        passed_benchmarks = 0
        failed_benchmarks = 0
        
        # Quick scan for pass/fail counts
        for benchmark_type, results in all_results.items():
            for result in results:
                scenarios = result.get("scenarios", {})
                if scenarios:
                    for scenario_data in scenarios.values():
                        if scenario_data.get('valid', False):
                            passed_benchmarks += 1
                        else:
                            failed_benchmarks += 1
                else:
                    failed_benchmarks += 1
        
        overall_status = "✅ ALL PASSED" if failed_benchmarks == 0 else f"❌ {failed_benchmarks} FAILED, {passed_benchmarks} PASSED"
        
        report_lines = [
            "# 🎯 MLPerf Benchmark Results Summary",
            "",
            f"## 📊 **OVERALL STATUS: {overall_status}**",
            "",
            f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  ",
            f"**Project:** {config.project_root}  ",
            f"**Total Scenarios:** {passed_benchmarks + failed_benchmarks}  ",
            "",
            "---",
            "",
            "## ⚙️ Environment Configuration",
            f"- **Model:** {config.model_name}",
            f"- **Max Tokens:** {config.max_tokens}",
            f"- **Server Target QPS:** {config.server_target_qps}",
            f"- **Offline Target QPS:** {config.offline_target_qps}",
            "",
            "## 🖥️ Node Configuration",
        ]
        
        for node_name, node_ip in config.nodes.items():
            report_lines.append(f"- **{node_name}:** {node_ip}")
        
        report_lines.extend([
            "",
            "---",
            "",
            "## 📈 Benchmark Results",
            ""
        ])
        
        # Process each benchmark type
        for benchmark_type, results in all_results.items():
            if not results:
                report_lines.extend([
                    f"### 🔍 {benchmark_type.title()} Benchmarks",
                    "❌ **NO RESULTS FOUND**",
                    "",
                    "---",
                    ""
                ])
                continue
                
            # Calculate pass/fail for this benchmark type
            type_passed = 0
            type_failed = 0
            for result in results:
                scenarios = result.get("scenarios", {})
                if scenarios:
                    for scenario_data in scenarios.values():
                        if scenario_data.get('valid', False):
                            type_passed += 1
                        else:
                            type_failed += 1
                else:
                    type_failed += 1
            
            type_status = "✅ ALL PASSED" if type_failed == 0 else f"❌ {type_failed} FAILED, {type_passed} PASSED"
            
            report_lines.extend([
                f"### 🔍 {benchmark_type.title()} Benchmarks",
                f"**Status:** {type_status}  ",
                f"**Total runs:** {len(results)}  ",
                "",
            ])
            
            for i, result in enumerate(results, 1):
                report_lines.append(f"#### 📋 Run {i} - {result.get('timestamp', 'Unknown')}")
                
                if benchmark_type == "datacenter":
                    self._add_datacenter_summary(report_lines, result)
                elif benchmark_type in ["coordinated", "distributed", "distributed_simple"]:
                    self._add_multi_gpu_summary(report_lines, result)
                
                report_lines.extend(["", "---", ""])
        
        return "\n".join(report_lines)
    
    def _add_datacenter_summary(self, report_lines: List[str], result: Dict):
        """Add datacenter benchmark summary"""
        scenarios = result.get("scenarios", {})
        
        if not scenarios:
            report_lines.extend([
                "❌ **FAILED** - No scenario results found",
                "- Status: BENCHMARK FAILED",
                "- Error: No valid scenarios completed",
                ""
            ])
            return
        
        for scenario_name, scenario_data in scenarios.items():
            # Determine pass/fail status
            is_valid = scenario_data.get('valid', False)
            status_icon = "✅" if is_valid else "❌"
            status_text = "PASSED" if is_valid else "FAILED"
            
            # Get metrics with fallbacks
            achieved_qps = scenario_data.get('achieved_qps', 'N/A')
            latency_p99 = scenario_data.get('latency_p99', 'N/A')
            accuracy = scenario_data.get('accuracy', 'N/A')
            
            report_lines.extend([
                f"{status_icon} **{scenario_name} Scenario: {status_text}**",
                f"- **Valid:** {is_valid}",
                f"- **Achieved QPS:** {achieved_qps}",
                f"- **Latency P99:** {latency_p99}ms" if latency_p99 != 'N/A' else f"- **Latency P99:** {latency_p99}",
                f"- **Accuracy:** {accuracy}",
                ""
            ])
    
    def _add_multi_gpu_summary(self, report_lines: List[str], result: Dict):
        """Add multi-GPU benchmark summary (Server scenario only)"""
        if "aggregated_results" in result:
            total_throughput = 0
            total_qps = 0
            node_count = len(result["aggregated_results"])
            
            report_lines.append(f"**Multi-GPU Server Results ({node_count} nodes):**")
            
            for node_result in result["aggregated_results"]:
                node_name = node_result.get("node_name", "Unknown")
                
                # Extract server scenario metrics
                server_data = node_result.get("scenarios", {}).get("Server", {})
                qps = server_data.get("achieved_qps", 0)
                throughput = server_data.get("throughput_tokens_per_sec", 0)
                is_valid = server_data.get("valid", False)
                status = "✅ VALID" if is_valid else "❌ INVALID"
                
                total_qps += qps
                total_throughput += throughput
                
                report_lines.append(f"- {node_name}: {status} - QPS: {qps:.2f}, Throughput: {throughput:.2f} tokens/sec")
            
            report_lines.extend([
                f"- **Combined Server QPS: {total_qps:.2f}**",
                f"- **Total Throughput: {total_throughput:.2f} tokens/sec**",
                f"- **Average per GPU: {total_throughput/node_count:.2f} tokens/sec**",
                ""
            ])
        else:
            # Single result - extract server scenario data
            server_data = result.get("scenarios", {}).get("Server", {})
            qps = server_data.get("achieved_qps", "N/A")
            throughput = server_data.get("throughput_tokens_per_sec", "N/A")
            latency_p99 = server_data.get("latency_p99", "N/A")
            report_lines.extend([
                f"- Server QPS: {qps}",
                f"- Throughput: {throughput} tokens/sec",
                f"- Latency P99: {latency_p99}ms",
                ""
            ])
    
    def generate_detailed_report(self, all_results: Dict[str, Any]) -> str:
        """Generate detailed JSON report"""
        detailed_report = {
            "generation_info": {
                "timestamp": self.timestamp,
                "generator": "MLPerf Report Generator v1.0",
                "project_root": str(config.project_root),
                "configuration": {
                    "model_name": config.model_name,
                    "max_tokens": config.max_tokens,
                    "server_target_qps": config.server_target_qps,
                    "offline_target_qps": config.offline_target_qps,
                    "nodes": config.nodes
                }
            },
            "results": all_results,
            "summary_statistics": self._calculate_summary_stats(all_results)
        }
        
        return json.dumps(detailed_report, indent=2)
    
    def _calculate_summary_stats(self, all_results: Dict[str, Any]) -> Dict:
        """Calculate summary statistics across all benchmarks"""
        stats = {
            "total_benchmarks": sum(len(results) for results in all_results.values()),
            "benchmark_types": list(all_results.keys()),
            "latest_runs": {}
        }
        
        # Find latest run for each benchmark type
        for benchmark_type, results in all_results.items():
            if results:
                latest = max(results, key=lambda x: x.get("timestamp", ""))
                stats["latest_runs"][benchmark_type] = {
                    "timestamp": latest.get("timestamp"),
                    "directory": latest.get("result_directory")
                }
        
        return stats
    
    def save_reports(self) -> Dict[str, Path]:
        """Save all generated reports and return file paths"""
        all_results = self.collect_all_results()
        
        # Generate reports
        summary_md = self.generate_summary_report(all_results)
        detailed_json = self.generate_detailed_report(all_results)
        
        # Save files
        summary_file = self.report_dir / "summary_report.md"
        detailed_file = self.report_dir / "detailed_report.json"
        
        with open(summary_file, 'w') as f:
            f.write(summary_md)
        
        with open(detailed_file, 'w') as f:
            f.write(detailed_json)
        
        # Create latest symlinks
        latest_summary = config.reports_dir / "latest_summary.md"
        latest_detailed = config.reports_dir / "latest_detailed.json"
        
        # Remove existing symlinks if they exist
        for symlink in [latest_summary, latest_detailed]:
            if symlink.exists() or symlink.is_symlink():
                symlink.unlink()
        
        # Create new symlinks
        latest_summary.symlink_to(summary_file.relative_to(config.reports_dir))
        latest_detailed.symlink_to(detailed_file.relative_to(config.reports_dir))
        
        return {
            "summary": summary_file,
            "detailed": detailed_file,
            "latest_summary": latest_summary,
            "latest_detailed": latest_detailed
        }

def main():
    """Main function to generate reports"""
    print("🎯 Generating MLPerf Benchmark Reports...")
    
    generator = MLPerfReportGenerator()
    report_files = generator.save_reports()
    
    print("✅ Reports generated successfully:")
    for report_type, file_path in report_files.items():
        print(f"   {report_type}: {file_path}")
    
    return report_files

if __name__ == "__main__":
    main()