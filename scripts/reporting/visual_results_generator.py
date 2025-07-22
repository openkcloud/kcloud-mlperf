#!/usr/bin/env python3
"""
Visual MLPerf Results Generator
Creates visually appealing HTML reports with charts and professional styling
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
from matplotlib.backends.backend_agg import FigureCanvasAgg
import base64
from io import BytesIO

def parse_mlperf_results(results_dir):
    """Parse MLPerf results from directory"""
    results_dir = Path(results_dir)
    
    data = {
        "timestamp": datetime.now().isoformat(),
        "results_dir": str(results_dir),
        "performance": {},
        "accuracy": {},
        "summary": {}
    }
    
    # Parse summary file
    summary_file = results_dir / "mlperf_log_summary.txt"
    if summary_file.exists():
        with open(summary_file, 'r') as f:
            content = f.read()
            
        # Extract key metrics
        for line in content.split('\n'):
            if "Completed samples per second" in line:
                try:
                    data["performance"]["samples_per_second"] = float(line.split(':')[1].strip())
                except:
                    pass
            elif "Completed tokens per second" in line:
                try:
                    data["performance"]["tokens_per_second"] = float(line.split(':')[1].strip())
                except:
                    pass
            elif "Result is" in line:
                data["summary"]["result"] = line.split(':')[1].strip()
        
        data["summary"]["raw_content"] = content
    
    # Parse detail file for timeline data
    detail_file = results_dir / "mlperf_log_detail.txt"
    if detail_file.exists():
        timestamps = []
        samples = []
        
        with open(detail_file, 'r') as f:
            for line_num, line in enumerate(f):
                if line_num > 1000:  # Limit parsing for performance
                    break
                if "qsl_rng" in line and "," in line:
                    try:
                        parts = line.strip().split(',')
                        if len(parts) >= 2:
                            timestamp = float(parts[0])
                            timestamps.append(timestamp)
                            samples.append(len(samples) + 1)
                    except:
                        continue
        
        data["timeline"] = {
            "timestamps": timestamps[:100],  # Limit for chart
            "samples": samples[:100]
        }
    
    return data

def create_performance_chart(data):
    """Create performance visualization"""
    plt.style.use('seaborn-v0_8')
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    
    # Performance metrics bar chart
    metrics = []
    values = []
    
    if "samples_per_second" in data["performance"]:
        metrics.append("Samples/sec")
        values.append(data["performance"]["samples_per_second"])
    
    if "tokens_per_second" in data["performance"]:
        metrics.append("Tokens/sec") 
        values.append(data["performance"]["tokens_per_second"])
    
    if metrics:
        bars = ax1.bar(metrics, values, color=['#2E86C1', '#28B463'])
        ax1.set_title('Performance Metrics', fontsize=14, fontweight='bold')
        ax1.set_ylabel('Rate')
        
        # Add value labels on bars
        for bar, value in zip(bars, values):
            height = bar.get_height()
            ax1.text(bar.get_x() + bar.get_width()/2., height + height*0.01,
                    f'{value:.2f}', ha='center', va='bottom', fontweight='bold')
    
    # Timeline chart
    if "timeline" in data and data["timeline"]["timestamps"]:
        timestamps = data["timeline"]["timestamps"]
        samples = data["timeline"]["samples"]
        
        # Convert to relative time
        if timestamps:
            start_time = timestamps[0]
            rel_times = [(t - start_time) / 1000 for t in timestamps]  # Convert to seconds
            
            ax2.plot(rel_times, samples, color='#E74C3C', linewidth=2, marker='o', markersize=4)
            ax2.set_title('Sample Processing Timeline', fontsize=14, fontweight='bold')
            ax2.set_xlabel('Time (seconds)')
            ax2.set_ylabel('Samples Processed')
            ax2.grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    # Convert to base64 for HTML embedding
    buffer = BytesIO()
    plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight', facecolor='white')
    buffer.seek(0)
    chart_base64 = base64.b64encode(buffer.getvalue()).decode()
    plt.close()
    
    return chart_base64

def generate_html_report(data, chart_base64, output_file):
    """Generate beautiful HTML report"""
    
    # Determine status color and icon
    result = data["summary"].get("result", "UNKNOWN")
    if "VALID" in result.upper():
        status_color = "#28B463"
        status_icon = "✅"
    elif "INVALID" in result.upper():
        status_color = "#E74C3C" 
        status_icon = "⚠️"
    else:
        status_color = "#F39C12"
        status_icon = "❓"
    
    # Get performance values
    samples_per_sec = data["performance"].get("samples_per_second", "N/A")
    tokens_per_sec = data["performance"].get("tokens_per_second", "N/A")
    
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MLPerf Benchmark Results</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }}
        
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.1);
            overflow: hidden;
        }}
        
        .header {{
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }}
        
        .header h1 {{
            font-size: 2.5em;
            margin-bottom: 10px;
            font-weight: 700;
        }}
        
        .header .subtitle {{
            font-size: 1.2em;
            opacity: 0.9;
            font-weight: 300;
        }}
        
        .status-banner {{
            background: {status_color};
            color: white;
            padding: 20px;
            text-align: center;
            font-size: 1.5em;
            font-weight: bold;
        }}
        
        .content {{
            padding: 40px;
        }}
        
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 30px;
            margin-bottom: 40px;
        }}
        
        .metric-card {{
            background: #f8f9fa;
            border-radius: 15px;
            padding: 30px;
            text-align: center;
            border: 1px solid #e9ecef;
            transition: transform 0.3s ease;
        }}
        
        .metric-card:hover {{
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }}
        
        .metric-value {{
            font-size: 2.5em;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 10px;
        }}
        
        .metric-label {{
            font-size: 1.1em;
            color: #7f8c8d;
            font-weight: 600;
        }}
        
        .chart-section {{
            background: #f8f9fa;
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
        }}
        
        .chart-section h2 {{
            color: #2c3e50;
            margin-bottom: 20px;
            font-size: 1.8em;
        }}
        
        .chart-container {{
            text-align: center;
        }}
        
        .chart-container img {{
            max-width: 100%;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }}
        
        .info-section {{
            background: #f8f9fa;
            border-radius: 15px;
            padding: 30px;
        }}
        
        .info-section h2 {{
            color: #2c3e50;
            margin-bottom: 20px;
            font-size: 1.8em;
        }}
        
        .info-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
        }}
        
        .info-item {{
            background: white;
            padding: 20px;
            border-radius: 10px;
            border-left: 4px solid #3498db;
        }}
        
        .info-label {{
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 5px;
        }}
        
        .info-value {{
            color: #7f8c8d;
        }}
        
        .footer {{
            background: #2c3e50;
            color: white;
            padding: 20px;
            text-align: center;
            font-size: 0.9em;
        }}
        
        @media (max-width: 768px) {{
            .header {{
                padding: 20px;
            }}
            .header h1 {{
                font-size: 2em;
            }}
            .content {{
                padding: 20px;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 MLPerf Benchmark Results</h1>
            <div class="subtitle">Professional Performance Analysis</div>
        </div>
        
        <div class="status-banner">
            {status_icon} Status: {result}
        </div>
        
        <div class="content">
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value">{samples_per_sec}</div>
                    <div class="metric-label">Samples per Second</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{tokens_per_sec}</div>
                    <div class="metric-label">Tokens per Second</div>
                </div>
            </div>
            
            <div class="chart-section">
                <h2>📊 Performance Visualization</h2>
                <div class="chart-container">
                    <img src="data:image/png;base64,{chart_base64}" alt="Performance Charts">
                </div>
            </div>
            
            <div class="info-section">
                <h2>ℹ️ Benchmark Information</h2>
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">Generated</div>
                        <div class="info-value">{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Model</div>
                        <div class="info-value">Llama-3.1-8B-Instruct</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Scenario</div>
                        <div class="info-value">Server</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Hardware</div>
                        <div class="info-value">NVIDIA A30</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            Generated by MLPerf Professional Benchmarking System
        </div>
    </div>
</body>
</html>"""
    
    with open(output_file, 'w') as f:
        f.write(html_content)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate Visual MLPerf Results Report")
    parser.add_argument("--results-dir", required=True, help="Directory containing MLPerf results")
    parser.add_argument("--output", help="Output HTML file (auto-generated if not specified)")
    
    args = parser.parse_args()
    
    # Parse results
    try:
        data = parse_mlperf_results(args.results_dir)
    except Exception as e:
        print(f"❌ Error parsing results: {e}")
        sys.exit(1)
    
    # Create visualizations
    try:
        chart_base64 = create_performance_chart(data)
    except Exception as e:
        print(f"❌ Error creating charts: {e}")
        sys.exit(1)
    
    # Generate output filename
    if args.output:
        output_file = args.output
    else:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = f"reports/{timestamp}_visual_results.html"
        Path("reports").mkdir(exist_ok=True)
    
    # Generate HTML report
    try:
        generate_html_report(data, chart_base64, output_file)
        print(f"✅ Visual results report generated: {output_file}")
    except Exception as e:
        print(f"❌ Error generating report: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()