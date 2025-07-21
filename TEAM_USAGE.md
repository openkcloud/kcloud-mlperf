# 🚀 MLPerf Benchmark Team Usage Guide

This guide provides everything your team needs to run benchmarks consistently and generate professional reports automatically.

## 🎯 Quick Start

### Simple Usage
```bash
# Run coordinated multi-GPU benchmark with automatic reports
./run_benchmark.sh

# Run single GPU benchmark with 20 samples
./run_benchmark.sh single -s 20

# Run without generating reports
./run_benchmark.sh coordinated --no-reports
```

### Python Interface
```bash
# Direct Python usage
python3 src/mlperf_benchmark.py --type coordinated --samples 10

# List available configurations
python3 src/mlperf_benchmark.py --list-configs
```

## 📊 Benchmark Types

| Type | Description | Use Case |
|------|-------------|----------|
| **single** | Single GPU benchmark | Baseline performance testing |
| **coordinated** | Multi-GPU coordinated benchmark | **Recommended for most testing** |
| **distributed** | Distributed multi-node benchmark | Large-scale testing |
| **datacenter** | MLPerf datacenter benchmark | Official MLPerf compliance |

## 🔧 Common Usage Patterns

### For Development Testing
```bash
# Quick performance check
./run_benchmark.sh coordinated -s 5

# Detailed analysis
./run_benchmark.sh coordinated -s 20
```

### For Production Validation
```bash
# Full benchmark suite
./run_benchmark.sh coordinated -s 50

# Performance regression testing
./run_benchmark.sh coordinated -s 10 -o results/regression-$(date +%Y%m%d)
```

### For Team Reporting
```bash
# Generate reports for team review
./run_benchmark.sh coordinated -s 20

# Skip reports for debugging
./run_benchmark.sh coordinated --no-reports
```

## 📈 Automatic Report Generation

Every benchmark run automatically generates three professional reports:

### 1. 📋 Benchmark Execution Report
- **Location**: `reports/benchmark-execution-report.md`
- **Content**: Executive summary, test results, performance metrics
- **Purpose**: High-level overview for stakeholders

### 2. 📊 Performance Analysis Report
- **Location**: `reports/performance-analysis.md`
- **Content**: Detailed performance analysis, scaling efficiency, optimization recommendations
- **Purpose**: Technical deep-dive for engineers

### 3. 🏥 Infrastructure Health Report
- **Location**: `reports/infrastructure-health.md`
- **Content**: System health assessment, component status, improvement recommendations
- **Purpose**: Infrastructure monitoring and maintenance

## 🎯 Best Practices

### ✅ Recommended Workflow
1. **Run benchmark**: `./run_benchmark.sh coordinated`
2. **Review reports**: Check `reports/` directory
3. **Share results**: Reports are ready for team distribution
4. **Track changes**: Compare with previous runs

### ⚠️ Common Issues

**Issue**: "Python 3 not found"
**Solution**: Install Python 3 or add to PATH

**Issue**: "Benchmark script not found"
**Solution**: Run from mlperf-benchmark directory

**Issue**: "Node connectivity failed"
**Solution**: Verify SSH access to cluster nodes

## 🛠️ Advanced Options

### Custom Output Directory
```bash
./run_benchmark.sh coordinated -o results/experiment-$(date +%Y%m%d)
```

### Specific Node Configuration
```bash
./run_benchmark.sh coordinated -n jw2,jw3
```

### Distributed Benchmarks
```bash
./run_benchmark.sh distributed -w 4
```

## 📁 File Structure

```
mlperf-benchmark/
├── src/
│   ├── mlperf_benchmark.py      # Main benchmark runner
│   └── report_generator.py      # Automated report generation
├── reports/                     # Generated reports (updated automatically)
│   ├── benchmark-execution-report.md
│   ├── performance-analysis.md
│   └── infrastructure-health.md
├── results/                     # Benchmark results
│   └── latest/                  # Most recent results
├── run_benchmark.sh             # Team-friendly script
└── TEAM_USAGE.md               # This guide
```

## 🤝 Team Consistency

### Why Use This System?
- **Consistent Reports**: Same format every time
- **Professional Quality**: Ready for stakeholder review
- **Automated Analysis**: No manual calculation errors
- **Version Control**: Track performance over time
- **Easy Sharing**: Markdown format works everywhere

### Report Standards
- All reports include timestamps
- Performance grades (A+, A, B, etc.)
- Executive summaries for management
- Technical details for engineers
- Actionable recommendations

## 🚨 Troubleshooting

### Performance Issues
```bash
# Check system health first
./run_benchmark.sh coordinated -s 5

# Review infrastructure health report
cat reports/infrastructure-health.md
```

### Report Generation Failures
```bash
# Run without reports to isolate issues
./run_benchmark.sh coordinated --no-reports

# Check manual report generation
python3 src/report_generator.py
```

### Cluster Connectivity
```bash
# Test SSH connectivity
ssh jungwooshim@129.254.202.252 hostname
ssh jungwooshim@129.254.202.253 hostname
```

## 🎯 Success Metrics

### What to Look For
- **Scaling Efficiency**: >95% is excellent
- **Throughput**: >2.0 samples/sec for multi-GPU
- **Success Rate**: 100% for reliable operation
- **Infrastructure Health**: >80/100 for production readiness

### Performance Targets
- **A+ Grade**: >100% scaling efficiency
- **A Grade**: 95-100% scaling efficiency
- **B Grade**: 85-95% scaling efficiency
- **Below B**: Needs optimization

## 📞 Support

### Quick Reference
```bash
# Show all options
./run_benchmark.sh --help

# List configurations
./run_benchmark.sh --list-configs

# Get Python help
python3 src/mlperf_benchmark.py --help
```

### Common Commands
```bash
# Standard team benchmark
./run_benchmark.sh coordinated -s 20

# Quick performance check
./run_benchmark.sh coordinated -s 5

# Detailed analysis
./run_benchmark.sh coordinated -s 50
```

---

## 🏆 Summary

This system ensures **consistent, professional benchmark reporting** across your team. Every run generates comprehensive reports with:

- ✅ **Executive summaries** for stakeholders
- ✅ **Technical analysis** for engineers  
- ✅ **Infrastructure health** monitoring
- ✅ **Actionable recommendations**
- ✅ **Timestamps** for tracking
- ✅ **Performance grades** for quick assessment

**Use `./run_benchmark.sh coordinated` for most testing scenarios.**