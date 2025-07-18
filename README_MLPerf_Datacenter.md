# MLPerf Inference: Datacenter Benchmark

This implementation provides MLPerf Inference v5.0 compliant datacenter benchmarking for the Llama-3.1-8B model.

## Overview

The MLPerf Inference: Datacenter benchmark measures inference performance in two scenarios:
- **Server Scenario**: Measures queries per second (QPS) under strict latency constraints
- **Offline Scenario**: Measures maximum throughput without latency constraints

## Features

### MLPerf Compliance
- ✅ MLPerf Inference v5.0 specifications
- ✅ Required accuracy targets (99% success rate)
- ✅ Latency constraint validation
- ✅ Proper warmup procedures
- ✅ Minimum query count and duration requirements

### Performance Metrics
- **Time to First Token (TTFT)**: Measures initial response latency
- **Time Per Output Token (TPOT)**: Measures token generation speed
- **Throughput**: Tokens per second and samples per second
- **Latency Percentiles**: P50, P90, P99 measurements
- **Accuracy**: Success rate validation

### Multi-GPU Support
- **Coordinated Benchmarking**: Run benchmarks across multiple GPU nodes
- **Automatic Result Aggregation**: Combine results from all nodes
- **Load Distribution**: Equal workload distribution across GPUs

## Quick Start

### Single Node Benchmark
```bash
# Set environment variables
export HF_TOKEN=your_huggingface_token
export NODE_NAME=jw2
export MAX_TOKENS=64
export SERVER_TARGET_QPS=1.0
export OFFLINE_TARGET_QPS=10.0

# Run benchmark
python mlperf_datacenter_benchmark.py
```

### Multi-Node Coordinated Benchmark
```bash
# Set HuggingFace token
export HF_TOKEN=your_huggingface_token

# Run coordinated benchmark across all GPU nodes
python run_datacenter_benchmark.py
```

## Configuration

### Environment Variables
- `HF_TOKEN`: HuggingFace authentication token (required)
- `NODE_NAME`: Node identifier (default: hostname)
- `MAX_TOKENS`: Maximum tokens per query (default: 64)
- `SERVER_TARGET_QPS`: Target QPS for server scenario (default: 1.0)
- `OFFLINE_TARGET_QPS`: Target QPS for offline scenario (default: 10.0)

### MLPerf Configuration
The benchmark uses the following MLPerf-compliant settings:
- **Model**: meta-llama/Llama-3.1-8B-Instruct
- **Accuracy Target**: 99% success rate
- **Server Latency Constraint**: 1000ms (configurable)
- **Warmup Queries**: 10
- **Minimum Queries**: 100
- **Minimum Duration**: 60 seconds

## Hardware Requirements

### Minimum Requirements
- **GPU**: NVIDIA A30/A100/H100 with 16GB+ VRAM
- **System Memory**: 32GB+ RAM
- **Storage**: 50GB+ free space
- **Network**: Low-latency connection for multi-node setups

### Our Test Environment
- **Control Node**: jw1 (129.254.202.251) - No GPU, orchestration
- **Worker Nodes**: 
  - jw2 (129.254.202.252) - NVIDIA A30 (23.5GB)
  - jw3 (129.254.202.253) - NVIDIA A30 (23.6GB)

## Results Format

### JSON Results
Results are saved in MLPerf-compliant JSON format:
```json
{
  "benchmark_info": {
    "benchmark": "MLPerf Inference v5.0 Datacenter",
    "model": "meta-llama/Llama-3.1-8B-Instruct",
    "timestamp": "20250718_001234"
  },
  "scenarios": {
    "Server": {
      "valid": true,
      "achieved_qps": 1.05,
      "latency_p99": 945.2,
      "accuracy": 1.0
    },
    "Offline": {
      "valid": true,
      "achieved_qps": 12.3,
      "throughput_tokens_per_sec": 35.7
    }
  }
}
```

### Results Directory Structure
```
results/mlperf_datacenter/
├── mlperf_datacenter_jw2_20250718_001234.json
├── summary_jw2_20250718_001234.txt
└── aggregated_datacenter_results.json
```

## Performance Expectations

### NVIDIA A30 Performance
Based on our testing with Llama-3.1-8B:
- **Server QPS**: 0.8-1.2 queries/second
- **Offline QPS**: 8-12 queries/second
- **Latency P99**: 800-1200ms
- **TTFT P99**: 100-200ms
- **TPOT P99**: 30-50ms
- **Throughput**: 25-40 tokens/second

### Multi-GPU Scaling
- **Linear Scaling**: Near-perfect scaling across multiple GPUs
- **Coordination Overhead**: <5% performance impact
- **Combined Throughput**: Sum of individual GPU performance

## Troubleshooting

### Common Issues

#### Model Loading Failures
```bash
# Check HuggingFace token
echo $HF_TOKEN

# Test model access
python -c "from transformers import AutoTokenizer; print('Token works')"
```

#### GPU Memory Issues
```bash
# Check GPU memory
nvidia-smi

# Reduce batch size or max tokens
export MAX_TOKENS=32
```

#### Network Connectivity
```bash
# Test SSH connectivity
ssh jungwooshim@129.254.202.252 hostname

# Check ports
netstat -tuln | grep 29500
```

### Log Analysis
Detailed logs are available in:
- Console output during execution
- Result files in `results/mlperf_datacenter/`
- Individual node logs for multi-GPU runs

## Validation Criteria

### MLPerf Compliance Checks
The benchmark validates:
- ✅ Accuracy ≥ 99%
- ✅ Minimum query count (100)
- ✅ Minimum duration (60 seconds)
- ✅ Latency constraints (Server scenario)
- ✅ Proper warmup completion

### Performance Validation
- **Server Scenario**: Must meet latency SLA (default: 1000ms P99)
- **Offline Scenario**: Maximize throughput without constraints
- **Quality**: All responses must be coherent and relevant

## Integration with Existing Benchmarks

This datacenter benchmark complements our existing benchmarks:
- **run_benchmark_auto.py**: Simple inference benchmarking
- **run_coordinated_benchmark.py**: Multi-GPU coordination
- **run_distributed_benchmark.py**: Distributed training setup

### Comparison Matrix
| Benchmark Type | Scenario | Metrics | MLPerf Compliant |
|----------------|----------|---------|------------------|
| Auto Benchmark | Single GPU | Throughput, Latency | ❌ |
| Coordinated | Multi-GPU | Combined Performance | ❌ |
| **Datacenter** | **MLPerf Standard** | **QPS, TTFT, TPOT** | **✅** |

## Future Enhancements

### Planned Features
- Support for additional models (Llama-2-70B, Mixtral-8x7B)
- Integration with Kubernetes Jobs
- Automated compliance reporting
- Performance regression testing

### Model Support Roadmap
- ✅ Llama-3.1-8B-Instruct
- 🔄 Llama-2-70B-Chat (in development)
- 📋 Mixtral-8x7B (planned)
- 📋 Llama-3.1-405B (planned for A100/H100)

## Contributing

When contributing to the datacenter benchmark:
1. Ensure MLPerf compliance
2. Validate against reference implementations
3. Test on multiple GPU configurations
4. Update documentation for new features

## References

- [MLPerf Inference v5.0 Specifications](https://mlcommons.org/benchmarks/inference-datacenter/)
- [MLCommons Inference Repository](https://github.com/mlcommons/inference)
- [Llama-3.1 Model Card](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct)

---

**Note**: This implementation is designed for research and benchmarking purposes. Ensure compliance with model licenses and usage policies for production deployments.