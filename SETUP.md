# MLPerf Setup Guide

## Prerequisites
- Python 3.10+
- CUDA 12.9+
- SSH access to worker nodes (jw2, jw3)
- 24GB+ GPU memory on each worker node

## Quick Setup

### 1. Install Dependencies
```bash
# Install basic requirements
pip install -r scripts/requirements.txt

# Install additional MLPerf dependencies
pip install simplejson
```

### 2. Generate Dataset
```bash
cd official_mlperf
python3 download_cnndm.py --max-examples 1000
```

### 3. Verify Setup
```bash
# Test connectivity
ssh jungwooshim@129.254.202.252 "nvidia-smi --query-gpu=name --format=csv"
ssh jungwooshim@129.254.202.253 "nvidia-smi --query-gpu=name --format=csv"
```

### 4. Run Test Benchmark
```bash
python3 bin/run_single_benchmark.py --node jw2 --samples 10
```

## Troubleshooting

### CUDA Out of Memory
```bash
# Clear GPU processes on remote nodes
ssh jungwooshim@129.254.202.252 "pkill -f python3; nvidia-smi"
ssh jungwooshim@129.254.202.253 "pkill -f python3; nvidia-smi"
```

### Missing Dependencies
```bash
# Install missing Python packages
pip install transformers datasets torch vllm simplejson matplotlib seaborn
```

### SSH Connection Issues
```bash
# Setup passwordless SSH
ssh-copy-id jungwooshim@129.254.202.252
ssh-copy-id jungwooshim@129.254.202.253
```