# RNGD Active Benchmark Discovery Fix

## Problem

The external systemd-discovery iframe at `http://10.254.202.114:30890/` shows "no bench units active"
because it scans `/run/systemd/transient/{bench,mlperf}-*.service` on the host. Our backend launches
benchmarks as Kubernetes Jobs, not `systemd-run` units, so the iframe will always show idle even when
a benchmark is actively running on node4.

## Solution (Additive)

A new "Active Benchmark (cluster-source)" section was added to the RNGD page
(`web/src/pages/npu-eval/rngd/index.tsx`) above the systemd iframe.

This section:
- Uses the existing `useRealtimeExams` hook which connects via SSE to `/realtime/exams` (falls back to polling `/realtime/exams/snapshot` every 5s)
- Filters for the slot with `vendor='furiosa'` and `device_type='npu'`
- Displays exam name, status chip (with pulse animation when active), elapsed time, and exam ID
- Shows "No active RNGD job in cluster orchestrator" when idle

## Result

Even if the systemd iframe shows idle, if a Kubernetes Job is running on node4 for a RNGD benchmark,
it will appear in the new section sourced from the cluster orchestrator's realtime snapshot.

## No Infrastructure Changes Required

- No new backend endpoints added
- No new hooks created — reuses `useRealtimeExams` already used by `DeviceRealtimeDashboard`
- Purely additive frontend change; does not affect the existing systemd iframe or any other component

## Data Flow

```
/realtime/exams (SSE) → useRealtimeExams hook → snapshot.slots[]
  → filter vendor='furiosa', device_type='npu'
  → rngdSlot.exam_name / rngdSlot.status / rngdSlot.elapsed_seconds
  → "Active Benchmark (cluster-source)" Paper section
```
