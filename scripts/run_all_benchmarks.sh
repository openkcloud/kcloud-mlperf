#!/bin/bash
# ============================================================================
# run_all_benchmarks.sh - Unified MLPerf/MMLU-Pro/LLM Inference Benchmark Runner
# ============================================================================
# Runs all three K8s benchmark jobs sequentially:
#   1. mlperf-inference-llama-3.1-8b - MLPerf LLM inference benchmark
#   2. mmlu-pro-llama-3.1-8b - MMLU-Pro evaluation benchmark
#   3. llm-inference-test-llama-3.1-8b - Interactive inference demo
#
# Prerequisites:
#   - K8s cluster with GPU worker node ready
#   - NVIDIA device plugin installed
#   - HuggingFace token secret created
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
NAMESPACE="mlperf"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo ""
    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}   $1${NC}"
    echo -e "${BLUE}============================================================================${NC}"
    echo ""
}

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

wait_for_job() {
    local job_name=$1
    local timeout=${2:-36000}  # Default 10 hours
    
    print_status "Waiting for job '$job_name' to complete (timeout: ${timeout}s)..."
    
    # Wait for pod to be created
    local retries=0
    while [ $retries -lt 60 ]; do
        pod_name=$(kubectl get pods -n $NAMESPACE -l job-name=$job_name -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
        if [ -n "$pod_name" ]; then
            break
        fi
        sleep 2
        retries=$((retries + 1))
    done
    
    if [ -z "$pod_name" ]; then
        print_error "No pod created for job $job_name"
        return 1
    fi
    
    print_status "Pod created: $pod_name"
    
    # Wait for pod to start running
    kubectl wait --for=condition=Ready pod/$pod_name -n $NAMESPACE --timeout=600s 2>/dev/null || true
    
    # Stream logs
    print_status "Streaming logs from $pod_name..."
    echo ""
    kubectl logs -f $pod_name -n $NAMESPACE 2>/dev/null || true
    
    # Wait for job completion
    kubectl wait --for=condition=complete job/$job_name -n $NAMESPACE --timeout=${timeout}s 2>/dev/null
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        print_status "Job '$job_name' completed successfully!"
        return 0
    else
        # Check if job failed
        local failed=$(kubectl get job $job_name -n $NAMESPACE -o jsonpath='{.status.failed}' 2>/dev/null || echo "0")
        if [ "$failed" != "0" ] && [ -n "$failed" ]; then
            print_error "Job '$job_name' failed!"
            return 1
        fi
        print_warning "Job '$job_name' timed out or status unknown"
        return 1
    fi
}

cleanup_job() {
    local job_name=$1
    print_status "Cleaning up job '$job_name'..."
    kubectl delete job $job_name -n $NAMESPACE --ignore-not-found=true 2>/dev/null || true
}

run_benchmark() {
    local yaml_file=$1
    local job_name=$2
    local description=$3
    local timeout=${4:-36000}
    
    print_header "$description"
    
    # Clean up any existing job
    cleanup_job $job_name
    sleep 2
    
    # Apply the job
    print_status "Creating job from $yaml_file..."
    kubectl apply -f "$REPO_DIR/k8s/$yaml_file"
    
    # Wait for completion
    if wait_for_job $job_name $timeout; then
        print_status "$description - PASSED"
        return 0
    else
        print_error "$description - FAILED"
        return 1
    fi
}

# ============================================================================
# Main execution
# ============================================================================

print_header "K-Cloud MLPerf Benchmark Suite"

echo "This script will run the following benchmarks:"
echo "  1. MLPerf Inference (Llama-3.1-8B) - CNN/DailyMail ROUGE-L"
echo "  2. MMLU-Pro (Llama-3.1-8B) - Multi-task Language Understanding"
echo "  3. LLM Inference Test (Llama-3.1-8B) - Interactive Demo"
echo ""
echo "Estimated total time: 18-20 hours (depends on GPU)"
echo ""

# Parse arguments
RUN_MLPERF=true
RUN_MMLU=true
RUN_INFERENCE=true
SKIP_SETUP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --mlperf-only)
            RUN_MMLU=false
            RUN_INFERENCE=false
            shift
            ;;
        --mmlu-only)
            RUN_MLPERF=false
            RUN_INFERENCE=false
            shift
            ;;
        --inference-only)
            RUN_MLPERF=false
            RUN_MMLU=false
            shift
            ;;
        --skip-mlperf)
            RUN_MLPERF=false
            shift
            ;;
        --skip-mmlu)
            RUN_MMLU=false
            shift
            ;;
        --skip-inference)
            RUN_INFERENCE=false
            shift
            ;;
        --skip-setup)
            SKIP_SETUP=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --mlperf-only      Run only MLPerf benchmark"
            echo "  --mmlu-only        Run only MMLU-Pro benchmark"
            echo "  --inference-only   Run only LLM inference test"
            echo "  --skip-mlperf      Skip MLPerf benchmark"
            echo "  --skip-mmlu        Skip MMLU-Pro benchmark"
            echo "  --skip-inference   Skip LLM inference test"
            echo "  --skip-setup       Skip namespace and secret setup"
            echo "  -h, --help         Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check prerequisites
print_header "Checking Prerequisites"

# Check kubectl
if ! command -v kubectl &> /dev/null; then
    print_error "kubectl not found. Please install kubectl first."
    exit 1
fi
print_status "kubectl found: $(kubectl version --client --short 2>/dev/null || kubectl version --client | head -1)"

# Check cluster connectivity
if ! kubectl cluster-info &> /dev/null; then
    print_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
    exit 1
fi
print_status "Connected to Kubernetes cluster"

# Check GPU nodes
gpu_nodes=$(kubectl get nodes -l nvidia.com/gpu.present=true -o name 2>/dev/null | wc -l)
if [ "$gpu_nodes" -eq 0 ]; then
    print_warning "No GPU nodes found with label 'nvidia.com/gpu.present=true'"
    print_warning "Make sure to label your GPU worker node:"
    print_warning "  kubectl label nodes <node-name> nvidia.com/gpu.present=true"
fi
print_status "GPU nodes available: $gpu_nodes"

# Setup namespace and secrets
if [ "$SKIP_SETUP" = false ]; then
    print_header "Setting Up Namespace and Secrets"
    
    kubectl apply -f "$REPO_DIR/k8s/00-namespace.yaml"
    print_status "Namespace '$NAMESPACE' ready"
    
    # Check if secret exists
    if ! kubectl get secret hf-token -n $NAMESPACE &> /dev/null; then
        if [ -f "$REPO_DIR/k8s/01-secret.yaml" ]; then
            kubectl apply -f "$REPO_DIR/k8s/01-secret.yaml"
            print_status "HuggingFace token secret created"
        else
            print_warning "HuggingFace token secret not found!"
            print_warning "Please create it manually:"
            print_warning "  kubectl create secret generic hf-token --from-literal=HF_TOKEN=<your-token> -n $NAMESPACE"
        fi
    else
        print_status "HuggingFace token secret exists"
    fi
fi

# Track results
declare -A RESULTS
START_TIME=$(date +%s)

# Run MLPerf benchmark
if [ "$RUN_MLPERF" = true ]; then
    if run_benchmark "02-mlperf-job-FULL.yaml" "mlperf-inference-llama-3.1-8b" "MLPerf Inference Benchmark" 36000; then
        RESULTS["mlperf"]="PASS"
    else
        RESULTS["mlperf"]="FAIL"
    fi
fi

# Run MMLU-Pro benchmark
if [ "$RUN_MMLU" = true ]; then
    if run_benchmark "03-mmlu-job-FULL.yaml" "mmlu-pro-llama-3.1-8b" "MMLU-Pro Benchmark" 36000; then
        RESULTS["mmlu"]="PASS"
    else
        RESULTS["mmlu"]="FAIL"
    fi
fi

# Run LLM inference test
if [ "$RUN_INFERENCE" = true ]; then
    if run_benchmark "04-llm-inference-job.yaml" "llm-inference-test-llama-3.1-8b" "LLM Inference Test" 1800; then
        RESULTS["inference"]="PASS"
    else
        RESULTS["inference"]="FAIL"
    fi
fi

# Summary
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
HOURS=$((DURATION / 3600))
MINUTES=$(((DURATION % 3600) / 60))
SECONDS=$((DURATION % 60))

print_header "Benchmark Suite Complete"

echo "Results Summary:"
echo "================"
for benchmark in "mlperf" "mmlu" "inference"; do
    if [ -n "${RESULTS[$benchmark]}" ]; then
        if [ "${RESULTS[$benchmark]}" = "PASS" ]; then
            echo -e "  $benchmark: ${GREEN}PASS${NC}"
        else
            echo -e "  $benchmark: ${RED}FAIL${NC}"
        fi
    fi
done
echo ""
echo "Total Duration: ${HOURS}h ${MINUTES}m ${SECONDS}s"
echo "Completed at: $(date -u '+%a %b %d %H:%M:%S UTC %Y')"
echo ""

# Check for any failures
for benchmark in "${!RESULTS[@]}"; do
    if [ "${RESULTS[$benchmark]}" = "FAIL" ]; then
        print_error "One or more benchmarks failed!"
        exit 1
    fi
done

print_status "All benchmarks completed successfully!"

