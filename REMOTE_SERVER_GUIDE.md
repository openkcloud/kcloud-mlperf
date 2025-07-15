# Remote Server Setup Guide

## Quick Setup on Fresh Ubuntu 22.04

### 1. Connect to Server
```bash
ssh username@129.254.202.253
```

### 2. Run Setup Script
```bash
# Clone repository
git clone https://github.com/jshim0978/MLPerf_local_test.git
cd MLPerf_local_test

# Run setup script
./setup_fresh_server.sh
```

### 3. Reboot (if needed)
```bash
sudo reboot
```

### 4. Test GPU Access
```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:11.8-base-ubuntu22.04 nvidia-smi
```

### 5. Build Container
```bash
cd MLPerf_local_test
docker build -t mlperf-llama:latest .
```

### 6. Run Benchmark
```bash
docker run --gpus all -e HF_TOKEN=your_token mlperf-llama:latest
```

## Expected Results
- **Performance**: 34.9 tokens/second (same as original server)
- **GPU Memory**: ~15GB usage on A30
- **Success Rate**: 100%

## Troubleshooting

### GPU Issues
```bash
# Check drivers
nvidia-smi

# Check Docker GPU access
docker run --rm --gpus all nvidia/cuda:11.8-base-ubuntu22.04 nvidia-smi
```

### Container Issues
```bash
# Check Docker
docker --version
docker info

# Check logs
docker logs container_name
```

### Performance Issues
```bash
# Monitor resources
nvidia-smi -l 1
htop
```

## What the Setup Script Does

1. **Updates system** packages
2. **Installs essential tools** (git, curl, build-essential)
3. **Installs NVIDIA drivers** automatically
4. **Installs Docker** with official script
5. **Sets up NVIDIA Container Runtime** for GPU access
6. **Clones repository** and prepares workspace

## Manual Verification Steps

After setup, verify each component:

```bash
# 1. System info
lsb_release -a
uname -a

# 2. GPU
nvidia-smi
nvidia-smi -L

# 3. Docker
docker --version
docker info | grep nvidia

# 4. Repository
ls -la MLPerf_local_test/
```

## Expected Timeline
- **Setup script**: 5-10 minutes
- **Reboot**: 2-3 minutes
- **Container build**: 10-15 minutes
- **First benchmark run**: 5-10 minutes

Total: ~30 minutes for complete setup and first benchmark run.