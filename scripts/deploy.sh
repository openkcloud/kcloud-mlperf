#!/bin/bash
# Universal MLPerf Benchmark Deployment Script
# Automatically detects environment and deploys appropriate configuration

set -euo pipefail

# Script metadata
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="1.0.0"

# Default values
DEPLOYMENT_TYPE="auto"
ACCELERATOR_TYPE="auto"
CONTAINER_RUNTIME="auto"
NAMESPACE="mlperf"
DRY_RUN=false
VERBOSE=false
CLEAN_INSTALL=false
SKIP_DEPS=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Help function
show_help() {
    cat << EOF
Universal MLPerf Benchmark Deployment Script v${VERSION}

USAGE:
    $0 [OPTIONS]

DESCRIPTION:
    Automatically detects your environment and deploys MLPerf datacenter benchmarks
    with appropriate configuration for your hardware (NVIDIA GPU, Furiosa NPU, etc.)

OPTIONS:
    -t, --type TYPE           Deployment type: auto, docker, kubernetes, standalone (default: auto)
    -a, --accelerator TYPE    Accelerator type: auto, nvidia, furiosa, amd, intel, cpu (default: auto)
    -r, --runtime RUNTIME    Container runtime: auto, docker, podman, containerd (default: auto)
    -n, --namespace NS        Kubernetes namespace (default: mlperf)
    -c, --clean              Clean install - remove existing installations
    -s, --skip-deps          Skip dependency installation
    -d, --dry-run            Show what would be done without executing
    -v, --verbose            Enable verbose output
    -h, --help               Show this help message

EXAMPLES:
    # Auto-detect everything and deploy
    $0

    # Deploy with specific accelerator type
    $0 --accelerator nvidia

    # Deploy to Kubernetes with Furiosa NPUs
    $0 --type kubernetes --accelerator furiosa

    # Docker deployment with verbose output
    $0 --type docker --verbose

    # Dry run to see what would happen
    $0 --dry-run

SUPPORTED ENVIRONMENTS:
    - NVIDIA GPUs (CUDA 11.8, 12.1, 12.2)
    - Furiosa NPUs (Warboy, RNGD)
    - AMD GPUs (ROCm 5.7+)
    - Intel GPUs (Arc, Data Center GPU Max)
    - CPU-only environments
    - Kubernetes clusters
    - Docker/Podman containers
    - Standalone installations

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -t|--type)
                DEPLOYMENT_TYPE="$2"
                shift 2
                ;;
            -a|--accelerator)
                ACCELERATOR_TYPE="$2"
                shift 2
                ;;
            -r|--runtime)
                CONTAINER_RUNTIME="$2"
                shift 2
                ;;
            -n|--namespace)
                NAMESPACE="$2"
                shift 2
                ;;
            -c|--clean)
                CLEAN_INSTALL=true
                shift
                ;;
            -s|--skip-deps)
                SKIP_DEPS=true
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Execute command with dry-run support
execute() {
    if [[ "$VERBOSE" == "true" ]]; then
        log_info "Executing: $*"
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "[DRY-RUN] Would execute: $*"
    else
        "$@"
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Python
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 is not installed"
        exit 1
    fi
    
    local python_version
    python_version=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
    if [[ "$(echo "$python_version >= 3.8" | bc -l)" != "1" ]]; then
        log_error "Python 3.8+ is required, found $python_version"
        exit 1
    fi
    
    # Check Git
    if ! command -v git &> /dev/null; then
        log_error "Git is not installed"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Detect environment
detect_environment() {
    log_info "Detecting environment..."
    
    cd "$ROOT_DIR"
    
    # Run environment detector
    if [[ -f "environment_detector.py" ]]; then
        execute python3 environment_detector.py > environment_config.json
    else
        log_error "Environment detector not found"
        exit 1
    fi
    
    if [[ -f "environment_config.json" ]]; then
        log_success "Environment detected and saved to environment_config.json"
    else
        log_error "Failed to detect environment"
        exit 1
    fi
}

# Install dependencies
install_dependencies() {
    if [[ "$SKIP_DEPS" == "true" ]]; then
        log_info "Skipping dependency installation"
        return
    fi
    
    log_info "Installing dependencies..."
    
    # Create virtual environment if it doesn't exist
    if [[ ! -d "venv" ]] || [[ "$CLEAN_INSTALL" == "true" ]]; then
        if [[ "$CLEAN_INSTALL" == "true" ]] && [[ -d "venv" ]]; then
            execute rm -rf venv
        fi
        execute python3 -m venv venv
    fi
    
    # Activate virtual environment
    source venv/bin/activate
    
    # Upgrade pip
    execute pip install --upgrade pip
    
    # Install base requirements
    if [[ -f "requirements.universal.txt" ]]; then
        execute pip install -r requirements.universal.txt
    elif [[ -f "requirements.txt" ]]; then
        execute pip install -r requirements.txt
    fi
    
    log_success "Dependencies installed"
}

# Build Docker image
build_docker_image() {
    log_info "Building Docker image..."
    
    local dockerfile="Dockerfile.universal"
    local image_tag="mlperf-benchmark:latest"
    
    if [[ "$ACCELERATOR_TYPE" != "auto" ]]; then
        image_tag="mlperf-benchmark:${ACCELERATOR_TYPE}"
    fi
    
    execute docker build \
        -f "$dockerfile" \
        --build-arg ACCELERATOR_TYPE="$ACCELERATOR_TYPE" \
        -t "$image_tag" \
        .
    
    log_success "Docker image built: $image_tag"
}

# Deploy to Docker
deploy_docker() {
    log_info "Deploying to Docker..."
    
    # Build image if needed
    build_docker_image
    
    # Create Docker run command based on accelerator type
    local docker_args=""
    local image_tag="mlperf-benchmark:latest"
    
    if [[ "$ACCELERATOR_TYPE" != "auto" ]]; then
        image_tag="mlperf-benchmark:${ACCELERATOR_TYPE}"
    fi
    
    # Add GPU support
    if command -v nvidia-docker &> /dev/null; then
        docker_args="--runtime=nvidia --gpus all"
    elif command -v docker &> /dev/null && docker info | grep -q nvidia; then
        docker_args="--gpus all"
    fi
    
    # Add NPU support for Furiosa
    if [[ "$ACCELERATOR_TYPE" == "furiosa" ]] || [[ -d "/dev" ]] && ls /dev/npu* 2>/dev/null; then
        docker_args="$docker_args --device=/dev/npu0 --device=/dev/npu1"
    fi
    
    # Run container
    execute docker run -it --rm \
        $docker_args \
        -v "$(pwd)/results:/app/results" \
        -v "$(pwd)/cache:/app/cache" \
        -v "$(pwd)/configs:/app/configs" \
        -e HF_TOKEN="${HF_TOKEN:-}" \
        "$image_tag"
    
    log_success "Docker deployment completed"
}

# Deploy to Kubernetes
deploy_kubernetes() {
    log_info "Deploying to Kubernetes..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi
    
    # Create namespace
    execute kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    
    # Build and push image (assuming registry access)
    local image_tag="mlperf-benchmark:k8s-${ACCELERATOR_TYPE}"
    build_docker_image
    
    # Generate Kubernetes manifests
    generate_k8s_manifests "$image_tag"
    
    # Apply manifests
    execute kubectl apply -f k8s-generated/ -n "$NAMESPACE"
    
    log_success "Kubernetes deployment completed"
    log_info "Monitor with: kubectl get pods -n $NAMESPACE"
}

# Generate Kubernetes manifests
generate_k8s_manifests() {
    local image_tag="$1"
    
    mkdir -p k8s-generated
    
    # ConfigMap for environment config
    cat > k8s-generated/configmap.yaml << EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: mlperf-config
  namespace: $NAMESPACE
data:
  config.json: |
$(cat environment_config.json | sed 's/^/    /')
EOF

    # Job for benchmark execution
    cat > k8s-generated/job.yaml << EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: mlperf-benchmark
  namespace: $NAMESPACE
spec:
  template:
    spec:
      containers:
      - name: mlperf
        image: $image_tag
        env:
        - name: HF_TOKEN
          valueFrom:
            secretKeyRef:
              name: mlperf-secrets
              key: hf-token
              optional: true
        - name: ACCELERATOR_TYPE
          value: "$ACCELERATOR_TYPE"
        volumeMounts:
        - name: config
          mountPath: /app/configs
        - name: results
          mountPath: /app/results
        - name: cache
          mountPath: /app/cache
        resources:
          limits:
            nvidia.com/gpu: "1"
          requests:
            cpu: "4"
            memory: "16Gi"
      volumes:
      - name: config
        configMap:
          name: mlperf-config
      - name: results
        emptyDir: {}
      - name: cache
        emptyDir: {}
      restartPolicy: Never
EOF
    
    log_success "Kubernetes manifests generated in k8s-generated/"
}

# Deploy standalone
deploy_standalone() {
    log_info "Deploying standalone..."
    
    # Install dependencies
    install_dependencies
    
    # Activate virtual environment
    source venv/bin/activate
    
    # Run benchmark directly
    execute python3 mlperf_datacenter_benchmark.py
    
    log_success "Standalone deployment completed"
}

# Main deployment logic
deploy() {
    case "$DEPLOYMENT_TYPE" in
        auto)
            if command -v kubectl &> /dev/null && kubectl cluster-info &> /dev/null; then
                deploy_kubernetes
            elif command -v docker &> /dev/null && docker info &> /dev/null; then
                deploy_docker
            else
                deploy_standalone
            fi
            ;;
        docker)
            deploy_docker
            ;;
        kubernetes)
            deploy_kubernetes
            ;;
        standalone)
            deploy_standalone
            ;;
        *)
            log_error "Unknown deployment type: $DEPLOYMENT_TYPE"
            exit 1
            ;;
    esac
}

# Cleanup function
cleanup() {
    if [[ "$CLEAN_INSTALL" == "true" ]]; then
        log_info "Cleaning up previous installations..."
        execute rm -rf venv/ k8s-generated/ environment_config.json
    fi
}

# Main function
main() {
    echo "🚀 Universal MLPerf Benchmark Deployment v${VERSION}"
    echo "================================================"
    
    parse_args "$@"
    
    if [[ "$VERBOSE" == "true" ]]; then
        set -x
    fi
    
    check_prerequisites
    cleanup
    detect_environment
    deploy
    
    echo ""
    log_success "🎉 Deployment completed successfully!"
    echo ""
    echo "📊 Check results in:"
    echo "   - Local: ./results/"
    echo "   - Config: ./environment_config.json"
    if [[ "$DEPLOYMENT_TYPE" == "kubernetes" ]]; then
        echo "   - K8s: kubectl get pods -n $NAMESPACE"
    fi
}

# Run main function with all arguments
main "$@"