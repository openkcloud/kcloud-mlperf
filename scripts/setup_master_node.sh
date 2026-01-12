#!/bin/bash
# ============================================================================
# setup_master_node.sh - Kubernetes Master Node Setup
# ============================================================================
# Sets up this machine as the Kubernetes control-plane (master) node.
# Run this on the local machine (WSL/Ubuntu).
# ============================================================================

set -e

export DEBIAN_FRONTEND=noninteractive
APT_FLAGS="-y -o DPkg::Options::=--force-confold"
MASTER_CLEAN="${MASTER_CLEAN:-1}" # 1=reset existing kubeadm state before init

echo "============================================================================"
echo "       Kubernetes Master Node Setup"
echo "============================================================================"

# Configuration
MASTER_IP=$(hostname -I | awk '{print $1}')
POD_NETWORK_CIDR="10.244.0.0/16"
K8S_VERSION="1.28.0"

echo "Master IP: ${MASTER_IP}"

# ============================================================================
# Step 1: Install container runtime (containerd)
# ============================================================================
install_containerd() {
    echo "[1/5] Installing containerd..."
    
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
    sudo apt-get install $APT_FLAGS containerd
    
    # Configure containerd
    sudo mkdir -p /etc/containerd
    containerd config default | sudo tee /etc/containerd/config.toml
    sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
    
    sudo systemctl restart containerd
    sudo systemctl enable containerd
    
    echo "containerd installed"
}

# ============================================================================
# Step 2: Install kubeadm, kubelet, kubectl
# ============================================================================
install_kubernetes() {
    echo "[2/5] Installing Kubernetes components..."
    
    # Disable swap
    sudo swapoff -a
    sudo sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab
    
    # Add Kubernetes apt repository
    sudo apt-get update
    sudo apt-get install $APT_FLAGS apt-transport-https ca-certificates curl gpg
    
    sudo rm -f /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    
    echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
    
    sudo apt-get update
    sudo apt-get install $APT_FLAGS kubelet kubeadm kubectl
    sudo apt-mark hold kubelet kubeadm kubectl
    
    echo "Kubernetes components installed"
}

# ============================================================================
# Step 3: Initialize the cluster
# ============================================================================
init_cluster() {
    echo "[3/5] Initializing Kubernetes cluster..."
    
    if [ "$MASTER_CLEAN" = "1" ]; then
        echo "[3/5] Cleaning previous Kubernetes state (kubeadm reset)..."
        sudo kubeadm reset -f || true
        sudo systemctl stop kubelet || true
        # Clean up leftover CNI state (prevents cni0 IP conflicts like 10.42.0.1 vs 10.244.0.1)
        sudo ip link set cni0 down 2>/dev/null || true
        sudo ip link delete cni0 2>/dev/null || true
        sudo ip link delete flannel.1 2>/dev/null || true
        sudo rm -rf /var/run/flannel /run/flannel || true
        sudo rm -rf /etc/kubernetes /var/lib/etcd /var/lib/kubelet /var/run/kubernetes /etc/cni/net.d /var/lib/cni || true
        sudo systemctl restart containerd || true
    fi

    # Initialize the cluster
    sudo kubeadm init \
        --apiserver-advertise-address=${MASTER_IP} \
        --pod-network-cidr=${POD_NETWORK_CIDR} \
        --control-plane-endpoint=${MASTER_IP}:6443 \
        | tee /tmp/kubeadm_init_output.txt
    
    # Set up kubeconfig for current user
    mkdir -p $HOME/.kube
    sudo cp -f /etc/kubernetes/admin.conf $HOME/.kube/config
    sudo chown $(id -u):$(id -g) $HOME/.kube/config
    
    echo "Cluster initialized"
}

# ============================================================================
# Step 4: Install Flannel CNI
# ============================================================================
install_cni() {
    echo "[4/5] Installing Flannel CNI..."
    
    kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml
    
    echo "Flannel CNI installed"
}

# ============================================================================
# Step 5: Generate join command
# ============================================================================
generate_join_command() {
    echo "[5/5] Generating worker join command..."
    
    # Save join command for worker nodes
    kubeadm token create --print-join-command > /tmp/k8s_join_command.sh
    chmod +x /tmp/k8s_join_command.sh
    
    echo ""
    echo "============================================================================"
    echo "                    Master Node Setup Complete!"
    echo "============================================================================"
    echo ""
    echo "Join command saved to: /tmp/k8s_join_command.sh"
    echo ""
    echo "To join the worker node, run this command on the worker:"
    echo "---"
    cat /tmp/k8s_join_command.sh
    echo "---"
    echo ""
    kubectl get nodes
}

# ============================================================================
# Main
# ============================================================================
main() {
    echo ""
    echo "This will set up this machine as a Kubernetes master node."
    echo "Master IP: ${MASTER_IP}"
    echo ""
    if [ -z "${AUTO_YES:-}" ]; then
        read -p "Continue? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        echo "AUTO_YES enabled, continuing without prompt."
    fi
    
    install_containerd
    install_kubernetes
    init_cluster
    install_cni
    generate_join_command
}

main "$@"