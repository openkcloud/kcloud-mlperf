# Kubernetes Deployment for MLPerf Llama

This guide explains how to deploy the MLPerf Llama benchmark on Kubernetes.

## Prerequisites

- Kubernetes cluster with GPU support
- NVIDIA GPU Operator installed
- HuggingFace token for Llama model access

## Quick Start

1. **Create the HuggingFace token secret:**
   ```bash
   # Replace YOUR_HF_TOKEN with your actual token
   echo -n "YOUR_HF_TOKEN" | base64
   # Copy the output and replace the token value in k8s-secret.yaml
   
   kubectl apply -f k8s-secret.yaml
   ```

2. **Deploy the application:**
   ```bash
   kubectl apply -f k8s-deployment.yaml
   kubectl apply -f k8s-service.yaml
   ```

3. **Check deployment status:**
   ```bash
   kubectl get pods -l app=mlperf-llama
   kubectl logs -l app=mlperf-llama
   ```

## Configuration

### Resource Requirements
- **CPU**: 2-4 cores
- **Memory**: 8-16GB
- **GPU**: 1x NVIDIA GPU (A30 recommended)
- **Storage**: 15GB total (10GB cache + 5GB results)

### Environment Variables
- `HF_TOKEN`: HuggingFace token (from secret)
- `CUDA_VISIBLE_DEVICES`: GPU device ID (default: "0")

### Node Selection
The deployment uses a node selector for NVIDIA A30 GPUs. Modify the `nodeSelector` in `k8s-deployment.yaml` for your hardware:

```yaml
nodeSelector:
  accelerator: nvidia-tesla-a30  # Change to your GPU type
```

## Usage

1. **Run benchmark:**
   ```bash
   kubectl exec -it deployment/mlperf-llama -- /app/docker-entrypoint.sh benchmark
   ```

2. **Run quick test:**
   ```bash
   kubectl exec -it deployment/mlperf-llama -- /app/docker-entrypoint.sh test
   ```

3. **Interactive shell:**
   ```bash
   kubectl exec -it deployment/mlperf-llama -- /app/docker-entrypoint.sh bash
   ```

## Monitoring

- **Pod logs**: `kubectl logs -l app=mlperf-llama -f`
- **Resource usage**: `kubectl top pods -l app=mlperf-llama`
- **GPU usage**: Check with NVIDIA monitoring tools

## Cleanup

```bash
kubectl delete -f k8s-deployment.yaml
kubectl delete -f k8s-service.yaml
kubectl delete -f k8s-secret.yaml
```

## Troubleshooting

### Common Issues

1. **GPU not detected:**
   - Verify NVIDIA GPU Operator is running
   - Check node labels: `kubectl get nodes -l accelerator`

2. **Out of memory:**
   - Increase memory limits in deployment
   - Check GPU memory with `nvidia-smi`

3. **Model download fails:**
   - Verify HuggingFace token is correct
   - Check internet connectivity from pod

### Debug Commands

```bash
# Check GPU availability
kubectl exec -it deployment/mlperf-llama -- nvidia-smi

# Check Python environment
kubectl exec -it deployment/mlperf-llama -- python3 -c "import torch; print(torch.cuda.is_available())"

# View environment variables
kubectl exec -it deployment/mlperf-llama -- env | grep -E "(HF_|CUDA_)"
```