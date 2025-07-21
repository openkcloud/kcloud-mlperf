# 🚀 MLPerf Local Test - Multi-GPU Kubernetes Cluster

[![MLPerf](https://img.shields.io/badge/MLPerf-v5.0-blue.svg)](https://mlcommons.org/en/inference-datacenter-50/)
[![Kubernetes](https://img.shields.io/badge/kubernetes-1.28+-blue.svg)](https://kubernetes.io/)
[![NVIDIA](https://img.shields.io/badge/NVIDIA-A30-green.svg)](https://www.nvidia.com/en-us/data-center/a30/)
[![Python](https://img.shields.io/badge/python-3.8+-blue.svg)](https://python.org/)

A comprehensive MLPerf benchmark suite for testing GPU cluster performance with support for multiple accelerator types including NVIDIA GPUs and Furiosa NPUs.

## 🏗️ **Cluster Architecture**

### **Current Setup**
| Node | Role | IP Address | Hardware | Status |
|------|------|------------|----------|---------|
| jw1 | Control Plane | 129.254.202.251 | CPU Only | ✅ Active |
| jw2 | Worker | 129.254.202.252 | NVIDIA A30 | ✅ Active |
| jw3 | Worker | 129.254.202.253 | NVIDIA A30 | ✅ Active |

**Network**: Calico CNI | **Platform**: Ubuntu 22.04 | **Kubernetes**: v1.28+

---

## ⚡ **Quick Start**

### **1. Environment Setup**
```bash
# Run automated setup (detects hardware automatically)
./scripts/setup-environment.sh

# For Kubernetes cluster setup
./scripts/setup-environment.sh --kubernetes

# Activate Python environment
source venv/bin/activate

# Set your HuggingFace token
export HF_TOKEN="your_token_here"
```

### **2. Run Benchmarks**

#### **Single/Multi-GPU Benchmarks**
```bash
# Single GPU benchmark (via coordinated mode)
python3 src/mlperf_benchmark.py --type coordinated --nodes jw2 --samples 10

# Multi-GPU coordinated benchmark
python3 src/mlperf_benchmark.py --type coordinated --nodes jw2,jw3 --samples 20

# Distributed multi-GPU benchmark
python3 src/mlperf_benchmark.py --type distributed --world-size 2
```

#### **MLPerf Datacenter Benchmark**
```bash
# Run MLPerf Inference v5.0 Datacenter benchmark
export SERVER_TARGET_QPS=0.5
export OFFLINE_TARGET_QPS=1.0
python3 src/mlperf_benchmark.py --type datacenter
```

### **3. View Results**
```bash
# Results automatically saved to results/latest/
ls results/latest/

# View comprehensive summary
cat results/20250721/comprehensive_benchmark_summary.md

# View automated reports
open reports/benchmark-execution-report.md
```

---

## 📊 **Performance Results Summary**

### **🏆 Latest Benchmark Results**

| Benchmark Type | jw2 Throughput | jw3 Throughput | Combined | Scaling Efficiency |
|----------------|----------------|----------------|----------|--------------------|
| **Coordinated Multi-GPU** | 0.98 samples/sec | 1.07 samples/sec | **2.05 samples/sec** | **2.05x** |
| **Distributed Multi-GPU** | 1.02 samples/sec | 1.09 samples/sec | **2.11 samples/sec** | **100%** |
| **Datacenter Server** | 0.50 QPS | 0.54 QPS | **1.03 QPS** | ✅ **Valid** |

**Token Generation**: ~67-72 tokens/sec combined | **GPU Memory**: ~16GB per A30 | **Latency**: <3s

---

## 🛠️ **Supported Hardware**

### **NVIDIA GPUs**
- ✅ **A30** (24GB) - Primary tested configuration
- ✅ **H100** (80GB) - Configuration available
- ✅ **Other NVIDIA GPUs** - Generic CUDA support

### **Furiosa NPUs**
- ✅ **Warboy NPU** - Configuration and adapter available
- 🔄 **Driver Integration** - Setup scripts included

### **Generic Hardware**
- ✅ **CPU-only** - Fallback support
- ✅ **Mixed Environments** - Configurable hardware detection

---

## 📁 **Repository Structure**

```
📦 MLPerf_local_test/
├── 📄 README.md                    # This file
├── 📄 requirements.txt             # Python dependencies
├── 🗂️ src/                         # Source code
│   ├── 📄 mlperf_benchmark.py      # Main benchmark runner
│   ├── 📄 mlperf_datacenter_benchmark.py
│   ├── 📄 report_generator.py      # Automated reporting
│   └── 🗂️ adapters/                # Hardware adapters
│       ├── 📄 generic_adapter.py   # Generic hardware support
│       └── 📄 furiosa_adapter.py   # Furiosa NPU support
├── 🗂️ configs/                     # Configuration files
│   ├── 🗂️ benchmark-configs/       # Hardware-specific configs
│   │   ├── 📄 nvidia-a30.yaml      # NVIDIA A30 optimized
│   │   ├── 📄 furiosa-npu.yaml     # Furiosa NPU optimized
│   │   └── 📄 generic-config.yaml  # Generic template
│   └── 🗂️ kubernetes/              # K8s deployments
│       ├── 📄 mlperf-job.yaml       # Benchmark job template
│       └── 📄 ntp-daemonset.yaml    # NTP synchronization
├── 🗂️ scripts/                     # Automation scripts
│   ├── 📄 setup-environment.sh     # Environment setup
│   └── 📄 deploy.sh                # Deployment automation
├── 🗂️ docs/                        # Documentation
│   ├── 📄 cluster-architecture.md  # Architecture details
│   ├── 📄 setup-guide.md           # Detailed setup
│   └── 📄 troubleshooting.md       # Common issues
├── 🗂️ reports/                     # Generated reports
└── 🗂️ results/                     # Benchmark results
    └── 🗂️ 20250721/                # Daily results
        └── 📄 comprehensive_benchmark_summary.md
```

---

## 🎯 **Benchmark Types**

### **1. Coordinated Multi-GPU**
- **Purpose**: Test multi-GPU scaling efficiency
- **Execution**: Simultaneous execution across worker nodes
- **Metrics**: Throughput, latency, scaling efficiency
- **Usage**: `--type coordinated --nodes jw2,jw3`

### **2. Distributed Multi-GPU**
- **Purpose**: True distributed inference simulation
- **Execution**: Independent processes with coordination
- **Metrics**: Combined throughput, per-node performance
- **Usage**: `--type distributed --world-size 2`

### **3. MLPerf Datacenter**
- **Purpose**: MLPerf v5.0 compliance testing
- **Scenarios**: Server (QPS), Offline (throughput)
- **Validation**: Latency constraints, accuracy targets
- **Usage**: `--type datacenter`

---

## ⚙️ **Configuration**

### **Environment Variables**
```bash
# Required
export HF_TOKEN="your_huggingface_token"

# Hardware Configuration
export HARDWARE_TYPE="nvidia-a30"          # Auto-detected
export CUDA_VISIBLE_DEVICES="0"            # GPU selection

# Performance Tuning
export SERVER_TARGET_QPS="0.5"             # Datacenter server QPS
export OFFLINE_TARGET_QPS="1.0"            # Datacenter offline QPS
export MAX_TOKENS="64"                     # Output token limit
export BATCH_SIZE="1"                      # Inference batch size
```

### **Hardware-Specific Configs**
```bash
# List available configurations
python3 src/mlperf_benchmark.py --list-configs

# Use specific hardware config
python3 src/mlperf_benchmark.py --config configs/benchmark-configs/nvidia-a30.yaml

# Create custom configuration
cp configs/benchmark-configs/generic-config.yaml configs/my-config.yaml
# Edit configs/my-config.yaml as needed
```

---

## 🚀 **Adding New Hardware**

### **1. Create Hardware Configuration**
```yaml
# configs/benchmark-configs/my-accelerator.yaml
hardware:
  type: "my-accelerator"
  model: "accelerator-v1"
  memory_gb: 32

benchmark:
  server_target_qps: 2.0
  # ... other settings

deployment:
  node_selector:
    accelerator: "my-accelerator"
  resources:
    limits:
      my-company.com/accelerator: 1
```

### **2. Create Hardware Adapter**
```python
# src/adapters/my_adapter.py
from adapters.generic_adapter import BaseHardwareAdapter

class MyAcceleratorAdapter(BaseHardwareAdapter):
    def initialize_device(self):
        # Initialize your accelerator
        pass
    
    def load_model(self, model_name):
        # Load model on your accelerator
        pass
    
    def run_inference(self, prompt, max_tokens):
        # Run inference
        pass
```

### **3. Update Environment Setup**
```bash
# Add to scripts/setup-environment.sh
case $HARDWARE_TYPE in
    my-accelerator)
        print_status "Setting up My Accelerator..."
        # Add installation steps
        ;;
esac
```

---

## 🔧 **Kubernetes Deployment**

### **Job-Based Execution**
```bash
# Deploy benchmark job
kubectl apply -f configs/kubernetes/mlperf-job.yaml

# Check status
kubectl get jobs
kubectl logs job/mlperf-benchmark

# Scale to multiple nodes
kubectl scale job mlperf-benchmark --replicas=2
```

### **Infrastructure Services**
```bash
# Deploy NTP synchronization
kubectl apply -f configs/kubernetes/ntp-daemonset.yaml

# Monitor cluster health
kubectl get nodes -o wide
kubectl top nodes
```

---

## 📊 **Monitoring and Observability**

### **Real-time Monitoring**
```bash
# GPU utilization
watch nvidia-smi

# System resources
htop

# Kubernetes resources
kubectl top nodes
kubectl top pods
```

### **Performance Analysis**
- **Automated Reports**: Generated after each benchmark
- **Metrics Collection**: Throughput, latency, GPU utilization
- **Health Assessment**: Infrastructure status monitoring
- **Historical Tracking**: Results stored by date

---

## 🔍 **Troubleshooting**

### **Common Issues**

#### **GPU Memory Issues**
```bash
# Check GPU memory
nvidia-smi

# Reduce batch size
export BATCH_SIZE=1

# Clear GPU cache
python3 -c "import torch; torch.cuda.empty_cache()"
```

#### **Model Loading Issues**
```bash
# Check HuggingFace token
echo $HF_TOKEN

# Test model access
huggingface-cli login
```

#### **Network Issues**
```bash
# Test node connectivity
ping jw2
ping jw3

# Check SSH access
ssh jw2 "hostname"
ssh jw3 "hostname"
```

### **Debug Mode**
```bash
# Enable verbose logging
export PYTHONPATH=src:$PYTHONPATH
python3 src/mlperf_benchmark.py --type single --samples 1 --verbose
```

---

## 🎯 **Performance Optimization**

### **A30 GPU Optimization**
- **Memory Usage**: ~16GB optimal utilization
- **Precision**: FP16 for memory efficiency
- **Batch Size**: 1 for latency optimization
- **Sequence Length**: 2048 max for balance

### **Multi-Node Optimization**
- **NTP Sync**: Critical for coordinated benchmarks
- **Network**: Calico CNI optimized for performance
- **Load Balancing**: Automatic distribution across nodes

---

## 📋 **Next Steps & Roadmap**

### **Current Status** ✅
- ✅ Multi-GPU scaling (2.05x efficiency)
- ✅ MLPerf Datacenter compliance
- ✅ Automated reporting
- ✅ Hardware abstraction

### **Planned Improvements** 🔄
- 🔄 Additional NPU support
- 🔄 Helm chart deployment
- 🔄 Advanced monitoring
- 🔄 Model optimization

### **Future Enhancements** 📋
- 📋 Multi-cluster support
- 📋 Custom model support
- 📋 Performance profiling
- 📋 CI/CD integration

---

## 🤝 **Contributing**

1. **Fork** the repository
2. **Create** a feature branch
3. **Test** on your hardware
4. **Submit** a pull request

### **Development Setup**
```bash
git clone https://github.com/jshim0978/MLPerf_local_test.git
cd MLPerf_local_test
./scripts/setup-environment.sh
source venv/bin/activate
```

---

## 📄 **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 **Acknowledgments**

- **MLCommons** for MLPerf specifications
- **NVIDIA** for A30 GPU support
- **Furiosa AI** for NPU integration
- **Kubernetes Community** for orchestration platform

---

<div align="center">

**📊 Benchmarked** | **🚀 Optimized** | **🔧 Production Ready**

*Built for high-performance AI inference at scale*

</div>