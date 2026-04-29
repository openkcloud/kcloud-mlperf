# Dashboard Troubleshooting Guide

This guide covers empty state diagnostics for each dashboard page and what to do when endpoints return no data.

## Dashboard Endpoints Overview

| Dashboard | Route | API Endpoint | Purpose |
|-----------|-------|--------------|---------|
| GPU Realtime | `/dashboard/gpu-realtime` | `/api/realtime/exams` (SSE) | Real-time GPU saturation metrics |
| NPU Realtime | `/dashboard/npu-realtime` | `/api/realtime/exams` (SSE) | Real-time NPU (RNGD + Atom+) metrics |
| Sweep Control | `/dashboard/sweep-control` | `/api/gpu-sweep/status`, `/api/gpu-sweep/start`, etc. | GPU sweep orchestration UI |
| MLPerf Device Comparison | `/mlperf/device-comparison` | `/api/comparison/mlperf` | Per-device MMLU result aggregates |
| MMLU Device Comparison | `/mmlu/device-comparison` | `/api/comparison/mmlu` | Per-device MLPerf result aggregates |

## GPU Realtime Dashboard (`/dashboard/gpu-realtime`)

### Symptom: Empty Slots Table

**Reason Codes:**

| Code | Description | Action |
|------|-------------|--------|
| `no_devices` | No GPU devices detected in cluster | Verify node2/node3 are Ready and labeled with `gpu: "true"` |
| `sse_disconnected` | SSE connection dropped | Browser refresh (Ctrl+R); check network tab for 503/5xx errors |
| `api_endpoint_error` | `/api/realtime/exams` returns 5xx | Check backend logs: `kubectl logs -f deployment/etri-llm-backend -n llm-evaluation \| grep -i realtime` |
| `subscriber_cap_exceeded` | 20 SSE subscribers max reached | Close other browser tabs; server returns 503 + `X-Fallback: poll` header (falls back to 5s polling) |

**Diagnosis Steps:**

1. **Check devices are registered**:
   ```bash
   curl -s http://10.254.177.41:30980/api/devices | jq '.[] | select(.type=="gpu")'
   ```
   Expected: At least 4 GPU devices (L40, A40, L40-44GiB, A40-44GiB) on node2/node3.

2. **Verify nodes are Ready**:
   ```bash
   kubectl get nodes node2 node3 -o wide
   ```
   Expected: STATUS=Ready for both nodes.

3. **Check GPU labels**:
   ```bash
   kubectl get nodes node2 node3 --show-labels | grep gpu
   ```
   Expected: Both nodes labeled `gpu=true` or similar.

4. **Check backend API**:
   ```bash
   curl -s http://10.254.177.41:30980/api/devices | jq '.[] | select(.type=="gpu")'
   ```
   If empty or error, check backend logs.

5. **Check browser console**:
   Open DevTools → Console tab. Look for fetch errors or SSE errors.

**Resolution:**

- If no GPU devices: Check node2/node3 kubelet logs and device plugin logs in `kube-system`
- If API error: Restart backend: `kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation`
- If SSE drops: Browser refresh; if persists, check backend SSE subscriber limits in env var `REALTIME_MAX_SUBSCRIBERS` (default 20)

---

## NPU Realtime Dashboard (`/dashboard/npu-realtime`)

### Symptom: Empty Slots Table or Pending_Join State

**Reason Codes:**

| Code | Description | Action |
|------|-------------|--------|
| `no_npu_devices` | No NPU devices (RNGD or Atom+) detected | Check node4 (RNGD) and node5 (Atom+) are Ready; verify device plugins are running |
| `node4_notready` | node4 (RNGD) not Ready | Verify RNGD device plugin: `kubectl get pods -n furiosa-system` |
| `node5_pending_join` | node5 (Atom+) tainted with `pending=true` | Run node5 join procedure (see `docs/node5_atomplus_runbook.md`); taint will be removed after device plugin verifies |
| `device_plugin_missing` | Device plugin pod not Running | Check namespace: `kubectl get pods -n furiosa-system`; check logs for image pull errors |
| `sse_disconnected` | SSE connection dropped | Browser refresh; same as GPU dashboard SSE handling |

**Diagnosis Steps:**

1. **Check NPU devices registered**:
   ```bash
   curl -s http://10.254.177.41:30980/api/devices | jq '.[] | select(.vendor=="furiosa" or .vendor=="rebellions")'
   ```
   Expected: 4 RNGD devices on node4 + 2 Atom+ devices on node5 (if joined).

2. **Verify node readiness**:
   ```bash
   kubectl get nodes node4 node5 -o wide
   ```
   - node4: Expected to be Ready
   - node5: Expected to be Ready only after join procedure completes

3. **Check node5 taint**:
   ```bash
   kubectl describe node node5 | grep -A 2 "Taints"
   ```
   If shows `node5.atom-plus/pending=true:NoSchedule`, node join is pending.

4. **Check device plugins**:
   ```bash
   kubectl get pods -n furiosa-system -o wide
   kubectl logs -n furiosa-system -l app.kubernetes.io/name=furiosa-device-plugin
   kubectl logs -n furiosa-system -l app.kubernetes.io/name=rebellions-atomplus-device-plugin
   ```

5. **Check backend device registry**:
   ```bash
   curl -s http://10.254.177.41:30980/api/devices | jq 'length'
   ```

**Resolution:**

- If node4 NotReady: Check RNGD kernel driver and device plugin pod logs
- If node5 pending: Proceed with join procedure in `docs/node5_atomplus_runbook.md`
- If device plugin missing: Check `furiosa-system` namespace and pod events
- After remediation: Devices may take 10-30s to appear on dashboard (SSE pushes periodically)

---

## Sweep Control Dashboard (`/dashboard/sweep-control`)

### Symptom: Buttons Disabled or Error Message

**Disabled Reason Codes:**

| Code | Reason | Resolution |
|------|--------|-----------|
| `feature_flag_off` | `GPU_SWEEP_ENABLED=false` in backend env | Set `GPU_SWEEP_ENABLED=true` and restart backend: `kubectl set env deployment/etri-llm-backend -n llm-evaluation GPU_SWEEP_ENABLED=true && kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation` |
| `node_not_ready` | node2 or node3 not Ready | Verify both GPU nodes are in Ready state: `kubectl get nodes node2 node3` |
| `device_plugin_missing` | GPU device plugin missing or pods not Running | Verify GPU device plugin daemonset is running: `kubectl get daemonset -n kube-system \| grep nvidia` |
| `no_model_artifact` | Model artifact not available in `/mnt/datasets/` | Check NFS mount: `kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- ls -la /mnt/datasets/` |
| `missing_permission` | User lacks admin role for sweep ops | Verify user has sweep-admin RBAC: `kubectl get rolebinding -n llm-evaluation \| grep sweep` |
| `node_pending_join` | A GPU node is in pending join state (should not occur for GPU nodes) | Ensure no GPU nodes have pending taints |

**Diagnosis Steps:**

1. **Check feature flag**:
   ```bash
   kubectl get deployment etri-llm-backend -n llm-evaluation -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="GPU_SWEEP_ENABLED")].value}'
   ```

2. **Check GPU nodes**:
   ```bash
   kubectl get nodes node2 node3 -o wide
   kubectl get nodes node2 node3 --show-labels | grep gpu
   ```

3. **Check device plugin**:
   ```bash
   kubectl get daemonset -n kube-system | grep device
   kubectl get pods -n kube-system -l k8s-app=nvidia-device-plugin -o wide
   ```

4. **Check dataset mount**:
   ```bash
   kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- ls -la /mnt/datasets/
   ```

5. **Check sweep status API**:
   ```bash
   curl -s http://10.254.177.41:30980/api/gpu-sweep/status | jq '.enabled'
   ```

**Resolution:**

- Feature disabled: See code above to enable
- Nodes NotReady: Check kubelet logs on affected nodes
- Missing plugin: Ensure `nvidia-device-plugin` daemonset is deployed
- Missing dataset: Check NFS PVC mount and permissions
- Missing permission: Add user to sweep-admin role via RBAC

### Symptom: Error When Clicking "Start Sweep"

**Check backend response**:
```bash
curl -X POST http://10.254.177.41:30980/api/gpu-sweep/start \
  -H 'Content-Type: application/json' \
  -d '{"mode":"calibration"}'
```

**Common Errors:**

| Error | Cause | Fix |
|-------|-------|-----|
| `sweep_already_active` | A sweep is already running | Wait for it to finish or drain via UI |
| `insufficient_nodes` | Not enough GPU nodes ready | Verify node2 + node3 both Ready |
| `insufficient_devices` | GPU devices not detected | Check device plugin and node labels |
| `no_model_artifact` | Model files missing | Mount NFS and copy models to `/mnt/datasets/` |

---

## MLPerf Device Comparison (`/mlperf/device-comparison`)

### Symptom: Empty Device List or No Metrics

**Reason Codes:**

| Code | Description | Action |
|------|-------------|--------|
| `no_results` | No MLPerf exams completed yet | Run at least one MLPerf exam; metrics aggregate from completed exams |
| `api_error` | `/api/comparison/mlperf` returns 5xx | Check backend logs: `kubectl logs -f deployment/etri-llm-backend -n llm-evaluation \| grep -i comparison` |
| `database_empty` | No results in database | Verify exams table has rows: `kubectl exec -it deployment/postgres -n llm-evaluation -- psql -U $DATABASE_USER -d $DATABASE_NAME -c "SELECT COUNT(*) FROM exams;"` |
| `aggregation_stale` | Metrics cached and need refresh | Browser hard refresh (Ctrl+Shift+R) |

**Diagnosis Steps:**

1. **Check exams exist**:
   ```bash
   curl -s http://10.254.177.41:30980/api/mlperf | jq 'length'
   ```
   Should be > 0.

2. **Check completed exams**:
   ```bash
   curl -s http://10.254.177.41:30980/api/mlperf | jq '.[] | select(.status=="Completed")'
   ```

3. **Check comparison endpoint**:
   ```bash
   curl -s http://10.254.177.41:30980/api/comparison/mlperf | jq 'keys'
   ```

4. **Check database**:
   ```bash
   kubectl exec -it deployment/postgres -n llm-evaluation -- \
     psql -U kcloud -d etri_llm_db -c "SELECT device_type, COUNT(*) FROM exams WHERE status='Completed' GROUP BY device_type;"
   ```

**Resolution:**

- If no results: Run MLPerf exams first via UI (`/mlperf/` → "New Exam")
- If API error: Restart backend
- If database empty: Check exam runner logs (operator/controller)
- If stale: Hard refresh browser

---

## MMLU Device Comparison (`/mmlu/device-comparison`)

Same diagnostics as MLPerf Device Comparison, but for MMLU exams:

```bash
# Check MMLU exams
curl -s http://10.254.177.41:30980/api/mmlu | jq 'length'

# Check comparison
curl -s http://10.254.177.41:30980/api/comparison/mmlu | jq 'keys'

# Check database
kubectl exec -it deployment/postgres -n llm-evaluation -- \
  psql -U kcloud -d etri_llm_db -c "SELECT device_type, COUNT(*) FROM exams WHERE benchmark='mmlu' AND status='Completed' GROUP BY device_type;"
```

---

## General Backend Diagnostics

### Backend Pod Not Running

```bash
kubectl get pods -n llm-evaluation
kubectl describe pod -n llm-evaluation deployment/etri-llm-backend
kubectl logs -n llm-evaluation deployment/etri-llm-backend --tail=100
```

### Database Connectivity Issue

```bash
kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- \
  npm run typeorm query "SELECT 1"
```

### SSE Subscriber Limit Hit

Check logs for SSE fallback:
```bash
kubectl logs -n llm-evaluation deployment/etri-llm-backend | grep -i "fallback\|subscriber"
```

Increase limit if needed (default 20):
```bash
kubectl set env deployment/etri-llm-backend -n llm-evaluation REALTIME_MAX_SUBSCRIBERS=50
kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation
```

### Device Registry Out of Sync

Rebuild device registry from cluster state:
```bash
curl -X POST http://10.254.177.41:30980/api/devices/sync
```

---

## Monitoring and Health Checks

### Daily Health Check Script

```bash
#!/bin/bash
set -e

echo "=== Cluster Health ==="
kubectl get nodes

echo "=== GPU Devices ==="
curl -s http://10.254.177.41:30980/api/devices | jq '.[] | select(.type=="gpu")'

echo "=== NPU Devices ==="
curl -s http://10.254.177.41:30980/api/devices | jq '.[] | select(.vendor=="furiosa" or .vendor=="rebellions")'

echo "=== Backend Health ==="
curl -s http://10.254.177.41:30980/health | jq '.'

echo "=== Active Exams ==="
curl -s http://10.254.177.41:30980/api/mlperf | jq '.[] | select(.status=="Running")'

echo "=== Sweep Status ==="
curl -s http://10.254.177.41:30980/api/gpu-sweep/status | jq '.'

echo "All checks passed."
```

---

## Quick Reference: Common Issues

| Symptom | First Check | Second Check |
|---------|------------|--------------|
| All dashboards empty | `kubectl get nodes` | Backend logs: `kubectl logs deployment/etri-llm-backend -n llm-evaluation \| tail -50` |
| GPU dashboard empty, NPU OK | Check node2/node3 | GPU device plugin: `kubectl get pods -n kube-system \| grep nvidia` |
| NPU dashboard empty/pending | Check node4/node5 | Device plugins: `kubectl get pods -n furiosa-system` |
| Sweep control buttons disabled | Check `GPU_SWEEP_ENABLED` env | Check device plugin and nodes Ready |
| Comparison pages empty | Run exams first | Check database: `psql ... SELECT COUNT(*) FROM exams` |
| SSE keeps dropping | Browser refresh | Check SSE subscriber count in logs |
