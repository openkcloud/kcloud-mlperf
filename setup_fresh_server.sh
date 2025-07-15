#!/bin/bash
set -e

echo "🚀 MLPerf Llama Benchmark - Fresh Ubuntu 22.04 Setup"
echo "======================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   log_error "This script should not be run as root. Please run as regular user with sudo privileges."
   exit 1
fi

# Check if user has sudo privileges
if ! sudo -n true 2>/dev/null; then
    log_error "This script requires sudo privileges. Please ensure your user can run sudo commands."
    exit 1
fi

log_info "Starting setup on $(hostname) at $(date)"
log_info "User: $(whoami)"
log_info "OS: $(lsb_release -d | cut -f2)"

# Step 1: System Update
log_info "📦 Step 1/6: Updating system packages..."
sudo apt update && sudo apt upgrade -y
log_success "System packages updated"

# Step 2: Install Essential Tools
log_info "🔧 Step 2/6: Installing essential tools..."
sudo apt install -y \
    curl \
    wget \
    git \
    build-essential \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release
log_success "Essential tools installed"

# Step 3: Install NVIDIA Drivers
log_info "🎮 Step 3/6: Installing NVIDIA drivers..."
if command -v nvidia-smi &> /dev/null; then
    log_warning "NVIDIA drivers already installed: $(nvidia-smi --query-gpu=driver_version --format=csv,noheader,nounits)"
else
    log_info "Installing NVIDIA drivers automatically..."
    sudo ubuntu-drivers autoinstall
    log_success "NVIDIA drivers installed - REBOOT REQUIRED after this script completes"
fi

# Step 4: Install Docker
log_info "🐳 Step 4/6: Installing Docker..."
if command -v docker &> /dev/null; then
    log_warning "Docker already installed: $(docker --version)"
else
    log_info "Downloading and installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    log_success "Docker installed"
fi

# Step 5: Install NVIDIA Container Runtime
log_info "🔥 Step 5/6: Installing NVIDIA Container Runtime..."
if docker info 2>/dev/null | grep -q nvidia; then
    log_warning "NVIDIA Container Runtime already configured"
else
    log_info "Setting up NVIDIA Container Runtime..."
    
    # Add NVIDIA Docker repository
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    
    sudo apt update
    sudo apt install -y nvidia-container-toolkit
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker
    log_success "NVIDIA Container Runtime installed"
fi

# Step 6: Clone Repository and Build Container
log_info "📁 Step 6/6: Setting up MLPerf benchmark..."
REPO_DIR="$HOME/MLPerf_local_test"

if [ -d "$REPO_DIR" ]; then
    log_warning "Repository already exists at $REPO_DIR"
    cd "$REPO_DIR"
    git pull origin main
else
    log_info "Cloning MLPerf repository..."
    git clone https://github.com/jshim0978/MLPerf_local_test.git "$REPO_DIR"
    cd "$REPO_DIR"
fi

log_success "Repository ready at $REPO_DIR"

# Check for CUDA support - mlperf-llama image already has CUDA
log_info "🐳 MLPerf container already built with CUDA support"
if docker images | grep -q "mlperf-llama"; then
    log_success "MLPerf container ready for GPU testing"
else
    log_warning "MLPerf container not found - will be built in next step"
fi

# Final Setup
log_info "🎯 Final setup..."
mkdir -p results cache
chmod 755 setup_fresh_server.sh

echo ""
echo "============================================="
log_success "🎉 Setup Complete!"
echo "============================================="
echo ""
echo "📋 Next Steps:"
echo "1. If NVIDIA drivers were just installed, REBOOT the system:"
echo "   sudo reboot"
echo ""
echo "2. After reboot, test GPU access:"
echo "   nvidia-smi"
echo ""
echo "3. Test Docker GPU access with MLPerf container:"
echo "   docker run --rm --gpus all mlperf-llama:latest nvidia-smi"
echo ""
echo "4. Build the MLPerf container:"
echo "   cd $REPO_DIR"
echo "   docker build -t mlperf-llama:latest ."
echo ""
echo "5. Run the benchmark:"
echo "   docker run --gpus all -e HF_TOKEN=your_token mlperf-llama:latest"
echo ""
echo "📖 For detailed usage, see: $REPO_DIR/CONTAINER_USAGE.md"
echo ""
echo "🔗 Get HuggingFace token: https://huggingface.co/settings/tokens"
echo "🔗 Request Llama access: https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct"
echo ""

# Check if reboot is needed
if [ -f /var/run/reboot-required ]; then
    log_warning "⚠️  REBOOT REQUIRED - Run 'sudo reboot' to complete driver installation"
fi

log_info "Setup script completed at $(date)"