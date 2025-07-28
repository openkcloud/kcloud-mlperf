#!/bin/bash
#
# MLPerf Environment Setup Script
# Sets up the environment for reproducible MLPerf benchmarks
#

set -e  # Exit on any error

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m' # No Color

# Logging functions
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

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$SCRIPT_DIR"

log_info "Setting up MLPerf benchmark environment..."
log_info "Project root: $PROJECT_ROOT"

# Check if we're in the right directory
if [ ! -f "$PROJECT_ROOT/config.py" ]; then
    log_error "config.py not found. Please run this script from the project root directory."
    exit 1
fi

# Create necessary directories
log_info "Creating project directories..."
mkdir -p "$PROJECT_ROOT/results"
mkdir -p "$PROJECT_ROOT/logs"
mkdir -p "$PROJECT_ROOT/cache"
mkdir -p "$PROJECT_ROOT/reports"
mkdir -p "$PROJECT_ROOT/venv"

# Check for Python 3.8+
log_info "Checking Python version..."
if ! command -v python3 &> /dev/null; then
    log_error "Python3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
REQUIRED_VERSION="3.8"

# Simple version check using Python
if python3 -c "import sys; exit(0 if sys.version_info >= (3, 8) else 1)"; then
    log_success "Python $PYTHON_VERSION is compatible"
else
    log_error "Python $PYTHON_VERSION is not compatible. Requires Python $REQUIRED_VERSION or higher."
    exit 1
fi

# Set up Python virtual environment
log_info "Setting up Python virtual environment..."
if [ ! -d "$PROJECT_ROOT/venv" ]; then
    python3 -m venv "$PROJECT_ROOT/venv"
    log_success "Virtual environment created"
else
    log_info "Virtual environment already exists"
fi

# Activate virtual environment
source "$PROJECT_ROOT/venv/bin/activate"
log_success "Virtual environment activated"

# Upgrade pip
log_info "Upgrading pip..."
pip install --upgrade pip

# Install requirements
log_info "Installing Python dependencies..."
if [ -f "$PROJECT_ROOT/requirements.txt" ]; then
    pip install -r "$PROJECT_ROOT/requirements.txt"
    log_success "Requirements installed from requirements.txt"
else
    # Install basic requirements
    log_info "Installing basic MLPerf requirements..."
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
    pip install transformers accelerate datasets
    pip install numpy pandas matplotlib seaborn
    pip install psutil gpustat
    pip install paramiko  # for SSH operations
    log_success "Basic requirements installed"
fi

# Check CUDA availability
log_info "Checking CUDA availability..."
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'CUDA devices: {torch.cuda.device_count()}')" || {
    log_warning "CUDA check failed. GPU benchmarks may not work."
}

# Check for HuggingFace token
log_info "Checking environment variables..."
if [ -z "$HF_TOKEN" ]; then
    log_warning "HF_TOKEN environment variable not set."
    log_info "Please set your HuggingFace token:"
    log_info "export HF_TOKEN=your_token_here"
else
    log_success "HF_TOKEN is set"
fi

# Check SSH connectivity to nodes (if configured)
log_info "Checking SSH connectivity to nodes..."
python3 -c "
from config import config
import subprocess
import sys

nodes = config.nodes
if not nodes:
    print('No nodes configured in config.py')
    sys.exit(0)

for node_name, node_ip in nodes.items():
    if node_ip == '127.0.0.1' or node_ip == 'localhost':
        continue  # Skip local node
    
    try:
        result = subprocess.run([
            'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5',
            f'{config.username}@{node_ip}', 'hostname'
        ], capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            print(f'✅ {node_name} ({node_ip}): Connected')
        else:
            print(f'❌ {node_name} ({node_ip}): Connection failed')
    except Exception as e:
        print(f'❌ {node_name} ({node_ip}): Error - {e}')
"

# Create environment activation script
log_info "Creating environment activation script..."
cat > "$PROJECT_ROOT/activate_env.sh" << 'EOF'
#!/bin/bash
# MLPerf Environment Activation Script

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Activate virtual environment
source "$SCRIPT_DIR/venv/bin/activate"

# Set default environment variables if not already set
export MLPERF_PROJECT_ROOT="$SCRIPT_DIR"
export MLPERF_USERNAME="${MLPERF_USERNAME:-${USER:-user}}"
export MLPERF_REMOTE_DIR="${MLPERF_REMOTE_DIR:-~/$(basename "$SCRIPT_DIR")}"

# Node IPs (can be overridden) - defaults to localhost for single machine setup
export JW1_IP="${JW1_IP:-localhost}"
export JW2_IP="${JW2_IP:-localhost}"
export JW3_IP="${JW3_IP:-localhost}"

# Benchmark configuration
export MAX_TOKENS="${MAX_TOKENS:-64}"
export SERVER_TARGET_QPS="${SERVER_TARGET_QPS:-1.0}"
export OFFLINE_TARGET_QPS="${OFFLINE_TARGET_QPS:-10.0}"

echo "🚀 MLPerf environment activated!"
echo "Project root: $MLPERF_PROJECT_ROOT"
echo "Python: $(which python)"
echo "Available commands:"
echo "  python mlperf_datacenter_benchmark.py    # Single node datacenter benchmark"
echo "  python run_datacenter_benchmark.py       # Multi-node datacenter benchmark"
echo "  python run_coordinated_benchmark.py      # Multi-GPU coordinated benchmark"
echo "  python report_generator.py               # Generate comprehensive reports"
echo ""
echo "💡 Remember to set HF_TOKEN: export HF_TOKEN=your_token_here"
EOF

chmod +x "$PROJECT_ROOT/activate_env.sh"
log_success "Environment activation script created: activate_env.sh"

# Create quick start script
log_info "Creating quick start script..."
cat > "$PROJECT_ROOT/quick_start.sh" << 'EOF'
#!/bin/bash
# MLPerf Quick Start Script

set -e

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Activate environment
source "$SCRIPT_DIR/activate_env.sh"

echo "🎯 MLPerf Quick Start Demo"
echo "=========================="

# Check HF token
if [ -z "$HF_TOKEN" ]; then
    echo "❌ HF_TOKEN not set. Please set it first:"
    echo "export HF_TOKEN=your_token_here"
    exit 1
fi

echo "✅ HF_TOKEN is set"

# Run a simple benchmark test
echo "🔬 Running simple datacenter benchmark test..."
python mlperf_datacenter_benchmark.py

echo ""
echo "📊 Generating reports..."
python report_generator.py

echo ""
echo "🎉 Quick start complete! Check the results/ and reports/ directories."
EOF

chmod +x "$PROJECT_ROOT/quick_start.sh"
log_success "Quick start script created: quick_start.sh"

# Create requirements.txt if it doesn't exist
if [ ! -f "$PROJECT_ROOT/requirements.txt" ]; then
    log_info "Creating requirements.txt..."
    cat > "$PROJECT_ROOT/requirements.txt" << 'EOF'
torch>=2.0.0
torchvision>=0.15.0
torchaudio>=2.0.0
transformers>=4.30.0
accelerate>=0.20.0
datasets>=2.12.0
numpy>=1.21.0
pandas>=1.5.0
matplotlib>=3.5.0
seaborn>=0.11.0
psutil>=5.8.0
gpustat>=1.0.0
paramiko>=2.11.0
requests>=2.28.0
huggingface-hub>=0.15.0
EOF
    log_success "requirements.txt created"
fi

# Final setup validation
log_info "Validating setup..."
python3 -c "
import sys
import os
from pathlib import Path

# Check project structure
project_root = Path('$PROJECT_ROOT')
required_files = ['config.py', 'mlperf_datacenter_benchmark.py', 'report_generator.py']
required_dirs = ['results', 'logs', 'cache', 'reports', 'venv']

print('📁 Project structure validation:')
for file in required_files:
    if (project_root / file).exists():
        print(f'   ✅ {file}')
    else:
        print(f'   ❌ {file} missing')

for dir in required_dirs:
    if (project_root / dir).exists():
        print(f'   ✅ {dir}/')
    else:
        print(f'   ❌ {dir}/ missing')

print('\\n🔧 Python environment:')
print(f'   Python: {sys.version}')
print(f'   Virtual env: {sys.prefix}')

try:
    import torch
    print(f'   PyTorch: {torch.__version__}')
    print(f'   CUDA available: {torch.cuda.is_available()}')
    if torch.cuda.is_available():
        print(f'   CUDA devices: {torch.cuda.device_count()}')
except ImportError:
    print('   ❌ PyTorch not available')

try:
    import transformers
    print(f'   Transformers: {transformers.__version__}')
except ImportError:
    print('   ❌ Transformers not available')
"

echo ""
log_success "Environment setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Set your HuggingFace token: export HF_TOKEN=your_token_here"
echo "2. Activate environment: source activate_env.sh"
echo "3. Run quick start: ./quick_start.sh"
echo "4. Or run specific benchmarks as needed"
echo ""
echo "📖 Documentation:"
echo "   - README.md: Overview and usage"
echo "   - README_MLPerf_Datacenter.md: Datacenter benchmark details"
echo "   - config.py: Configuration management"
echo ""