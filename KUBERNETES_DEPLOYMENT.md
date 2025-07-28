# 🚀 MLPerf Universal Kubernetes Deployment

This guide shows how to deploy MLPerf benchmarks using Docker containers and Kubernetes for true universal distribution.

## 📋 Quick Start (3 Steps)

### 1. **Build Container**
```bash
./deploy.sh build
```

### 2. **Setup Cluster**
```bash
./deploy.sh setup
# Edit config.env with your cluster details
```

### 3. **Run Full Benchmark (13,368 samples)**
```bash
./deploy.sh deploy performance
```

## 🎯 Available Benchmark Types

### **Performance Benchmark** (Default)
```bash
./deploy.sh deploy performance
```
- **Samples**: 13,368 (full dataset)
- **Focus**: Throughput and latency metrics
- **Duration**: ~10-12 hours on A30 GPU
- **Output**: Performance reports and logs

### **Accuracy Benchmark**
```bash
./deploy.sh deploy accuracy
```
- **Samples**: 13,368 (full dataset)
- **Focus**: ROUGE-1, ROUGE-2, ROUGE-L, ROUGE-Lsum metrics
- **Duration**: ~15-18 hours (includes accuracy evaluation)
- **Output**: Accuracy scores vs MLCommons targets

### **Distributed Benchmark**
```bash
./deploy.sh deploy distributed
```
- **Nodes**: 2 GPUs in parallel
- **Tensor Parallelism**: Enabled
- **Duration**: ~6-8 hours (faster with multiple GPUs)
- **Output**: Distributed performance analysis

## 🔧 Configuration

### **Cluster Configuration** (`config.env`)
```bash
# Cluster Node IPs
export JW1_IP="192.168.1.10"
export JW2_IP="192.168.1.20" 
export JW3_IP="192.168.1.30"
export MLPERF_USERNAME="your-username"

# HuggingFace Token
export HF_TOKEN="hf_your_token_here"

# Benchmark Settings
export SAMPLES="13368"  # Full dataset
export ACCURACY="false" # true for accuracy benchmarks
export MODEL_NAME="meta-llama/Llama-3.1-8B-Instruct"

# Storage
export STORAGE_CLASS="nfs-client"
```

### **Kubernetes ConfigMap** (`k8s/configmap.yaml`)
All benchmark parameters can be configured via ConfigMap:
- Sample count, accuracy mode, model settings
- Resource allocation, storage paths
- Node IP addresses and credentials

## 🐳 Alternative: Docker Compose

For single-node deployments:

### **Performance Benchmark**
```bash
# Edit docker-compose.yml with your HF_TOKEN
docker-compose up mlperf-benchmark
```

### **Accuracy Benchmark**
```bash
docker-compose --profile accuracy up mlperf-accuracy
```

### **Distributed Benchmark**
```bash
# Run on multiple machines
NODE_ID=1 docker-compose --profile distributed up mlperf-distributed
NODE_ID=2 docker-compose --profile distributed up mlperf-distributed
```

## 📊 Expected Results

### **Full Dataset Performance (13,368 samples)**
- **Single A30 GPU**: ~0.34 samples/sec → **10.9 hours**
- **Distributed 2x A30**: ~0.68 samples/sec → **5.5 hours**
- **Memory Usage**: ~15GB GPU + 2.5GB CUDA graphs
- **Storage**: ~50GB for results, ~100GB for model cache

### **Accuracy Targets**
| Metric | MLCommons Target | Expected Result | Status |
|--------|------------------|-----------------|--------|
| ROUGE-1 | 38.39% | ~39.12% | ✅ PASS |
| ROUGE-2 | 15.75% | ~16.41% | ✅ PASS |
| ROUGE-L | 24.25% | ~18.07% | ❌ Below |
| ROUGE-Lsum | 35.44% | ~35.56% | ✅ PASS |

## 🗂️ Output Structure

```
results/
├── mlperf_log_summary.txt    # Key performance metrics
├── mlperf_log_detail.txt     # Complete MLPerf logs
├── mlperf_log_accuracy.json  # Accuracy evaluation data
└── mlperf_log_trace.json     # Execution traces

reports/
├── MLPerf_Complete_Analysis_YYYYMMDD.md
├── benchmark_visualization.png
└── accuracy_analysis.json
```

## 🔍 Monitoring

### **Check Status**
```bash
./deploy.sh status
```

### **View Live Logs**
```bash
./deploy.sh logs performance
./deploy.sh logs accuracy
./deploy.sh logs distributed
```

### **Kubernetes Commands**
```bash
# Monitor pods
kubectl get pods -l app=mlperf

# Check job status
kubectl get jobs -l app=mlperf

# View detailed pod logs
kubectl logs -f pod/mlperf-benchmark-xxx

# Check resource usage
kubectl top pods -l app=mlperf
```

## 📈 Scaling and Optimization

### **Resource Requirements**
```yaml
# Single GPU Node
resources:
  requests:
    nvidia.com/gpu: 1
    memory: "16Gi"
    cpu: "4"
  limits:
    nvidia.com/gpu: 1
    memory: "32Gi"
    cpu: "8"
```

### **Storage Requirements**
- **Results PVC**: 50Gi (benchmark outputs)
- **HuggingFace Cache PVC**: 100Gi (model downloads)
- **Storage Class**: NFS or similar for multi-node access

### **Multi-GPU Scaling**
- **2 GPUs**: ~2x throughput improvement
- **4 GPUs**: ~3.5x throughput improvement  
- **8 GPUs**: ~6-7x throughput improvement

## 🛠️ Troubleshooting

### **Common Issues**

#### **Pod Pending**
```bash
# Check node resources
kubectl describe nodes

# Check GPU availability
kubectl get nodes -o json | jq '.items[].status.allocatable'
```

#### **Image Pull Errors**
```bash
# Rebuild and retag image
./deploy.sh build
docker tag mlperf-universal:latest your-registry/mlperf-universal:latest
docker push your-registry/mlperf-universal:latest
```

#### **Storage Issues**
```bash
# Check PVC status
kubectl get pvc

# Check storage class
kubectl get storageclass
```

#### **Memory Errors**
```bash
# Reduce model length in ConfigMap
kubectl patch configmap mlperf-config --patch '{"data":{"MAX_MODEL_LEN":"4096"}}'

# Or reduce batch size
kubectl patch configmap mlperf-config --patch '{"data":{"BATCH_SIZE":"1"}}'
```

### **Debug Commands**
```bash
# Get into running container
kubectl exec -it pod/mlperf-benchmark-xxx -- /bin/bash

# Check GPU in container
kubectl exec pod/mlperf-benchmark-xxx -- nvidia-smi

# View config
kubectl exec pod/mlperf-benchmark-xxx -- env | grep -i mlperf
```

## 🧹 Cleanup

### **Remove Benchmarks**
```bash
./deploy.sh cleanup
```

### **Remove Everything**
```bash
kubectl delete namespace mlperf-system  # If using custom namespace
docker rmi mlperf-universal:latest
```

## 🎯 Production Deployment

For production environments:

1. **Use private registry**:
   ```bash
   docker tag mlperf-universal:latest your-registry.com/mlperf:v1.0
   docker push your-registry.com/mlperf:v1.0
   ```

2. **Set resource quotas**:
   ```yaml
   apiVersion: v1
   kind: ResourceQuota
   metadata:
     name: mlperf-quota
   spec:
     hard:
       nvidia.com/gpu: "4"
       memory: "128Gi"
   ```

3. **Use secrets management**:
   ```bash
   kubectl create secret generic mlperf-secrets \
     --from-literal=HF_TOKEN="$HF_TOKEN" \
     --from-file=ssh-key=~/.ssh/id_rsa
   ```

4. **Enable monitoring**:
   ```bash
   # Install Prometheus/Grafana for metrics
   helm install prometheus prometheus-community/kube-prometheus-stack
   ```

---

**🎉 Your MLPerf framework is now ready for universal deployment across any Kubernetes cluster!**

The system automatically:
- Downloads and caches models
- Runs the full 13,368 sample benchmark  
- Generates comprehensive reports
- Provides real-time monitoring
- Scales across multiple GPUs
- Works on any Kubernetes cluster