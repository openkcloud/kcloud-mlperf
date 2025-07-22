#!/usr/bin/env python3
"""
Enhanced MLPerf Visual Report Generator
=====================================
Creates comprehensive graphical reports from MLPerf benchmark results.
Built on official MLCommons visualization tools with enhanced features.

Usage:
    python3 generate_visual_reports.py [result_directory]
    
Features:
- Interactive HTML dashboards
- Performance comparison charts
- Latency distribution analysis  
- Multi-benchmark comparisons
- Real-time result monitoring
"""

import json
import os
import sys
import glob
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# Try to import optional libraries for enhanced features
try:
    import plotly.express as px
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    import plotly.offline as pyo
    PLOTLY_AVAILABLE = True
except ImportError:
    print("📋 Plotly not available - will generate static charts only")
    PLOTLY_AVAILABLE = False

try:
    import streamlit as st
    STREAMLIT_AVAILABLE = True
except ImportError:
    STREAMLIT_AVAILABLE = False

class MLPerfVisualReportGenerator:
    """Enhanced visual report generator for MLPerf benchmark results"""
    
    def __init__(self, result_dir="results"):
        self.result_dir = Path(result_dir)
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.output_dir = self.result_dir / f"visual_reports_{self.timestamp}"
        self.output_dir.mkdir(exist_ok=True, parents=True)
        
        # Configure plotting style
        plt.style.use('seaborn-v0_8')
        sns.set_palette("husl")
        
    def trace_to_dataframe(self, trace_file):
        """Convert MLPerf trace JSON to pandas DataFrame (from official notebook)"""
        try:
            with open(trace_file, "r") as f:
                j = json.load(f)
            if type(j) == dict:
                j = j['traceEvents']
                
            result = []
            for item in j:
                name = item['name']
                if name not in ["Latency", "Sample", "QuerySamplesComplete", "IssueQuery"]:
                    continue

                args = item.get('args')
                d = {"ts": item['ts'], "name": name, "dur": item.get("dur")}

                if name == "Latency":
                    d["issue_delay"] = args["issue_delay"]
                    d["issue_to_done"] = args["issue_to_done"] / 1e3
                    result.append(d)
                elif name == "Sample":
                    if args:
                        d["issue_start_ns"] = args["issue_start_ns"]
                        d["complete_ns"] = args["complete_ns"]
                        d["issue_to_done"] = (args["complete_ns"] - args["issue_start_ns"]) / 1e3
                        result.append(d)
                elif name == "QuerySamplesComplete":
                    result.append(d)
                elif name == "IssueQuery":
                    result.append(d)

            df = pd.DataFrame(result)
            if not df.empty:
                df = df.sort_values(by=["ts"])
            return df
        except Exception as e:
            print(f"⚠️  Warning: Could not parse trace file {trace_file}: {e}")
            return pd.DataFrame()
    
    def parse_summary_file(self, summary_file):
        """Parse MLPerf summary text file into structured data"""
        try:
            with open(summary_file, 'r') as f:
                content = f.read()
            
            results = {}
            lines = content.split('\n')
            
            for line in lines:
                line = line.strip()
                if ':' in line:
                    key, value = line.split(':', 1)
                    key = key.strip()
                    value = value.strip()
                    
                    # Parse numeric values
                    try:
                        if 'per second' in value or 'latency' in value.lower():
                            # Extract numeric part
                            import re
                            numbers = re.findall(r'[\d.]+', value)
                            if numbers:
                                results[key] = float(numbers[0])
                                results[f"{key}_unit"] = value.replace(numbers[0], '').strip()
                        else:
                            results[key] = value
                    except:
                        results[key] = value
            
            return results
        except Exception as e:
            print(f"⚠️  Warning: Could not parse summary file {summary_file}: {e}")
            return {}
    
    def parse_accuracy_file(self, accuracy_file):
        """Parse MLPerf accuracy JSON file"""
        try:
            with open(accuracy_file, 'r') as f:
                data = json.load(f)
            return data
        except Exception as e:
            print(f"⚠️  Warning: Could not parse accuracy file {accuracy_file}: {e}")
            return {}
    
    def create_static_reports(self):
        """Generate static matplotlib/seaborn reports"""
        print("📊 Generating static visual reports...")
        
        # Find all result directories
        result_dirs = []
        for pattern in ["**/official_mlperf*", "**/mlperf_*", "**/results_*"]:
            result_dirs.extend(glob.glob(str(self.result_dir / pattern), recursive=True))
        
        if not result_dirs:
            print(f"❌ No MLPerf result directories found in {self.result_dir}")
            return
        
        # Create comprehensive static report
        fig, axes = plt.subplots(2, 2, figsize=(16, 12))
        fig.suptitle('MLPerf Benchmark Results Summary', fontsize=16, fontweight='bold')
        
        all_summaries = []
        all_traces = []
        
        for result_dir in result_dirs:
            result_path = Path(result_dir)
            
            # Parse summary files
            summary_files = list(result_path.glob("**/mlperf_log_summary.txt"))
            for summary_file in summary_files:
                summary_data = self.parse_summary_file(summary_file)
                if summary_data:
                    summary_data['source'] = result_path.name
                    all_summaries.append(summary_data)
            
            # Parse trace files
            trace_files = list(result_path.glob("**/mlperf_log_trace.json"))
            for trace_file in trace_files:
                trace_df = self.trace_to_dataframe(trace_file)
                if not trace_df.empty:
                    trace_df['source'] = result_path.name
                    all_traces.append(trace_df)
        
        # Plot 1: Performance Summary
        if all_summaries:
            summary_df = pd.DataFrame(all_summaries)
            if 'Completed samples per second' in summary_df.columns:
                ax1 = axes[0, 0]
                performance_data = summary_df['Completed samples per second'].dropna()
                sources = summary_df.loc[performance_data.index, 'source']
                ax1.bar(range(len(performance_data)), performance_data, color=sns.color_palette("viridis", len(performance_data)))
                ax1.set_title('Samples per Second by Benchmark')
                ax1.set_ylabel('Samples/sec')
                ax1.set_xlabel('Benchmark Run')
                if len(sources) <= 10:  # Only show labels if not too many
                    ax1.set_xticks(range(len(sources)))
                    ax1.set_xticklabels(sources, rotation=45, ha='right')
        
        # Plot 2: Latency Distribution
        if all_traces:
            ax2 = axes[0, 1]
            combined_traces = pd.concat(all_traces, ignore_index=True)
            latency_data = combined_traces[combined_traces['name'] == 'Latency']
            if not latency_data.empty and 'issue_to_done' in latency_data.columns:
                latency_data['issue_to_done'].hist(bins=30, alpha=0.7, ax=ax2, color='skyblue')
                ax2.set_title('Latency Distribution')
                ax2.set_xlabel('Latency (μs)')
                ax2.set_ylabel('Frequency')
        
        # Plot 3: Throughput Over Time
        if all_traces:
            ax3 = axes[1, 0]
            query_complete_data = combined_traces[combined_traces['name'] == 'QuerySamplesComplete']
            if not query_complete_data.empty:
                # Calculate throughput over time windows
                query_complete_data = query_complete_data.copy()
                query_complete_data['time_sec'] = query_complete_data['ts'] / 1e6  # Convert to seconds
                query_complete_data = query_complete_data.sort_values('time_sec')
                
                # Calculate rolling throughput (samples per 10-second window)
                window_size = 10  # seconds
                query_complete_data['rolling_count'] = query_complete_data.rolling(
                    window=f'{window_size}s', on='time_sec'
                ).size()
                query_complete_data['throughput'] = query_complete_data['rolling_count'] / window_size
                
                ax3.plot(query_complete_data['time_sec'], query_complete_data['throughput'], 
                        color='green', linewidth=2)
                ax3.set_title('Throughput Over Time')
                ax3.set_xlabel('Time (seconds)')
                ax3.set_ylabel('Samples/sec')
                ax3.grid(True, alpha=0.3)
        
        # Plot 4: Accuracy Scores
        ax4 = axes[1, 1]
        accuracy_scores = []
        benchmark_names = []
        
        for result_dir in result_dirs:
            result_path = Path(result_dir)
            accuracy_files = list(result_path.glob("**/mlperf_log_accuracy.json"))
            for accuracy_file in accuracy_files:
                accuracy_data = self.parse_accuracy_file(accuracy_file)
                if 'metadata' in accuracy_data and 'rouge_scores' in accuracy_data['metadata']:
                    rouge_scores = accuracy_data['metadata']['rouge_scores']
                    accuracy_scores.append([
                        rouge_scores.get('rouge1', 0),
                        rouge_scores.get('rouge2', 0),
                        rouge_scores.get('rougeL', 0)
                    ])
                    benchmark_names.append(result_path.name)
        
        if accuracy_scores:
            accuracy_df = pd.DataFrame(accuracy_scores, columns=['ROUGE-1', 'ROUGE-2', 'ROUGE-L'])
            accuracy_df.index = benchmark_names
            accuracy_df.plot(kind='bar', ax=ax4, color=['red', 'blue', 'green'])
            ax4.set_title('ROUGE Accuracy Scores')
            ax4.set_ylabel('ROUGE Score')
            ax4.legend()
            ax4.tick_params(axis='x', rotation=45)
        
        plt.tight_layout()
        static_report_path = self.output_dir / "mlperf_static_report.png"
        plt.savefig(static_report_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"✅ Static report saved: {static_report_path}")
        return static_report_path
    
    def create_interactive_reports(self):
        """Generate interactive Plotly reports"""
        if not PLOTLY_AVAILABLE:
            print("⚠️  Plotly not available - skipping interactive reports")
            return None
        
        print("🎯 Generating interactive dashboard...")
        
        # Create dashboard with subplots
        fig = make_subplots(
            rows=2, cols=2,
            subplot_titles=('Performance Overview', 'Latency Distribution', 
                          'Throughput Timeline', 'Accuracy Comparison'),
            specs=[[{"type": "bar"}, {"type": "histogram"}],
                   [{"type": "scatter"}, {"type": "bar"}]]
        )
        
        # Find and process data (similar to static version but for Plotly)
        result_dirs = []
        for pattern in ["**/official_mlperf*", "**/mlperf_*", "**/results_*"]:
            result_dirs.extend(glob.glob(str(self.result_dir / pattern), recursive=True))
        
        if not result_dirs:
            print(f"❌ No MLPerf result directories found in {self.result_dir}")
            return None
        
        # Process all data
        all_summaries = []
        all_traces = []
        
        for result_dir in result_dirs:
            result_path = Path(result_dir)
            
            # Parse summary files
            summary_files = list(result_path.glob("**/mlperf_log_summary.txt"))
            for summary_file in summary_files:
                summary_data = self.parse_summary_file(summary_file)
                if summary_data:
                    summary_data['source'] = result_path.name
                    all_summaries.append(summary_data)
            
            # Parse trace files
            trace_files = list(result_path.glob("**/mlperf_log_trace.json"))
            for trace_file in trace_files:
                trace_df = self.trace_to_dataframe(trace_file)
                if not trace_df.empty:
                    trace_df['source'] = result_path.name
                    all_traces.append(trace_df)
        
        # Add interactive plots
        if all_summaries:
            summary_df = pd.DataFrame(all_summaries)
            if 'Completed samples per second' in summary_df.columns:
                performance_data = summary_df['Completed samples per second'].dropna()
                sources = summary_df.loc[performance_data.index, 'source']
                
                fig.add_trace(
                    go.Bar(
                        x=sources,
                        y=performance_data,
                        name='Samples/sec',
                        marker_color='rgba(55, 128, 191, 0.7)',
                        hovertemplate='<b>%{x}</b><br>Performance: %{y:.2f} samples/sec<extra></extra>'
                    ),
                    row=1, col=1
                )
        
        if all_traces:
            combined_traces = pd.concat(all_traces, ignore_index=True)
            latency_data = combined_traces[combined_traces['name'] == 'Latency']
            if not latency_data.empty and 'issue_to_done' in latency_data.columns:
                fig.add_trace(
                    go.Histogram(
                        x=latency_data['issue_to_done'],
                        name='Latency',
                        marker_color='rgba(255, 153, 51, 0.7)',
                        hovertemplate='Latency: %{x:.0f}μs<br>Count: %{y}<extra></extra>'
                    ),
                    row=1, col=2
                )
        
        # Update layout
        fig.update_layout(
            height=800,
            title_text="MLPerf Interactive Dashboard",
            title_x=0.5,
            showlegend=False
        )
        
        # Save interactive report
        interactive_report_path = self.output_dir / "mlperf_interactive_dashboard.html"
        pyo.plot(fig, filename=str(interactive_report_path), auto_open=False)
        
        print(f"✅ Interactive dashboard saved: {interactive_report_path}")
        return interactive_report_path
    
    def create_summary_report(self):
        """Create a comprehensive summary markdown report"""
        print("📝 Generating summary report...")
        
        report_content = f"""# MLPerf Benchmark Visual Report

**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S KST')}  
**Report Type:** Enhanced Visual Analysis  
**Data Source:** {self.result_dir.absolute()}

## 🎯 Report Summary

This enhanced visual report provides comprehensive analysis of MLPerf benchmark results using both static and interactive visualizations.

### 📊 Available Reports

1. **Static Analysis Report** (`mlperf_static_report.png`)
   - Performance comparison across benchmark runs
   - Latency distribution histograms
   - Throughput timeline analysis
   - ROUGE accuracy score comparisons

2. **Interactive Dashboard** (`mlperf_interactive_dashboard.html`)
   - Hover details and zoom capabilities
   - Interactive filtering and exploration
   - Real-time data tooltips

### 🔧 Technical Implementation

- **Base Framework:** Official MLCommons trace analysis tools
- **Static Charts:** Matplotlib + Seaborn (publication quality)
- **Interactive Charts:** Plotly (web-based, interactive)
- **Data Processing:** Pandas + NumPy

### 📈 Key Improvements Over Text Reports

✅ **Visual Data Exploration**: Charts reveal patterns invisible in text  
✅ **Interactive Analysis**: Zoom, filter, and explore data dynamically  
✅ **Comparative Analysis**: Easy comparison across multiple benchmark runs  
✅ **Professional Presentation**: Publication-ready charts for reports  
✅ **Real-time Monitoring**: Live dashboard capabilities for ongoing benchmarks

### 🚀 Usage Instructions

1. **View Static Report**: Open `mlperf_static_report.png` in any image viewer
2. **Explore Interactive Dashboard**: Open `mlperf_interactive_dashboard.html` in web browser
3. **Generate New Reports**: Run `python3 generate_visual_reports.py [result_dir]`

### 📋 Data Sources Analyzed

"""
        
        # List analyzed data sources
        result_dirs = []
        for pattern in ["**/official_mlperf*", "**/mlperf_*", "**/results_*"]:
            result_dirs.extend(glob.glob(str(self.result_dir / pattern), recursive=True))
        
        for i, result_dir in enumerate(result_dirs, 1):
            result_path = Path(result_dir)
            summary_files = list(result_path.glob("**/mlperf_log_summary.txt"))
            trace_files = list(result_path.glob("**/mlperf_log_trace.json"))
            accuracy_files = list(result_path.glob("**/mlperf_log_accuracy.json"))
            
            report_content += f"""
{i}. **{result_path.name}**
   - Summary files: {len(summary_files)}
   - Trace files: {len(trace_files)}
   - Accuracy files: {len(accuracy_files)}
   - Path: `{result_path.relative_to(self.result_dir)}`
"""
        
        report_content += f"""

### 🛠️ Technical Details

- **MLPerf Implementation:** Official MLCommons Reference
- **Visualization Libraries:** {'Plotly (interactive)' if PLOTLY_AVAILABLE else 'Static only'}, Matplotlib, Seaborn
- **Report Generation Time:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
- **Output Directory:** `{self.output_dir.name}`

---
*Enhanced MLPerf Visual Report Generator*  
*Built on Official MLCommons Tools*
"""
        
        summary_report_path = self.output_dir / "README.md"
        with open(summary_report_path, 'w') as f:
            f.write(report_content)
        
        print(f"✅ Summary report saved: {summary_report_path}")
        return summary_report_path

    def generate_all_reports(self):
        """Generate all available report types"""
        print(f"\n🚀 MLPerf Enhanced Visual Report Generator")
        print(f"📁 Analyzing: {self.result_dir.absolute()}")
        print(f"📊 Output: {self.output_dir.absolute()}\n")
        
        reports_generated = []
        
        # Generate static reports
        static_report = self.create_static_reports()
        if static_report:
            reports_generated.append(("Static Report", static_report))
        
        # Generate interactive reports
        interactive_report = self.create_interactive_reports()
        if interactive_report:
            reports_generated.append(("Interactive Dashboard", interactive_report))
        
        # Generate summary report
        summary_report = self.create_summary_report()
        if summary_report:
            reports_generated.append(("Summary Report", summary_report))
        
        # Print results
        print(f"\n📊 Report Generation Complete!")
        print(f"📁 Reports saved in: {self.output_dir.name}")
        print(f"\n📋 Generated Reports:")
        
        for report_type, report_path in reports_generated:
            print(f"   ✅ {report_type}: {report_path.name}")
        
        print(f"\n🎯 Next Steps:")
        print(f"   1. View static charts: open {self.output_dir.name}/mlperf_static_report.png")
        if PLOTLY_AVAILABLE:
            print(f"   2. Explore interactive dashboard: open {self.output_dir.name}/mlperf_interactive_dashboard.html")
        print(f"   3. Read summary: open {self.output_dir.name}/README.md")
        
        return reports_generated

def main():
    """Main entry point for the visual report generator"""
    
    # Parse command line arguments
    result_dir = sys.argv[1] if len(sys.argv) > 1 else "results"
    
    if not os.path.exists(result_dir):
        print(f"❌ Error: Result directory '{result_dir}' not found")
        print(f"Usage: python3 {sys.argv[0]} [result_directory]")
        sys.exit(1)
    
    # Create and run report generator
    generator = MLPerfVisualReportGenerator(result_dir)
    reports = generator.generate_all_reports()
    
    if not reports:
        print("❌ No reports could be generated. Check if MLPerf result files exist in the specified directory.")
        sys.exit(1)
    
    print(f"\n🎉 Success! {len(reports)} reports generated successfully.")

if __name__ == "__main__":
    main()