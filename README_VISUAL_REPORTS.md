# Enhanced MLPerf Visual Reporting System

## 🎯 Overview

This repository now includes an **enhanced visual reporting system** that transforms hard-to-read MLPerf text reports into comprehensive graphical dashboards. Built on official MLCommons tools with modern visualization frameworks.

## 📊 Key Improvements

### Before: Text-Only Reports ❌
- Dense text summaries difficult to interpret
- No visual comparison across benchmark runs  
- Hard to spot performance trends
- Limited data exploration capabilities

### After: Interactive Visual Dashboards ✅
- **Static Charts**: Publication-quality matplotlib/seaborn plots
- **Interactive Dashboards**: Web-based Plotly charts with hover details
- **Comparative Analysis**: Easy comparison across multiple runs
- **Real-time Monitoring**: Auto-updating visual reports during benchmarks

## 🚀 Quick Start

### Generate Visual Reports (One-time)
```bash
# Generate reports for all results
python3 generate_visual_reports.py results

# Generate reports for specific directory
python3 generate_visual_reports.py results/official_mlperf_samples
```

### Auto-Monitor Live Benchmarks
```bash
# Generate reports once and exit
python3 auto_visual_monitor.py --once

# Watch benchmarks and auto-generate reports every 30 seconds
python3 auto_visual_monitor.py --watch --interval 30
```

## 📋 Available Report Types

### 1. Static Analysis Report (`mlperf_static_report.png`)
- **Performance Comparison**: Bar charts showing samples/sec across runs
- **Latency Distribution**: Histogram of inference time distribution  
- **Throughput Timeline**: Performance over time visualization
- **Accuracy Scores**: ROUGE score comparisons with visual breakdown

### 2. Interactive Dashboard (`mlperf_interactive_dashboard.html`)
- **Hover Details**: Detailed information on mouse hover
- **Zoom & Pan**: Interactive exploration of data
- **Filter Controls**: Dynamic data filtering capabilities
- **Export Options**: Save charts as images or data

### 3. Summary Report (`README.md`)
- **Data Source Analysis**: Comprehensive overview of processed data
- **Technical Details**: Implementation and library information
- **Usage Instructions**: Step-by-step guide for all features

## 🔧 Technical Implementation

### Core Technologies
- **Base Framework**: Official MLCommons trace analysis tools
- **Static Visualization**: Matplotlib + Seaborn (scientific plotting)
- **Interactive Visualization**: Plotly (web-based charts)
- **Data Processing**: Pandas + NumPy (data analysis)

### Official MLPerf Integration
Built on official MLPerf tools from `/official_mlperf/loadgen/tools/`:
- Uses official trace parsing from `mlperf-trace.ipynb`
- Compatible with official MLPerf result formats
- Extends official visualization capabilities

### Data Sources Supported
- ✅ **MLPerf Summary Files** (`mlperf_log_summary.txt`)
- ✅ **MLPerf Trace Files** (`mlperf_log_trace.json`) 
- ✅ **MLPerf Accuracy Files** (`mlperf_log_accuracy.json`)
- ✅ **MLPerf Detail Logs** (`mlperf_log_detail.txt`)

## 📈 Usage Examples

### Example 1: Compare Multiple Benchmark Runs
```bash
# Run benchmarks with different configurations
./run_official_benchmark.sh --config config1.yaml
./run_official_benchmark.sh --config config2.yaml

# Generate comparative visual report
python3 generate_visual_reports.py results
# Opens: results/visual_reports_TIMESTAMP/mlperf_static_report.png
```

### Example 2: Monitor Live Benchmarks
```bash
# Start long-running benchmark
./run_official_benchmark.sh --full-dataset &

# Start visual monitoring (updates every 30 seconds)
python3 auto_visual_monitor.py --watch --interval 30
# Generates: Real-time visual reports showing progress
```

### Example 3: Export for Presentations
```bash
# Generate high-quality static charts for presentations
python3 generate_visual_reports.py results/final_results

# Charts are saved as high-DPI PNG files suitable for:
# - Research papers
# - Presentation slides  
# - Technical reports
# - Performance analysis
```

## 🎯 Key Features

### 1. Official MLPerf Compliance
- Built on official MLCommons trace analysis tools
- Compatible with all MLPerf submission formats
- Follows MLPerf visualization best practices

### 2. Multiple Visualization Types
- **Performance Charts**: Throughput, latency, accuracy comparisons
- **Distribution Analysis**: Histogram and statistical summaries
- **Timeline Analysis**: Performance trends over time
- **Comparative Analysis**: Side-by-side benchmark comparisons

### 3. Professional Output
- **Publication Quality**: High-DPI charts suitable for papers/reports
- **Interactive Exploration**: Web-based dashboards for detailed analysis
- **Export Capabilities**: Multiple output formats (PNG, HTML, PDF)

### 4. Real-time Monitoring
- **Live Updates**: Auto-refresh during benchmark execution
- **Progress Tracking**: Visual progress indicators
- **Automatic Report Generation**: No manual intervention required

## 📊 Report Output Structure

```
results/visual_reports_TIMESTAMP/
├── mlperf_static_report.png          # Static analysis charts
├── mlperf_interactive_dashboard.html # Interactive web dashboard  
├── README.md                         # Comprehensive summary report
└── data/                            # Processed data files (optional)
```

## 🛠️ Dependencies

### Required (Auto-installed)
- `matplotlib` - Static plotting
- `seaborn` - Statistical visualization
- `plotly` - Interactive charts
- `pandas` - Data processing
- `numpy` - Numerical computing

### Optional Enhancements
- `streamlit` - Web dashboard framework
- `jupyter` - Notebook-based analysis
- `kaleido` - Static image export for Plotly

## 🔍 Troubleshooting

### Common Issues

**Issue**: `ModuleNotFoundError: No module named 'matplotlib'`
```bash
# Solution: Install visualization dependencies
pip install matplotlib seaborn plotly pandas numpy
```

**Issue**: "No MLPerf result files found"
```bash
# Solution: Check result directory structure
ls -la results/*/mlperf_log_*.{txt,json}
python3 generate_visual_reports.py results/specific_directory
```

**Issue**: Interactive dashboard not opening
```bash
# Solution: Open HTML file directly in browser
firefox results/visual_reports_*/mlperf_interactive_dashboard.html
# Or use absolute path
python3 -c "import webbrowser; webbrowser.open('file:///absolute/path/to/dashboard.html')"
```

## 📚 Advanced Usage

### Custom Visualization Scripts
The report generator is designed to be extensible:

```python
from generate_visual_reports import MLPerfVisualReportGenerator

# Create custom report generator
generator = MLPerfVisualReportGenerator("custom_results")

# Generate specific report types
static_report = generator.create_static_reports()
interactive_report = generator.create_interactive_reports()
```

### Integration with MLPerf Workflow
Add visual reporting to your benchmark scripts:

```bash
#!/bin/bash
# run_benchmark_with_visuals.sh

# Run benchmark
python3 official_mlperf/main.py --scenario Server --full-dataset

# Generate visual reports automatically
python3 generate_visual_reports.py results

# Open results in browser
firefox results/visual_reports_*/mlperf_interactive_dashboard.html
```

## 🎉 Benefits

1. **🔍 Better Data Understanding**: Visual patterns reveal insights invisible in text
2. **⚡ Faster Analysis**: Immediate visual comparison vs manual text parsing  
3. **📊 Professional Presentation**: Publication-ready charts for reports/papers
4. **🎯 Real-time Monitoring**: Live visual feedback during benchmark execution
5. **🔧 Easy Integration**: Works with existing MLPerf workflows
6. **📈 Comparative Analysis**: Easy comparison across different configurations

---

**🎯 Result**: Transform MLPerf's hard-to-comprehend text reports into intuitive, interactive visual dashboards that reveal performance insights at a glance.**