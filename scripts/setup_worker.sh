#!/bin/bash
# ============================================================================
# setup_worker.sh - GPU Worker Node Setup for K-Cloud MLPerf Benchmarks
# ============================================================================
# Run this script on each GPU worker node to join the Kubernetes cluster
# and set up NVIDIA container runtime.
#
# Usage:
#   ./scripts/setup_worker.sh [--config config/cluster.env]
#
# Prerequisites:
#   - Ubuntu 20.04/22.04
#   - NVIDIA GPU with driver installed
#   - Root or sudo access
#   - Network connectivity to master node
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Load configuration
CONFIG_FILE="${1:-$PROJECT_ROOT/config/cluster.env}"
if [ -f "$PROJECT_ROOT/config/cluster.env.local" ]; then
    CONFIG_FILE="$PROJECT_ROOT/config/cluster.env.local"
fi

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
    log "Loaded config from $CONFIG_FILE"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║     K-Cloud MLPerf - GPU Worker Node Setup                       ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================================
# Step 1: Check NVIDIA Driver
# ============================================================================
check_nvidia_driver() {
    log "[1/8] Checking NVIDIA driver..."
    
    if ! command -v nvidia-smi &>/dev/null; then
        error "NVIDIA driver not installed. Please install NVIDIA driver first."
    fi
    
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
    success "NVIDIA driver found"
}

# ============================================================================
# Step 2: System Prerequisites
# ============================================================================
install_prerequisites() {
    log "[2/8] Installing prerequisites..."
    
    # Disable swap
    sudo swapoff -a
    sudo sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab
    
    # Load required modules
    cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
    sudo modprobe overlay
    sudo modprobe br_netfilter
    
    # Sysctl settings
    cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
    sudo sysctl --system >/dev/null 2>&1
    
    success "Prerequisites configured"
}

# ============================================================================
# Step 3: Install containerd
# ============================================================================
install_containerd() {
    log "[3/8] Installing containerd..."
    
    if command -v containerd &>/dev/null; then
        success "containerd already installed"
    else
        sudo apt-get update
        sudo apt-get install -y containerd
    fi
    
    # Configure containerd with NVIDIA runtime
    sudo mkdir -p /etc/containerd
    containerd config default | sudo tee /etc/containerd/config.toml >/dev/null
    sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
    
    success "containerd installed"
}

# ============================================================================
# Step 4: Install NVIDIA Container Toolkit
# ============================================================================
install_nvidia_container_toolkit() {
    log "[4/8] Installing NVIDIA Container Toolkit..."
    
    if nvidia-ctk --version &>/dev/null 2>&1; then
        success "NVIDIA Container Toolkit already installed"
    else
        distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
        curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
            sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null || true
        
        curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
            sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
            sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
        
        sudo apt-get update
        sudo apt-get install -y nvidia-container-toolkit
    fi
    
    success "NVIDIA Container Toolkit installed"
}

# ============================================================================
# Step 5: Configure containerd for NVIDIA
# ============================================================================
configure_nvidia_runtime() {
    log "[5/8] Configuring NVIDIA runtime for containerd..."
    
    # Configure containerd to use nvidia runtime
    sudo nvidia-ctk runtime configure --runtime=containerd
    
    # Add nvidia as default runtime handler
    sudo sed -i 's/default_runtime_name = "runc"/default_runtime_name = "nvidia"/' /etc/containerd/config.toml 2>/dev/null || true
    
    # Restart containerd
    sudo systemctl restart containerd
    sudo systemctl enable containerd
    
    success "NVIDIA runtime configured"
}

# ============================================================================
# Step 6: Install kubeadm, kubelet
# ============================================================================
install_kubernetes() {
    log "[6/8] Installing Kubernetes components..."
    
    K8S_VERSION="${K8S_VERSION:-1.28}"
    
    if command -v kubelet &>/dev/null; then
        success "Kubernetes already installed: $(kubelet --version)"
        return
    fi
    
    sudo apt-get update
    sudo apt-get install -y apt-transport-https ca-certificates curl gpg
    
    # Add Kubernetes repository
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION}/deb/Release.key | \
        sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg 2>/dev/null || true
    
    echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION}/deb/ /" | \
        sudo tee /etc/apt/sources.list.d/kubernetes.list
    
    sudo apt-get update
    sudo apt-get install -y kubelet kubeadm kubectl
    sudo apt-mark hold kubelet kubeadm kubectl
    
    success "Kubernetes components installed"
}

# ============================================================================
# Step 7: Create data directories
# ============================================================================
create_directories() {
    log "[7/8] Creating data directories..."
    
    DATA_DIR="${DATA_DIR:-/data}"
    HF_CACHE_DIR="${HF_CACHE_DIR:-/data/hf-cache}"
    
    sudo mkdir -p "$DATA_DIR"
    sudo mkdir -p "$HF_CACHE_DIR"
    sudo mkdir -p "$DATA_DIR/mlcommons-inference"
    sudo chmod -R 777 "$DATA_DIR"
    
    success "Data directories created at $DATA_DIR"
}

# ============================================================================
# Step 8: Label node for GPU scheduling
# ============================================================================
label_node() {
    log "[8/8] GPU node ready for labeling..."
    
    echo ""
    echo "After joining the cluster, run this on the master node:"
    echo "  kubectl label node $(hostname) nvidia.com/gpu.present=true"
    echo ""
}

# ============================================================================
# Join Cluster
# ============================================================================
join_cluster() {
    log "Joining Kubernetes cluster..."
    
    JOIN_CMD_FILE="$PROJECT_ROOT/config/join-command.sh"
    
    if [ -f "$JOIN_CMD_FILE" ]; then
        log "Using join command from $JOIN_CMD_FILE"
        sudo bash "$JOIN_CMD_FILE"
        success "Joined cluster successfully"
    else
        echo ""
        warn "No join command file found."
        echo "Run the following on this node (get the command from master):"
        echo "  sudo kubeadm join <master-ip>:6443 --token <token> --discovery-token-ca-cert-hash <hash>"
        echo ""
    fi
}

# ============================================================================
# Main
# ============================================================================
main() {
    # Check if running as root or with sudo
    if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
        error "This script requires root/sudo access"
    fi
    
    check_nvidia_driver
    install_prerequisites
    install_containerd
    install_nvidia_container_toolkit
    configure_nvidia_runtime
    install_kubernetes
    create_directories
    label_node
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║                  Worker Node Setup Complete!                     ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    
    read -p "Join cluster now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        join_cluster
    fi
    
    echo ""
    echo "Next steps (on master node):"
    echo "  1. kubectl get nodes  # Verify worker joined"
    echo "  2. kubectl label node $(hostname) nvidia.com/gpu.present=true"
    echo "  3. ./scripts/preflight.sh  # Verify everything is ready"
    echo "  4. ./scripts/run_benchmarks.sh --smoke  # Run benchmarks"
    echo ""
}

main "$@"
