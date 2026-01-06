#!/bin/bash
# ============================================================================
# setup_k8s_cluster.sh - Kubernetes Cluster Setup with GPU Support
# ============================================================================
# This script sets up a bare-metal Kubernetes cluster with NVIDIA GPU support
# for running MLPerf and MMLU benchmarks on Llama-3.1-8B.
#
# Prerequisites:
#   - Ubuntu 20.04/22.04 or similar Linux distribution
#   - NVIDIA GPU (RTX 4090 or compatible)
#   - NVIDIA Driver installed
#   - Root or sudo access
# ============================================================================

set -e

echo "============================================================================"
echo "       Kubernetes Cluster Setup with GPU Support"
echo "============================================================================"

# ============================================================================
# Step 1: Install Docker
# ============================================================================
install_docker() {
    echo "[1/6] Installing Docker..."
    
    if command -v docker &> /dev/null; then
        echo "Docker already installed: $(docker --version)"
        return
    fi
    
    # Install Docker
    sudo apt-get update
    sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
    
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io
    
    sudo usermod -aG docker $USER
    echo "Docker installed successfully"
}

# ============================================================================
# Step 2: Install NVIDIA Container Toolkit
# ============================================================================
install_nvidia_container_toolkit() {
    echo "[2/6] Installing NVIDIA Container Toolkit..."
    
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    
    curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    
    sudo apt-get update
    sudo apt-get install -y nvidia-container-toolkit
    
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker
    
    echo "NVIDIA Container Toolkit installed"
}

# ============================================================================
# Step 3: Install kubectl
# ============================================================================
install_kubectl() {
    echo "[3/6] Installing kubectl..."
    
    if command -v kubectl &> /dev/null; then
        echo "kubectl already installed: $(kubectl version --client --short 2>/dev/null || kubectl version --client)"
        return
    fi
    
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
    sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
    rm kubectl
    
    echo "kubectl installed"
}

# ============================================================================
# Step 4: Install kind (for local testing)
# ============================================================================
install_kind() {
    echo "[4/6] Installing kind..."
    
    if command -v kind &> /dev/null; then
        echo "kind already installed: $(kind --version)"
        return
    fi
    
    curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
    chmod +x ./kind
    sudo mv ./kind /usr/local/bin/kind
    
    echo "kind installed"
}

# ============================================================================
# Step 5: Create Kind Cluster with GPU Support
# ============================================================================
create_kind_cluster() {
    echo "[5/6] Creating Kind cluster with GPU support..."
    
    # Create kind config for GPU passthrough
    cat > /tmp/kind-gpu-config.yaml << 'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  extraMounts:
  - hostPath: /dev/null
    containerPath: /dev/null
- role: worker
  extraMounts:
  - hostPath: /data
    containerPath: /data
EOF

    # Delete existing cluster if present
    kind delete cluster --name mlperf-cluster 2>/dev/null || true
    
    # Create new cluster
    kind create cluster --name mlperf-cluster --config /tmp/kind-gpu-config.yaml
    
    echo "Kind cluster created"
}

# ============================================================================
# Step 6: Install NVIDIA Device Plugin
# ============================================================================
install_nvidia_device_plugin() {
    echo "[6/6] Installing NVIDIA Device Plugin..."
    
    kubectl create -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.0/nvidia-device-plugin.yml
    
    echo "Waiting for NVIDIA device plugin to be ready..."
    kubectl wait --for=condition=ready pod -l name=nvidia-device-plugin-ds -n kube-system --timeout=300s || true
    
    echo "NVIDIA Device Plugin installed"
}

# ============================================================================
# Main execution
# ============================================================================
main() {
    echo ""
    echo "This script will install:"
    echo "  - Docker"
    echo "  - NVIDIA Container Toolkit"
    echo "  - kubectl"
    echo "  - kind"
    echo "  - Create a Kind cluster with GPU support"
    echo "  - Install NVIDIA Device Plugin"
    echo ""
    read -p "Continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    
    install_docker
    install_nvidia_container_toolkit
    install_kubectl
    install_kind
    create_kind_cluster
    install_nvidia_device_plugin
    
    echo ""
    echo "============================================================================"
    echo "                    Setup Complete!"
    echo "============================================================================"
    echo ""
    kubectl cluster-info
    echo ""
    kubectl get nodes
    echo ""
    echo "To verify GPU availability:"
    echo "  kubectl get nodes -o jsonpath='{.items[*].status.allocatable.nvidia\.com/gpu}'"
    echo ""
    echo "Next steps:"
    echo "  1. cd /path/to/kcloud-mlperf"
    echo "  2. ./scripts/run_benchmarks.sh"
    echo ""
}

main "$@"