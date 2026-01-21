#!/bin/bash
# ============================================================================
# setup_worker.sh - GPU Worker Node Setup for K-Cloud MLPerf Benchmarks
# ============================================================================
# Run this script on each GPU worker node to join the Kubernetes cluster
# and set up NVIDIA container runtime.
#
# Usage:
#   ./scripts/setup_worker.sh [--auto-join] [--config config/cluster.env]
#
# Options:
#   --auto-join    Automatically join the cluster without prompting
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

# Parse command line arguments
AUTO_JOIN=false
CONFIG_FILE="$PROJECT_ROOT/config/cluster.env"

while [[ $# -gt 0 ]]; do
    case $1 in
        --auto-join)
            AUTO_JOIN=true
            shift
            ;;
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        *)
            CONFIG_FILE="$1"
            shift
            ;;
    esac
done

# Load configuration
if [ -f "$PROJECT_ROOT/config/cluster.env.local" ]; then
    CONFIG_FILE="$PROJECT_ROOT/config/cluster.env.local"
fi

if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
    log "Loaded config from $CONFIG_FILE"
fi

# Try to extract MASTER_IP from join command if config is missing
if [ -z "$MASTER_IP" ] && [ -f "$PROJECT_ROOT/config/join-command.sh" ]; then
    # Extract the IP from the kubeadm join command (the IP after the colon in the join address)
    EXTRACTED_IP=$(grep -oE 'kubeadm join [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$PROJECT_ROOT/config/join-command.sh" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [ -n "$EXTRACTED_IP" ]; then
        MASTER_IP="$EXTRACTED_IP"
        log "Extracted MASTER_IP=$MASTER_IP from join command"
    fi
fi

# Try to get MASTER_USER from current user or common defaults
if [ -z "$MASTER_USER" ]; then
    MASTER_USER="${USER:-$(whoami)}"
    log "Using current user as MASTER_USER: $MASTER_USER"
fi

# Validate required configuration
if [ -z "$MASTER_IP" ]; then
    warn "MASTER_IP not set in config and could not be auto-detected"
    warn "These are required for automated worker setup"
    echo ""
    echo "Please create config/cluster.env.local with:"
    echo "  MASTER_IP=\"<master-ip-address>\""
    echo "  MASTER_USER=\"<master-username>\""
    echo ""
    if [ "$AUTO_JOIN" = true ]; then
        error "Cannot proceed in auto-join mode without MASTER_IP"
    fi
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
# Clean up incomplete kubeadm join state
# ============================================================================
cleanup_incomplete_join() {
    log "Checking for incomplete kubeadm join state..."
    
    # Check if node is already successfully joined
    # Worker nodes have kubelet config but no admin.conf
    if [ -f /etc/kubernetes/kubelet.conf ]; then
        # Check if kubelet can actually connect to the cluster
        if systemctl is-active --quiet kubelet 2>/dev/null; then
            # Try to verify node is registered (requires kubectl on master, so we can't fully verify here)
            # But we can check if kubelet is in a good state
            if systemctl is-failed --quiet kubelet 2>/dev/null; then
                warn "kubelet service is in failed state - may indicate incomplete join"
            else
                # Node appears to be joined, skip cleanup
                return 0
            fi
        fi
    fi
    
    # Check for partial join state (kubelet config exists but service isn't working)
    # OR kubelet config doesn't exist but there's partial kubeadm state
    HAS_PARTIAL_STATE=false
    
    if [ -f /etc/kubernetes/kubelet.conf ] && ! systemctl is-active --quiet kubelet 2>/dev/null; then
        HAS_PARTIAL_STATE=true
    fi
    
    # Check for leftover pki or manifests from failed join
    if [ -d /etc/kubernetes/pki ] && [ ! -f /etc/kubernetes/kubelet.conf ]; then
        HAS_PARTIAL_STATE=true
    fi
    
    if [ "$HAS_PARTIAL_STATE" = true ]; then
        warn "Found incomplete kubeadm join state"
        warn "This usually happens when a previous 'kubeadm join' failed partway through"
        log "Automatically cleaning up incomplete join state..."
        
        # Reset kubeadm state
        sudo kubeadm reset --force 2>/dev/null || true
        
        # Additional cleanup
        sudo rm -rf /etc/kubernetes/pki
        sudo rm -rf /etc/kubernetes/manifests
        sudo rm -f /etc/kubernetes/*.conf
        sudo rm -f /etc/kubernetes/kubeadm-config.yaml
        
        # Clean up iptables rules
        sudo iptables -F && sudo iptables -t nat -F && sudo iptables -t mangle -F && sudo iptables -X || true
        
        # Stop kubelet if it's running
        sudo systemctl stop kubelet 2>/dev/null || true
        
        success "kubeadm join state cleaned up"
    fi
}

# ============================================================================
# Join Cluster
# ============================================================================
join_cluster() {
    log "Joining Kubernetes cluster..."
    
    # Check if already successfully joined by verifying node registration
    # This is more reliable than just checking if kubelet.conf exists
    if [ -f /etc/kubernetes/kubelet.conf ]; then
        if systemctl is-active --quiet kubelet 2>/dev/null; then
            # Check if kubelet is actually connected to the API server
            # Look for connection errors in kubelet status
            KUBELET_STATUS=$(systemctl status kubelet --no-pager 2>&1 | grep -i "error\|failed\|unable" | head -3)
            
            # Check if we can verify node registration (if kubectl is available and configured)
            NODE_REGISTERED=false
            if command -v kubectl &>/dev/null && [ -f ~/.kube/config ]; then
                NODE_NAME=$(hostname)
                if kubectl get node "$NODE_NAME" &>/dev/null 2>&1; then
                    NODE_REGISTERED=true
                    success "Node is already registered in cluster"
                    return
                fi
            fi
            
            # If kubelet is running but node isn't registered, it's likely a failed join
            if [ "$NODE_REGISTERED" = false ]; then
                if [ -n "$KUBELET_STATUS" ]; then
                    warn "kubelet is running but node is not registered. This indicates a failed join."
                    log "Cleaning up incomplete join state..."
                    cleanup_incomplete_join
                else
                    # kubelet is running but we can't verify registration - be cautious
                    warn "kubelet is running but cannot verify node registration."
                    warn "If the node is not showing in 'kubectl get nodes', this is a failed join."
                    
                    # In auto-join mode, automatically reset and rejoin
                    if [ "$AUTO_JOIN" = true ]; then
                        log "Auto-join mode: automatically resetting and rejoining..."
                        cleanup_incomplete_join
                    elif [ -t 0 ]; then
                        # Interactive mode - prompt
                        read -p "Reset and rejoin? (y/n) " -n 1 -r
                        echo
                        if [[ $REPLY =~ ^[Yy]$ ]]; then
                            cleanup_incomplete_join
                        else
                            warn "Skipping join. Run 'sudo kubeadm reset --force' manually if needed."
                            return
                        fi
                    else
                        # Non-interactive but not auto-join - be safe and reset
                        log "Non-interactive mode: automatically resetting incomplete join state..."
                        cleanup_incomplete_join
                    fi
                fi
            fi
        fi
    fi
    
    # Clean up any incomplete join state before attempting to join (only if not already cleaned)
    if [ ! -f /etc/kubernetes/kubelet.conf ]; then
        cleanup_incomplete_join
    fi
    
    JOIN_CMD_FILE="$PROJECT_ROOT/config/join-command.sh"
    
    # Setup SSH keys for automated access to master
    setup_ssh_keys() {
        if [ -z "$MASTER_IP" ] || [ -z "$MASTER_USER" ]; then
            warn "MASTER_IP or MASTER_USER not set, cannot setup SSH"
            return 1
        fi
        
        SSH_DIR="$HOME/.ssh"
        SSH_KEY="$SSH_DIR/id_ed25519"
        SSH_PUB_KEY="$SSH_DIR/id_ed25519.pub"
        
        # Create .ssh directory if it doesn't exist
        mkdir -p "$SSH_DIR"
        chmod 700 "$SSH_DIR"
        
        # Generate SSH key if it doesn't exist
        if [ ! -f "$SSH_KEY" ]; then
            log "Generating SSH key for automated master access..."
            ssh-keygen -t ed25519 -C "kcloud-worker-$(hostname)" -f "$SSH_KEY" -N "" -q
            chmod 600 "$SSH_KEY"
            chmod 644 "$SSH_PUB_KEY"
            success "SSH key generated"
        fi
        
        # Test if passwordless SSH already works
        log "Testing passwordless SSH connection to master..."
        if ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
           "${MASTER_USER}@${MASTER_IP}" "exit" 2>/dev/null; then
            success "Passwordless SSH already configured"
            return 0
        fi
        
        # Try to copy public key to master
        log "Setting up passwordless SSH to master..."
        log "Note: You may be prompted for password once (this is a one-time setup)"
        
        # Method 1: Try ssh-copy-id
        if command -v ssh-copy-id &>/dev/null; then
            log "Trying ssh-copy-id..."
            log "You will be prompted for the master password (one-time setup)..."
            # ssh-copy-id will prompt for password interactively
            # We can't fully automate this, but we can check if it worked after
            if ssh-copy-id -o StrictHostKeyChecking=no \
               "${MASTER_USER}@${MASTER_IP}" 2>&1; then
                SSH_COPY_EXIT=$?
            else
                SSH_COPY_EXIT=$?
            fi
            
            # Wait a moment for the key to be processed
            sleep 2
            
            # Verify it worked by testing passwordless SSH
            if ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
               "${MASTER_USER}@${MASTER_IP}" "exit" 2>/dev/null; then
                success "SSH key copied to master via ssh-copy-id"
                return 0
            elif [ $SSH_COPY_EXIT -eq 0 ]; then
                # ssh-copy-id succeeded but passwordless SSH not working yet
                # This can happen if the key was added but needs a moment
                log "ssh-copy-id completed, waiting for SSH to propagate..."
                sleep 3
                if ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
                   "${MASTER_USER}@${MASTER_IP}" "exit" 2>/dev/null; then
                    success "SSH key copied to master via ssh-copy-id"
                    return 0
                else
                    warn "ssh-copy-id completed but passwordless SSH not working"
                    warn "You may need to manually verify SSH key was added to master"
                fi
            else
                log "ssh-copy-id failed or was cancelled (exit code: $SSH_COPY_EXIT)"
            fi
        fi
        
        # Method 2: Manual method (only if ssh-copy-id didn't work and passwordless SSH still doesn't work)
        # Check again if passwordless SSH works (maybe it just needed a moment)
        sleep 2
        if ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
           "${MASTER_USER}@${MASTER_IP}" "exit" 2>/dev/null; then
            success "Passwordless SSH is now working"
            return 0
        fi
        
        # If still not working, try manual method
        log "Trying manual SSH key copy method..."
        if [ -f "$SSH_PUB_KEY" ]; then
            PUB_KEY_CONTENT=$(cat "$SSH_PUB_KEY")
            log "You will be prompted for the master password again..."
            # This will also prompt for password, but we try it
            if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
               "${MASTER_USER}@${MASTER_IP}" \
               "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$PUB_KEY_CONTENT' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys" 2>&1; then
                # Verify it worked
                sleep 3
                if ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
                   "${MASTER_USER}@${MASTER_IP}" "exit" 2>/dev/null; then
                    success "SSH key copied to master via manual method"
                    return 0
                fi
            fi
        fi
        
        warn "Could not setup passwordless SSH automatically"
        warn "SSH key setup requires password authentication"
        return 1
    }
    
    # Try to fetch join command from master if not present
    # Check if MASTER_IP and MASTER_USER are configured
    if [ -z "$MASTER_IP" ] || [ -z "$MASTER_USER" ]; then
        warn "MASTER_IP or MASTER_USER not configured in config file"
        warn "Please set them in config/cluster.env.local or config/cluster.env"
        error "Cannot fetch join command without master configuration"
    fi
    
    if [ ! -f "$JOIN_CMD_FILE" ]; then
        log "Join command file not found locally, attempting to fetch from master..."
        
        # Always setup SSH keys if passwordless SSH doesn't work
        log "Ensuring SSH access to master is configured..."
        if ! ssh -o BatchMode=yes -o ConnectTimeout=5 \
           -o StrictHostKeyChecking=no \
           "${MASTER_USER}@${MASTER_IP}" "exit" 2>/dev/null; then
            if ! setup_ssh_keys; then
                error "Could not setup SSH access to master. Please ensure:"
                echo "  1. SSH password authentication is enabled on master"
                echo "  2. You can manually run: ssh-copy-id ${MASTER_USER}@${MASTER_IP}"
                echo "  3. Or copy ~/.ssh/id_ed25519.pub to master's ~/.ssh/authorized_keys"
                exit 1
            fi
        else
            success "Passwordless SSH to master is working"
        fi
        
        if command -v scp &>/dev/null; then
            mkdir -p "$PROJECT_ROOT/config"
            log "Fetching from ${MASTER_USER}@${MASTER_IP}:${PROJECT_ROOT}/config/join-command.sh"
            if scp -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
               "${MASTER_USER}@${MASTER_IP}:${PROJECT_ROOT}/config/join-command.sh" \
               "$JOIN_CMD_FILE" 2>/dev/null; then
                chmod +x "$JOIN_CMD_FILE"
                success "Fetched join command from master"
            else
                # Try alternative: get join command directly via SSH
                log "File fetch failed, trying to get join command directly from master..."
                JOIN_CMD=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
                          "${MASTER_USER}@${MASTER_IP}" \
                          "cd ${PROJECT_ROOT} && kubeadm token create --print-join-command 2>/dev/null" 2>/dev/null)
                
                if [ -n "$JOIN_CMD" ] && echo "$JOIN_CMD" | grep -q "kubeadm join"; then
                    echo "$JOIN_CMD" > "$JOIN_CMD_FILE"
                    chmod +x "$JOIN_CMD_FILE"
                    success "Got join command directly from master"
                else
                    error "Could not fetch join command from master. Please ensure SSH access is configured."
                fi
            fi
        else
            error "scp not available. Install openssh-client."
        fi
    fi
    
    if [ -f "$JOIN_CMD_FILE" ]; then
        log "Using join command from $JOIN_CMD_FILE"
        sudo bash "$JOIN_CMD_FILE"
        success "Joined cluster successfully"
    else
        echo ""
        warn "No join command file found."
        
        # This should not happen if the fetch logic above worked
        error "Join command file not found and could not be fetched from master."
        echo "Please ensure:"
        echo "  1. MASTER_IP and MASTER_USER are set in config/cluster.env"
        echo "  2. SSH access to master is configured"
        echo "  3. Master node has run setup_master.sh to generate join command"
        exit 1
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
    
    # Check if join command file exists
    JOIN_CMD_FILE="$PROJECT_ROOT/config/join-command.sh"
    
    if [ "$AUTO_JOIN" = true ]; then
        log "Auto-join enabled, joining cluster..."
        join_cluster
    elif [ -f "$JOIN_CMD_FILE" ]; then
        # If join command exists and we're in a TTY, prompt
        if [ -t 0 ]; then
            read -p "Join cluster now? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                join_cluster
            else
                echo ""
                echo "To join later, run:"
                echo "  sudo bash $JOIN_CMD_FILE"
            fi
        else
            # Non-interactive mode - auto-join if file exists
            log "Non-interactive mode detected, auto-joining cluster..."
            join_cluster
        fi
    else
        warn "Join command file not found: $JOIN_CMD_FILE"
        echo "Run setup_master.sh first to generate the join command, then:"
        echo "  1. Copy config/join-command.sh to this node, or"
        echo "  2. Run the join command manually:"
        echo "     sudo kubeadm join <master-ip>:6443 --token <token> --discovery-token-ca-cert-hash <hash>"
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
