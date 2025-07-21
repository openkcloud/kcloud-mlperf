#!/bin/bash

# MLPerf Benchmark Environment Setup Script
# Supports NVIDIA GPUs, Furiosa NPUs, and generic CPU/GPU setups

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HARDWARE_TYPE="${HARDWARE_TYPE:-auto}"
INSTALL_KUBERNETES="${INSTALL_KUBERNETES:-false}"
SETUP_NTP="${SETUP_NTP:-true}"

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

detect_hardware() {
    print_status "Detecting hardware configuration..."
    
    if command -v nvidia-smi &> /dev/null; then
        GPU_INFO=$(nvidia-smi --query-gpu=name --format=csv,noheader,nounits | head -1)
        if [[ "$GPU_INFO" == *"A30"* ]]; then
            HARDWARE_TYPE="nvidia-a30"
            print_success "Detected NVIDIA A30 GPU"
        elif [[ "$GPU_INFO" == *"H100"* ]]; then
            HARDWARE_TYPE="nvidia-h100"
            print_success "Detected NVIDIA H100 GPU"
        else
            HARDWARE_TYPE="nvidia-gpu"
            print_success "Detected NVIDIA GPU: $GPU_INFO"
        fi
    elif [[ -d "/sys/class/npu" ]] || command -v furiosa-smi &> /dev/null; then
        HARDWARE_TYPE="furiosa-npu"
        print_success "Detected Furiosa NPU"
    else
        HARDWARE_TYPE="generic"
        print_warning "No specific accelerator detected, using generic configuration"
    fi
}

install_system_dependencies() {
    print_status "Installing system dependencies..."
    
    # Update package list
    sudo apt-get update
    
    # Install common dependencies
    sudo apt-get install -y \
        python3 \
        python3-pip \
        python3-venv \
        git \
        curl \
        wget \
        ssh \
        htop \
        nvtop \
        tmux \
        vim \
        build-essential \
        cmake
    
    # Install NTP if requested
    if [[ "$SETUP_NTP" == "true" ]]; then
        print_status "Setting up NTP synchronization..."
        sudo apt-get install -y ntp ntpdate
        sudo systemctl stop systemd-timesyncd
        sudo systemctl disable systemd-timesyncd
        sudo systemctl enable ntp
        sudo systemctl start ntp
        print_success "NTP configured"
    fi
    
    print_success "System dependencies installed"
}

install_python_environment() {
    print_status "Setting up Python environment..."
    
    cd "$PROJECT_ROOT"
    
    # Create virtual environment if it doesn't exist
    if [[ ! -d "venv" ]]; then
        python3 -m venv venv
        print_success "Created Python virtual environment"
    fi
    
    # Activate virtual environment
    source venv/bin/activate
    
    # Upgrade pip
    pip install --upgrade pip
    
    # Install requirements
    if [[ -f "requirements.txt" ]]; then
        pip install -r requirements.txt
        print_success "Installed Python dependencies"
    fi
    
    # Install hardware-specific dependencies
    case $HARDWARE_TYPE in
        nvidia-*)
            print_status "Installing NVIDIA-specific dependencies..."
            pip install nvidia-ml-py3 pynvml
            ;;
        furiosa-npu)
            print_status "Installing Furiosa NPU dependencies..."
            # Add Furiosa SDK installation here when available
            print_warning "Furiosa SDK installation not yet implemented"
            ;;
    esac
    
    print_success "Python environment configured"
}

setup_kubernetes() {
    if [[ "$INSTALL_KUBERNETES" != "true" ]]; then
        return
    fi
    
    print_status "Setting up Kubernetes..."
    
    # Install Docker
    if ! command -v docker &> /dev/null; then
        print_status "Installing Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker $USER
        rm get-docker.sh
    fi
    
    # Install kubeadm, kubelet, kubectl
    if ! command -v kubeadm &> /dev/null; then
        print_status "Installing Kubernetes components..."
        sudo apt-get update
        sudo apt-get install -y apt-transport-https ca-certificates curl
        curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-archive-keyring.gpg
        echo "deb [signed-by=/etc/apt/keyrings/kubernetes-archive-keyring.gpg] https://apt.kubernetes.io/ kubernetes-xenial main" | sudo tee /etc/apt/sources.list.d/kubernetes.list
        sudo apt-get update
        sudo apt-get install -y kubelet kubeadm kubectl
        sudo apt-mark hold kubelet kubeadm kubectl
    fi
    
    print_success "Kubernetes components installed"
}

setup_gpu_support() {
    case $HARDWARE_TYPE in
        nvidia-*)
            print_status "Setting up NVIDIA GPU support..."
            
            # Install NVIDIA drivers if not present
            if ! command -v nvidia-smi &> /dev/null; then
                print_status "Installing NVIDIA drivers..."
                sudo apt-get install -y nvidia-driver-535
                print_warning "NVIDIA drivers installed. Please reboot and run this script again."
                exit 0
            fi
            
            # Install NVIDIA Container Toolkit for Kubernetes
            if [[ "$INSTALL_KUBERNETES" == "true" ]]; then
                print_status "Installing NVIDIA Container Toolkit..."
                distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
                curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
                curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
                sudo apt-get update
                sudo apt-get install -y nvidia-container-toolkit
                sudo systemctl restart docker
            fi
            
            print_success "NVIDIA GPU support configured"
            ;;
        furiosa-npu)
            print_status "Setting up Furiosa NPU support..."
            # Add Furiosa NPU setup here
            print_warning "Furiosa NPU setup not yet implemented"
            ;;
    esac
}

create_configuration() {
    print_status "Creating hardware-specific configuration..."
    
    # Create config directory
    mkdir -p "$PROJECT_ROOT/configs/active"
    
    # Copy appropriate configuration
    case $HARDWARE_TYPE in
        nvidia-a30)
            cp "$PROJECT_ROOT/configs/benchmark-configs/nvidia-a30.yaml" "$PROJECT_ROOT/configs/active/hardware.yaml"
            ;;
        furiosa-npu)
            cp "$PROJECT_ROOT/configs/benchmark-configs/furiosa-npu.yaml" "$PROJECT_ROOT/configs/active/hardware.yaml"
            ;;
        *)
            cp "$PROJECT_ROOT/configs/benchmark-configs/generic-config.yaml" "$PROJECT_ROOT/configs/active/hardware.yaml"
            ;;
    esac
    
    # Create environment file
    cat > "$PROJECT_ROOT/.env" << EOF
# MLPerf Benchmark Environment Configuration
HARDWARE_TYPE=$HARDWARE_TYPE
HARDWARE_CONFIG=configs/active/hardware.yaml
HF_TOKEN=${HF_TOKEN:-}
CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0}

# Performance settings based on detected hardware
SERVER_TARGET_QPS=${SERVER_TARGET_QPS:-0.5}
OFFLINE_TARGET_QPS=${OFFLINE_TARGET_QPS:-1.0}
MAX_TOKENS=${MAX_TOKENS:-64}
BATCH_SIZE=${BATCH_SIZE:-1}
EOF
    
    print_success "Configuration created for $HARDWARE_TYPE"
}

setup_ssh_keys() {
    print_status "Setting up SSH keys for multi-node communication..."
    
    if [[ ! -f ~/.ssh/id_rsa ]]; then
        ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""
        print_success "SSH key pair generated"
    fi
    
    print_status "SSH public key (add to other nodes):"
    cat ~/.ssh/id_rsa.pub
}

run_tests() {
    print_status "Running basic functionality tests..."
    
    cd "$PROJECT_ROOT"
    source venv/bin/activate
    
    # Test Python imports
    python3 -c "import torch; print(f'PyTorch version: {torch.__version__}')"
    python3 -c "import transformers; print(f'Transformers version: {transformers.__version__}')"
    
    # Test hardware detection
    if [[ "$HARDWARE_TYPE" == nvidia-* ]]; then
        python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
        if command -v nvidia-smi &> /dev/null; then
            nvidia-smi
        fi
    fi
    
    print_success "Basic tests passed"
}

print_next_steps() {
    print_success "Environment setup completed!"
    echo
    print_status "Next steps:"
    echo "  1. Activate the Python environment: source venv/bin/activate"
    echo "  2. Set your HuggingFace token: export HF_TOKEN=your_token_here"
    echo "  3. Run a test benchmark: python3 src/mlperf_benchmark.py --type single --samples 5"
    echo
    if [[ "$INSTALL_KUBERNETES" == "true" ]]; then
        echo "  For Kubernetes cluster setup:"
        echo "  4. Initialize cluster: sudo kubeadm init"
        echo "  5. Install Calico CNI: kubectl apply -f https://docs.projectcalico.org/manifests/calico.yaml"
        echo "  6. Join worker nodes: kubeadm join ..."
    fi
    echo
    print_status "Configuration summary:"
    echo "  Hardware Type: $HARDWARE_TYPE"
    echo "  Config File: configs/active/hardware.yaml"
    echo "  Environment: .env"
}

# Main execution
main() {
    echo -e "${BLUE}🚀 MLPerf Benchmark Environment Setup${NC}"
    echo "========================================"
    
    detect_hardware
    install_system_dependencies
    install_python_environment
    setup_kubernetes
    setup_gpu_support
    create_configuration
    setup_ssh_keys
    run_tests
    print_next_steps
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --hardware)
            HARDWARE_TYPE="$2"
            shift 2
            ;;
        --kubernetes)
            INSTALL_KUBERNETES="true"
            shift
            ;;
        --no-ntp)
            SETUP_NTP="false"
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --hardware TYPE    Force hardware type (nvidia-a30, furiosa-npu, generic)"
            echo "  --kubernetes       Install Kubernetes components"
            echo "  --no-ntp          Skip NTP configuration"
            echo "  --help            Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

main "$@"