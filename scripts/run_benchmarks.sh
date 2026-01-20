#!/bin/bash
# ============================================================================
# run_benchmarks.sh - K-Cloud LLM Benchmark Suite
# ============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
K8S_DIR="$PROJECT_DIR/k8s"
JOBS_DIR="$K8S_DIR/jobs"
BENCHMARKS_DIR="$PROJECT_DIR/benchmarks"
NAMESPACE="mlperf"

# Defaults
SMOKE_TEST=false
RUN_MLPERF=true
RUN_MMLU=true
RUN_INFERENCE=true
HF_TOKEN="${HF_TOKEN:-}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
RESULTS_DIR="$PROJECT_DIR/results/$RUN_ID"
SUMMARY_FILE="$RESULTS_DIR/summary.txt"

for arg in "$@"; do
    case $arg in
        --smoke) SMOKE_TEST=true ;;
        --mlperf) RUN_MMLU=false; RUN_INFERENCE=false ;;
        --mmlu) RUN_MLPERF=false; RUN_INFERENCE=false ;;
        --inference) RUN_MLPERF=false; RUN_MMLU=false ;;
        --help|-h)
            echo "Usage: $0 [--smoke] [--mlperf|--mmlu|--inference]"
            echo "  --smoke      Quick test with 10 samples (~15 min)"
            echo "  --mlperf     Run only MLPerf"
            echo "  --mmlu       Run only MMLU-Pro"
            echo "  --inference  Run only LLM Inference"
            exit 0 ;;
    esac
done

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   K-Cloud LLM Benchmark Suite - Llama 3.1 8B                     ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
if [ "$SMOKE_TEST" = true ]; then
    echo "Mode: SMOKE TEST (10 samples each, ~15 min)"
    SAMPLE_SPLIT="[:10]"
else
    echo "Mode: FULL DATASET (8-10 hours)"
    echo "  - MLPerf: ~11k samples (CNN/DailyMail test set)"
    echo "  - MMLU-Pro: ~12k questions"
    echo "  - Progress updates: every 1% or 60 seconds"
    echo "  - Heartbeat status: every 2 minutes during job execution"
    SAMPLE_SPLIT=""
fi
echo "Date: $(date)"
echo ""
mkdir -p "$RESULTS_DIR"
{
    echo "K-Cloud LLM Benchmark Suite"
    echo "Run ID: $RUN_ID"
    echo "Date: $(date)"
    echo "Mode: $([ "$SMOKE_TEST" = true ] && echo 'Smoke Test' || echo 'Full Dataset')"
    echo "Components: MLPerf=$RUN_MLPERF MMLU=$RUN_MMLU Inference=$RUN_INFERENCE"
    echo ""
} > "$SUMMARY_FILE"

status() {
    echo "[$(date '+%H:%M:%S')] $*"
}

check_runtime_and_gpu() {
    status "[1a] Validating GPU runtime..."
    if ! kubectl get runtimeclass nvidia >/dev/null 2>&1; then
        echo "ERROR: RuntimeClass 'nvidia' not found."
        exit 1
    fi

    local gpu_nodes
    gpu_nodes=$(kubectl get nodes -l nvidia.com/gpu.present=true --no-headers 2>/dev/null | wc -l | xargs)
    if [ "${gpu_nodes:-0}" -eq 0 ]; then
        echo "ERROR: No GPU nodes labeled with nvidia.com/gpu.present=true"
        exit 1
    fi
    echo "✓ RuntimeClass 'nvidia' present; GPU nodes available: $gpu_nodes"
    echo ""
}

ensure_hf_secret() {
    if kubectl get secret hf-token -n $NAMESPACE >/dev/null 2>&1; then
        local placeholder current
        placeholder=$(echo -n "YOUR_HUGGINGFACE_TOKEN" | base64)
        current=$(kubectl get secret hf-token -n $NAMESPACE -o jsonpath='{.data.HF_TOKEN}' 2>/dev/null || echo "")

        if [ "$current" = "$placeholder" ]; then
            if [ -z "$HF_TOKEN" ]; then
                echo "ERROR: hf-token secret contains placeholder. Export HF_TOKEN to recreate it."
                exit 1
            fi
            echo "Updating hf-token secret with provided HF_TOKEN..."
            kubectl delete secret hf-token -n $NAMESPACE >/dev/null 2>&1 || true
            kubectl create secret generic hf-token --from-literal=HF_TOKEN="$HF_TOKEN" -n $NAMESPACE
        fi
    else
        if [ -z "$HF_TOKEN" ]; then
            echo "ERROR: Set HF_TOKEN env var"
            exit 1
        fi
        kubectl create secret generic hf-token --from-literal=HF_TOKEN="$HF_TOKEN" -n $NAMESPACE
    fi
}

setup_benchmark_configmaps() {
    status "[2a] Setting up benchmark script ConfigMaps..."
    
    kubectl delete configmap benchmark-scripts -n $NAMESPACE --ignore-not-found=true >/dev/null 2>&1
    
    kubectl create configmap benchmark-scripts -n $NAMESPACE \
        --from-file=mlperf_summarization.py="$BENCHMARKS_DIR/mlperf_summarization.py" \
        --from-file=mmlu_pro_cot.py="$BENCHMARKS_DIR/mmlu_pro_cot.py" \
        --from-file=inference_throughput.py="$BENCHMARKS_DIR/inference_throughput.py"
    
    echo "✓ Benchmark scripts ConfigMap created"
}

# Load YAML template and substitute variables
load_job_yaml() {
    local yaml_file=$1
    local yaml_content
    yaml_content=$(cat "$yaml_file")
    # Substitute ${SAMPLE_SPLIT} with actual value
    echo "${yaml_content//\$\{SAMPLE_SPLIT\}/$SAMPLE_SPLIT}"
}

# Check cluster
status "[1/4] Checking Cluster..."
kubectl cluster-info > /dev/null || { echo "ERROR: Cannot connect to cluster"; exit 1; }
echo "✓ Cluster OK"
kubectl get nodes -o wide
echo ""
check_runtime_and_gpu

# Setup
status "[2/4] Setting up namespace..."
kubectl apply -f "$K8S_DIR/00-namespace.yaml" 2>/dev/null || true
ensure_hf_secret
setup_benchmark_configmaps
echo "✓ Namespace, secrets, and ConfigMaps ready"
echo ""

# Function to run job and wait for completion
run_job() {
    local job_name=$1
    local description=$2
    local yaml_content=$3
    local log_file="$RESULTS_DIR/${job_name}.log"
    local diag_file="$RESULTS_DIR/${job_name}-diagnostics.log"
    local manifest_file="$RESULTS_DIR/${job_name}-manifest.yaml"
    
    echo "════════════════════════════════════════════════════════════════════"
    echo "  $description"
    echo "════════════════════════════════════════════════════════════════════"
    echo "$yaml_content" > "$manifest_file"
    status "Saved manifest -> $manifest_file"
    
    # Delete existing job
    status "Deleting any existing job $job_name..."
    kubectl delete job $job_name -n $NAMESPACE --ignore-not-found=true 2>/dev/null
    sleep 3
    
    # Apply job
    status "Creating job $job_name..."
    echo "$yaml_content" | kubectl apply -f -
    
    # Wait for pod to start
    echo "Waiting for pod to start..."
    local pod=""
    local pod_status=""
    for i in $(seq 1 120); do
        pod=$(kubectl get pods -n $NAMESPACE -l job-name=$job_name -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
        if [ -n "$pod" ]; then
            pod_status=$(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null)
            if [ "$pod_status" = "Running" ]; then
                echo "Pod $pod is Running on $(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.spec.nodeName}')"
                break
            elif [ "$pod_status" = "Succeeded" ] || [ "$pod_status" = "Failed" ]; then
                echo "Pod $pod finished with status: $pod_status"
                break
            else
                status "Pod $pod state: $pod_status (waiting...)"

                # Fail fast if scheduler already marked it unschedulable
                pod_scheduled_status=$(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.status.conditions[?(@.type=="PodScheduled")].status}' 2>/dev/null || true)
                pod_scheduled_reason=$(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.status.conditions[?(@.type=="PodScheduled")].reason}' 2>/dev/null || true)
                if [ "$pod_scheduled_status" = "False" ] && [ "$pod_scheduled_reason" = "Unschedulable" ]; then
                    echo "ERROR: Pod $pod is Unschedulable"
                    kubectl describe pod $pod -n $NAMESPACE || true
                    kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20 || true
                    {
                        echo "[$(date '+%F %T')] $description unschedulable"
                        kubectl describe pod $pod -n $NAMESPACE
                        kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20
                    } > "$diag_file" 2>&1 || true
                    echo "FAIL $description" >> "$SUMMARY_FILE"
                    return 1
                fi
            fi
        fi
        status "Waiting for pod... attempt $i/120"
        sleep 5
    done
    
    if [ -z "$pod" ]; then
        echo "ERROR: Pod failed to start"
        kubectl describe job $job_name -n $NAMESPACE
        kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20
        {
            echo "[$(date '+%F %T')] $description pod failed to start"
            kubectl describe job $job_name -n $NAMESPACE
            kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20
        } > "$diag_file" 2>&1
        echo "FAIL $description" >> "$SUMMARY_FILE"
        return 1
    fi

    if [ "$pod_status" = "Pending" ]; then
        echo "ERROR: Pod $pod is still Pending after waiting"
        kubectl describe pod $pod -n $NAMESPACE || true
        kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20 || true
        {
            echo "[$(date '+%F %T')] $description still pending after timeout"
            kubectl describe pod $pod -n $NAMESPACE
            kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20
        } > "$diag_file" 2>&1 || true
        echo "FAIL $description" >> "$SUMMARY_FILE"
        return 1
    fi
    
    # Stream logs
    echo ""
    echo "--- Streaming logs (real-time) ---"
    status "Log file: $log_file"
    
    if command -v stdbuf >/dev/null 2>&1; then
        stdbuf -oL kubectl logs -f $pod -n $NAMESPACE 2>&1 | stdbuf -oL tee -a "$log_file" &
    else
        kubectl logs -f $pod -n $NAMESPACE 2>&1 | tee -a "$log_file" &
    fi
    local logs_pid=$!
    
    # Wait for job to complete
    echo ""
    local poll_count=0
    local start_time=$(date +%s)
    while true; do
        sleep 10
        poll_count=$((poll_count + 1))
        
        if [ $((poll_count % 3)) -eq 0 ]; then
            local now=$(date +%s)
            local elapsed_min=$(( (now - start_time) / 60 ))
            local pod_status_now=$(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
            
            local recent_progress=$(kubectl logs $pod -n $NAMESPACE --tail=10 2>/dev/null | grep -E '^\s*\[|samples/s|q/s|ETA:|%' | tail -3)
            if [ -n "$recent_progress" ]; then
                echo ""
                status "[Progress Update] Elapsed: ${elapsed_min}m | Pod: $pod_status_now"
                echo "$recent_progress"
            else
                status "[Heartbeat] Job: $job_name | Pod: $pod_status_now | Elapsed: ${elapsed_min}m"
            fi
        fi
        
        succeeded=$(kubectl get job $job_name -n $NAMESPACE -o jsonpath='{.status.succeeded}' 2>/dev/null)
        failed=$(kubectl get job $job_name -n $NAMESPACE -o jsonpath='{.status.failed}' 2>/dev/null)
        
        if [ "$succeeded" = "1" ]; then
            kill $logs_pid 2>/dev/null || true
            wait $logs_pid 2>/dev/null || true
            echo ""
            echo "✓ $description: PASS"
            echo "PASS $description" >> "$SUMMARY_FILE"
            return 0
        elif [ "$failed" = "1" ]; then
            kill $logs_pid 2>/dev/null || true
            wait $logs_pid 2>/dev/null || true
            echo ""
            echo "✗ $description: FAIL"
            kubectl describe pod $pod -n $NAMESPACE || true
            {
                echo "[$(date '+%F %T')] $description failed"
                kubectl describe pod $pod -n $NAMESPACE
            } > "$diag_file" 2>&1 || true
            echo "FAIL $description" >> "$SUMMARY_FILE"
            return 1
        fi
        
        local current_pod_status=$(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null)
        if [ "$current_pod_status" = "Succeeded" ]; then
            kill $logs_pid 2>/dev/null || true
            wait $logs_pid 2>/dev/null || true
            echo ""
            echo "✓ $description: PASS"
            return 0
        elif [ "$current_pod_status" = "Failed" ]; then
            kill $logs_pid 2>/dev/null || true
            wait $logs_pid 2>/dev/null || true
            echo ""
            echo "✗ $description: FAIL"
            kubectl describe pod $pod -n $NAMESPACE || true
            {
                echo "[$(date '+%F %T')] $description failed"
                kubectl describe pod $pod -n $NAMESPACE
            } > "$diag_file" 2>&1 || true
            echo "FAIL $description" >> "$SUMMARY_FILE"
            return 1
        fi
    done
}

# Results array
declare -a RESULTS

echo "[3/4] Running Benchmarks..."
echo ""

# MLPerf - load from YAML file
if [ "$RUN_MLPERF" = true ]; then
    MLPERF_YAML=$(load_job_yaml "$JOBS_DIR/mlperf-job.yaml")
    if run_job "mlperf-bench" "MLPerf Inference" "$MLPERF_YAML"; then
        RESULTS+=("MLPerf: PASS ✓")
    else
        RESULTS+=("MLPerf: FAIL ✗")
    fi
    echo ""
fi

# MMLU-Pro - load from YAML file
if [ "$RUN_MMLU" = true ]; then
    MMLU_YAML=$(load_job_yaml "$JOBS_DIR/mmlu-job.yaml")
    if run_job "mmlu-bench" "MMLU-Pro Benchmark" "$MMLU_YAML"; then
        RESULTS+=("MMLU-Pro: PASS ✓")
    else
        RESULTS+=("MMLU-Pro: FAIL ✗")
    fi
    echo ""
fi

# Inference - load from YAML file
if [ "$RUN_INFERENCE" = true ]; then
    INF_YAML=$(load_job_yaml "$JOBS_DIR/inference-job.yaml")
    if run_job "inference-bench" "LLM Inference Test" "$INF_YAML"; then
        RESULTS+=("Inference: PASS ✓")
    else
        RESULTS+=("Inference: FAIL ✗")
    fi
    echo ""
fi

# Summary
echo "[4/4] Final Summary"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                    BENCHMARK RESULTS                             ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
for r in "${RESULTS[@]}"; do
    printf "║  %-64s ║\n" "$r"
done
echo "╠══════════════════════════════════════════════════════════════════╣"
printf "║  %-64s ║\n" "Completed: $(date '+%Y-%m-%d %H:%M:%S')"
printf "║  %-64s ║\n" "Mode: $([ "$SMOKE_TEST" = true ] && echo 'Smoke Test' || echo 'Full Dataset')"
echo "╚══════════════════════════════════════════════════════════════════╝"
