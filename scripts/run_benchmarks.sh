#!/bin/bash
# ============================================================================
# run_benchmarks.sh - K-Cloud LLM Benchmark Suite
# ============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
K8S_DIR="$PROJECT_DIR/k8s"
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
    # Timestamped status line for better live visibility
    echo "[$(date '+%H:%M:%S')] $*"
}

check_runtime_and_gpu() {
    status "[1a] Validating GPU runtime..."
    if ! kubectl get runtimeclass nvidia >/dev/null 2>&1; then
        echo "ERROR: RuntimeClass 'nvidia' not found. Install NVIDIA runtime or remove runtimeClassName from the job spec."
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
echo "✓ Namespace and hf-token secret ready"
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
    local status=""
    for i in $(seq 1 120); do
        pod=$(kubectl get pods -n $NAMESPACE -l job-name=$job_name -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
        if [ -n "$pod" ]; then
            status=$(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null)
            if [ "$status" = "Running" ]; then
                echo "Pod $pod is Running on $(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.spec.nodeName}')"
                break
            elif [ "$status" = "Succeeded" ] || [ "$status" = "Failed" ]; then
                echo "Pod $pod finished with status: $status"
                break
            else
                status "Pod $pod state: $status (waiting...)"

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

    # If we exited the loop with a pod but it's still Pending, treat as failure
    if [ "$status" = "Pending" ]; then
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
    
    # Stream logs until pod completes
    echo ""
    echo "--- Streaming logs ---"
    status "Streaming logs -> $log_file"
    kubectl logs -f $pod -n $NAMESPACE 2>&1 | tee -a "$log_file" &
    local logs_pid=$!
    
    # Wait for job to complete (poll every 30 seconds)
    echo ""
    while true; do
        sleep 30
        
        # Check job status
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
            kubectl logs $pod -n $NAMESPACE --previous || true
            kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20 || true
            {
                echo "[$(date '+%F %T')] $description failed"
                kubectl describe pod $pod -n $NAMESPACE
                kubectl logs $pod -n $NAMESPACE --previous
                kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20
            } > "$diag_file" 2>&1 || true
            echo "FAIL $description" >> "$SUMMARY_FILE"
            return 1
        fi
        
        # Check if pod still exists and is running
        pod_status=$(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null)
        if [ "$pod_status" = "Succeeded" ]; then
            kill $logs_pid 2>/dev/null || true
            wait $logs_pid 2>/dev/null || true
            echo ""
            echo "✓ $description: PASS"
            return 0
        elif [ "$pod_status" = "Failed" ]; then
            kill $logs_pid 2>/dev/null || true
            wait $logs_pid 2>/dev/null || true
            echo ""
            echo "✗ $description: FAIL"
            kubectl describe pod $pod -n $NAMESPACE || true
            kubectl logs $pod -n $NAMESPACE --previous || true
            kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20 || true
            {
                echo "[$(date '+%F %T')] $description failed"
                kubectl describe pod $pod -n $NAMESPACE
                kubectl logs $pod -n $NAMESPACE --previous
                kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp | tail -n 20
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

# MLPerf
if [ "$RUN_MLPERF" = true ]; then
    MLPERF_YAML=$(cat <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: mlperf-bench
  namespace: mlperf
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      runtimeClassName: nvidia
      nodeSelector:
        nvidia.com/gpu.present: "true"
      containers:
      - name: bench
        image: python:3.10-slim
        command: ["bash", "-c"]
        args:
        - |
          set -e
          echo "========================================"
          echo " MLPerf Inference - Llama 3.1 8B"
          echo "========================================"
          pip install -q torch transformers datasets evaluate rouge-score nltk sentencepiece accelerate
          python3 -u << 'PY'
          import time, sys, torch
          from datasets import load_dataset
          from transformers import AutoModelForCausalLM, AutoTokenizer
          import evaluate

          print("Loading dataset...", flush=True)
          dataset = load_dataset("cnn_dailymail", "3.0.0", split="test${SAMPLE_SPLIT}")
          total = len(dataset)
          print(f"Samples: {total}", flush=True)

          print("Loading model (this can take 1-3 minutes)...", flush=True)
          tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")
          model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3.1-8B-Instruct", torch_dtype=torch.float16, device_map="auto")
          print(f"GPU: {torch.cuda.get_device_name(0)}", flush=True)

          preds, refs = [], []
          t0 = time.time()
          print("Starting inference...", flush=True)
          progress_every = max(1, total // 20)  # ~5% increments, at least every sample for small sets
          for i, s in enumerate(dataset):
              prompt = f"Summarize:\n{s['article'][:1500]}\n\nSummary:"
              inputs = tokenizer.apply_chat_template([{"role":"user","content":prompt}], tokenize=False, add_generation_prompt=True)
              inp = tokenizer(inputs, return_tensors="pt", truncation=True, max_length=2048).to(model.device)
              with torch.no_grad():
                  out = model.generate(**inp, max_new_tokens=150, do_sample=False, pad_token_id=tokenizer.eos_token_id)
              preds.append(tokenizer.decode(out[0][inp['input_ids'].shape[1]:], skip_special_tokens=True))
              refs.append(s["highlights"])

              if (i + 1) % progress_every == 0 or (i + 1) == total:
                  elapsed = time.time() - t0
                  rate = (i+1) / elapsed
                  eta = (len(dataset) - (i+1)) / rate / 60
                  print(f"  [{i+1}/{total}] {rate:.2f} samples/s, ETA: {eta:.0f}m", flush=True)

          elapsed = time.time() - t0
          print(f"\nCompleted {total} samples in {elapsed/60:.1f} minutes", flush=True)

          print("Computing ROUGE scores...", flush=True)
          rouge = evaluate.load("rouge")
          r = rouge.compute(predictions=preds, references=refs)
          print(f"\n{'='*50}", flush=True)
          print(f"ROUGE-L: {r['rougeL']:.4f}", flush=True)
          print(f"Time: {elapsed/60:.1f}m | {len(dataset)/elapsed:.2f} samples/s", flush=True)
          print(f"Status: {'PASS' if r['rougeL'] >= 0.15 else 'FAIL'}", flush=True)
          print(f"{'='*50}", flush=True)
          PY
        resources:
          limits: { nvidia.com/gpu: "1", memory: "48Gi" }
          requests: { nvidia.com/gpu: "1", memory: "24Gi" }
        env:
        - name: HF_TOKEN
          valueFrom: { secretKeyRef: { name: hf-token, key: HF_TOKEN } }
        - name: HF_HOME
          value: /cache
        - name: PYTHONUNBUFFERED
          value: "1"
        volumeMounts:
        - { name: cache, mountPath: /cache }
      volumes:
      - name: cache
        hostPath: { path: /data/hf-cache, type: DirectoryOrCreate }
EOF
)
    if run_job "mlperf-bench" "MLPerf Inference" "$MLPERF_YAML"; then
        RESULTS+=("MLPerf: PASS ✓")
    else
        RESULTS+=("MLPerf: FAIL ✗")
    fi
    echo ""
fi

# MMLU
if [ "$RUN_MMLU" = true ]; then
    MMLU_YAML=$(cat <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: mmlu-bench
  namespace: mlperf
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      runtimeClassName: nvidia
      nodeSelector:
        nvidia.com/gpu.present: "true"
      containers:
      - name: bench
        image: python:3.10-slim
        command: ["bash", "-c"]
        args:
        - |
          set -e
          echo "========================================"
          echo " MMLU-Pro - Llama 3.1 8B"
          echo "========================================"
          pip install -q torch transformers datasets sentencepiece accelerate
          python3 -u << 'PY'
          import time, re, torch
          from datasets import load_dataset
          from transformers import AutoModelForCausalLM, AutoTokenizer

          print("Loading dataset...", flush=True)
          dataset = load_dataset("TIGER-Lab/MMLU-Pro", split="test${SAMPLE_SPLIT}")
          total = len(dataset)
          print(f"Questions: {total}", flush=True)

          print("Loading model (this can take 1-3 minutes)...", flush=True)
          tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")
          model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3.1-8B-Instruct", torch_dtype=torch.float16, device_map="auto")
          print(f"GPU: {torch.cuda.get_device_name(0)}", flush=True)

          correct = 0
          t0 = time.time()
          print("Starting evaluation...", flush=True)
          progress_every = max(1, total // 20)  # ~5% increments
          for i, s in enumerate(dataset):
              opts = "\n".join([f"{chr(65+j)}. {o}" for j, o in enumerate(s["options"])])
              prompt = f"Answer with ONLY the letter.\n\nQ: {s['question']}\n\n{opts}\n\nAnswer:"
              inputs = tokenizer.apply_chat_template([{"role":"user","content":prompt}], tokenize=False, add_generation_prompt=True)
              inp = tokenizer(inputs, return_tensors="pt", truncation=True, max_length=2048).to(model.device)
              with torch.no_grad():
                  out = model.generate(**inp, max_new_tokens=10, do_sample=False, pad_token_id=tokenizer.eos_token_id)
              resp = tokenizer.decode(out[0][inp['input_ids'].shape[1]:], skip_special_tokens=True).upper()
              m = re.search(r'[A-J]', resp)
              if m and m.group(0) == s["answer"]: correct += 1

              if (i + 1) % progress_every == 0 or (i + 1) == total:
                  elapsed = time.time() - t0
                  rate = (i+1) / elapsed
                  eta = (len(dataset) - (i+1)) / rate / 60
                  acc = correct / (i+1)
                  print(f"  [{i+1}/{len(dataset)}] Acc: {acc:.1%}, {rate:.1f} q/s, ETA: {eta:.0f}m", flush=True)

          elapsed = time.time() - t0
          acc = correct / len(dataset)
          print(f"\nCompleted {len(dataset)} questions in {elapsed/60:.1f} minutes", flush=True)
          print(f"\n{'='*50}", flush=True)
          print(f"Accuracy: {acc:.2%} ({correct}/{len(dataset)})", flush=True)
          print(f"Time: {elapsed/60:.1f}m", flush=True)
          print(f"Status: {'PASS' if acc >= 0.35 else 'FAIL'}", flush=True)
          print(f"{'='*50}", flush=True)
          PY
        resources:
          limits: { nvidia.com/gpu: "1", memory: "48Gi" }
          requests: { nvidia.com/gpu: "1", memory: "24Gi" }
        env:
        - name: HF_TOKEN
          valueFrom: { secretKeyRef: { name: hf-token, key: HF_TOKEN } }
        - name: HF_HOME
          value: /cache
        - name: PYTHONUNBUFFERED
          value: "1"
        volumeMounts:
        - { name: cache, mountPath: /cache }
      volumes:
      - name: cache
        hostPath: { path: /data/hf-cache, type: DirectoryOrCreate }
EOF
)
    if run_job "mmlu-bench" "MMLU-Pro Benchmark" "$MMLU_YAML"; then
        RESULTS+=("MMLU-Pro: PASS ✓")
    else
        RESULTS+=("MMLU-Pro: FAIL ✗")
    fi
    echo ""
fi

# Inference
if [ "$RUN_INFERENCE" = true ]; then
    INF_YAML=$(cat <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: inference-bench
  namespace: mlperf
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      runtimeClassName: nvidia
      nodeSelector:
        nvidia.com/gpu.present: "true"
      containers:
      - name: bench
        image: python:3.10-slim
        command: ["bash", "-c"]
        args:
        - |
          set -e
          echo "========================================"
          echo " LLM Inference Test - Llama 3.1 8B"
          echo "========================================"
          pip install -q torch transformers sentencepiece accelerate
          python3 -u << 'PY'
          import time, torch
          from transformers import AutoModelForCausalLM, AutoTokenizer

          print("Loading model...", flush=True)
          tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")
          model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3.1-8B-Instruct", torch_dtype=torch.float16, device_map="auto")
          print(f"GPU: {torch.cuda.get_device_name(0)}", flush=True)

          prompt = "How to make spaghetti from scratch?"
          print(f"\nPrompt: {prompt}\n", flush=True)

          inputs = tokenizer.apply_chat_template([{"role":"user","content":prompt}], tokenize=False, add_generation_prompt=True)
          inp = tokenizer(inputs, return_tensors="pt").to(model.device)

          t0 = time.time()
          with torch.no_grad():
              out = model.generate(**inp, max_new_tokens=512, do_sample=True, temperature=0.7, pad_token_id=tokenizer.eos_token_id)
          elapsed = time.time() - t0

          resp = tokenizer.decode(out[0][inp['input_ids'].shape[1]:], skip_special_tokens=True)
          tokens = len(out[0]) - inp['input_ids'].shape[1]

          print(f"Response:\n{resp}\n", flush=True)
          print(f"{'='*50}", flush=True)
          print(f"Tokens: {tokens} | Time: {elapsed:.2f}s | {tokens/elapsed:.1f} tok/s", flush=True)
          print(f"Status: PASS", flush=True)
          print(f"{'='*50}", flush=True)
          PY
        resources:
          limits: { nvidia.com/gpu: "1", memory: "48Gi" }
          requests: { nvidia.com/gpu: "1", memory: "24Gi" }
        env:
        - name: HF_TOKEN
          valueFrom: { secretKeyRef: { name: hf-token, key: HF_TOKEN } }
        - name: HF_HOME
          value: /cache
        - name: PYTHONUNBUFFERED
          value: "1"
        volumeMounts:
        - { name: cache, mountPath: /cache }
      volumes:
      - name: cache
        hostPath: { path: /data/hf-cache, type: DirectoryOrCreate }
EOF
)
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
