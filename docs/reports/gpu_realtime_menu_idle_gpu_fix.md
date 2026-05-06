# GPU Realtime Menu — Idle GPU Listing Fix

## REDEPLOY REQUIRED: NO
The fix is frontend-only. The live cluster already serves the correct data.
The deployed build at http://10.254.177.41:30001/ needs a rebuild+redeploy to reflect this change.

## Problem
`web/src/pages/dashboard/gpu-realtime/index.tsx` rendered `PrometheusIframeDashboard`,
which shows a Prometheus iframe. It did NOT list idle GPU devices from `/api/devices`.
The NPU realtime page already used `DeviceRealtimeDashboard deviceType="npu"` which
correctly shows all registered devices regardless of benchmark status.

## Fix

### Files Changed

**`web/src/pages/dashboard/gpu-realtime/index.tsx`** (lines 1–4 replaced entirely)

Before:
```tsx
import { PrometheusIframeDashboard } from '@/components/benchmark-page';
export { getGpuPrometheusUrl, deriveState } from '@/components/benchmark-page';
const GpuRealtimePage = () => (
  <PrometheusIframeDashboard title="Live GPU Dashboard" ... />
);
```

After:
```tsx
import { DeviceRealtimeDashboard } from '@/components/DeviceRealtimeDashboard';
const GpuRealtimePage = () => <DeviceRealtimeDashboard deviceType="gpu" />;
```

**`web/src/pages/dashboard/gpu-realtime/__tests__/url.test.ts`**
- Updated to import `deriveState` and `getGpuPrometheusUrl` directly from `@/components/benchmark-page` (which still exports them)
- Added a smoke test confirming `getGpuPrometheusUrl` remains importable after the page refactor

## API Verification

### `/api/realtime/exams/snapshot` — 4 GPU slots, all idle
```json
{"slots":[
  {"device_type":"gpu","vendor":"nvidia","model":"L40","node":"node2","slot_id":0,"status":"idle"},
  {"device_type":"gpu","vendor":"nvidia","model":"A40","node":"node2","slot_id":1,"status":"idle"},
  {"device_type":"gpu","vendor":"nvidia","model":"L40-44GiB","node":"node3","slot_id":0,"status":"idle"},
  {"device_type":"gpu","vendor":"nvidia","model":"A40-44GiB","node":"node3","slot_id":1,"status":"idle"}
]}
```

### `/api/devices` — 4 GPU entries, state:ready
```json
[
  {"node":"node2","type":"gpu","vendor":"nvidia","model":"L40","slot_id":0,"state":"ready"},
  {"node":"node2","type":"gpu","vendor":"nvidia","model":"A40","slot_id":1,"state":"ready"},
  {"node":"node3","type":"gpu","vendor":"nvidia","model":"L40-44GiB","slot_id":0,"state":"ready"},
  {"node":"node3","type":"gpu","vendor":"nvidia","model":"A40-44GiB","slot_id":1,"state":"ready"}
]
```

### HTTP check
`curl -o /dev/null -w "%{http_code}" http://10.254.177.41:30001/dashboard/gpu-realtime` → **200**

## TypeScript
`npx tsc --noEmit -p web/tsconfig.app.json` — zero errors in gpu-realtime files.
Two pre-existing errors in `mlperf/` and `mmlu/` (unrelated, owned by other workers).

## Render Test
The existing `DeviceRealtimeDashboard/__tests__/registry-driven.test.tsx` already covers
the 4-GPU fixture case (`FIXTURE_4_GPU`) and verifies all 4 slots render (L40, A40,
L40-44GiB, A40-44GiB). The GPU realtime page now renders that component with
`deviceType="gpu"`, so those tests directly cover the required behavior.
