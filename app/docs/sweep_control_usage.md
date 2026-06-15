# Sweep Control Usage Guide

This guide covers how to use the GPU Sweep feature, what each option does, and why sweeps might be disabled.

## Overview

GPU Sweep Mode orchestrates a bounded benchmark sweep across all 4 GPU SKUs:
- NVIDIA-L40 (node2)
- NVIDIA-A40 (node2)
- NVIDIA-L40-44GiB (node3)
- NVIDIA-A40-44GiB (node3)

Sweeps are gated by the `GPU_SWEEP_ENABLED` environment variable (default `false` in production).

## Accessing Sweep Control

**URL**: `http://10.254.177.41:30001/dashboard/sweep-control`

**Requirements**:
- Logged in with admin credentials
- `GPU_SWEEP_ENABLED=true` in backend environment
- Both GPU nodes (node2, node3) in Ready state
- GPU device plugin running
- Model artifacts available in `/mnt/datasets/`

## Sweep Modes

### Full Sweep (110 cells)

Runs a complete benchmark matrix across all GPU SKUs, batches, precision, and tensor parallelism options:

**Configuration**:
- 4 GPU devices (2 SKU variations × 2 nodes)
- 5 batch sizes: 1, 2, 4, 8, 16
- 2 precisions: fp32, fp8
- ~11 TP configurations per device

**Typical Duration**: 6-10 hours (depends on device load and job queue)

**Tagging**: All exams tagged `[sweep:full]` for filtering in MLPerf/MMLU exam lists

**API Call**:
```bash
curl -X POST http://10.254.177.41:30980/api/gpu-sweep/start \
  -H 'Content-Type: application/json' \
  -d '{"mode":"full"}'
```

**Use Cases**:
- Comprehensive benchmarking of all GPU SKU/precision combinations
- Pre-release validation
- Performance regression detection

### Calibration Sweep (Baseline)

Runs a canonical cell on each GPU node for quick baseline validation:

**Configuration**:
- Canonical cell: L40 + fp8 + batch_size=1 + TP=1 + num_samples=500
- Runs on both node2 and node3 (separate exams per node)
- Lightweight, takes ~10-30 minutes

**Tagging**: All exams tagged `[sweep:calibration]`

**API Call**:
```bash
curl -X POST http://10.254.177.41:30980/api/gpu-sweep/start \
  -H 'Content-Type: application/json' \
  -d '{"mode":"calibration"}'
```

**Use Cases**:
- Smoke test after deployment
- Quick validation that GPUs are responsive
- Baseline performance check before full sweep

## Sweep Controls

### Starting a Sweep

**Via UI**:
1. Navigate to `http://10.254.177.41:30001/dashboard/sweep-control`
2. Choose "Full Sweep" or "Calibration"
3. Click "Start Sweep"
4. Confirm when prompted

**Via API**:
```bash
curl -X POST http://10.254.177.41:30980/api/gpu-sweep/start \
  -H 'Content-Type: application/json' \
  -d '{"mode":"full"}' or '{"mode":"calibration"}'
```

**Response**:
```json
{
  "sweep_id": 1,
  "mode": "full",
  "status": "active",
  "created_at": "2026-04-28T10:30:00Z"
}
```

### Pausing a Sweep

Pauses new job dispatch while allowing running jobs to finish.

**Via UI**: Click "Pause" button on sweep-control page

**Via API**:
```bash
curl -X PATCH http://10.254.177.41:30980/api/gpu-sweep/pause/1
```

**Behavior**:
- Running exams continue and complete normally
- New exams from the sweep matrix are not dispatched
- Pause can be resumed later (status → `paused` → `active`)

### Draining a Sweep

Stops all in-flight exams immediately and cancels queued exams from the sweep.

**Via UI**: Click "Drain" button on sweep-control page

**Via API**:
```bash
curl -X PATCH http://10.254.177.41:30980/api/gpu-sweep/drain/1
```

**Behavior**:
- All exams from this sweep are marked `Cancelled` or `Drained`
- Results collected so far are preserved
- Graceful shutdown; no force-kill
- Idempotent (safe to call multiple times)

### Checking Sweep Status

**Via UI**: Sweep progress bar on sweep-control page shows:
- Cells completed / Total cells
- Estimated time remaining
- Current bottleneck node

**Via API**:
```bash
curl -s http://10.254.177.41:30980/api/gpu-sweep/status
```

**Response**:
```json
{
  "enabled": true,
  "active_sweep": {
    "id": 1,
    "mode": "full",
    "status": "active",
    "cells_completed": 45,
    "cells_total": 110,
    "node_state": {
      "node2": {
        "running_count": 2,
        "queue_depth": 8
      },
      "node3": {
        "running_count": 1,
        "queue_depth": 5
      }
    }
  }
}
```

### Previewing Sweep Matrix (No Execution)

View all cells in the sweep matrix without executing anything:

**Via API**:
```bash
curl -s http://10.254.177.41:30980/api/gpu-sweep/preview
```

**Response**:
```json
{
  "total_cells": 110,
  "cells": [
    {
      "device": "nvidia-l40",
      "batch_size": 1,
      "precision": "fp32",
      "tensor_parallelism": 1,
      "num_samples": 500
    },
    ...
  ],
  "timeline": {
    "node2": [/* 55 cells */],
    "node3": [/* 55 cells */]
  },
  "dedup_keys_excluded": [/* cells excluded due to deduplication */]
}
```

## Disabled Reasons

### `feature_flag_off`

**Reason**: `GPU_SWEEP_ENABLED=false` in backend environment

**Resolution**:
```bash
kubectl set env deployment/etri-llm-backend \
  -n llm-evaluation \
  GPU_SWEEP_ENABLED=true

kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation
```

Verify:
```bash
kubectl get deployment etri-llm-backend -n llm-evaluation \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="GPU_SWEEP_ENABLED")].value}'
```

### `node_not_ready`

**Reason**: One or more GPU nodes not in Ready state

**Resolution**:
```bash
kubectl get nodes node2 node3 -o wide
kubectl describe node node2  # if NotReady, check conditions
```

Common causes:
- Kubelet crashed: Check `systemctl status kubelet` on the node
- Network issues: Check CNI pod status in `kube-system`
- Disk/Memory pressure: Add capacity or debug the pressure

### `device_plugin_missing`

**Reason**: GPU device plugin daemonset not running or pods not Ready

**Resolution**:
```bash
kubectl get daemonset -n kube-system | grep device
kubectl get pods -n kube-system -l k8s-app=nvidia-device-plugin -o wide
kubectl describe pods -n kube-system -l k8s-app=nvidia-device-plugin
```

Common causes:
- Image pull failure: Check image registry and credentials
- Node selector mismatch: Verify nodes labeled for GPU
- Device not present: Check `lspci` on the node for NVIDIA devices

### `no_model_artifact`

**Reason**: Model files not available in `/mnt/datasets/`

**Resolution**:
```bash
# Check NFS mount on backend pod
kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- \
  ls -la /mnt/datasets/

# If empty, copy model to NFS
kubectl cp model.bin deployment/etri-llm-backend -n llm-evaluation:/mnt/datasets/
```

Or directly mount NFS from host (advanced):
```bash
sudo mount -t nfs <nfs-server>:/export/datasets /mnt/datasets
sudo cp model.bin /mnt/datasets/
```

### `missing_permission`

**Reason**: User lacks admin/sweep-admin RBAC role

**Resolution**:
```bash
# Check RBAC
kubectl get rolebinding -n llm-evaluation | grep sweep
kubectl get clusterrolebinding | grep sweep

# Add user to sweep-admin role (if role exists)
kubectl edit rolebinding sweep-admin -n llm-evaluation
# Add your username to subjects
```

Contact cluster admin if role doesn't exist.

### `node_pending_join`

**Reason**: A GPU node is in pending_join state (unexpected for GPU nodes)

**Resolution**:
This should not occur for GPU nodes (node2, node3). If seen, check:
```bash
kubectl describe node node2 node3 | grep -A 2 "Taints"
```

Remove pending taint if present:
```bash
kubectl taint node node2 node2.pending-
kubectl taint node node3 node3.pending-
```

## Sweep Internals

### Scheduling

- **Per-node mutex**: Only 1 sweep active per node at a time
- **60s stagger**: Successive cells staggered to avoid thundering herd
- **Queue depth**: Frontend shows queue depth per node; UI warns if queue > 20

### Deduplication

Some cell combinations are automatically excluded to avoid redundant testing:

```bash
curl -s http://10.254.177.41:30980/api/gpu-sweep/preview | \
  jq '.dedup_keys_excluded'
```

Example deduplication rules:
- Ampere GPUs (A40) don't support FP8 tensor cores; exclude `fp8 + A40`
- Some TP configurations invalid for certain batch sizes; excluded

### Retry Logic

If an exam from the sweep fails:

1. **Transient failure** (e.g., network timeout): Auto-retried with 60s stagger
2. **Persistent failure** (after 10 retries/hour): Sweep pauses to prevent cascading failures
3. **Resume**: Manual "Resume Sweep" click on UI

Check logs for retry state:
```bash
kubectl logs -n llm-evaluation deployment/etri-llm-backend | \
  grep -i "retry\|sweep.*failed"
```

## Monitoring During Sweep

### Real-time Progress

Visit `http://10.254.177.41:30001/dashboard/gpu-realtime` while sweep is active:
- Watch device utilization trends
- Monitor for stalls (devices idle too long)
- Check for errors in exam logs

### Backend Logs

```bash
kubectl logs -f deployment/etri-llm-backend -n llm-evaluation | \
  grep -i "sweep\|exam.*scheduled"
```

### Database Queries

Check sweep exams in database:
```bash
kubectl exec -it deployment/postgres -n llm-evaluation -- \
  psql -U kcloud -d etri_llm_db -c \
  "SELECT COUNT(*), status FROM exams WHERE tags LIKE '%[sweep:%' GROUP BY status;"
```

## Common Issues

### Sweep Starts but No Progress

**Check**:
1. Queue depth visible on UI? Yes → normal (just slow)
2. Any errors in backend logs? → debug the error
3. Device utilization on GPU dashboard? → check if jobs are actually running

**Typical causes**:
- Device contention (other workloads running)
- Slow model or evaluation service
- Network bottleneck

**Fix**: Drain other exams, increase model inference timeout.

### Sweep Pauses After Few Cells

**Check**:
```bash
curl -s http://10.254.177.41:30980/api/gpu-sweep/status | jq '.active_sweep.status'
```

If `paused`:
- Manual pause was triggered (click "Resume" on UI)
- Or auto-paused due to retry threshold (check logs)

**Fix**:
```bash
curl -X PATCH http://10.254.177.41:30980/api/gpu-sweep/resume/1
```

### High Failure Rate

**Debug**:
```bash
# Check failed exams from sweep
curl -s http://10.254.177.41:30980/api/mlperf | \
  jq '.[] | select(.tags | contains("[sweep:")) | select(.status=="Failed")'

# Check error messages
kubectl logs deployment/etri-llm-backend -n llm-evaluation | grep -i "error\|failed"
```

**Common causes**:
- Model not loaded or incompatible
- Evaluation service unreachable
- GPU memory exhausted (try lower batch size)

### Hiding Sweep Runs from Exam List

On MLPerf/MMLU exam list pages, toggle **"Hide sweep runs"** checkbox to filter out `[sweep:*]`-tagged exams from normal views.

## Best Practices

1. **Run calibration first**: Quick smoke test before full sweep
2. **Schedule during off-peak**: Sweeps take 6-10 hours; schedule after hours
3. **Monitor early**: Watch GPU dashboard for first 30 min to catch failures early
4. **Have rollback ready**: Know how to drain and recover if needed (see `docs/operator_recovery_runbook.md`)
5. **Check disk space**: Sweep generates large result files; ensure `/mnt/result` has capacity
6. **Pause if demos**: Use `QUIET_WINDOW_CRON` to auto-pause during demo windows

## Reference: API Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/gpu-sweep/start` | POST | Start a sweep (full or calibration) |
| `/api/gpu-sweep/pause/{id}` | PATCH | Pause sweep; allow running jobs to finish |
| `/api/gpu-sweep/drain/{id}` | PATCH | Stop all jobs immediately |
| `/api/gpu-sweep/resume/{id}` | PATCH | Resume paused sweep |
| `/api/gpu-sweep/status` | GET | Check sweep status and node state |
| `/api/gpu-sweep/preview` | GET | Preview sweep matrix without executing |
