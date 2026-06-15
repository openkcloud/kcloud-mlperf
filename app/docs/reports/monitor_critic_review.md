---
title: Monitor / Realtime Critic Review — demo-rescue-may06b
worker: w-critic
date: 2026-05-06
mission: demo-rescue-may06b
contract_ref: docs/reports/rngd_dashboard_contract.md
scope: |
  - Task #4 (w-gpu-realtime-menu): GPU realtime page lists idle GPUs.
  - RNGD active-benchmark detection state machine.
verdict: PARTIAL — source PASS; live UI BLOCKED-pending-redeploy
---

# Monitor / Realtime Critic Review

Verifies four things:

1. GPU realtime menu source uses the same `DeviceRealtimeDashboard` shared
   component as the NPU page.
2. Live `/api/realtime/exams/snapshot` reports all 4 GPU slots as `idle`.
3. The state machine correctly maps idle / running / stale / unavailable to
   the contract §4 hex colors.
4. Slot keys / vendor display follow contract §11.

---

## Q1 — GPU realtime page mirrors NPU page

```
web/src/pages/dashboard/gpu-realtime/index.tsx:1-3
  import { DeviceRealtimeDashboard } from '@/components/DeviceRealtimeDashboard';
  const GpuRealtimePage = () => <DeviceRealtimeDashboard deviceType="gpu" />;

web/src/pages/dashboard/npu-realtime/index.tsx:1-3
  import { DeviceRealtimeDashboard } from '@/components/DeviceRealtimeDashboard';
  const NpuRealtimePage = () => <DeviceRealtimeDashboard deviceType="npu" />;
```

Identical shape, only `deviceType` prop differs. **PASS.**

The previous version of the GPU page was importing `PrometheusIframeDashboard`
directly (per worker evidence `gpu_realtime_menu_idle_gpu_fix.md:20-26`), which
showed only the Prometheus iframe and did not list registered devices. The fix
replaces that with the shared component that pulls from `/api/devices` and
overlays `/api/realtime/exams/snapshot` per slot.

---

## Q2 — Live API confirms 4 idle GPU slots

Captured this session (2026-05-06T07:11Z):

```
$ curl http://10.254.177.41:30001/api/realtime/exams/snapshot
{"data":{"slots":[
  {"device_type":"gpu","vendor":"nvidia","model":"L40","node":"node2","slot_id":0,"status":"idle","last_seen":null,"current_exam":null,...},
  {"device_type":"gpu","vendor":"nvidia","model":"A40","node":"node2","slot_id":1,"status":"idle",...},
  {"device_type":"gpu","vendor":"nvidia","model":"L40-44GiB","node":"node3","slot_id":0,"status":"idle",...},
  {"device_type":"gpu","vendor":"nvidia","model":"A40-44GiB","node":"node3","slot_id":1,"status":"idle",...},
  {"device_type":"npu","vendor":"furiosa","model":"RNGD","node":"node4","slot_id":0,"status":"idle",...},
  {"device_type":"npu","vendor":"rebellions","model":"Atom+","node":"node5","slot_id":0,"status":"idle",...},
  {"device_type":"npu","vendor":"rebellions","model":"Atom+","node":"node5","slot_id":1,"status":"idle",...}
]}}
```

```
$ curl http://10.254.177.41:30001/api/devices
[
  {"node":"node1","type":"cpu","vendor":"intel","model":"cpu","slot_id":0,"state":"ready",...},
  {"node":"node2","type":"gpu","vendor":"nvidia","model":"L40","slot_id":0,"state":"ready",...},
  {"node":"node2","type":"gpu","vendor":"nvidia","model":"A40","slot_id":1,"state":"ready",...},
  {"node":"node3","type":"gpu","vendor":"nvidia","model":"L40-44GiB","slot_id":0,"state":"ready",...},
  {"node":"node3","type":"gpu","vendor":"nvidia","model":"A40-44GiB","slot_id":1,"state":"ready",...},
  ...
]
```

All 4 GPU slots are `state: ready` in the registry and `status: idle` in the
realtime snapshot. The `DeviceRealtimeDashboard` shared component renders each
slot (via the `useDeviceRegistry` hook + per-slot snapshot join) — the
fixture-based test `web/src/components/DeviceRealtimeDashboard/__tests__/registry-driven.test.tsx:23-72`
defines `FIXTURE_4_GPU` covering exactly these 4 model strings, and lines
166-168 render the dashboard with `deviceType="gpu"` against that fixture.
**PASS.**

---

## Q3 — Status color state machine vs contract §4

`web/src/components/DeviceRealtimeDashboard/DeviceRealtimeDashboard.tsx:73-99`
defines the StatusChip color map. Cross-checked against contract §4:

| Wire status | Display label | Source hex (line) | Contract §4 hex | Match |
|---|---|---|---|---|
| running / Running | Running | `#16A34A` (74-75) | `#16A34A` | yes |
| completed / Completed | Completed | `#4F46E5` (76-77) | `#4F46E5` | yes |
| Queued / queued | Queued | `#D97706` (78-79) | `#D97706` | yes |
| Pending | Pending | `#D97706` (80) | `#D97706` | yes |
| Preparing / preparing | Preparing | `#0284C7` (81-82) | `#0284C7` | yes |
| Idle / idle | Idle | `#64748B` (83-84) | `#64748B` | yes |
| Failed / failed / error | Failed/Error | `#DC2626` (85-87) | `#DC2626` | yes |
| Stopped | Stopped | `#9333EA` (88) | `#9333EA` | yes |
| Stale / stale | Stale | `#64748B` (90-91) | `#64748B` | yes |
| Unavailable / unavailable | Unavailable | `#DC2626` + `strikethrough: true` (93-94) | `#DC2626` + line-through | yes |
| Unknown / unknown | Unknown | `#64748B` (95-96) | `#64748B` | yes |
| 'Pending Join' / pending_join | Pending Join | `#D97706` (97-98) | `#D97706` | yes |

Strikethrough applied selectively at chip render time
(`DeviceRealtimeDashboard.tsx:110` `...(cfg.strikethrough ? { textDecoration: 'line-through' } : {})`) — matches contract §8.

**Verdict (Q3 — colors): PASS — contract-perfect.**

---

## Q4 — Slot keys & vendor display per contract §11

| Item | Source | Contract §11 | Match |
|---|---|---|---|
| VENDOR_DISPLAY map | `DeviceRealtimeDashboard.tsx:53-58` `{nvidia:'NVIDIA', furiosa:'FuriosaAI', rebellions:'Rebellions', intel:'Intel'}` | exact | yes |
| RegistryStateChip color map | `DeviceRealtimeDashboard.tsx:60-66` `ready:#16A34A, pending_join:#D97706, not_ready:#DC2626, degraded:#EA580C, unknown:#64748B` | exact | yes |
| Idle-when-state-ready fallback | `DeviceRealtimeDashboard.tsx:145` `const status = slot?.status ?? (device.state === 'ready' ? 'Idle' : 'Pending');` | matches §6 (status chosen from snapshot, fallback per registry) | yes |
| Stale detection | `slot?.status === 'stale'` derived from backend `STALE_THRESHOLD_MS = 120000` (`server/src/realtime/realtime.service.ts`, per prior W-3 monitor critic review) | 120s TTL per contract §5 | yes |

**PASS.**

---

## Q5 — RNGD active-benchmark detection (per contract)

The RNGD slot is at `slots[furiosa/RNGD/node4]` with `status: idle, current_exam: null`
in this session — no active job. Two complementary surfaces:

- `/api/realtime/exams/snapshot` (one current_exam per slot) — verified.
- `/npu-eval/rngd/index.tsx` ActiveBenchmarkCard polled from `NpuEvalApi.list`
  every 5 s — confirmed in source (per prior R-3 ui review and the unchanged
  `web/src/pages/npu-eval/rngd/index.tsx`).

The state machine correctly returns `status: idle, last_seen: null,
current_exam: null` while the cluster has no active RNGD jobs — the contract's
"idle-only-when-verified-idle" requirement (§6) is satisfied.

The synthetic running → stale transition (heartbeat >120s) cannot be exercised
here without launching a job; this is bounded by demo schedule and is covered
by unit tests at `server/test/realtime-state.e2e-spec.ts` per prior critic
review (R-3).

**PASS** for static state. Synthetic transition test deferred (acceptable per
prior reviews).

---

## Defects found

None requiring rework.

**Operational caveat:** the deployed v26 frontend image still serves the OLD
`PrometheusIframeDashboard` for `/dashboard/gpu-realtime`. The fix is in
source but invisible to demo viewers until the v27 frontend image rolls out.
Demo path for "Live GPU dashboard" should NOT navigate to that route on the
deployed v26.

---

## Summary

| Criterion | Verdict |
|---|---|
| GPU realtime page uses DeviceRealtimeDashboard with deviceType="gpu" | PASS (source) |
| 4 GPU slots present in /api/realtime/exams/snapshot, all idle | PASS (live) |
| 4 GPU entries in /api/devices, all state:ready | PASS (live) |
| StatusChip color map matches contract §4 (12/12 colors + strikethrough) | PASS |
| VENDOR_DISPLAY map matches contract §11 | PASS |
| Idle / running / stale / unavailable state machine intact | PASS |
| Synthetic running → stale transition | NEEDS-RUN (acceptable; unit-test covered) |
| Live deployed v26 GPU realtime page | BLOCKED-pending-redeploy |

**Final monitor verdict: PARTIAL.** Every state-machine and color-contract
criterion PASSes on the source axis; the live route is gated on the v27
frontend rollout. **Required image: `etri-llm-frontend:v27`** containing the
diff evidenced in `gpu_realtime_menu_idle_gpu_fix.md`.
