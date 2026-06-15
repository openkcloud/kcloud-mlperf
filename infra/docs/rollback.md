# Operator Runbook: Rollback Procedures

## Overview

Each numbered script (00–17) can introduce changes that might need to be rolled back if issues are detected. This document specifies rollback procedures per script, with emphasis on data preservation.

## Per-Script Rollback Matrix

### Scripts 00–07: Cluster Setup

No user-facing changes. Safe to re-run if preflight or system setup fails.

**If cluster is completely broken:**
- Use scripts/17_rollback_last_change.sh (see below)
- Or manually restore kubeconfig from backup on control plane: `scp node1:/etc/kubernetes/admin.conf ~/.kube/config`

### Script 08: Build and Push Images

**Scenario**: New image tag (e.g., v13) was pushed but contains a bug.

**Rollback**:
1. Identify previous working tag (e.g., v12)
2. Revert the Helm values file:
   ```bash
   sed -i "s|jungwooshim/etri-llm-backend:v13|jungwooshim/etri-llm-backend:v12|g" \
       kubernetes/app-chart/values.yaml
   sed -i "s|jungwooshim/etri-llm-frontend:v13|jungwooshim/etri-llm-frontend:v12|g" \
       kubernetes/app-chart/values.yaml
   ```
3. Re-run script 09 to redeploy with old image:
   ```bash
   bash 09_deploy_app_chart.sh
   ```
4. Verify pods are running: `kubectl get pods -n llm-evaluation`

**Preserve**: Image v13 remains in Docker registry (no deletion needed unless storage is critical).

### Script 09: Deploy App Chart

**Scenario**: Helm upgrade introduced a configuration error (e.g., bad secret, wrong port).

**Rollback**:
```bash
# View deployment history:
helm history etri-llm -n llm-evaluation

# Rollback to previous release:
helm rollback etri-llm 1 -n llm-evaluation  # '1' is revision number

# Or manually revert via kubectl:
kubectl rollout undo deploy/etri-llm-backend -n llm-evaluation
kubectl rollout undo deploy/etri-llm-frontend -n llm-evaluation
```

**Preserve**: Previous values.yaml is saved by Helm automatically.

### Script 10: Warmup and Prep

**Scenario**: Warmup script hung or crashed GPUs.

**Rollback**:
```bash
# Kill any running warmup processes:
kubectl delete job -n llm-evaluation --all

# Restart GPU operators to reset devices:
kubectl rollout restart ds -n kube-system -l k8s-app=nvidia-gpu-device-plugin
kubectl delete pod -n kube-system -l k8s-app=furiosa-device-plugin
```

**Preserve**: No persistent changes. Safe to re-run.

### Scripts 11–15: Run Benchmarks

**Scenario**: A benchmark job is taking too long, crashed, or produced invalid results. You want to cancel and retry.

**Rollback**:
```bash
# Cancel the running job:
kubectl delete job -n llm-evaluation benchmark-mlperf  # (or whichever benchmark)

# Check if results were partially written:
ls -la results/$(date +%Y%m%d)/mlperf/

# Option A: Keep partial results (for debugging):
# Do nothing; next script 16 will pick them up or log the error

# Option B: Clean up and re-run from scratch:
rm -rf results/$(date +%Y%m%d)/mlperf/
bash 11_run_mlperf_performance.sh
```

**Preserve**: Intermediate artifacts are kept in case post-mortem analysis is needed.

### Script 16: Generate Reports

**Scenario**: Report generation failed or output is corrupted.

**Rollback**:
```bash
# Delete generated reports (keep raw benchmark data):
rm -rf results/$(date +%Y%m%d)/SUMMARY.json
rm -rf results/$(date +%Y%m%d)/report-bundle/

# Re-run report generation:
bash 16_generate_reports.sh

# If still failing, check for missing benchmark outputs:
ls results/$(date +%Y%m%d)/{mlperf,mmlu,npu}/*.json
```

**Preserve**: Raw benchmark data is never deleted by script 16. Only aggregated reports and HTML bundles are regenerated.

## Full Cluster Rollback (Script 17)

For cases where you need to revert the entire run or multiple scripts:

```bash
bash 17_rollback_last_change.sh
```

**This script**:
1. Queries `backups/{RUN_ID}/` for saved state (image digests, helm releases, node labels)
2. Rolls back Helm release to previous version
3. Restarts all pods
4. Removes incomplete benchmark jobs
5. Preserves all data in `results/` (no destructive deletions)

**Safety**: Always creates a new backup before rolling back, so you can forward-roll if needed.

## Manual Kubernetes Rollbacks

### Revert Deployment without Helm

```bash
# Check current deployment:
kubectl describe deploy/etri-llm-backend -n llm-evaluation | grep -A5 "Image:"

# Revert to previous revision:
kubectl rollout undo deploy/etri-llm-backend -n llm-evaluation
kubectl rollout undo deploy/etri-llm-frontend -n llm-evaluation

# Verify:
kubectl get deploy -n llm-evaluation
```

### Restore PVC Data

If a PVC was corrupted by a failed job:

```bash
# List PVCs:
kubectl get pvc -n llm-evaluation

# Check a PVC's backup (if snapshot exists):
kubectl get volumesnapshot -n llm-evaluation

# Restore from snapshot:
kubectl create -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: etri-results-restore
  namespace: llm-evaluation
spec:
  dataSource:
    name: results-snapshot  # assumes snapshot exists
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteMany
  storageClassName: nfs-client
  resources:
    requests:
      storage: 100Gi
EOF
```

## Preserve and Investigate

**Before rolling back, preserve logs and artifacts for post-mortem:**

```bash
# Collect all logs from the failed run:
mkdir -p backups/investigate-{RUN_ID}/
kubectl logs -n llm-evaluation job/benchmark-mlperf > backups/investigate-{RUN_ID}/mlperf-logs.txt
kubectl describe job -n llm-evaluation benchmark-mlperf > backups/investigate-{RUN_ID}/mlperf-describe.txt

# Collect events:
kubectl get events -n llm-evaluation --sort-by='.lastTimestamp' > backups/investigate-{RUN_ID}/events.txt

# Copy results/ directory:
cp -r results/$(date +%Y%m%d)/ backups/investigate-{RUN_ID}/results/
```

Then proceed with rollback.

## Testing Rollback

Recommended: always test rollback procedures in staging before applying to production:

```bash
# On staging cluster:
bash 16_generate_reports.sh  # Or whichever script to test

# Simulate failure or issue:
# ... make changes ...

# Test rollback:
bash 17_rollback_last_change.sh

# Verify system is back to previous state:
kubectl get deploy -n llm-evaluation
helm status etri-llm -n llm-evaluation
```

## Recovery Checklist

After rolling back:
- [ ] All pods are in `Running` state: `kubectl get pods -n llm-evaluation`
- [ ] Frontend is accessible: `curl http://<frontend-host>/mlperf/main`
- [ ] Backend is accessible: `curl http://<backend-host>/api/realtime/exams/health`
- [ ] GPU/NPU operators are running: `kubectl get ds -n kube-system`
- [ ] Benchmark jobs have been cleaned up: `kubectl get jobs -n llm-evaluation`
- [ ] Results directory is intact: `ls -la results/$(date +%Y%m%d)/`
