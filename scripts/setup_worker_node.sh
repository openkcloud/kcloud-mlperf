#!/bin/bash
# ============================================================================
# setup_worker_node.sh - Kubernetes Worker Node Setup with NVIDIA GPU
# ============================================================================
# Sets up this machine as a Kubernetes GPU worker node.
# Run this on the remote server (kcloud@129.254.202.129).
# ============================================================================

set -e

echo "============================================================================"
echo "       Kubernetes GPU Worker Node Setup (A30)"
echo "============================================================================"

WORKER_IP=$(hostname -I | awk '{print $1}')
echo "Worker IP: ${WORKER_IP}"

# ============================================================================
# Step 1: Install container runtime (containerd)
# ============================================================================
install_containerd() {
    echo "[1/6] Installing containerd..."
    
    # Load required kernel modules
    cat <<EOF | sudo tee /etc/modules-load.d/containerd.conf
overlay
br_netfilter
EOF
    sudo modprobe overlay
    sudo modprobe br_netfilter
    
    # Set up required sysctl params
    cat <<EOF | sudo tee /etc/sysctl.d/99-kubernetes-cri.conf
net.bridge.bridge-nf-call-iptables  = 1
net.ipv4.ip_forward                 = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF
    sudo sysctl --system
    
    # Install containerd
    sudo apt-get update
    sudo apt-get install -y containerd
    
    # Configure containerd
    sudo mkdir -p /etc/containerd
    containerd config default | sudo tee /etc/containerd/config.toml
    sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
    
    sudo systemctl restart containerd
    sudo systemctl enable containerd
    
    echo "containerd installed"
}

# ============================================================================
# Step 2: Install NVIDIA Driver (if not present)
# ============================================================================
install_nvidia_driver() {
    echo "[2/6] Checking NVIDIA driver..."
    
    if command -v nvidia-smi &> /dev/null; then
        echo "NVIDIA driver already installed:"
        nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
        return
    fi
    
    echo "Installing NVIDIA driver..."
    sudo apt-get update
    sudo apt-get install -y linux-headers-$(uname -r)
    
    # Add NVIDIA repository
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    
    # Install driver
    sudo apt-get install -y nvidia-driver-535
    
    echo "NVIDIA driver installed. A reboot may be required."
}

# ============================================================================
# Step 3: Install NVIDIA Container Toolkit
# ============================================================================
install_nvidia_container_toolkit() {
    echo "[3/6] Installing NVIDIA Container Toolkit..."
    
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null || true
    
    curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    
    sudo apt-get update
    sudo apt-get install -y nvidia-container-toolkit
    
    # Configure containerd to use NVIDIA runtime
    sudo nvidia-ctk runtime configure --runtime=containerd
    sudo systemctl restart containerd
    
    echo "NVIDIA Container Toolkit installed"
}

# ============================================================================
# Step 4: Install kubeadm, kubelet, kubectl
# ============================================================================
install_kubernetes() {
    echo "[4/6] Installing Kubernetes components..."
    
    # Disable swap
    sudo swapoff -a
    sudo sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab
    
    # Add Kubernetes apt repository
    sudo apt-get update
    sudo apt-get install -y apt-transport-https ca-certificates curl gpg
    
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg 2>/dev/null || true
    
    echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
    
    sudo apt-get update
    sudo apt-get install -y kubelet kubeadm kubectl
    sudo apt-mark hold kubelet kubeadm kubectl
    
    echo "Kubernetes components installed"
}

# ============================================================================
# Step 5: Create data directories
# ============================================================================
create_data_dirs() {
    echo "[5/6] Creating data directories..."
    
    sudo mkdir -p /data/hf-cache
    sudo mkdir -p /data/hf-home
    sudo mkdir -p /data/results
    sudo mkdir -p /data/work
    sudo chmod -R 777 /data
    
    echo "Data directories created"
}

# ============================================================================
# Step 6: Display join instructions
# ============================================================================
display_instructions() {
    echo "[6/6] Setup complete!"
    echo ""
    echo "============================================================================"
    echo "                    Worker Node Setup Complete!"
    echo "============================================================================"
    echo ""
    echo "GPU Status:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "GPU not detected (driver may need reboot)"
    echo ""
    echo "Next steps:"
    echo "1. Get the join command from the master node"
    echo "2. Run: sudo kubeadm join <master-ip>:6443 --token <token> --discovery-token-ca-cert-hash <hash>"
    echo ""
    echo "To verify GPU is available after joining:"
    echo "  kubectl get nodes"
    echo "  kubectl describe node $(hostname) | grep -A5 'Allocatable:'"
    echo ""
}

# ============================================================================
# Main
# ============================================================================
main() {
    echo ""
    echo "This will set up this machine as a Kubernetes GPU worker node."
    echo "Worker IP: ${WORKER_IP}"
    echo ""
    read -p "Continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    
    install_containerd
    install_nvidia_driver
    install_nvidia_container_toolkit
    install_kubernetes
    create_data_dirs
    display_instructions
}

main "$@"