# P0 Repo-Wide Truth Audit
**RUN_ID**: 20260428-083516-4b786d4  
**Auditor**: worker-1  
**Date**: 2026-04-28  
**Status**: READ-ONLY AUDIT (no code changes)

---

## CRITICAL FINDING: Vendor Mislabeling

### 🚨 PRIMARY DEFECT: node5 Atom+ labeled as Furiosa

**Location**: `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/config/cluster.yaml:57`

```yaml
- name: node5
  accelerator: { type: npu, vendor: furiosa, model: "Atom+", count: 2 }
  ssh: { host: 10.254.202.111, port: 22 }
```

**TRUTH**: 
- **Atom+** (PCI vendor 1eff) = **Rebellions** ✗ (currently says Furiosa)
- **RNGD** (different model) = **Furiosa** ✓
- node5 is the Rebellions Atom+ node; this scaffold is **WRONG**

**Impact**: Any code reading `vendor: furiosa` for node5 will fail at deployment time.

---

## GPU-Hardcoded SKU Arrays (Refactor Candidates)

### 1. **DeviceRealtimeDashboard component** 
**File**: `/home/kcloud/etri-llm-exam-solution/web/src/components/DeviceRealtimeDashboard/DeviceRealtimeDashboard.tsx:11`

```typescript
const GPU_SKUS = ['NVIDIA-L40', 'NVIDIA-A40', 'NVIDIA-L40-44GiB', 'NVIDIA-A40-44GiB'] as const;
```

**Issue**: Hardcoded 4-GPU SKU array. Does not account for NPU SKUs. Should be parameterized or fetched from device registry.

---

### 2. **Realtime Service GPU SKU Type**
**File**: `/home/kcloud/etri-llm-exam-solution/server/src/realtime/realtime.service.ts:18`

```typescript
sku: 'NVIDIA-L40' | 'NVIDIA-A40' | 'NVIDIA-L40-44GiB' | 'NVIDIA-A40-44GiB';
```

**Issue**: GPU-only union type. Does not include RNGD or Atom+ SKUs for realtime streaming.

---

### 3. **GPU Sweep Matrix Hardcoding**
**File**: `/home/kcloud/etri-llm-exam-solution/server/src/gpu-sweep/matrix.ts:13-16`

```typescript
const GPU_DEVICES = [
  { gpu_type: 'NVIDIA-L40', node: 'node2', gpu_index: 0 },
  { gpu_type: 'NVIDIA-A40', node: 'node2', gpu_index: 1 },
  { gpu_type: 'NVIDIA-L40-44GiB', node: 'node3', gpu_index: 0 },
  { gpu_type: 'NVIDIA-A40-44GiB', node: 'node3', gpu_index: 1 },
];
```

**Issue**: Static 4-GPU array. Does not load from cluster registry. No provision for node5 (Atom+) or node4 (RNGD).

---

### 4. **GPU Sweep TP2 Whitelist**
**File**: `/home/kcloud/etri-llm-exam-solution/server/src/gpu-sweep/matrix.ts:20-21`

```typescript
const TP2_ALLOWED_SKUS = new Set(['NVIDIA-L40', 'NVIDIA-L40-44GiB']);
```

**Issue**: Hardcoded L40 pair whitelist for TP=2. Does not allow for future device capability tuning.

---

### 5. **Realtime Service Hardcoded Slots**
**File**: `/home/kcloud/etri-llm-exam-solution/server/src/realtime/realtime.service.ts:60-63`

```typescript
const DEVICE_SLOTS = [
  { node: 'node2', sku: 'NVIDIA-L40' },
  { node: 'node2', sku: 'NVIDIA-A40' },
  { node: 'node3', sku: 'NVIDIA-L40-44GiB' },
  { node: 'node3', sku: 'NVIDIA-A40-44GiB' },
];
```

**Issue**: Static 4-device slot configuration. Missing node5 (Atom+) and node4 (RNGD) slots entirely.

---

## Device-Comparison Pages (GPU-Only or GPU-Centric)

### Identified Routes

| Page | Path | Status |
|------|------|--------|
| NPU Device Comparison | `/npu-eval/device-comparison` | ✓ Exists |
| MLPerf Device Comparison | `/ml-perf/device-comparison` | ✓ Exists |
| MMLU Device Comparison | `/mmlu/device-comparison` | ✓ Exists |

**Files**:
- `/home/kcloud/etri-llm-exam-solution/web/src/pages/npu/device-comparison/index.tsx`
- `/home/kcloud/etri-llm-exam-solution/web/src/pages/mlperf/device-comparison/index.tsx`
- `/home/kcloud/etri-llm-exam-solution/web/src/pages/mmlu/device-comparison/index.tsx`

**Note**: Routes exist; content implementation depends on Lane D-backend (comparison API).

---

## Realtime SSE/EventSource Infrastructure

### Server-Side
- **Controller**: `/home/kcloud/etri-llm-exam-solution/server/src/realtime/realtime.controller.ts`
- **Service**: `/home/kcloud/etri-llm-exam-solution/server/src/realtime/realtime.service.ts`
- **Gateway**: `/home/kcloud/etri-llm-exam-solution/server/src/realtime/realtime.gateway.ts`
- **Endpoint**: `GET /realtime/exams` (SSE stream)
- **Health Check**: `GET /realtime/exams/health`
- **Snapshot Fallback**: `GET /realtime/exams/snapshot`

### Client-Side
- **Hook**: `/home/kcloud/etri-llm-exam-solution/web/src/hooks/useRealtimeExams.ts`
- **Component**: `/home/kcloud/etri-llm-exam-solution/web/src/components/DeviceRealtimeDashboard/DeviceRealtimeDashboard.tsx`
- **Page**: `/home/kcloud/etri-llm-exam-solution/web/src/pages/dashboard/gpu-realtime/index.tsx`

**Issue**: GPU-only. DeviceRealtimeDashboard component hardcodes GPU SKUs, no NPU integration yet.

---

## GPU Sweep Control

### Routes
- **Control Page**: `/dashboard/sweep-control`
- **API Preview**: `GET /api/gpu-sweep/preview`
- **API Status**: `GET /api/gpu-sweep/status`
- **API Start**: `POST /api/gpu-sweep/start`
- **API Drain**: `PATCH /api/gpu-sweep/drain/:id`

### Files
- **Controller**: `/home/kcloud/etri-llm-exam-solution/server/src/gpu-sweep/gpu-sweep.controller.ts`
- **Service**: `/home/kcloud/etri-llm-exam-solution/server/src/gpu-sweep/gpu-sweep.service.ts`
- **UI Page**: `/home/kcloud/etri-llm-exam-solution/web/src/pages/dashboard/sweep-control/index.tsx`

**Issue**: GPU-only sweep infrastructure. No NPU sweep orchestration yet.

---

## NPU Evaluation Infrastructure

### Routes
All under `/npu-eval/**` prefix

- **Create exam**: `POST /npu-eval/create`
- **Update exam**: `PATCH /npu-eval/update/:id`
- **List exams**: `GET /npu-eval/list`
- **Get details**: `GET /npu-eval/details/:id`
- **NPU list**: `GET /npu-eval/npu-list`
- **Exam status**: `GET /npu-eval/status/:id`
- **Start time**: `PATCH /npu-eval/start-time/:id`
- **Stop exam**: `PATCH /npu-eval/stop/:id`
- **Delete exam**: `DELETE /npu-eval/delete/:id`
- **Compare**: `GET /npu-eval/compare/:npuId/:gpuId`
- **Results**: `GET /npu-eval/results/:id`

### Files
- **Controller**: `/home/kcloud/etri-llm-exam-solution/server/src/npu-eval/npu-eval.controller.ts`
- **Domain/API**: `/home/kcloud/etri-llm-exam-solution/web/src/api/domains/npu-eval.domain.ts`
- **Types**: `/home/kcloud/etri-llm-exam-solution/web/src/api/types/npu-eval.types.d.ts`

**Status**: NPU evaluation infrastructure exists; realtime dashboard integration is pending.

---

## GPU Device SKU References

### All GPU Hardcodes

| File | Line | Pattern | Count |
|------|------|---------|-------|
| `web/src/components/DeviceRealtimeDashboard/DeviceRealtimeDashboard.tsx` | 11 | GPU_SKUS constant | 1 |
| `web/src/constants/device-colors.ts` | 4-7 | NVIDIA-L40/A40 color map | 4 |
| `server/src/gpu-sweep/matrix.ts` | 13-16 | GPU_DEVICES array | 4 |
| `server/src/gpu-sweep/matrix.ts` | 20-21 | TP2_ALLOWED_SKUS set | 2 |
| `server/src/realtime/realtime.service.ts` | 18 | SKU union type | 4 |
| `server/src/realtime/realtime.service.ts` | 60-63 | DEVICE_SLOTS array | 4 |
| `server/src/gpu-sweep/baseline.fixture.ts` | 19,28,37 | Baseline test fixtures | 3 |
| **Test files** | multiple | E2E/unit test hardcodes | ~40 |

**Total GPU-only hardcodes**: ~60+ locations across source + tests

---

## Entity Type Hints

### GPU/NPU Type Documentation

**File**: `/home/kcloud/etri-llm-exam-solution/server/src/entities/mm-exam.entity.ts:66`

```typescript
// Test GPU/NPU type: A6000, L40, A40, RNGD
```

**File**: `/home/kcloud/etri-llm-exam-solution/server/src/entities/mp-exam.entity.ts:95`

```typescript
// Test GPU/NPU type: A6000, L40, A40, RNGD
```

**Issue**: Comments reference A6000 and RNGD but do not mention Atom+. Schema may need update.

---

## Kubernetes Cluster Configuration

### node5 Definition
**File**: `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/config/cluster.yaml:54-62`

```yaml
- name: node5
  ssh: { host: 10.254.202.111, port: 22 }
  role: worker
  accelerator: { type: npu, vendor: furiosa, model: "Atom+", count: 2 }
  labels:
    npu-model: atomplus
```

**Status**: node5 is marked as SKIPPED in inventory (pending join). Vendor label is **WRONG**.

**File**: `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/reports/cluster_inventory.yaml:7`

```yaml
# node5 is SKIPPED — state: pending_join per cluster.yaml
```

---

## Config References to GPU Models

### Benchmark Profiles
**File**: `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/config/benchmark_profiles.yaml`

Lines with GPU references:
- **L40 FP8**: Line 18 (profile name), 19, 87, 145, 213, 216, 281, 545
- **A40 Ampere FP8 fallback**: Line 79, 83
- **Profile count**: 8+ hardcoded GPU benchmark profiles

**Issue**: No parallel RNGD or Atom+ benchmark profiles yet.

---

### Model Profiles
**File**: `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/config/model_profiles.yaml`

GPU device requirement matrix:
- **L40**: Lines 33, 59, 85
- **A40**: Lines 33, 59, 85
- **A100-80G**: Lines 33, 59, 85

**Issue**: RNGD and Atom+ do not appear in model capability tables.

---

## Cluster Inventory Report

**File**: `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/reports/cluster_inventory.yaml`

**node2 GPU**:
- NVIDIA-L40 (gpu_index=0)
- NVIDIA-A40 (gpu_index=1)

**node3 GPU**:
- NVIDIA-L40-44GiB (gpu_index=0)
- NVIDIA-A40-44GiB (gpu_index=1)

**node4** (RNGD): Not yet in inventory

**node5** (Atom+): Marked as SKIPPED (pending join)

---

## Device Plugin & Helm Integration

**File**: `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/gpu-operator-25.10.0/`

GPU operator charts present; device plugin config awaiting node5 join.

---

## Summary of Findings

| Finding | Severity | Count | Files |
|---------|----------|-------|-------|
| **node5 vendor mislabel (furiosa→Rebellions)** | CRITICAL | 1 | cluster.yaml |
| **Hardcoded 4-GPU SKU arrays** | HIGH | 5 | matrix.ts, realtime.service.ts, DeviceRealtimeDashboard.tsx |
| **Missing NPU slots in realtime** | HIGH | 1 | realtime.service.ts |
| **GPU-only sweep matrix** | HIGH | 1 | matrix.ts |
| **GPU benchmark profiles without RNGD/Atom+** | MEDIUM | 8+ | benchmark_profiles.yaml |
| **No model capability profiles for NPU** | MEDIUM | 1 | model_profiles.yaml |
| **Test hardcodes (GPU SKUs in e2e/unit)** | MEDIUM | ~40 | gpu-sweep.e2e-spec.ts, realtime.e2e-spec.ts, etc. |
| **Entity type hints missing Atom+** | LOW | 2 | mm-exam.entity.ts, mp-exam.entity.ts |

---

## Refactor Roadmap

### Immediate (Blocking node5)
1. **Fix cluster.yaml line 57**: Change `vendor: furiosa` to `vendor: rebellions`
2. **Add node5 to device registry** (Lane H)
3. **Update realtime SKU type** to include RNGD + Atom+ (Lane F)

### High-Priority (Unblock realtime/sweep)
4. **Extract GPU SKU array from hardcodes** → fetch from `/api/devices`
5. **Parameterize realtime slots** → load from device registry
6. **Parameterize GPU sweep matrix** → dynamic per-node iteration

### Medium-Priority (Feature completeness)
7. **Add NPU benchmark profiles** for RNGD (node4) and Atom+ (node5)
8. **Add NPU model capability matrix** (memory, TP limits)
9. **Update entity type hints** to include Atom+
10. **Refactor test fixtures** to use parameterized device lists

---

## Code Paths Summary

### GPU-Only (No NPU Integration)
- Realtime dashboard (DeviceRealtimeDashboard.tsx)
- GPU sweep service (gpu-sweep/*)
- Device color constants
- Realtime service SKU union type
- E2E test harnesses for GPU realtime

### NPU-Only (Separate)
- NPU evaluation API (/npu-eval/*)
- NPU exam entities (mm-exam, mp-exam)
- Device comparison pages (framework in place, data pending)

### Mixed Intent (Needs Reconciliation)
- Realtime slots array (GPU only, should include NPU)
- Device registry (planned, Lane H)
- Device comparison API (planned, Lane D)

---

## Verification Checkpoints

- [ ] Lane C: Fix cluster.yaml vendor label
- [ ] Lane H: Deploy device registry with node4 + node5 configs
- [ ] Lane F: Update realtime service to fetch SKUs from registry
- [ ] Lane D: Comparison API returns GPU + NPU results
- [ ] Lane I: Tests parameterized (no hardcoded SKU arrays)
- [ ] Lane K: All routes functional with 2x GPU + 2x NPU devices

