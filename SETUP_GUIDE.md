# MLPerf Infrastructure Setup Guide

## 🎯 Quick Setup for Any Infrastructure

This guide helps you configure MLPerf benchmarks for **your specific infrastructure** - whether you have different IPs, hostnames, GPU types, or deployment methods.

## 📋 Step 1: Configure Your Infrastructure

### 1.1 Create Configuration File
```bash
# Create example configuration
python3 config_manager.py --create-example

# Copy and customize for your infrastructure  
cp config.yaml.example config.yaml
nano config.yaml  # Edit with your details
```

### 1.2 Update GPU Node Information
Edit `config.yaml` with your infrastructure details:

```yaml
# Example: Your GPU cluster
infrastructure:
  deployment_type: "ssh"  # ssh, kubernetes, docker, local
  
  gpu_nodes:
    - name: "workstation-1"        # Your custom name
      ip: "10.0.0.50"              # Your actual IP
      ssh_user: "your-username"    # Your SSH username
      gpu_type: "NVIDIA RTX 4090"  # Your GPU model
      gpu_memory: "24GB"
      
    - name: "server-gpu-2"         # Another custom name
      ip: "10.0.0.51"              # Another IP
      ssh_user: "your-username"    # Your SSH username  
      gpu_type: "NVIDIA A100"      # Different GPU is fine
      gpu_memory: "80GB"
```

### 1.3 Common Infrastructure Examples

#### Multi-GPU Workstation
```yaml
infrastructure:
  deployment_type: "local"
  gpu_nodes:
    - name: "local-gpu-0"
      ip: "localhost" 
      ssh_user: "$(whoami)"
      gpu_type: "NVIDIA RTX 4090"
```

#### Cloud Infrastructure (AWS/GCP/Azure)
```yaml
infrastructure:
  deployment_type: "ssh"
  gpu_nodes:
    - name: "aws-p3-instance-1"
      ip: "ec2-xx-xx-xx-xx.compute-1.amazonaws.com"
      ssh_user: "ubuntu"
      gpu_type: "NVIDIA V100"
      
    - name: "gcp-a100-instance-1"  
      ip: "35.xxx.xxx.xxx"
      ssh_user: "your-username"
      gpu_type: "NVIDIA A100"
```

#### University/Corporate Cluster
```yaml
infrastructure:
  deployment_type: "ssh"
  gpu_nodes:
    - name: "hpc-node-01"
      ip: "hpc-node-01.university.edu" 
      ssh_user: "student123"
      gpu_type: "NVIDIA A30"
      
    - name: "hpc-node-02"
      ip: "hpc-node-02.university.edu"
      ssh_user: "student123" 
      gpu_type: "NVIDIA A30"
```

## 📋 Step 2: Generate Custom Scripts

### 2.1 Validate Configuration
```bash
# Check if your configuration is valid
python3 config_manager.py --validate

# Expected output:
# ✅ Configuration is valid!
# 📋 Configuration Summary:
#    Deployment Type: ssh
#    GPU Nodes: 2
#      - workstation-1: 10.0.0.50 (NVIDIA RTX 4090)
#      - server-gpu-2: 10.0.0.51 (NVIDIA A100)
```

### 2.2 Generate Infrastructure-Specific Scripts
```bash
# Generate customized scripts for your infrastructure
python3 config_manager.py --generate-scripts

# This creates:
# ✅ Generated: monitor_benchmarks.sh   # Monitors YOUR specific nodes
# ✅ Generated: run_benchmarks.sh       # Runs on YOUR specific infrastructure
```

## 📋 Step 3: Setup Remote Nodes

### 3.1 Install MLPerf on Each GPU Node
For each GPU node in your configuration:

```bash
# SSH to each node and setup MLPerf
ssh your-username@your-gpu-node-ip

# Clone official MLPerf
git clone https://github.com/mlcommons/inference.git
cd inference/language/llama3.1-8b

# Install dependencies
pip install torch vllm pandas numpy transformers

# Download dataset
python3 download_cnndm.py

# Test installation
python3 main.py --help
```

### 3.2 Configure SSH Access (if using SSH deployment)
```bash
# Setup passwordless SSH to each node
ssh-keygen -t rsa -b 4096 -C "mlperf-benchmark"
ssh-copy-id your-username@your-gpu-node-ip

# Test SSH access
ssh your-username@your-gpu-node-ip "nvidia-smi"
```

## 📋 Step 4: Run Benchmarks

### 4.1 Start Benchmarks
```bash
# Start benchmarks on all configured nodes
./run_benchmarks.sh

# Expected output:
# 🚀 Starting MLPerf Benchmarks on Configured Infrastructure
# 🎯 Starting benchmark on workstation-1 (10.0.0.50)...
# ✅ Benchmark started on workstation-1
# 🎯 Starting benchmark on server-gpu-2 (10.0.0.51)...  
# ✅ Benchmark started on server-gpu-2
```

### 4.2 Monitor Progress
```bash
# Live monitoring with auto-refresh
./monitor_benchmarks.sh watch

# Check status once
./monitor_benchmarks.sh status

# Collect final results and generate reports
./monitor_benchmarks.sh results
```

## 📋 Step 5: Different Deployment Types

### Kubernetes Deployment
```yaml
# In config.yaml
infrastructure:
  deployment_type: "kubernetes"
  gpu_nodes:
    - name: "gpu-pod-1"
      ip: "10.244.0.10"  # Pod IP
      ssh_user: "root"
      
kubernetes:
  namespace: "mlperf"
  config_file: "~/.kube/config"
  gpu_resource: "nvidia.com/gpu"
```

### Docker Deployment  
```yaml
# In config.yaml
infrastructure:
  deployment_type: "docker"
  gpu_nodes:
    - name: "docker-gpu-1"
      ip: "localhost"
      
docker:
  image: "mlperf-inference:latest"
  runtime: "nvidia"
  volumes:
    - "/data:/data"
    - "/models:/models"
```

### Local Multi-GPU
```yaml
# In config.yaml
infrastructure:
  deployment_type: "local"
  gpu_nodes:
    - name: "local-gpu-0"
      ip: "localhost"
    - name: "local-gpu-1"  
      ip: "localhost"
      
local:
  python_env: "conda"
  env_name: "mlperf"
```

## 🔧 Troubleshooting

### Configuration Issues
```bash
# Validate configuration
python3 config_manager.py --validate

# Common issues:
# ❌ Missing required field: ip
# ❌ No GPU nodes configured  
# ❌ At least one GPU node must be configured
```

### SSH Connection Issues
```bash
# Test SSH connectivity
ssh -o ConnectTimeout=10 your-username@your-gpu-node-ip "echo 'Connection successful'"

# Check SSH key authentication
ssh-add -l
ssh -v your-username@your-gpu-node-ip
```

### GPU Detection Issues
```bash
# On each GPU node, verify GPU access
nvidia-smi
python3 -c "import torch; print(torch.cuda.is_available())"
```

## 📊 Automatic Visual Reports

The system automatically generates visual reports when benchmarks complete:

- **Static Charts**: `results/visual_reports_*/mlperf_static_report.png`
- **Interactive Dashboard**: `results/visual_reports_*/mlperf_interactive_dashboard.html`  
- **Summary Report**: `results/visual_reports_*/README.md`

## 🎯 Benefits of Configurable Infrastructure

✅ **Universal Compatibility**: Works with any GPU infrastructure  
✅ **Easy Customization**: Simple YAML configuration  
✅ **Auto-Generated Scripts**: No manual script editing required  
✅ **Multiple Deployment Types**: SSH, Kubernetes, Docker, Local  
✅ **Flexible GPU Support**: Any NVIDIA GPU with sufficient memory  
✅ **Automatic Monitoring**: Custom monitoring for your specific nodes  

Your colleagues can now easily adapt this repository to their own infrastructure by simply updating `config.yaml` with their IPs, usernames, and deployment preferences!