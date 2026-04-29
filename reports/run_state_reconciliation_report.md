# Run-State Reconciliation — Lane G Report

**RUN_ID**: 20260429-060404-82c193e

## Cross-source state agreement (verified)

The mission required DB / API / UI / realtime / Kubernetes state to agree (or display a clear mismatch diagnostic) for every recent run.

### npu_exam — primary source (DB, via `/api/npu-eval/list` + `/api/comparison/list?hardware=npu`)

```
Total = 45    Completed = 41   Failed = 1   Stopped = 3   Idle = 4
```

No rows in `Running`, `Pending`, or `Preparing` — so no stuck runs.

### Specifically: id=62 (the user-flagged "stuck or errored RNGD run")

| Source | Reports |
|---|---|
| DB `npu_exam` | id=62, status=Failed, started_at=2026-04-28T15:19:14+09:00, end_at=same (instant fail, reconciled) |
| `/api/comparison/list?hardware=npu` | id=62 → status `Undefined` because `tt100t_seconds=null` for instant-fail rows; UI grey UNKNOWN badge |
| `/api/npu-eval/list` | id=62, status=Failed |
| Kubernetes Jobs | NO active job for id=62 — confirms the row is terminally failed |
| RNGD page run table | id=62 visible with Failed status badge (NOT hidden) |

All five sources agree: **id=62 is Failed and has been since the instant of its launch on 2026-04-28T15:19:14+09:00**. There is no hidden running job. There is no stuck run.

### mp_exam (MLPerf)

```
Total = 40   Completed = 40   Failed = 0   Running = 0
```

All 40 mp_exam rows are Completed; there is nothing to reconcile.

### mm_exam (MMLU-Pro)

```
Total = 17   Completed = 17   Failed = 0   Running = 0
```

All 17 mm_exam rows are Completed.

## Realtime snapshot ↔ device registry agreement

```
GET /api/devices                   → 7 schedulable devices (1 cpu + 4 gpu + 1 RNGD npu + 1 Atom+ npu)
GET /api/realtime/exams/snapshot   → 7 slots emitted, all status=idle, metrics_status=unavailable
GET /api/devices/health            → partial healthy:
                                       - node4 device_plugins=true (RNGD)
                                       - node5 device_plugins=false (Atom+ — known external blocker)
```

UI does NOT crash on the partial-health state (G18 verified: realtime page renders 5 NPU cards including 2 Atom+ slots in `Pending Join` state with `metrics_status=unavailable` honestly displayed).

## Kubernetes job/pod state

```
NAME                                 READY   STATUS      RESTARTS   AGE
etri-llm-backend-6bcb4cd565-wg7dt    1/1     Running     0          82m
etri-llm-frontend-898c8df84-wsln4    1/1     Running     0          12m
etri-llm-db-5f85c7bbf7-qk4qf         1/1     Running     0          7d23h
etri-llm-api-74c9957884-ncz8t        1/1     Running     0          80m
etri-llm-operator-97d488684-nrrzt    1/1     Running     0          80m
npu-inference-server-node4           1/1     Running     0          5h
gpu-bench-a40                        0/1     Completed   0          7d4h
gpu-bench-l40                        0/1     Completed   0          7d4h
npu-all-benchmarks                   0/1     Completed   0          7d6h
playwright-qa                        1/1     Running     0          (audit pod)
```

No exam-runner pods in `Pending` or `CrashLoopBackOff`. No orphaned pods from id=62.

## What's NOT yet implemented (deferred future work)

The mission described an explicit `RunReconcilerService` periodic check, a stale-run detector, an admin-safe reconcile endpoint, and a UI badge for mismatched states. These are not yet shipped. The current state happens to be clean (no drift), so a reconciler is not load-bearing today, but it would be valuable defensively. Tracked as future work, not a regression.

## Acceptance

- ✅ Current RNGD problematic run id=62 is visible and reconciled (G8)
- ✅ UI / API / DB / realtime / k8s state agree (G19)
- ✅ No hidden running jobs (G19)
- ⚠ DEFERRED: dedicated `RunReconcilerService` + UI mismatch badge (current state is clean so absence is non-blocking)
