#!/bin/bash
# ============================================================================
# run_benchmarks.sh - MLPerf and MMLU Benchmark Runner for Kubernetes
# ============================================================================
# This script orchestrates the execution of MLPerf and MMLU benchmarks
# on a Kubernetes cluster using Llama-3.1-8B-Instruct model.
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
NAMESPACE="mlperf"
LOG_DIR="${SCRIPT_DIR}/benchmark_run_${TIMESTAMP}"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Create log directory
mkdir -p "${LOG_DIR}"
echo_info "Log directory: ${LOG_DIR}"

# ============================================================================
# Step 1: Cluster Connection Check
# ============================================================================
echo_info "Checking Kubernetes cluster connection..."
if ! kubectl cluster-info &>/dev/null; then
    echo_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
    exit 1
fi
kubectl cluster-info
echo_info "Cluster connection verified."

# ============================================================================
# Step 2: Cleanup Previous Jobs
# ============================================================================
echo_info "Cleaning up previous jobs in namespace: ${NAMESPACE}"
kubectl delete job -n ${NAMESPACE} --all 2>/dev/null || true
echo_info "Cleanup complete."

# ============================================================================
# Step 3: Apply Namespace and Secret
# ============================================================================
echo_info "Applying namespace and secrets..."
kubectl apply -f "${SCRIPT_DIR}/k8s/00-namespace.yaml"
kubectl apply -f "${SCRIPT_DIR}/k8s/01-secret.yaml"
echo_info "Namespace and secrets applied."

# ============================================================================
# Step 4: Run MLPerf Benchmark
# ============================================================================
echo_info "Starting MLPerf benchmark..."
kubectl apply -f "${SCRIPT_DIR}/k8s/02-mlperf-job-FULL.yaml"

MLPERF_JOB="mlperf-llama-benchmark-FULL"
echo_info "Waiting for MLPerf job to complete (this may take several hours)..."

# Wait for job completion
while true; do
    STATUS=$(kubectl get job ${MLPERF_JOB} -n ${NAMESPACE} -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
    FAILED=$(kubectl get job ${MLPERF_JOB} -n ${NAMESPACE} -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "")
    
    if [ "$STATUS" == "True" ]; then
        echo_info "MLPerf job completed successfully!"
        break
    elif [ "$FAILED" == "True" ]; then
        echo_error "MLPerf job failed!"
        break
    fi
    
    echo -n "."
    sleep 60
done

# Collect MLPerf logs
MLPERF_POD=$(kubectl get pods -n ${NAMESPACE} -l job-name=${MLPERF_JOB} -o jsonpath='{.items[0].metadata.name}')
kubectl logs "${MLPERF_POD}" -n ${NAMESPACE} > "${LOG_DIR}/mlperf_logs.txt" 2>&1
echo_info "MLPerf logs saved to ${LOG_DIR}/mlperf_logs.txt"

# ============================================================================
# Step 5: Run MMLU Benchmark
# ============================================================================
echo_info "Starting MMLU benchmark..."
kubectl apply -f "${SCRIPT_DIR}/k8s/03-mmlu-job-FULL.yaml"

MMLU_JOB="mmlu-benchmark-FULL"
echo_info "Waiting for MMLU job to complete (this may take several hours)..."

# Wait for job completion
while true; do
    STATUS=$(kubectl get job ${MMLU_JOB} -n ${NAMESPACE} -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
    FAILED=$(kubectl get job ${MMLU_JOB} -n ${NAMESPACE} -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo "")
    
    if [ "$STATUS" == "True" ]; then
        echo_info "MMLU job completed successfully!"
        break
    elif [ "$FAILED" == "True" ]; then
        echo_error "MMLU job failed!"
        break
    fi
    
    echo -n "."
    sleep 60
done

# Collect MMLU logs
MMLU_POD=$(kubectl get pods -n ${NAMESPACE} -l job-name=${MMLU_JOB} -o jsonpath='{.items[0].metadata.name}')
kubectl logs "${MMLU_POD}" -n ${NAMESPACE} > "${LOG_DIR}/mmlu_logs.txt" 2>&1
echo_info "MMLU logs saved to ${LOG_DIR}/mmlu_logs.txt"

# ============================================================================
# Step 6: Final Summary
# ============================================================================
echo ""
echo "============================================================================"
echo "                         BENCHMARK SUMMARY"
echo "============================================================================"
echo ""
kubectl get jobs -n ${NAMESPACE}
echo ""
kubectl get pods -n ${NAMESPACE}
echo ""
echo_info "All benchmarks complete. Logs saved to: ${LOG_DIR}"
echo "============================================================================"