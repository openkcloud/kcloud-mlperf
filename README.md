# MLPerf Distributed Multi-GPU Benchmarking

A comprehensive implementation of distributed multi-GPU MLPerf benchmarking using VLLM, DeepSpeed, and manual coordination approaches.

## 🎯 Current Status

### ✅ Working Solutions
- **Manual Distributed Benchmarking**: Proven 2x throughput improvement
- **Automated Daily Scheduling**: 7pm KST execution via cron
- **Performance Monitoring**: Live status tracking and reporting
- **Multi-Node Coordination**: jw1 (coordinator) + jw2,jw3 (GPU workers)

### ⚠️ Known Limitations  
- **DeepSpeed Native**: Blocked by network/architecture barriers
- **Ray Distributed**: NCCL communication issues preventing tensor parallelism
- **TorchX Kubernetes**: Same network infrastructure limitations

## 🏗️ Architecture

### Hardware Setup
- **jw1 (129.254.202.251)**: Coordinator node (CPU)
- **jw2 (129.254.202.252)**: Worker node with NVIDIA A30 GPU (24GB)
- **jw3 (129.254.202.253)**: Worker node with NVIDIA A30 GPU (24GB)

### Software Stack
- **Model**: meta-llama/Llama-3.1-8B-Instruct
- **Inference Engine**: VLLM with tensor parallelism
- **Frameworks**: DeepSpeed, Ray, TorchX, Manual coordination
- **Benchmarking**: MLPerf-style inference evaluation

## 📁 Repository Structure

```
├── scripts/                    # Production-ready scripts
│   ├── manual_distributed_mlperf.sh    # Working distributed benchmark
│   ├── scheduled_benchmark.sh          # Daily automated execution
│   └── deepspeed_standalone.py         # DeepSpeed implementation
├── experimental/               # Development and testing scripts
│   ├── deepspeed_*.py         # Various DeepSpeed approaches
│   ├── test_*.py              # Framework testing scripts
│   └── launch_*.sh            # Launcher scripts
├── archive/                   # Configuration files and deprecated scripts
│   ├── deepspeed_config.json  # DeepSpeed configuration
│   └── *hostfile              # Multi-node host configurations
├── results/                   # Benchmark results and reports
│   ├── official_mlperf/       # Production benchmark results
│   ├── manual_distributed_*/  # Manual approach results
│   └── scheduled_benchmark_*/ # Daily scheduled results
├── logs/                      # Execution logs and debugging output
├── reports/                   # Analysis and performance reports
├── PICKUP_PROMPT_TOMORROW.md  # Session continuation context
└── deepspeed_standalone_problems.md  # Technical analysis
```

## 🚀 Quick Start

### Run Manual Distributed Benchmark
```bash
# Execute proven working approach
./scripts/manual_distributed_mlperf.sh
```

### Check Scheduled Benchmarks
```bash
# View cron jobs
crontab -l

# Check latest results
ls -la results/scheduled_benchmark_*
```

### Review Performance
```bash
# View live status
cat results/official_mlperf/live_status.md

# Check combined results
cat results/manual_distributed_*/combined_results/combined_performance.txt
```

## 📊 Performance Results

### Manual Distributed Approach
- **Throughput**: 2x improvement over single GPU
- **Duration**: ~12 minutes for 20 samples
- **jw2 Performance**: ~198-202 tokens/s prompt, ~15-17 tokens/s generation  
- **jw3 Performance**: ~217-322 tokens/s prompt, ~41-42 tokens/s generation

### Scheduling
- **Frequency**: Daily at 7pm KST via cron
- **Automation**: Full result collection and analysis
- **Monitoring**: Live status updates

## 🔧 Technical Challenges & Solutions

### Network Communication Issues
**Problem**: NCCL inter-node communication blocked
- `NCCL error: unhandled system error, Call to ibv_modify_qp failed`
- Affects Ray, DeepSpeed, TorchX distributed frameworks

**Solution**: Manual coordination with data partitioning
- Each GPU processes different samples independently
- Results aggregated post-inference
- Reliable 2x throughput improvement achieved

### Framework Compatibility
**Problem**: Mixed CPU/GPU architecture challenges
- DeepSpeed expects homogeneous GPU clusters
- Ray launcher requires consistent environments
- TorchX networking complexity in Kubernetes

**Solution**: Pragmatic manual approach
- Proven reliability and performance
- Simplified debugging and monitoring
- Production-ready with automated scheduling

## 🎯 Next Steps

1. **Network Infrastructure**: Investigate NCCL/InfiniBand solutions
2. **Container Deployment**: Kubernetes manifests for automated scaling
3. **Performance Optimization**: Fine-tune VLLM and model parameters
4. **Monitoring Enhancement**: Advanced metrics and alerting
5. **Documentation**: Comprehensive deployment and troubleshooting guides

## 📝 Key Files

- `PICKUP_PROMPT_TOMORROW.md`: Complete session context for development continuation
- `deepspeed_standalone_problems.md`: Detailed technical analysis of DeepSpeed limitations
- `scripts/scheduled_benchmark.sh`: Production automated benchmark execution
- `results/official_mlperf/live_status.md`: Real-time system status and results

## 🤝 Contributing

This repository represents a comprehensive exploration of distributed multi-GPU benchmarking approaches. The manual coordination method provides a reliable foundation while distributed framework investigations continue.

---

**Last Updated**: July 23, 2025  
**Status**: Production manual distributed benchmarking operational with daily automation  
**Next Session**: Continue with `PICKUP_PROMPT_TOMORROW.md`