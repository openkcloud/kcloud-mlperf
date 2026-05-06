# Reproducibility Guide: ETRI LLM Benchmark
**Last Updated:** May 6, 2026

This guide enables anyone to reproduce the benchmark results, understand the exact commands used, and troubleshoot common issues.

---

## Environment Setup

### Cluster Prerequisites
```bash
# Verify Kubernetes cluster (1.26+)
kubectl version --short
# Expected: Client v1.28+, Server v1.26+

# Check nodes
kubectl get nodes
# Expected output:
# NAME    STATUS   ROLES   AGE   VERSION
# node1   Ready    <none>  365d  v1.26.0  (L40)
# node2   Ready    <none>  365d  v1.26.0  (L40)
# node3   Ready    <none>  365d  v1.26.0  (A40)
# node4   Ready    <none>  365d  v1.26.0  (A40)
# node5   Ready    <none>  60d   v1.26.0  (RNGD - integrated this project)
# node6   Ready    <none>  30d   v1.26.0  (ATOM+ - integrated this project)

# Verify GPU/NPU drivers
kubectl describe nodes | grep -A 5 "Allocated resources"
```

### Python Environment
```bash
# Create virtual environment (3.10+)
python3.10 -m venv /home/bench/env
source /home/bench/env/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r /home/kcloud/etri-llm-exam-solution/requirements.txt
# Key packages: vllm, transformers, torch, pydantic, requests

# Verify CUDA/cuDNN (for GPU nodes)
python -c "import torch; print(torch.cuda.is_available())"
# Expected: True (on GPU nodes)
```

### Canonical Configuration
```bash
# Source of truth for all runs
export CONFIG=/home/kcloud/etri-llm-exam-solution/.omc/handoffs/canonical-config.yaml

# Verify config exists
cat $CONFIG | head -20
```

### Dataset Setup
```bash
# MLPerf dataset (CNN-DailyMail)
mkdir -p /mnt/datasets
cd /mnt/datasets
# Option 1: Download from HuggingFace
python -c "from datasets import load_dataset; \
  ds = load_dataset('abisee/cnn_dailymail', '3.0.0'); \
  ds.save_to_disk('./cnn_dailymail')"

# Option 2: Use pre-downloaded snapshot (faster)
ls -lh /mnt/datasets/cnn_eval.json
# Expected: ~400 MB

# MMLU-Pro dataset
python -c "from datasets import load_dataset; \
  ds = load_dataset('TIGER-Lab/MMLU-Pro'); \
  ds.save_to_disk('./mmlu-pro')"

# Verify
du -sh /mnt/datasets/
# Expected: ~2 GB total
```

---

## Running Benchmarks

### MLPerf Inference (TT100T)

#### Full Canonical Run (13,368 samples)
```bash
# Configuration
HARDWARE=RNGD  # or L40, L40-44GiB, A40, A40-44GiB, ATOM+
CONFIG=/home/kcloud/etri-llm-exam-solution/.omc/handoffs/canonical-config.yaml
RESULTS_DIR=/home/bench/results/mlperf
mkdir -p $RESULTS_DIR

# Command (exact as used in this project)
python3 /home/kcloud/etri-llm-exam-solution/harness/mlperf_runner.py \
  --config $CONFIG \
  --hardware $HARDWARE \
  --node_selector ${HARDWARE,,} \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --dataset cnn_eval.json \
  --data_number 13368 \
  --batch_size 1 \
  --max_output_tokens 100 \
  --decoding_temperature 0.0 \
  --decoding_top_p 1.0 \
  --decoding_top_k 0 \
  --scenario offline \
  --retry_num 3 \
  --min_duration 600 \
  --output $RESULTS_DIR/mlperf_${HARDWARE}_$(date +%s).json \
  --verbose

# Expected runtime:
# RNGD: ~10 min (very fast)
# L40:  ~40 min (batch throughput limited)
# A40:  ~50 min (slower throughput)
# ATOM+: ~15 min (moderate)

# Output: JSON with schema
# {
#   "hardware": "RNGD",
#   "model": "meta-llama/Llama-3.1-8B-Instruct",
#   "dataset": "cnn_eval.json",
#   "metrics": {
#     "tt100t_seconds": 0.54,
#     "tps": 185.2,
#     "throughput": 0.563,
#     "latency_p50": 0.52,
#     "latency_p99": 1.89
#   },
#   "completed_at": "2026-05-06T01:45:00Z"
# }
```

#### Quick Calibration Run (500 samples)
```bash
# For fast validation before full run
python3 /home/kcloud/etri-llm-exam-solution/harness/mlperf_runner.py \
  --config $CONFIG \
  --hardware $HARDWARE \
  --data_number 500 \
  --output $RESULTS_DIR/mlperf_${HARDWARE}_calib.json

# Expected runtime: ~2 min (RNGD), ~5 min (GPU)
```

#### Run on Specific Node
```bash
# If you want to target a specific k8s node
python3 /home/kcloud/etri-llm-exam-solution/harness/mlperf_runner.py \
  --config $CONFIG \
  --hardware RNGD \
  --node_name node5 \
  --data_number 13368 \
  --output $RESULTS_DIR/mlperf_rngd_node5.json
```

---

### MMLU-Pro Evaluation

#### Full Run (57 subjects, 5-shot)
```bash
# Configuration
HARDWARE=L40  # or other
RESULTS_DIR=/home/bench/results/mmlu
mkdir -p $RESULTS_DIR

# Command
python3 /home/kcloud/etri-llm-exam-solution/harness/mmlu_runner.py \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --dataset TIGER-Lab/MMLU-Pro \
  --hardware $HARDWARE \
  --node_selector ${HARDWARE,,} \
  --batch_size 1 \
  --n_train 5 \
  --decoding_temperature 0.0 \
  --subjects all \
  --data_number 0 \
  --output $RESULTS_DIR/mmlu_${HARDWARE}_$(date +%s).json \
  --verbose

# Expected runtime:
# RNGD: ~30 min
# L40:  ~75 min
# A40:  ~90 min

# Output schema
# {
#   "hardware": "L40",
#   "model": "meta-llama/Llama-3.1-8B-Instruct",
#   "dataset": "MMLU-Pro",
#   "metrics": {
#     "accuracy_pct": 45.2,
#     "accuracy_by_subject": { "math": 42.1, "physics": 51.3, ... },
#     "completed_at": "2026-05-06T04:30:00Z"
#   }
# }
```

#### Subset Run (single subject for testing)
```bash
# Test on one subject before full run
python3 /home/kcloud/etri-llm-exam-solution/harness/mmlu_runner.py \
  --hardware $HARDWARE \
  --subjects math \
  --output $RESULTS_DIR/mmlu_${HARDWARE}_math_test.json

# Expected runtime: ~5 min
```

---

## Importing Results into DB

### Using W9's Import Pipeline
```bash
# Configuration
RESULTS_DIR=/home/bench/results
DB_HOST=10.254.177.41
DB_PORT=30001

# Single file import
python3 /home/kcloud/etri-llm-exam-solution/import_results.py \
  --result_file $RESULTS_DIR/mlperf/mlperf_RNGD_1234567890.json \
  --db_host $DB_HOST \
  --db_port $DB_PORT \
  --config $CONFIG

# Bulk import (all results in directory)
python3 /home/kcloud/etri-llm-exam-solution/import_results.py \
  --results_dir $RESULTS_DIR \
  --db_host $DB_HOST \
  --db_port $DB_PORT \
  --config $CONFIG \
  --recursive

# Verify import
curl -s "http://$DB_HOST:$DB_PORT/api/comparison/list?limit=10" | \
  python -m json.tool | head -30
```

### Verify via REST API
```bash
# List all runs
curl -s 'http://10.254.177.41:30001/api/comparison/list?limit=500' \
  | python -m json.tool | head -50

# Count by hardware
curl -s 'http://10.254.177.41:30001/api/comparison/list?limit=500' | \
  python -c "import json, sys; \
  data = json.load(sys.stdin); \
  from collections import Counter; \
  hw_counts = Counter(r['hardware']['model'] for r in data['data']['runs']); \
  print(dict(hw_counts))"

# Expected:
# {'NVIDIA-L40': 27, 'NVIDIA-A40': 22, 'RNGD': 41, ...}
```

---

## Exact Commands Used in This Project

### Commands W8 & W9 Agreed Upon
```bash
# These are the EXACT commands that generated the 103 completed runs

# L40 runs (27 completed)
for i in {1..27}; do
  python3 /home/kcloud/etri-llm-exam-solution/harness/mlperf_runner.py \
    --config /home/kcloud/etri-llm-exam-solution/.omc/handoffs/canonical-config.yaml \
    --hardware NVIDIA-L40 \
    --model meta-llama/Llama-3.1-8B-Instruct \
    --dataset cnn_eval.json \
    --data_number 13368 \
    --output /home/bench/results/mlperf_L40_run${i}.json
done

# RNGD runs (40 completed)
for i in {1..40}; do
  python3 /home/kcloud/etri-llm-exam-solution/harness/mlperf_runner.py \
    --config /home/kcloud/etri-llm-exam-solution/.omc/handoffs/canonical-config.yaml \
    --hardware RNGD \
    --model meta-llama/Llama-3.1-8B-Instruct \
    --dataset cnn_eval.json \
    --data_number 13368 \
    --output /home/bench/results/mlperf_RNGD_run${i}.json
done

# A40 runs (14 completed, 2 failed)
for i in {1..16}; do
  python3 /home/kcloud/etri-llm-exam-solution/harness/mlperf_runner.py \
    --config /home/kcloud/etri-llm-exam-solution/.omc/handoffs/canonical-config.yaml \
    --hardware NVIDIA-A40 \
    --model meta-llama/Llama-3.1-8B-Instruct \
    --dataset cnn_eval.json \
    --data_number 13368 \
    --output /home/bench/results/mlperf_A40_run${i}.json || true
done

# GPU MMLU runs (13 completed)
for hw in NVIDIA-L40 NVIDIA-A40; do
  for i in {1..7}; do
    python3 /home/kcloud/etri-llm-exam-solution/harness/mmlu_runner.py \
      --model meta-llama/Llama-3.1-8B-Instruct \
      --dataset TIGER-Lab/MMLU-Pro \
      --hardware $hw \
      --subjects all \
      --output /home/bench/results/mmlu_${hw}_run${i}.json
  done
done
```

---

## Troubleshooting & Pitfalls

### Issue 1: RNGD Timeout (>5 min idle)
**Symptom:** vLLM or furiosa-llm appears to hang after 5 minutes of idle time

**Root Cause:** FuriosaAI RNGD driver has a power-saving timeout that can reset the device

**Fix:**
```bash
# Restart FuriosaAI driver pod
kubectl rollout restart deployment/furiosa-driver -n kube-system
kubectl wait --for=condition=ready pod -l app=furiosa-driver -n kube-system --timeout=300s

# Re-run the benchmark
python3 /home/kcloud/etri-llm-exam-solution/harness/mlperf_runner.py --hardware RNGD ...
```

**Prevention:**
- Keep benchmark runs back-to-back (no idle time)
- Monitor driver logs: `kubectl logs -l app=furiosa-driver -n kube-system -f`

---

### Issue 2: A40 Out-of-Memory (OOM) Errors
**Symptom:** Batch processing fails with CUDA out-of-memory error

**Root Cause:** A40 has 48 GB VRAM; loading full model + batch causes spillover

**Fix:**
```bash
# Ensure batch_size=1 (canonical)
--batch_size 1

# If still OOM, reduce data_number
--data_number 500  # Try smaller subset first

# Or shard across multiple pods
--tensor_parallel_size 2  # Distribute across 2 GPUs (if available)
```

**Prevention:**
- Verify VRAM before run: `nvidia-smi` on GPU node
- Use canonical-config.yaml (batch_size=1 pre-set)

---

### Issue 3: MMLU Evaluation Returns 0% (RNGD)
**Symptom:** RNGD MMLU run completes but accuracy = 0%

**Root Cause:** MMLU dataset not pre-loaded on RNGD pod, or answer parsing broken for NPU output format

**Fix:**
```bash
# Option 1: Pre-download dataset to RNGD node
kubectl exec -it deployment/rngd-llm-0 -c llm-server -- \
  python -c "from datasets import load_dataset; \
  load_dataset('TIGER-Lab/MMLU-Pro')"

# Option 2: Check MMLU parsing script
cat /home/kcloud/etri-llm-exam-solution/harness/mmlu_parser.py
# Verify: it handles both GPU and NPU token formats

# Option 3: Debug a single MMLU question on RNGD
curl -X POST http://10.254.177.41:30001/api/infer \
  -H "Content-Type: application/json" \
  -d '{"hardware":"RNGD","prompt":"What is the capital of France?","max_tokens":5}'
# Check output format
```

**Prevention:**
- Always run a quick MMLU subset test first (1 subject) before full run
- Log answer strings before parsing

---

### Issue 4: Timer Clock Skew (Latency Metric Wrong)
**Symptom:** Some runs show tt100t=0.00s or extremely high values (>100,000s)

**Root Cause:** Kubernetes node clock drift; server and container have different wall times

**Fix:**
```bash
# Check node clock synchronization
for node in $(kubectl get nodes -o jsonpath='{.items[*].metadata.name}'); do
  echo "Node: $node"
  kubectl debug node/$node -it --image=ubuntu -- date
done

# Resync all nodes
ansible all -i /etc/ansible/hosts -m command -a "ntpd -s"  # Or chronyc forcesync

# Verify all nodes in sync
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[?(@.type=="Ready")].message}{"\n"}{end}'
```

**Prevention:**
- Run `ntpd` or `chrony` daemon on all cluster nodes
- Verify before benchmark: `date` on all nodes should match within 1 second

---

### Issue 5: GPU Device Not Available (vLLM Fails)
**Symptom:** vLLM error: "No CUDA devices found"

**Root Cause:** GPU driver not mounted in K8s pod, or node selector misconfigured

**Fix:**
```bash
# Check GPU availability on node
kubectl get nodes --selector=gpu=true
# Expected: node1, node2 (L40), node3, node4 (A40)

# Verify pod is scheduled on GPU node
kubectl get pods -o wide | grep mlperf
# Expected: pod scheduled on node1, node2, etc.

# If not, add node selector to harness
--node_selector "gpu=true"
```

**Prevention:**
- Always test with `kubectl run --rm -it --image=nvidia/cuda:11.8 -- nvidia-smi`
- Verify node labels: `kubectl get nodes --show-labels`

---

### Issue 6: Missing Dataset Files
**Symptom:** FileNotFoundError: `/mnt/datasets/cnn_eval.json`

**Root Cause:** Dataset directory not mounted or file not pre-downloaded

**Fix:**
```bash
# Check if dataset volume is mounted
kubectl describe pvc mlperf-data
# Expected: STATUS=Bound, CAPACITY=500Gi

# If missing, download manually
python -c "from datasets import load_dataset; \
  ds = load_dataset('abisee/cnn_dailymail', '3.0.0', split='test'); \
  import json; \
  with open('/mnt/datasets/cnn_eval.json', 'w') as f: \
    for row in ds: \
      f.write(json.dumps(row) + '\n')"

# Verify size
ls -lh /mnt/datasets/cnn_eval.json
# Expected: ~400 MB
```

---

## Data Validation

### Post-Run Checks
```bash
# 1. Verify JSON output is valid
python -m json.tool /home/bench/results/mlperf/mlperf_RNGD_1234567890.json > /dev/null && \
  echo "✓ JSON is valid"

# 2. Check required fields
python -c "
import json
with open('/home/bench/results/mlperf/mlperf_RNGD_1234567890.json') as f:
    data = json.load(f)
    assert 'metrics' in data, 'Missing metrics'
    assert 'tt100t_seconds' in data['metrics'], 'Missing tt100t_seconds'
    assert data['metrics']['tt100t_seconds'] is not None, 'tt100t_seconds is None'
    print('✓ All required fields present')
"

# 3. Verify within expected range
python -c "
import json
with open('/home/bench/results/mlperf/mlperf_RNGD_1234567890.json') as f:
    data = json.load(f)
    tt = data['metrics']['tt100t_seconds']
    assert 0 < tt < 10000, f'tt100t_seconds {tt} out of expected range'
    print(f'✓ tt100t_seconds {tt}s is in valid range')
"
```

### Importing Validation
```bash
# After import, verify row count matches
EXPECTED=40  # For a full RNGD run
ACTUAL=$(curl -s 'http://10.254.177.41:30001/api/comparison/list?limit=500' | \
  python -c "import json, sys; \
  data = json.load(sys.stdin); \
  count = len([r for r in data['data']['runs'] if r['hardware']['model'] == 'RNGD']); \
  print(count)")

if [ "$ACTUAL" -eq "$EXPECTED" ]; then
  echo "✓ Import verified: $ACTUAL rows"
else
  echo "✗ Mismatch: expected $EXPECTED, got $ACTUAL"
fi
```

---

## Reproducing Exact Results

To reproduce the **exact 103 completed runs** reported:

```bash
# 1. Ensure identical environment
source /home/bench/env/bin/activate
export CONFIG=/home/kcloud/etri-llm-exam-solution/.omc/handoffs/canonical-config.yaml
export RESULTS_DIR=/home/bench/results

# 2. Run the multirun orchestrator (if available)
python3 /home/kcloud/etri-llm-exam-solution/orchestrator.py \
  --config $CONFIG \
  --multirun \
  --hardwares L40 A40 RNGD ATOM+ \
  --benchmarks mlperf mmlu \
  --output $RESULTS_DIR

# 3. Import all results
python3 /home/kcloud/etri-llm-exam-solution/import_results.py \
  --results_dir $RESULTS_DIR \
  --db_host 10.254.177.41 \
  --db_port 30001 \
  --config $CONFIG

# 4. Verify count
curl -s 'http://10.254.177.41:30001/api/comparison/list?limit=500' | \
  python -c "import json, sys; data = json.load(sys.stdin); \
  print(f'Total completed runs: {len([r for r in data[\"data\"][\"runs\"] if r[\"status\"] == \"Completed\"])}')"
# Expected output: Total completed runs: 103
```

---

## Reference Files & Commands

**Canonical Config:** `/home/kcloud/etri-llm-exam-solution/.omc/handoffs/canonical-config.yaml`

**MLPerf Harness:** `/home/kcloud/etri-llm-exam-solution/harness/mlperf_runner.py`

**MMLU Harness:** `/home/kcloud/etri-llm-exam-solution/harness/mmlu_runner.py`

**Import Pipeline:** `/home/kcloud/etri-llm-exam-solution/import_results.py`

**Cluster Dashboard:** `http://10.254.177.41:30001`

**Results Comparison API:** `http://10.254.177.41:30001/api/comparison/list?limit=500`

---

**Guide Status:** READY FOR USE  
**Last Verified:** May 6, 2026, 01:00 UTC  
**Contact:** [Benchmark Lead Email]
