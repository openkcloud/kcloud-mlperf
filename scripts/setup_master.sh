#!/bin/bash
# ============================================================================
# setup_master.sh - Master Node Setup for K-Cloud MLPerf Benchmarks
# ============================================================================
# Run this script on the master/control-plane node to set up Kubernetes.
#
# Usage:
#   ./scripts/setup_master.sh [--config config/cluster.env]
#
# Prerequisites:
#   - Ubuntu 20.04/22.04
#   - Root or sudo access
#   - Network connectivity to worker nodes
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
else
    warn "No config file found. Using defaults."
    MASTER_IP=$(hostname -I | awk '{print $1}')
    POD_NETWORK_CIDR="10.244.0.0/16"
    K8S_VERSION="1.28"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║     K-Cloud MLPerf - Master Node Setup                           ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "  Master IP: $MASTER_IP"
echo "  K8s Version: $K8S_VERSION"
echo "  Pod Network: $POD_NETWORK_CIDR"
echo ""

# ============================================================================
# Step 1: System Prerequisites
# ============================================================================
install_prerequisites() {
    log "[1/7] Installing prerequisites..."
    
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
# Step 2: Install containerd
# ============================================================================
install_containerd() {
    log "[2/7] Installing containerd..."
    
    if command -v containerd &>/dev/null; then
        success "containerd already installed"
        return
    fi
    
    sudo apt-get update
    sudo apt-get install -y containerd
    
    # Configure containerd
    sudo mkdir -p /etc/containerd
    containerd config default | sudo tee /etc/containerd/config.toml >/dev/null
    sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
    
    sudo systemctl restart containerd
    sudo systemctl enable containerd
    
    success "containerd installed and configured"
}

# ============================================================================
# Step 3: Install kubeadm, kubelet, kubectl
# ============================================================================
install_kubernetes() {
    log "[3/7] Installing Kubernetes components..."
    
    if command -v kubeadm &>/dev/null; then
        success "Kubernetes already installed: $(kubeadm version -o short)"
        return
    fi
    
    sudo apt-get update
    sudo apt-get install -y apt-transport-https ca-certificates curl gpg
    
    # Add Kubernetes repository
    curl -fsSL https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION}/deb/Release.key | \
        sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    
    echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION}/deb/ /" | \
        sudo tee /etc/apt/sources.list.d/kubernetes.list
    
    sudo apt-get update
    sudo apt-get install -y kubelet kubeadm kubectl
    sudo apt-mark hold kubelet kubeadm kubectl
    
    success "Kubernetes components installed"
}

# ============================================================================
# Step 4: Initialize Kubernetes cluster
# ============================================================================
init_cluster() {
    log "[4/7] Initializing Kubernetes cluster..."
    
    # Check if already initialized
    if [ -f /etc/kubernetes/admin.conf ]; then
        warn "Cluster already initialized. Skipping."
        return
    fi
    
    # Create kubeadm config
    cat > /tmp/kubeadm-config.yaml <<EOF
apiVersion: kubeadm.k8s.io/v1beta3
kind: InitConfiguration
localAPIEndpoint:
  advertiseAddress: ${MASTER_IP}
  bindPort: 6443
---
apiVersion: kubeadm.k8s.io/v1beta3
kind: ClusterConfiguration
kubernetesVersion: v${K8S_VERSION}.0
networking:
  podSubnet: ${POD_NETWORK_CIDR}
controlPlaneEndpoint: "${MASTER_IP}:6443"
---
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cgroupDriver: systemd
EOF
    
    # Save config for future reference
    sudo cp /tmp/kubeadm-config.yaml /etc/kubernetes/kubeadm-config.yaml
    
    # Initialize cluster
    sudo kubeadm init --config=/tmp/kubeadm-config.yaml
    
    # Setup kubeconfig for current user
    mkdir -p $HOME/.kube
    sudo cp -f /etc/kubernetes/admin.conf $HOME/.kube/config
    sudo chown $(id -u):$(id -g) $HOME/.kube/config
    
    success "Kubernetes cluster initialized"
}

# ============================================================================
# Step 5: Install CNI (Flannel)
# ============================================================================
install_cni() {
    log "[5/7] Installing Flannel CNI..."
    
    if kubectl get pods -n kube-flannel 2>/dev/null | grep -q Running; then
        success "Flannel already installed"
        return
    fi
    
    kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml
    
    log "Waiting for Flannel to be ready..."
    kubectl wait --for=condition=ready pod -l app=flannel -n kube-flannel --timeout=120s || true
    
    success "Flannel CNI installed"
}

# ============================================================================
# Step 6: Create NVIDIA RuntimeClass
# ============================================================================
create_nvidia_runtime() {
    log "[6/7] Creating NVIDIA RuntimeClass..."
    
    if kubectl get runtimeclass nvidia 2>/dev/null; then
        success "NVIDIA RuntimeClass already exists"
        return
    fi
    
    cat <<EOF | kubectl apply -f -
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: nvidia
handler: nvidia
EOF
    
    success "NVIDIA RuntimeClass created"
}

# ============================================================================
# Step 7: Generate worker join command
# ============================================================================
generate_join_command() {
    log "[7/7] Generating worker join command..."
    
    JOIN_CMD=$(kubeadm token create --print-join-command)
    
    # Save join command
    echo "$JOIN_CMD" > "$PROJECT_ROOT/config/join-command.sh"
    chmod +x "$PROJECT_ROOT/config/join-command.sh"
    
    success "Join command saved to config/join-command.sh"
    echo ""
    echo "Run this on worker nodes:"
    echo "  sudo $JOIN_CMD"
}

# ============================================================================
# Main
# ============================================================================
main() {
    # Check if running as root or with sudo
    if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
        error "This script requires root/sudo access"
    fi
    
    install_prerequisites
    install_containerd
    install_kubernetes
    init_cluster
    install_cni
    create_nvidia_runtime
    generate_join_command
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║                    Master Node Setup Complete!                   ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    kubectl cluster-info
    echo ""
    kubectl get nodes
    echo ""
    echo "Next steps:"
    echo "  1. Run setup_worker.sh on each GPU worker node"
    echo "  2. Run preflight.sh to verify the cluster"
    echo "  3. Run run_benchmarks.sh to start benchmarking"
    echo ""
}

main "$@"
