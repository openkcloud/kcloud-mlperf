#!/bin/bash
# ============================================================================
# run_all_benchmarks.sh - K8s Benchmark Runner with Full Logging
# ============================================================================
# Runs MLPerf, MMLU-Pro, and LLM Inference benchmarks sequentially.
# All output is streamed to the terminal in real-time.
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="${SCRIPT_DIR}/../k8s"
NAMESPACE="mlperf"

echo "========================================"
echo " K-Cloud Benchmark Suite"
echo " $(date -u)"
echo "========================================"
echo ""

# Parse arguments
RUN_MLPERF=true
RUN_MMLU=true
RUN_INFERENCE=true
SKIP_SETUP=false

for arg in "$@"; do
    case $arg in
        --mlperf-only) RUN_MMLU=false; RUN_INFERENCE=false ;;
        --mmlu-only) RUN_MLPERF=false; RUN_INFERENCE=false ;;
        --inference-only) RUN_MLPERF=false; RUN_MMLU=false ;;
        --skip-mlperf) RUN_MLPERF=false ;;
        --skip-mmlu) RUN_MMLU=false ;;
        --skip-inference) RUN_INFERENCE=false ;;
        --skip-setup) SKIP_SETUP=true ;;
    esac
done

# Function to run a job and stream logs
run_job() {
    local yaml_file=$1
    local job_name=$2
    local description=$3
    
    echo ""
    echo "========================================"
    echo " $description"
    echo "========================================"
    echo ""
    
    # Delete any existing job
    echo "[INFO] Cleaning up previous job..."
    kubectl delete job $job_name -n $NAMESPACE --ignore-not-found=true 2>/dev/null || true
    sleep 2
    
    # Apply the job
    echo "[INFO] Creating job from $yaml_file..."
    kubectl apply -f "${K8S_DIR}/${yaml_file}"
    echo ""
    
    # Wait for pod to be created
    echo "[INFO] Waiting for pod to be created..."
    local pod_name=""
    for i in $(seq 1 120); do
        pod_name=$(kubectl get pods -n $NAMESPACE -l job-name=$job_name -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
        if [ -n "$pod_name" ]; then
            echo "[INFO] Pod created: $pod_name"
            break
        fi
        sleep 1
    done
    
    if [ -z "$pod_name" ]; then
        echo "[ERROR] Pod was not created within 2 minutes."
        kubectl describe job $job_name -n $NAMESPACE
        return 1
    fi
    
    # Wait for pod to start (or fail)
    echo "[INFO] Waiting for pod to start running..."
    for i in $(seq 1 300); do
        local phase=$(kubectl get pod $pod_name -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
        if [[ "$phase" == "Running" || "$phase" == "Succeeded" || "$phase" == "Failed" ]]; then
            echo "[INFO] Pod status: $phase"
            break
        fi
        
        # Check if pending due to scheduling issues
        if [[ "$phase" == "Pending" ]]; then
            local reason=$(kubectl get pod $pod_name -n $NAMESPACE -o jsonpath='{.status.conditions[?(@.reason)].reason}' 2>/dev/null || true)
            if [ -n "$reason" ]; then
                echo "[WARN] Pod pending: $reason"
            fi
        fi
        sleep 1
    done
    
    # Stream logs
    echo ""
    echo "========================================"
    echo " JOB OUTPUT"
    echo "========================================"
    kubectl logs -f $pod_name -n $NAMESPACE 2>&1 || true
    echo "========================================"
    echo ""
    
    # Check result - wait for job status to finalize
    echo "[INFO] Waiting for job status to finalize..."
    for i in $(seq 1 30); do
        local succeeded=$(kubectl get job $job_name -n $NAMESPACE -o jsonpath='{.status.succeeded}' 2>/dev/null)
        local failed=$(kubectl get job $job_name -n $NAMESPACE -o jsonpath='{.status.failed}' 2>/dev/null)
        
        if [ "$succeeded" == "1" ]; then
            echo "[RESULT] $description: SUCCESS ✓"
            return 0
        elif [ -n "$failed" ] && [ "$failed" != "0" ]; then
            echo "[RESULT] $description: FAILED ✗"
            return 1
        fi
        sleep 1
    done
    
    # Final check
    local final_succeeded=$(kubectl get job $job_name -n $NAMESPACE -o jsonpath='{.status.succeeded}' 2>/dev/null)
    if [ "$final_succeeded" == "1" ]; then
        echo "[RESULT] $description: SUCCESS ✓"
        return 0
    else
        echo "[RESULT] $description: FAILED (timeout waiting for status)"
        return 1
    fi
}

# Check cluster
echo "[INFO] Checking Kubernetes cluster..."
kubectl cluster-info || { echo "[ERROR] Cannot connect to cluster"; exit 1; }
echo ""

echo "[INFO] Checking nodes..."
kubectl get nodes -o wide
echo ""

# Setup namespace and secret if needed
if [ "$SKIP_SETUP" = false ]; then
    echo "[INFO] Setting up namespace and secrets..."
    kubectl apply -f "${K8S_DIR}/00-namespace.yaml" 2>/dev/null || true
    
    # Check if secret exists
    if ! kubectl get secret hf-token -n $NAMESPACE &>/dev/null; then
        echo "[WARN] HuggingFace token secret not found. Creating from HF_TOKEN env var..."
        if [ -n "$HF_TOKEN" ]; then
            kubectl create secret generic hf-token --from-literal=HF_TOKEN="$HF_TOKEN" -n $NAMESPACE
        else
            echo "[ERROR] HF_TOKEN environment variable not set!"
            exit 1
        fi
    fi
    echo "[INFO] Namespace and secrets ready."
fi

# Track results
declare -a RESULTS

# Run MLPerf
if [ "$RUN_MLPERF" = true ]; then
    if run_job "02-mlperf-job-FULL.yaml" "mlperf-inference-llama-3.1-8b" "MLPerf Inference Benchmark"; then
        RESULTS+=("MLPerf: PASS")
    else
        RESULTS+=("MLPerf: FAIL")
    fi
fi

# Run MMLU
if [ "$RUN_MMLU" = true ]; then
    if run_job "03-mmlu-job-FULL.yaml" "mmlu-pro-llama-3.1-8b" "MMLU-Pro Benchmark"; then
        RESULTS+=("MMLU-Pro: PASS")
    else
        RESULTS+=("MMLU-Pro: FAIL")
    fi
fi

# Run Inference Test
if [ "$RUN_INFERENCE" = true ]; then
    if run_job "04-llm-inference-job.yaml" "llm-inference-test-llama-3.1-8b" "LLM Inference Test"; then
        RESULTS+=("Inference: PASS")
    else
        RESULTS+=("Inference: FAIL")
    fi
fi

# Final summary
echo ""
echo "========================================"
echo " FINAL SUMMARY"
echo "========================================"
for result in "${RESULTS[@]}"; do
    echo "  $result"
done
echo "========================================"
echo " Completed: $(date -u)"
echo "========================================"
