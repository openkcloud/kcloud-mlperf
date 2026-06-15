> Note: ETRI takeover migration 2026-05-12 — directory previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming); now ETRI-owned at `/home/kcloud/etri-llm-deployments/app/`. Container images previously under `mondrianai/*` Docker Hub org are migrating to `ghcr.io/etri-llm/*`. Historical mentions of the legacy names below are preserved for context.

# Operator Runbook: Nominal End-to-End Benchmark Flow

## Overview

This runbook describes the standard operational flow for running a complete benchmark cycle on the ETRI LLM cluster. It assumes the cluster is deployed and healthy. For cluster setup from scratch, see INSTALL_AND_DEPLOY_GUIDE.md.

## Pre-Flight: Environment Setup

### 1. Source Credentials and Config

```bash
cd /home/kcloud/etri-llm-deployments/app
source config/.env
source config/credentials.example.env  # Or your actual .env-prod
```

Verify kubeconfig is accessible:
```bash
kubectl cluster-info
kubectl get nodes
```

Expected output: 1 master (node1) + 4 workers (node2, node3, node4, node5 if joined).

### 2. Verify Cluster Health

Check all components are running:
```bash
kubectl get pods -n monitoring
kubectl get pods -n loki
kubectl get pods -n llm-evaluation
```

All pods should be in `Running` or `Completed` state. If any are `CrashLoopBackOff`, check logs:
```bash
kubectl logs -n llm-evaluation deploy/etri-llm-backend -f
```

## Standard Benchmark Run (Scripts 00–16)

### Scripts 00–07: Pre-Flight and Cluster Setup

```bash
cd scripts

# 00: Pre-flight checks (master node ssh, kubeconfig, ansible, kubectl)
bash 00_preflight_master.sh

# 01–04: Reserved for future use or cluster inspection
# (See scripts/README.md for per-script details)

# 05–07: Deployed via kubernetes scripts in the parent dir
cd ../kubernetes
bash 02-deploy-nfs-provisioner.sh  # If NFS not yet deployed
bash 03-deploy-gpu-operator.sh     # If GPU operator not yet deployed
bash 04-deploy-loki.sh             # Logging backend
bash 05-deploy-prometheus.sh       # Metrics (optional)
bash 06-deploy-alloy.sh            # Log/metric collection (optional)

cd ../scripts
```

### Scripts 08–16: Benchmark Execution

All benchmark scripts follow the pattern:
```bash
bash NN_benchmark_name.sh [options]
```

Each script is idempotent and skips work if already done. If a script fails, fix the issue and re-run it.

**Main scripts (in order):**

1. **Script 08**: Build and push images (if code changed)
   ```bash
   bash 08_build_and_push_images.sh v13
   # Updates kubernetes/app-chart/values.yaml with new image tag
   ```

2. **Script 09**: Deploy app (helm install/upgrade)
   ```bash
   bash 09_deploy_app_chart.sh
   # Applies app Helm chart to llm-evaluation namespace
   ```

3. **Script 10**: Warmup and system prep (GPU drivers, kernel cache)
   ```bash
   bash 10_warmup_and_prep.sh
   # Runs ~5 min, verifies all GPUs/NPUs are responsive
   ```

4. **Scripts 11–13**: Run benchmarks (choose subset based on targets)
   ```bash
   bash 11_run_mlperf_performance.sh
   bash 12_run_mlperf_accuracy.sh
   bash 13_run_mmlu_pro.sh
   bash 14_run_npu_tt100.sh
   bash 15_run_npu_ttft.sh
   # Each benchmark spawns Kubernetes jobs, monitors progress via realtime API
   # Typical duration: 30 min (MLPerf) to 2 hours (MMLU)
   ```

5. **Script 16**: Generate reports and collect results
   ```bash
   bash 16_generate_reports.sh
   # Aggregates all benchmark outputs into results/ directory
   # Generates summary HTML report
   # Outputs: results/{RUN_ID}/
   ```

### Monitoring During Execution

While benchmarks run, monitor via:

**Real-time Dashboard (UI)**
```
http://<frontend-host>/dashboard/gpu-realtime
```
Shows live GPU utilization, exam status, and current phase.

**Kubectl Logs**
```bash
kubectl logs -n llm-evaluation deploy/etri-llm-backend -f | grep -E "STARTED|COMPLETED|ERROR"
```

**Loki Dashboard (if available)**
```
http://<grafana-host>/d/<dashboard-slug>
```
Shows pod logs, system metrics, and traces.

**Exit Codes**
All scripts return:
- `0` — success
- `1–127` — error (check logs for reason)
- `78` — config error (e.g., insufficient hardware for 70B model)

## Post-Benchmark: Results Collection

### 1. Verify Results Were Generated

```bash
ls -lh results/$(date +%Y%m%d)/
# Should show subdirectories: mlperf/, mmlu/, npu/
```

### 2. Download Results (Optional)

Via NFS (requires SSH):
```bash
rsync -avz kcloud@<control-plane>:/mnt/nfs/results/{RUN_ID}/ ./local-results/
```

Via web UI:
```
http://<frontend-host>/mlperf/main
# Browse exams, click result page, download via download button
```

### 3. Inspect Summary Report

```bash
cat results/{RUN_ID}/SUMMARY.json
# or open the HTML report if generated:
open results/{RUN_ID}/report-bundle/index.html
```

### 4. Validate Accuracy and Latency

Check results JSON files for expected metrics:
```bash
jq '.accuracy, .latency, .failure_rate' results/{RUN_ID}/mlperf/results.json
```

**Expected ranges:**
- MLPerf accuracy: > 50% (per-sample validation)
- MMLU accuracy: > 40% (baseline models ~50%)
- NPU TT100T: < 1.5 seconds (target 1.1s)

## Troubleshooting: Common Issues

| Symptom | Likely Cause | Fix |
|---------|---|---|
| Pods stuck in `ImagePullBackOff` | Image not built/pushed | Re-run `bash 08_build_and_push_images.sh` |
| Benchmark job stuck in `Pending` | Pod not scheduled due to resource/node selector | Check `kubectl describe pod <pod>`, verify node has capacity |
| Real-time dashboard shows "no exams" | Realtime API not running or SSE connection failed | Restart backend: `kubectl rollout restart deploy/etri-llm-backend -n llm-evaluation` |
| Results directory is empty | Script 16 didn't complete or exited early | Check logs: `kubectl logs -n llm-evaluation job/script-16 --tail=100` |
| Metrics are 0 or "N/A" | Benchmark completed but output parsing failed | Re-check results CSV; may have different column order or missing fields |
| GPU/NPU not detected during script 10 | Device plugin not running or misconfigured | `kubectl get ds -n kube-system` (NVIDIA) or `-n kube-system` (Furiosa) |

## Key Log Locations

All logs are stored and queryable via Loki:

**Pod Logs** (stdout/stderr)
```bash
kubectl logs -n llm-evaluation job/benchmark-<name> --tail=200
```

**Benchmark Output** (in-pod working dir)
```bash
# Inside pod or via kubectl exec:
/workspace/benchmark-<name>/results.json
/workspace/benchmark-<name>/logs.txt
```

**Cluster Events**
```bash
kubectl get events -n llm-evaluation --sort-by='.lastTimestamp'
```

## Rollback (If Needed)

See docs/rollback.md for detailed per-script rollback procedures.

Quick rollback:
```bash
# Revert last app deployment:
helm rollback etri-llm -n llm-evaluation 1
# or:
kubectl rollout undo deploy/etri-llm-backend -n llm-evaluation
```

## Expected Duration

| Phase | Duration |
|-------|----------|
| Preflight (scripts 00–07) | ~5 min |
| Warmup (script 10) | ~5 min |
| MLPerf performance | ~30–45 min |
| MLPerf accuracy | ~45–60 min |
| MMLU-Pro (full dataset) | ~90–120 min |
| NPU TT100T | ~15–20 min |
| Report generation (script 16) | ~5 min |
| **Total (all benchmarks)** | **~3–4 hours** |

## Success Criteria

A run is considered successful if:
- [ ] All scripts exited with code 0
- [ ] Results directory contains .json files for each benchmark
- [ ] Accuracy > 40% and < 100% (sanity check)
- [ ] Latency is in expected range (no extreme outliers)
- [ ] Frontend UI shows all exams with COMPLETED status
- [ ] Download buttons work and return non-empty files
