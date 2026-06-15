# Device Registry Documentation

This guide explains how the platform discovers, registers, and manages compute devices across the cluster.

## Overview

The Device Registry is the source of truth for all accelerators in the cluster. It integrates three data sources:

1. **Kubernetes API**: Node objects, labels, taints, allocatable resources
2. **cluster.yaml**: Static device inventory (vendor mapping, hardware specs)
3. **gRPC Evaluation Service**: Dynamic device health and capabilities

Devices are exposed via `/api/devices` endpoint and cached in memory with 30s TTL.

## Vendor Enum

Vendors are **SEPARATE and DISTINCT**. Do NOT conflate or merge vendor implementations:

| Vendor | Device | Model | K8s Resource | Node | Status |
|--------|--------|-------|--------------|------|--------|
| `nvidia` | GPU | L40 / A40 / L40-44GiB / A40-44GiB | `nvidia.com/gpu` | node2, node3 | Ready ✓ |
| `furiosa` | NPU | RNGD | `furiosa.ai/warboy` | node4 | Ready ✓ |
| `rebellions` | NPU | Atom+ | `rebellions.ai/atomplus` | node5 | Pending Join (tainted) |

**Key Differences**:
- NVIDIA GPU: Standard NVIDIA device plugin; high throughput
- Furiosa RNGD: Custom device plugin in `furiosa-system` namespace; lower power, suitable for edge
- Rebellions Atom+: Custom device plugin in `furiosa-system` namespace; newest accelerator; requires node5 join procedure

## Device Data Model

Each device in the registry has this structure:

```json
{
  "id": "gpu-0",
  "vendor": "nvidia",
  "device_type": "gpu",
  "model": "L40",
  "hostname": "node2",
  "node_name": "node2",
  "accelerator_index": 0,
  "status": "idle",
  "capacity": {
    "memory_gb": 48,
    "compute_units": 142,
    "max_batch_size": 256
  },
  "labels": {
    "accelerator-type": "gpu",
    "gpu-model": "L40",
    "benchmark.openkcloud.io/role": "benchmark-worker"
  },
  "allocatable": {
    "nvidia.com/gpu": "1"
  },
  "available": true,
  "k8s_node_ready": true
}
```

## Device Registry: Sources and Priority

### Source 1: Kubernetes API (k8s/node objects)

The primary source. For each Ready node:

1. **Extract device count** from allocatable resources:
   ```
   .status.allocatable[nvidia.com/gpu]
   .status.allocatable[furiosa.ai/warboy]
   .status.allocatable[rebellions.ai/atomplus]
   ```

2. **Extract labels** for vendor/model/sku mapping:
   ```
   gpu-sku: "L40"         (on GPU nodes)
   npu-vendor: "furiosa"  (on node4)
   npu-model: "warboy"    (on node4)
   npu-vendor: "rebellions"  (on node5)
   npu-model: "atomplus"     (on node5)
   ```

3. **Check taints** for node state:
   ```
   If tainted with node5.atom-plus/pending=true:NoSchedule
     → status = "pending_join"
     → available = false
   ```

4. **Check node conditions**:
   ```
   If condition.type=Ready, condition.status!=True
     → k8s_node_ready = false
     → device unavailable for scheduling
   ```

### Source 2: cluster.yaml (Static Inventory)

Located at: `/home/kcloud/etri-llm-deployments/app/k8s/cluster.yaml`

Maps node hostname to device specs:

```yaml
devices:
  node2:
    - vendor: nvidia
      sku: L40
      memory_gb: 48
      count: 2
  node3:
    - vendor: nvidia
      sku: A40
      memory_gb: 48
      count: 2
  node4:
    - vendor: furiosa
      model: warboy
      memory_gb: 12
      count: 4
  node5:
    - vendor: rebellions
      model: atomplus
      memory_gb: 16
      count: 2
```

**Used for**:
- Hardware specs not available from Kubernetes
- Fallback device discovery if node is temporarily unreachable
- Capacity planning and device characteristics

### Source 3: gRPC Evaluation Service (Dynamic Health)

Periodically queries evaluation service for real-time device health:

```
gRPC call: GetDeviceStatus
Response: { device_id, health, utilization, last_seen_ms }
```

Used to populate:
- `status`: idle / running / preparing / error
- `available`: true if health=OK
- `last_heartbeat`: timestamp of last response

## K8s Integration

### Node Labels (Device Discovery)

The platform auto-discovers devices via node labels:

**GPU Nodes (node2, node3)**:
```bash
kubectl label node node2 \
  accelerator-type=gpu \
  gpu-sku=L40 \
  benchmark.openkcloud.io/role=benchmark-worker
```

**NPU Nodes (node4, node5)**:
```bash
kubectl label node node4 \
  accelerator-type=npu \
  npu-vendor=furiosa \
  npu-model=warboy \
  accelerator-count=4

kubectl label node node5 \
  accelerator-type=npu \
  npu-vendor=rebellions \
  npu-model=atomplus \
  accelerator-count=2
```

### Device Plugin Resources

Device plugins advertise resources in `.status.allocatable`:

```bash
kubectl get node node2 -o jsonpath='{.status.allocatable}' | jq keys
# Output: ["nvidia.com/gpu", "cpu", "ephemeral-storage", "memory", "pods"]

kubectl get node node4 -o jsonpath='{.status.allocatable}' | jq '.["furiosa.ai/warboy"]'
# Output: "4"

kubectl get node node5 -o jsonpath='{.status.allocatable}' | jq '.["rebellions.ai/atomplus"]'
# Output: "2"
```

### Node Taints (Scheduling Control)

Taints prevent workload scheduling until the node is ready:

**node5 (Atom+) before join completes**:
```bash
kubectl describe node node5 | grep Taints
# Taints: node5.atom-plus/pending=true:NoSchedule
```

After join completes:
```bash
# Remove taint
kubectl taint node node5 node5.atom-plus/pending-
# Node becomes schedulable
```

## API Endpoint: `/api/devices`

### GET /api/devices

Returns all devices in the registry:

```bash
curl -s http://10.254.177.41:30980/api/devices | jq '.'
```

**Response** (array of device objects):
```json
[
  {
    "id": "gpu-0",
    "vendor": "nvidia",
    "device_type": "gpu",
    "model": "L40",
    "hostname": "node2",
    "status": "idle",
    "available": true
  },
  ...
]
```

### GET /api/devices?vendor=nvidia

Filter by vendor:

```bash
curl -s 'http://10.254.177.41:30980/api/devices?vendor=nvidia'
curl -s 'http://10.254.177.41:30980/api/devices?vendor=furiosa'
curl -s 'http://10.254.177.41:30980/api/devices?vendor=rebellions'
```

### GET /api/devices?status=idle

Filter by status:

```bash
curl -s 'http://10.254.177.41:30980/api/devices?status=idle'
curl -s 'http://10.254.177.41:30980/api/devices?status=running'
```

### GET /api/devices/sync (Rebuild Cache)

Force rebuild of device registry from live cluster state:

```bash
curl -X POST http://10.254.177.41:30980/api/devices/sync
```

Response:
```json
{
  "synced_at": "2026-04-28T10:30:00Z",
  "total_devices": 12,
  "by_vendor": {
    "nvidia": 4,
    "furiosa": 4,
    "rebellions": 2
  }
}
```

**Use cases**:
- After adding a new node to the cluster
- After restarting device plugins
- Manual cache invalidation if data stale

## Real-time Status Updates

Device status (idle/running/preparing/error) is updated via:

1. **SSE stream** (`/api/realtime/exams`):
   - Browser subscribes to real-time exam status
   - Each exam state change updates device status
   - Frontend updates dashboards in real-time

2. **Polling fallback** (if SSE cap exceeded):
   - Browser falls back to 5s polling of `/api/devices`
   - Slower than SSE but no subscriber limits

## Device Comparison Pages

Devices are aggregated for comparison dashboards:

### MLPerf Device Comparison (`/mlperf/device-comparison`)

Aggregates MLPerf exam results by device:

```
GET /api/comparison/mlperf
Response:
{
  "nvidia-l40": { "avg_throughput": 150, "avg_latency": 25, "count": 10 },
  "nvidia-a40": { "avg_throughput": 140, "avg_latency": 26, "count": 8 },
  "furiosa-warboy": { "avg_throughput": 80, "avg_latency": 45, "count": 5 }
}
```

### MMLU Device Comparison (`/mmlu/device-comparison`)

Same structure, aggregated from MMLU exams.

## Troubleshooting Device Registry

### Device Not Appearing

**Check 1: Node Ready?**
```bash
kubectl get nodes node2 node3 node4 node5 -o wide
```

**Check 2: Allocatable Resources?**
```bash
kubectl get node node2 -o jsonpath='{.status.allocatable}' | jq '.["nvidia.com/gpu"]'
```

**Check 3: Labels?**
```bash
kubectl get node node2 --show-labels | grep -E "gpu|accelerator"
```

**Check 4: Device Plugin Running?**
```bash
# GPU (NVIDIA)
kubectl get pods -n kube-system -l k8s-app=nvidia-device-plugin

# NPU (Furiosa/Rebellions)
kubectl get pods -n furiosa-system
```

**Check 5: Registry Cache Stale?**
Rebuild:
```bash
curl -X POST http://10.254.177.41:30980/api/devices/sync
curl -s http://10.254.177.41:30980/api/devices | jq length
```

### Device Status Stuck in "error" or "unknown"

**Check 1: Evaluation Service Health**
```bash
kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- \
  grpcurl -plaintext localhost:50051 list
# Should list evaluation service methods
```

**Check 2: Device Plugin Logs**
```bash
kubectl logs -n kube-system -l k8s-app=nvidia-device-plugin
kubectl logs -n furiosa-system -l app.kubernetes.io/name=furiosa-device-plugin
```

**Check 3: Backend Logs**
```bash
kubectl logs -f deployment/etri-llm-backend -n llm-evaluation | grep -i "device\|health"
```

### node5 (Atom+) Status is "pending_join"

This is expected before join procedure completes. After join:

1. Check taint is removed:
   ```bash
   kubectl describe node node5 | grep Taints
   # Should be empty
   ```

2. Check device plugin is Running:
   ```bash
   kubectl get pods -n furiosa-system -l app.kubernetes.io/name=rebellions-atomplus-device-plugin
   ```

3. Rebuild cache:
   ```bash
   curl -X POST http://10.254.177.41:30980/api/devices/sync
   ```

4. Verify status changed:
   ```bash
   curl -s http://10.254.177.41:30980/api/devices | \
     jq '.[] | select(.vendor=="rebellions")'
   ```

## Frontend Integration

### useDeviceRegistry Hook

React components use the `useDeviceRegistry` hook to access device data:

```typescript
import { useDeviceRegistry } from '../hooks/useDeviceRegistry';

function MyComponent() {
  const devices = useDeviceRegistry(); // auto-refresh every 30s
  const gpus = devices.filter(d => d.vendor === 'nvidia');
  // ...
}
```

### Device Filtering in UI

Dashboards allow filtering by:
- **Vendor**: nvidia / furiosa / rebellions
- **Status**: idle / running / preparing / error
- **Availability**: available / unavailable

### Realtime Updates

Device status updates are pushed via SSE. Frontend subscribes and re-renders automatically when status changes.

## Backend Implementation

### Device Registry Service

Located at: `server/src/device-registry/`

Key methods:
- `getDevices()`: Return all devices (cached)
- `getDevice(id)`: Return single device
- `syncDevices()`: Rebuild cache from cluster
- `watchDeviceHealth()`: Periodic health check loop

### Data Sources

- `KubernetesService`: Queries node objects, labels, taints
- `ConfigService`: Reads cluster.yaml device specs
- `EvaluationClient`: gRPC calls to evaluation service for health

## Reference: Device Lifecycle

1. **Node Joins Cluster**:
   - Node gets Ready condition
   - Device plugin pod starts on node
   - Resources advertised in allocatable

2. **Device Registered**:
   - `GET /api/devices/sync` or periodic cache refresh
   - Device added to registry with `status=idle`

3. **Exam Scheduled to Device**:
   - `status` → `preparing` (pulling model)
   - `status` → `running` (executing)
   - SSE pushes status update to frontend

4. **Exam Completes**:
   - `status` → `idle`
   - Result stored in database
   - Frontend chart updated

5. **Node Drained**:
   - Running exams finished or drained
   - Device marked unavailable
   - Device plugin daemonset deleted

## Vendor-Specific Details

### NVIDIA (GPU)

- **Plugin**: NVIDIA GPU Device Plugin (DaemonSet in `kube-system`)
- **Resource**: `nvidia.com/gpu`
- **Models**: L40, A40, L40-44GiB, A40-44GiB
- **Supported**: fp32, fp8, various batch sizes
- **Nodes**: node2, node3

### Furiosa (RNGD NPU)

- **Plugin**: Furiosa Device Plugin (DaemonSet in `furiosa-system`)
- **Resource**: `furiosa.ai/warboy`
- **Models**: Warboy/RNGD
- **Supported**: Specific quantization schemes, lower power
- **Nodes**: node4
- **Status**: Production-ready

### Rebellions (Atom+ NPU)

- **Plugin**: Rebellions Atom+ Device Plugin (DaemonSet in `furiosa-system`)
- **Resource**: `rebellions.ai/atomplus`
- **Models**: Atom+
- **Supported**: Custom compiler, emerging support
- **Nodes**: node5
- **Status**: Pending join (tainted until join completes)

---

**See Also**:
- `docs/node5_atomplus_runbook.md` — node5 join procedure
- `docs/dashboard_troubleshooting.md` — empty device list diagnostics
- `server/AGENTS.md` — backend device registry implementation
