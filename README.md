## kcloud-mlperf — Kubernetes LLM Benchmark Suite (Llama 3.1 8B)

Portable benchmark suite for evaluating LLM inference performance on bare-metal Kubernetes clusters with NVIDIA GPUs.

| Benchmark | Description | Implementation |
|-----------|-------------|----------------|
| **MLPerf Inference** | CNN/DailyMail summarization → ROUGE scores | Official MLCommons LoadGen |
| **MMLU-Pro** | 5-shot Chain-of-Thought evaluation → Accuracy | TIGER-Lab Official |
| **LLM Inference** | vLLM throughput test | vLLM Backend |

> **Tip**: Always run `--smoke` test first (10 samples, ~15 min), then scale to full dataset.

---

## 🚀 Quick Start (3 Steps)

### Prerequisites
- 2+ Ubuntu 22.04 machines (1 master, 1+ GPU worker)
- NVIDIA GPU with driver installed on worker nodes
- HuggingFace token for Llama 3.1 access

### Step 1: Configure Your Cluster

```bash
# Clone the repository
git clone --recursive https://github.com/openkcloud/kcloud-mlperf.git
cd kcloud-mlperf

# Copy and edit configuration
cp config/cluster.env config/cluster.env.local
nano config/cluster.env.local
```

Edit `config/cluster.env.local`:
```bash
MASTER_IP="YOUR_MASTER_IP"
WORKER_IP="YOUR_WORKER_IP"
WORKER_USER="your-user"
HF_TOKEN="hf_your_token_here"
```

### Step 2: Setup Cluster

**On Master Node:**
```bash
./scripts/setup_master.sh
```

**On Each GPU Worker Node:**
```bash
./scripts/setup_worker.sh
```

**After worker joins, on Master:**
```bash
kubectl label node <worker-hostname> nvidia.com/gpu.present=true
```

### Step 3: Run Benchmarks

```bash
# Verify cluster is ready
./scripts/preflight.sh

# Run smoke test (~15 min)
./scripts/run_benchmarks.sh --smoke

# Run full benchmark suite (8-10 hours)
./scripts/run_benchmarks.sh
```

---

## 📁 Project Structure

```
kcloud-mlperf/
├── config/
│   ├── cluster.env          # Cluster configuration template
│   └── cluster.env.local    # Your local config (gitignored)
├── scripts/
│   ├── setup_master.sh      # Master node setup
│   ├── setup_worker.sh      # GPU worker node setup
│   ├── preflight.sh         # Pre-flight checks with auto-fix
│   └── run_benchmarks.sh    # Main benchmark runner
├── k8s/jobs/                 # Kubernetes Job manifests
│   ├── mlperf-job.yaml      # Official MLCommons benchmark
│   ├── mmlu-job.yaml        # MMLU-Pro benchmark
│   └── inference-job.yaml   # Throughput benchmark
├── benchmarks/               # Python benchmark scripts
├── results/                  # Benchmark results (auto-generated)
├── mlcommons_inference/      # MLCommons official (submodule)
└── mmlu_pro/                 # TIGER-Lab official (submodule)
```

---

## 🔧 Key Scripts

| Script | Purpose |
|--------|---------|
| `setup_master.sh` | Install K8s on master, create cluster, configure CNI |
| `setup_worker.sh` | Install K8s + NVIDIA runtime on GPU workers |
| `preflight.sh` | Validate cluster, auto-fix common issues |
| `run_benchmarks.sh` | Run benchmarks with progress tracking |

---

## 📊 Benchmark Options

```bash
# Smoke test (10 samples, ~15 min)
./scripts/run_benchmarks.sh --smoke

# Full dataset (8-10 hours)
./scripts/run_benchmarks.sh

# Run specific benchmark only
./scripts/run_benchmarks.sh --smoke --mlperf
./scripts/run_benchmarks.sh --smoke --mmlu
./scripts/run_benchmarks.sh --smoke --inference

# Skip pre-flight checks
./scripts/run_benchmarks.sh --smoke --skip-checks

# Auto-fix issues (e.g., IP changes)
./scripts/run_benchmarks.sh --smoke --fix
```

---

## 📈 Benchmark Details

### MLPerf Inference (Official MLCommons)
- **Dataset**: CNN/DailyMail test split (~13k samples)
- **Metrics**: ROUGE-1, ROUGE-2, ROUGE-L
- **Backend**: vLLM with LoadGen
- **Implementation**: Official MLCommons `inference/language/llama3.1-8b`

### MMLU-Pro
- **Dataset**: TIGER-Lab/MMLU-Pro (~12k questions)
- **Method**: 5-shot Chain-of-Thought (per-category examples)
- **Backend**: vLLM
- **Pass Criteria**: Accuracy ≥ 35%

### LLM Inference Throughput
- **Test**: Single prompt + batch throughput
- **Backend**: vLLM
- **Metrics**: tokens/s, latency

---

## 📁 Results

```
results/<RUN_ID>/
├── summary.txt                 # Overall summary
├── mlperf-bench.log            # MLPerf logs
├── mlperf-bench-metrics.txt    # Extracted metrics
├── mlperf-bench-manifest.yaml  # Job YAML used
├── mmlu-bench.log              # MMLU-Pro logs
├── mmlu-bench-metrics.txt
└── inference-bench.log         # Throughput logs
```

---

## 🔄 Auto-Recovery Features

The benchmark suite includes automatic recovery for common issues:

### Master IP Changed
```bash
# Auto-detect and fix IP change
./scripts/run_benchmarks.sh --fix

# Or run pre-flight with fix
./scripts/preflight.sh --fix
```

### Missing RuntimeClass/Labels
```bash
# Auto-create nvidia RuntimeClass and label GPU nodes
./scripts/preflight.sh --fix
```

### Complete Cluster Reset
```bash
# Reset cluster (if kubeadm was used)
sudo kubeadm reset -f
./scripts/setup_master.sh
```

---

## 🛠 Troubleshooting

### Cannot connect to cluster
```bash
# Check kubelet status
sudo systemctl status kubelet

# Check API server
sudo crictl ps | grep kube-apiserver

# Run diagnostics
./scripts/preflight.sh
```

### Pod stuck in Pending (GPU)
```bash
# Check GPU availability
kubectl get nodes -o jsonpath='{.items[*].status.allocatable.nvidia\.com/gpu}'

# Check device plugin
kubectl logs -n kube-system -l name=nvidia-device-plugin-ds --tail=50

# Restart NVIDIA runtime on worker
ssh <worker> "sudo nvidia-ctk runtime configure --runtime=containerd && sudo systemctl restart containerd kubelet"
```

### DNS/Network Issues
```bash
# Check CoreDNS
kubectl get pods -n kube-system -l k8s-app=kube-dns

# Check Flannel
kubectl get pods -n kube-flannel
```

---

## 📋 Requirements

### Master Node
- Ubuntu 20.04/22.04
- 4+ CPU cores, 8GB+ RAM
- Network access to workers

### GPU Worker Node
- Ubuntu 20.04/22.04  
- NVIDIA GPU (A30, RTX 4090, etc.)
- NVIDIA Driver 535+ installed
- 24GB+ GPU VRAM recommended

### Network
- Access to: `pypi.org`, `huggingface.co`, `cdn-lfs.huggingface.co`
- Ports: 6443 (API), 10250 (kubelet), 8472 (Flannel)

---

## 🔑 HuggingFace Token

1. Get token: https://huggingface.co/settings/tokens (read access)
2. Accept license: https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct
3. Add to config:
```bash
# In config/cluster.env.local
HF_TOKEN="hf_..."
```

---

## 📚 Additional Documentation

- `K8S_SETUP.md` - Manual Kubernetes setup guide
- `MULTINODE_SETUP.md` - Multi-node cluster configuration
- `mlcommons_inference/` - MLCommons official implementation
- `mmlu_pro/` - TIGER-Lab official implementation
