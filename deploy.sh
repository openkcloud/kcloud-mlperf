#!/bin/bash
set -e

# MLPerf Universal Kubernetes Deployment Script
echo "🚀 MLPerf Universal Kubernetes Deployment"
echo "=========================================="

# Configuration
DOCKER_IMAGE="mlperf-universal:latest"
NAMESPACE="default"
CONFIG_FILE="config.env"

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

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check cluster connection
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        log_info "Please ensure your kubectl is configured correctly"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Build Docker image
build_image() {
    log_info "Building MLPerf Docker image..."
    
    docker build -t ${DOCKER_IMAGE} . || {
        log_error "Failed to build Docker image"
        exit 1
    }
    
    log_success "Docker image built: ${DOCKER_IMAGE}"
}

# Create namespace if needed
setup_namespace() {
    log_info "Setting up namespace: ${NAMESPACE}"
    
    kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -
    
    log_success "Namespace ready: ${NAMESPACE}"
}

# Deploy configuration
deploy_config() {
    log_info "Deploying configuration..."
    
    # Check if user config exists
    if [ -f "${CONFIG_FILE}" ]; then
        log_info "Loading configuration from ${CONFIG_FILE}"
        source "${CONFIG_FILE}"
    else
        log_warning "No ${CONFIG_FILE} found, using defaults"
        cat > ${CONFIG_FILE} << EOF
# MLPerf Configuration
# Edit these values for your environment

# Cluster Node IPs (replace with your actual IPs)
export JW1_IP="your-controller-ip"
export JW2_IP="your-worker1-ip" 
export JW3_IP="your-worker2-ip"
export MLPERF_USERNAME="your-username"

# HuggingFace Token (required)
export HF_TOKEN="your-huggingface-token"

# Benchmark Settings
export SAMPLES="13368"  # Full dataset
export ACCURACY="false" # Set to "true" for accuracy benchmarks
export MODEL_NAME="meta-llama/Llama-3.1-8B-Instruct"

# Storage Settings
export STORAGE_CLASS="nfs-client"  # Adjust for your cluster
EOF
        log_warning "Created ${CONFIG_FILE} template - please edit with your values"
        log_info "Then run this script again"
        exit 0
    fi
    
    # Apply ConfigMap
    kubectl apply -f k8s/configmap.yaml -n ${NAMESPACE}
    
    # Create secrets from environment
    if [ -n "${HF_TOKEN}" ]; then
        kubectl create secret generic mlperf-secrets \
            --from-literal=HF_TOKEN="${HF_TOKEN}" \
            --namespace=${NAMESPACE} \
            --dry-run=client -o yaml | kubectl apply -f -
        log_success "Secrets configured"
    else
        log_warning "HF_TOKEN not set - create secrets manually"
    fi
    
    log_success "Configuration deployed"
}

# Deploy benchmark jobs
deploy_benchmarks() {
    log_info "Deploying benchmark jobs..."
    
    # Apply PVCs and jobs
    kubectl apply -f k8s/benchmark-job.yaml -n ${NAMESPACE}
    
    log_success "Benchmark jobs deployed"
}

# Show status
show_status() {
    log_info "Current cluster status:"
    echo ""
    
    log_info "Pods:"
    kubectl get pods -n ${NAMESPACE} -l app=mlperf
    echo ""
    
    log_info "Jobs:"
    kubectl get jobs -n ${NAMESPACE} -l app=mlperf
    echo ""
    
    log_info "ConfigMaps:"
    kubectl get configmaps -n ${NAMESPACE} | grep mlperf
    echo ""
    
    log_info "Secrets:"
    kubectl get secrets -n ${NAMESPACE} | grep mlperf
    echo ""
}

# Main deployment function
deploy() {
    local job_type=${1:-"performance"}
    
    case $job_type in
        "performance")
            log_info "Deploying performance benchmark (${SAMPLES:-13368} samples)"
            kubectl apply -f k8s/benchmark-job.yaml -n ${NAMESPACE}
            ;;
        "accuracy")
            log_info "Deploying accuracy benchmark (${SAMPLES:-13368} samples)"
            kubectl apply -f k8s/accuracy-benchmark.yaml -n ${NAMESPACE}
            ;;
        "distributed")
            log_info "Deploying distributed benchmark (2 nodes)"
            kubectl apply -f k8s/distributed-benchmark.yaml -n ${NAMESPACE}
            ;;
        *)
            log_error "Unknown job type: $job_type"
            log_info "Available types: performance, accuracy, distributed"
            exit 1
            ;;
    esac
    
    log_success "Deployment complete!"
    log_info "Monitor progress with: kubectl logs -f job/mlperf-${job_type}-benchmark -n ${NAMESPACE}"
}

# Show help
show_help() {
    echo "MLPerf Universal Kubernetes Deployment"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  build                  Build Docker image"
    echo "  setup                  Setup cluster prerequisites"
    echo "  deploy [TYPE]          Deploy benchmark (performance|accuracy|distributed)"
    echo "  status                 Show cluster status"
    echo "  logs [TYPE]            Show logs for benchmark type"
    echo "  cleanup                Remove all MLPerf resources"
    echo "  help                   Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 build               # Build container image"
    echo "  $0 setup               # Setup cluster"
    echo "  $0 deploy performance  # Run performance benchmark"
    echo "  $0 deploy accuracy     # Run accuracy benchmark"
    echo "  $0 deploy distributed  # Run distributed benchmark"
    echo "  $0 status              # Check status"
    echo "  $0 logs performance    # View logs"
}

# Show logs
show_logs() {
    local job_type=${1:-"performance"}
    local job_name="mlperf-${job_type}-benchmark"
    
    if [ "$job_type" = "performance" ]; then
        job_name="mlperf-benchmark-full"
    fi
    
    log_info "Showing logs for: ${job_name}"
    kubectl logs -f job/${job_name} -n ${NAMESPACE}
}

# Cleanup
cleanup() {
    log_info "Cleaning up MLPerf resources..."
    
    kubectl delete jobs -l app=mlperf -n ${NAMESPACE}
    kubectl delete configmaps -l app=mlperf -n ${NAMESPACE}
    kubectl delete secrets mlperf-secrets -n ${NAMESPACE} --ignore-not-found
    
    log_success "Cleanup complete"
}

# Main script
case "${1:-help}" in
    "build")
        check_prerequisites
        build_image
        ;;
    "setup")
        check_prerequisites
        setup_namespace
        deploy_config
        ;;
    "deploy")
        check_prerequisites
        deploy_config
        deploy ${2:-performance}
        ;;
    "status")
        show_status
        ;;
    "logs")
        show_logs ${2:-performance}
        ;;
    "cleanup")
        cleanup
        ;;
    "help"|*)
        show_help
        ;;
esac