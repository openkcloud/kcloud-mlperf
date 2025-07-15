# MLPerf Llama Benchmark Troubleshooting

## Common Issues and Solutions

### 🐳 Docker Issues

#### Container won't start
```bash
# Check NVIDIA container runtime
docker run --rm --gpus all nvidia/cuda:12.1-base-ubuntu22.04 nvidia-smi

# Verify GPU access
nvidia-smi
```

#### Out of memory errors
```bash
# Reduce batch size in environment variables
docker run --gpus all -e BATCH_SIZE=1 -e NUM_SAMPLES=5 mlperf-llama:latest
```

#### Permission denied on results directory
```bash
# Fix volume permissions
sudo chown -R $USER:$USER ./results
```

### ☸️ Kubernetes Issues

#### Pod fails to schedule
```bash
# Check GPU nodes
kubectl get nodes -l accelerator=nvidia-gpu

# Check GPU resources
kubectl describe nodes | grep nvidia.com/gpu
```

#### PVC pending
```bash
# Check storage classes
kubectl get storageclass

# Create storage if needed
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: benchmark-pv
spec:
  capacity:
    storage: 50Gi
  accessModes:
    - ReadWriteOnce
  hostPath:
    path: /tmp/benchmark-data
EOF
```

#### HuggingFace authentication failed
```bash
# Create secret with your token
kubectl create secret generic huggingface-secret \
  --from-literal=token=your_hf_token_here

# Verify secret
kubectl get secret huggingface-secret -o yaml
```

#### Job keeps restarting
```bash
# Check logs
kubectl logs job/mlperf-llama-benchmark

# Check resource limits
kubectl describe job mlperf-llama-benchmark
```

### 🔧 Performance Issues

#### Low tokens/second
- **GPU Memory**: Increase batch size if memory allows
- **Model Precision**: Ensure float16 is being used on GPU
- **GPU Type**: Verify you're using A30/A100/H100 for best performance

#### CUDA out of memory
```bash
# Reduce model precision or batch size
export BATCH_SIZE=1
export MAX_TOKENS=32
```

#### Slow model loading
```bash
# Pre-download models to persistent cache
export HF_HOME=/app/cache
huggingface-cli download meta-llama/Llama-3.1-8B-Instruct
```

### 🔐 Authentication Issues

#### Gated model access
1. Request access: https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct
2. Wait for approval (usually <24 hours)
3. Create token: https://huggingface.co/settings/tokens
4. Token needs 'Read' permission

#### Token permissions
```bash
# Test token
export HF_TOKEN=your_token
python -c "from huggingface_hub import login; login(token='$HF_TOKEN')"
```

### 📊 Results Issues

#### No results generated
```bash
# Check output directory permissions
ls -la /app/results/

# Verify container logs
docker logs container_name
```

#### Results format issues
- Results are saved as JSON in `/app/results/benchmark_results.json`
- Summary available in `/app/results/summary.txt`

### 🏗️ Build Issues

#### Docker build fails
```bash
# Update base image
docker pull nvidia/cuda:12.1-devel-ubuntu22.04

# Clean build
docker build --no-cache -t mlperf-llama:latest .
```

#### Missing dependencies
```bash
# Check requirements.txt versions
pip install -r requirements.txt

# Update PyTorch for your CUDA version
pip install torch==2.4.0+cu121 -f https://download.pytorch.org/whl/torch_stable.html
```

### 📞 Getting Help

1. **Check logs first**: `kubectl logs job/mlperf-llama-benchmark`
2. **Verify GPU access**: `nvidia-smi` on the target node
3. **Test locally**: Build and run container locally before K8s deployment
4. **Resource monitoring**: Use `kubectl top pods` to check resource usage

### 🔍 Debug Commands

```bash
# Test container locally
docker run --gpus all -it mlperf-llama:latest /bin/bash

# Check Kubernetes events
kubectl get events --sort-by='.lastTimestamp'

# Monitor pod resources
kubectl top pod mlperf-llama-benchmark-xxxxx

# Get detailed pod info
kubectl describe pod mlperf-llama-benchmark-xxxxx
```

### 📈 Performance Expectations

| Hardware | Expected Tokens/sec | Memory Usage | Notes |
|----------|-------------------|--------------|-------|
| RTX 4090 | 35-45 | ~16GB | Consumer GPU |
| A30 | 30-40 | ~15GB | Data center |
| A100 | 50-70 | ~15GB | High performance |
| H100 | 100-150 | ~15GB | Latest generation |

Lower performance may indicate:
- CPU bottleneck (use GPU with sufficient PCIe bandwidth)
- Memory bandwidth limitation
- Incorrect CUDA/driver versions
- Thermal throttling