# Benchmark Execution Report
RUN_ID: 20260428-072038-a612a54
Generated: 2026-04-28
Verifier lane: oh-my-claudecode:verifier (Sonnet 4.6)

---

## Summary

This report documents what was executed during RUN_ID `20260428-072038-a612a54` (audit-only autopilot pass) and what has NOT yet been executed. Per the autopilot instruction: "Do not mutate the cluster until baseline audit, backups, dry-run validation, and checkpoint report are complete."

**Benchmarks have NOT been run. This is the checkpoint report before any cluster mutation.**

---

## Execution Status Table

| Stage | Status | Notes |
|-------|--------|-------|
| Static + dry-run validation | **FAIL** | See test_validation_report.md — secret leak in add-node.sh blocks |
| Cluster state audit | COMPLETE | See reports/current_state_report.md, reports/cluster_inventory.yaml |
| Backups | NOT VERIFIED | No backup manifests or backup job output found in results/ |
| Dry-run validation | COMPLETE (with findings) | kubectl dry-run run; 2 errors found (see test_validation_report.md) |
| Checkpoint report | COMPLETE | This file |
| Cluster mutation (apply k8s/) | NOT EXECUTED | Blocked — must resolve FAIL verdict first |
| Smoke benchmark | NOT EXECUTED | Requires operator action (see below) |
| MLPerf Perf benchmark | NOT EXECUTED | Requires operator action (see below) |
| MLPerf Accuracy benchmark | NOT EXECUTED | Requires operator action (see below) |
| MMLU-Pro benchmark | NOT EXECUTED | Requires operator action (see below) |
| TT100 benchmark | NOT EXECUTED | tt100_runner.py not yet generated |

---

## Operator Commands Required (in order)

**Before running any commands, resolve blocking issues from test_validation_report.md:**

```
# BLOCKER 1: Remove hardcoded password from scripts/add-node.sh:27
# Change: PASSWD="${ANSIBLE_PASSWORD:-<SUDO_PASS>}"
# To:     PASSWD="${ANSIBLE_PASSWORD:?ERROR: ANSIBLE_PASSWORD must be set}"
# Then commit and re-run verification.

# BLOCKER 2: Ensure scripts/03_*.sh through scripts/17_*.sh are generated.
# BLOCKER 3: Ensure config/model_profiles.yaml is generated.
# BLOCKER 4: Ensure results/20260428-072038-a612a54/tt100_runner.py is generated.
```

**Once blockers are resolved, proceed in this order:**

### Step 1: Apply namespaces
```bash
kubectl apply -f k8s/namespaces/00-namespaces.yaml
```

### Step 2: Apply device plugins
```bash
# FuriosaAI RNGD NPU device plugin
kubectl apply -f k8s/device-plugins/furiosa-rngd-device-plugin.yaml

# NOTE: k8s/device-plugins/nvidia-gpu-operator-values.yaml is a Helm values file.
# Apply it via Helm, not kubectl:
helm upgrade --install gpu-operator nvidia/gpu-operator \
  -f k8s/device-plugins/nvidia-gpu-operator-values.yaml \
  -n gpu-operator --create-namespace
```

### Step 3: Create secrets (from templates)
```bash
# Source real credentials first:
source config/credentials.example.env  # fill in actual values before sourcing

# Instantiate and apply each secret template:
envsubst < k8s/secrets/huggingface-token.yaml.template | kubectl apply -f -
envsubst < k8s/secrets/dockerhub-pull-secret.yaml.template | kubectl apply -f -
envsubst < k8s/secrets/etri-llm-backend.yaml.template | kubectl apply -f -
```

### Step 4: Apply storage
```bash
# WARNING: Reconcile nfs-pvc-template.yaml with live cluster state first.
# Live PVCs use storageClassName="" and are bound to specific PVs.
# The template specifies storageClassName=nfs-client which conflicts.
# Operator must manually verify before applying:
kubectl get pvc -n llm-evaluation
kubectl apply -f k8s/storage/nfs-pvc-template.yaml  # only after reconciliation
```

### Step 5: Apply benchmark job (from template)
```bash
# Instantiate benchmark job template:
envsubst < k8s/benchmark-jobs/mlperf-perf-job.yaml.template | kubectl apply -f -

# Monitor:
kubectl get jobs -n llm-bench
kubectl logs -n llm-bench -l app=mlperf-benchmark -f
```

### Step 6: Smoke benchmark
```bash
# Run a quick inference smoke test (adjust endpoint as appropriate):
kubectl exec -n llm-evaluation deploy/llm-evaluation -- \
  curl -s http://localhost:8000/v1/models

# Expected: HTTP 200 with model list
```

### Step 7: MLPerf performance benchmark
```bash
# After smoke test passes:
kubectl create job mlperf-perf-$(date +%Y%m%d) \
  --from=cronjob/mlperf-perf-benchmark -n llm-bench
kubectl logs -n llm-bench job/mlperf-perf-$(date +%Y%m%d) -f
```

### Step 8: MLPerf accuracy benchmark
```bash
kubectl create job mlperf-acc-$(date +%Y%m%d) \
  --from=cronjob/mlperf-acc-benchmark -n llm-bench
kubectl logs -n llm-bench job/mlperf-acc-$(date +%Y%m%d) -f
```

### Step 9: MMLU-Pro benchmark
```bash
kubectl create job mmlu-pro-$(date +%Y%m%d) \
  --from=cronjob/mmlu-pro-benchmark -n llm-bench
kubectl logs -n llm-bench job/mmlu-pro-$(date +%Y%m%d) -f
```

### Step 10: TT100 benchmark
```bash
# After results/${RUN_ID}/tt100_runner.py is generated:
python3 results/20260428-072038-a612a54/tt100_runner.py \
  --endpoint http://<cluster-endpoint>:8000 \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --output results/20260428-072038-a612a54/tt100_results.json
```

---

## Why No Benchmarks Were Run

Per explicit autopilot instruction:
> "Do not mutate the cluster until baseline audit, backups, dry-run validation, and checkpoint report are complete."

This autopilot pass completed:
- Baseline cluster audit (current_state_report.md, cluster_inventory.yaml, repo_architecture_audit.md, mlperf_legitimacy_report.md, mlperf_patch_audit.md)
- Dry-run validation (this report + test_validation_report.md)
- Checkpoint report (this file)

It did NOT complete:
- Scripts 03–17 generation
- config/model_profiles.yaml generation
- results/${RUN_ID}/tt100_runner.py generation
- Backup verification

The cluster has NOT been mutated. All benchmark jobs remain at NOT EXECUTED status.
