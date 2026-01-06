# Multi-Node K8s Cluster Setup (Master + GPU Worker)

This guide covers setting up a Kubernetes cluster for running MLPerf, MMLU-Pro, and LLM inference benchmarks on Llama-3.1-8B.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Kubernetes Cluster                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐        ┌────────────────────────────────────────┐ │
│  │   Master Node        │        │      GPU Worker Node                   │ │
│  │  (Local WSL Machine) │◄──────►│   (Remote: 129.254.202.129)            │ │
│  │                      │  K8s   │                                        │ │
│  │  - Control Plane     │  API   │  - NVIDIA A30 (24GB)                   │ │
│  │  - kubectl           │        │  - MLPerf/MMLU Jobs                    │ │
│  │  - Scheduling        │        │  - Llama-3.1-8B Inference              │ │
│  └──────────────────────┘        └────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Benchmarks Overview

| Job Name | Benchmark | Dataset | Metric | Threshold |
|----------|-----------|---------|--------|-----------|
| `mlperf-inference-llama-3.1-8b` | MLPerf LLM Inference | CNN/DailyMail | ROUGE-L | >= 0.40 |
| `mmlu-pro-llama-3.1-8b` | MMLU-Pro | TIGER-Lab/MMLU-Pro | Accuracy | >= 0.65 |
| `llm-inference-test-llama-3.1-8b` | Interactive Demo | N/A | Throughput | N/A |

## Prerequisites

### Master Node (Local Machine - WSL2)
- WSL2 with Ubuntu 20.04/22.04
- Network connectivity to remote server
- SSH access to worker node

### Worker Node (Remote Server)
- **Host**: `kcloud@129.254.202.129`
- **Password**: `kcloudserver`
- **GPU**: NVIDIA A30 (24GB VRAM)
- **OS**: Ubuntu 20.04/22.04
- NVIDIA Driver installed (535.x+)

## Quick Setup

### Step 1: Set up SSH Key Authentication

```bash
# On local machine (WSL)
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""

# Copy key to worker (will prompt for password: kcloudserver)
ssh-copy-id kcloud@129.254.202.129

# Test connection
ssh kcloud@129.254.202.129 "hostname && nvidia-smi --query-gpu=name --format=csv,noheader"
```

### Step 2: Set Up Master Node

```bash
cd /mnt/c/Users/etri-jws/repos/kcloud-mlperf
chmod +x scripts/*.sh

# Run master setup (installs containerd, kubeadm, initializes cluster)
./scripts/setup_master_node.sh
```

This will:
1. Install containerd runtime
2. Install kubeadm, kubelet, kubectl
3. Initialize the Kubernetes control plane
4. Install Flannel CNI for pod networking
5. Generate a join command for worker nodes

### Step 3: Deploy and Join Worker Node

```bash
# Deploy setup script to worker and join cluster
./scripts/deploy_to_worker.sh
```

This will:
1. Copy the worker setup script to the remote server
2. Install containerd, NVIDIA driver, and Container Toolkit
3. Install Kubernetes components
4. Join the worker to the cluster

### Step 4: Install NVIDIA Device Plugin

```bash
# Install NVIDIA device plugin for GPU scheduling
./scripts/install_nvidia_plugin.sh

# Label the GPU worker node
kubectl label nodes <worker-hostname> nvidia.com/gpu.present=true

# Verify GPU is available
kubectl describe node <worker-hostname> | grep -A5 "Allocatable:"
# Should show: nvidia.com/gpu: 1
```

### Step 5: Configure HuggingFace Token

The Llama-3.1-8B model requires a HuggingFace token with access to Meta's models.

1. Get your token from: https://huggingface.co/settings/tokens
2. Accept the Llama license at: https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct

```bash
# Create the secret file (replace YOUR_TOKEN)
cat > k8s/01-secret.yaml << 'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: hf-token
  namespace: mlperf
type: Opaque
stringData:
  HF_TOKEN: "YOUR_HUGGINGFACE_TOKEN_HERE"
EOF

# Apply the secret
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-secret.yaml
```

### Step 6: Run Benchmarks

```bash
# Run all three benchmarks sequentially
./scripts/run_all_benchmarks.sh

# Or run specific benchmarks:
./scripts/run_all_benchmarks.sh --mlperf-only    # Only MLPerf
./scripts/run_all_benchmarks.sh --mmlu-only      # Only MMLU-Pro
./scripts/run_all_benchmarks.sh --inference-only # Only LLM inference test
```

## Manual Job Execution

If you prefer to run jobs individually:

```bash
# Apply namespace and secret
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-secret.yaml

# Run MLPerf benchmark (~9-10 hours)
kubectl apply -f k8s/02-mlperf-job-FULL.yaml
kubectl logs -f -l job-name=mlperf-inference-llama-3.1-8b -n mlperf

# Run MMLU-Pro benchmark (~8 hours)
kubectl apply -f k8s/03-mmlu-job-FULL.yaml
kubectl logs -f -l job-name=mmlu-pro-llama-3.1-8b -n mlperf

# Run LLM inference test (~10 minutes)
kubectl apply -f k8s/04-llm-inference-job.yaml
kubectl logs -f -l job-name=llm-inference-test-llama-3.1-8b -n mlperf
```

## Network Configuration

### Required Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 6443 | TCP | Kubernetes API Server |
| 2379-2380 | TCP | etcd server client API |
| 10250 | TCP | Kubelet API |
| 10259 | TCP | kube-scheduler |
| 10257 | TCP | kube-controller-manager |
| 30000-32767 | TCP | NodePort Services |

### Firewall Rules (on both nodes)

```bash
# On Ubuntu
sudo ufw allow 6443/tcp
sudo ufw allow 2379:2380/tcp
sudo ufw allow 10250/tcp
sudo ufw allow 10259/tcp
sudo ufw allow 10257/tcp
sudo ufw allow 30000:32767/tcp
sudo ufw reload
```

## Expected Benchmark Results

### MLPerf (ROUGE-L on CNN/DailyMail)

| Metric | Threshold | Expected (A30) |
|--------|-----------|----------------|
| ROUGE-L | >= 0.4000 | ~0.4123 |
| Completion Rate | 100% | 100% |
| Processing Time | - | ~9h28m |
| Samples | 13368 | 13368 |

### MMLU-Pro (57 Subjects)

| Metric | Threshold | Expected (A30) |
|--------|-----------|----------------|
| Accuracy | >= 0.6500 | ~0.6842 |
| Completion Rate | 100% | 100% |
| Processing Time | - | ~7h59m |
| Questions | 14042 | 14042 |

### LLM Inference Test

| Metric | Expected (A30) |
|--------|----------------|
| Throughput | ~5.7 tok/s |
| TTFT | ~2.7s |
| Response Time | ~55s for 313 tokens |

## Troubleshooting

### Worker node stuck in NotReady

```bash
# On worker node, check kubelet status
ssh kcloud@129.254.202.129 "sudo systemctl status kubelet"
ssh kcloud@129.254.202.129 "sudo journalctl -xeu kubelet | tail -50"

# Common fix: restart containerd and kubelet
ssh kcloud@129.254.202.129 "sudo systemctl restart containerd && sudo systemctl restart kubelet"
```

### Pod stuck in Pending (no GPU available)

```bash
# Check if GPU is properly detected
kubectl describe node <worker-hostname> | grep nvidia

# If nvidia.com/gpu not shown:
# 1. Verify NVIDIA driver on worker
ssh kcloud@129.254.202.129 nvidia-smi

# 2. Restart NVIDIA device plugin
kubectl delete pod -n kube-system -l name=nvidia-device-plugin-ds
```

### Token expired for joining worker

```bash
# On master, create new token
kubeadm token create --print-join-command
```

### HuggingFace authentication fails

```bash
# Verify secret exists
kubectl get secret hf-token -n mlperf -o yaml

# Test token manually
curl -H "Authorization: Bearer $(kubectl get secret hf-token -n mlperf -o jsonpath='{.data.HF_TOKEN}' | base64 -d)" \
  https://huggingface.co/api/whoami
```

### Network connectivity issues

```bash
# Test connectivity from master to worker
ping 129.254.202.129
nc -zv 129.254.202.129 6443

# Check if worker can reach master API
MASTER_IP=$(hostname -I | awk '{print $1}')
ssh kcloud@129.254.202.129 "curl -k https://${MASTER_IP}:6443"
```

## Useful Commands

```bash
# Check cluster status
kubectl cluster-info
kubectl get nodes -o wide

# Check GPU worker allocatable resources
kubectl describe node <worker-hostname> | grep -A10 Allocatable

# View running pods
kubectl get pods -n mlperf -o wide

# View pod logs
kubectl logs -f <pod-name> -n mlperf

# Describe job details
kubectl describe job <job-name> -n mlperf

# Get job status
kubectl get jobs -n mlperf

# Clean up all jobs
kubectl delete job --all -n mlperf

# Check results on worker node
ssh kcloud@129.254.202.129 "ls -la /data/results/"
```

## Directory Structure

```
kcloud-mlperf/
├── k8s/
│   ├── 00-namespace.yaml           # mlperf namespace
│   ├── 01-secret.yaml              # HuggingFace token secret
│   ├── 02-mlperf-job-FULL.yaml     # MLPerf inference job
│   ├── 03-mmlu-job-FULL.yaml       # MMLU-Pro evaluation job
│   └── 04-llm-inference-job.yaml   # Interactive inference demo
├── scripts/
│   ├── setup_master_node.sh        # Master node setup
│   ├── setup_worker_node.sh        # Worker node setup
│   ├── deploy_to_worker.sh         # Deploy worker remotely
│   ├── install_nvidia_plugin.sh    # NVIDIA device plugin
│   ├── run_all_benchmarks.sh       # Unified benchmark runner
│   └── llm_inference.py            # Standalone inference script
├── mlcommons_inference/            # MLCommons submodule
├── mmlu_pro/                       # MMLU-Pro submodule
├── run.py                          # MLPerf benchmark runner
├── mmlu.py                         # Basic MMLU evaluator
└── mmlu_pro_benchmark.py           # MMLU-Pro wrapper
```

## Submodules

This repository includes two git submodules:

1. **mlcommons_inference** - Official MLCommons inference benchmark
   - URL: https://github.com/mlcommons/inference
   - Used for: MLPerf LLM inference benchmark reference

2. **mmlu_pro** - TIGER-AI-Lab MMLU-Pro benchmark
   - URL: https://github.com/TIGER-AI-Lab/MMLU-Pro
   - Used for: MMLU-Pro evaluation with chain-of-thought

To initialize submodules:

```bash
git submodule update --init --recursive
```
