# Realtime / Dashboard Failure-Mode Catalog

> Source: `server/src/realtime/realtime.service.ts`
> Backend health endpoint: `http://10.254.177.41:30001/api/realtime/exams/health`
> Snapshot endpoint: `http://10.254.177.41:30001/api/realtime/exams/snapshot`
> `STALE_THRESHOLD_MS = 120 000 ms (2 min)` — the TTL that separates `running` from `stale`.

---

## Slot state-machine reference

```
PREPARING  →  RUNNING  →  (completed / idle)
                 ↓
             stale  (RUNNING in DB but no result heartbeat for ≥ 2 min)
                 ↓  (manual or auto recovery)
             idle / error
```

`buildSnapshot()` queries ACTIVE_STATUSES (`RUNNING | PREPARING`) on every poll, then derives the display state from the DB row plus the age of the latest `mp_exam_result` / `npu_exam_result` row. It never mutates DB state — it only reads.

---

## Scenario 1 — Exam transitions from Running to Error mid-poll

**Trigger**
The operator marks the exam `ERROR` (e.g. CUDA OOM, model-load failure, gRPC error from the inference pod) between two consecutive frontend polls.

**Symptom**
Progress ring turns red; slot card shows `status: error`. `current_exam` block stays visible with elapsed time frozen. `metrics_status` reflects last known value (`available` or `pending`).

**Backend diagnostic**
```bash
# Confirm DB state
kubectl exec -n etri deploy/backend -- \
  psql $DATABASE_URL -c \
  "SELECT id, status, started_at, finished_at FROM mp_exam ORDER BY id DESC LIMIT 5;"

# Check operator logs for the error cause
kubectl logs -n etri -l app=gpu-operator --tail=100 | grep -i error
```

**Recovery action**
1. Re-submit the exam from the UI (creates a new exam row).
2. If the pod is stuck in `Error` state: `kubectl delete pod -n etri -l job=<exam-job-name>`.
3. Verify the new exam appears as `preparing` in the next snapshot poll.

**Self-heal time**
Does not self-heal. The `error` state is terminal in the DB until a new exam is submitted.

**Demo response**
"The benchmark encountered a runtime error — this is expected during GPU saturation testing. We'll resubmit in a moment. Note the realtime dashboard caught the failure immediately via the slot heartbeat TTL."

---

## Scenario 2 — Exam pod killed manually (`kubectl delete pod`)

**Trigger**
An operator runs `kubectl delete pod -n etri <running-exam-pod>` during an active exam.

**Symptom**
Within one poll cycle (≤ 5 s) the slot transitions: `running` → `stale` (if the pod dies before writing a final result row and no heartbeat arrives for ≥ 2 min) or directly to `idle` (if the controller sets the exam to a terminal status quickly).

More precisely: `buildGpuSlot` / `buildNpuSlot` compute `heartbeatAge` from the last `created_at` on the result table. Once the pod is dead, no new rows are written. After `STALE_THRESHOLD_MS` the slot shows `stale`.

**Backend diagnostic**
```bash
# See which pods are running for exams
kubectl get pods -n etri -l app=exam-runner --field-selector=status.phase=Running

# Confirm the pod is gone
kubectl get pod -n etri <pod-name>

# Check if the exam row ever got a terminal status
kubectl exec -n etri deploy/backend -- \
  psql $DATABASE_URL -c \
  "SELECT id, status, finished_at FROM mp_exam WHERE status='RUNNING' ORDER BY id DESC LIMIT 5;"
```

**Recovery action**
1. If the exam row is stuck `RUNNING` with no pod: manually update the DB row or re-trigger via API `PATCH /api/exams/:id` to set status = `ERROR`.
2. Resubmit the exam from the UI.

**Self-heal time**
Slot shows `stale` after 2 min automatically. The `running` → `stale` transition is cosmetic only (no DB write). Full recovery requires manual exam resubmission or a backend reconcile loop.

**Demo response**
"The pod was evicted — the dashboard detects this within two minutes via the heartbeat timeout and shows the slot as stale. We would resubmit the benchmark now."

---

## Scenario 3 — Operator becomes unreachable (gRPC timeout)

**Trigger**
The inference operator pod crashes or its gRPC endpoint becomes unresponsive during an active exam.

**Symptom**
The exam controller cannot dispatch new work units. The current exam row stays `RUNNING` in the DB (the controller hasn't received a completion/error signal). Result rows stop being written. After 2 min the slot transitions to `stale`.

`operator_race_alerts` counter in the snapshot may increment if `recordOperatorRaceFailed()` was triggered before the operator went down.

**Backend diagnostic**
```bash
# Check operator pod health
kubectl get pods -n etri -l app=llm-operator

# Test gRPC reachability
kubectl exec -n etri deploy/backend -- \
  grpc_health_probe -addr=<operator-service>:50051

# Check backend logs for gRPC errors
kubectl logs -n etri deploy/backend --tail=200 | grep -i "grpc\|operator"

# Snapshot — look for operator_race_alerts > 0
curl -s http://10.254.177.41:30001/api/realtime/exams/snapshot | jq .operator_race_alerts
```

**Recovery action**
1. `kubectl rollout restart deployment/llm-operator -n etri`
2. Wait for the operator pod to become `Running` (≈ 30–60 s).
3. If the exam row is stuck `RUNNING`: resubmit or manually set to `ERROR`.
4. Monitor `operator_race_alerts` counter — it should stop incrementing once the operator recovers.

**Self-heal time**
Slot shows `stale` after 2 min. The operator itself does not auto-restart unless a `restartPolicy` or liveness probe is configured. Requires manual pod restart.

**Demo response**
"The inference operator is temporarily unreachable — this appears as a stale slot after our two-minute heartbeat window. We're restarting the operator now; exams will resume once it reconnects."

---

## Scenario 4 — Loki goes down (progress values unavailable)

**Trigger**
The Loki log-aggregation pod crashes or is evicted, making log-derived progress metrics unavailable.

**Symptom**
`sweep_progress` fields (`completed`, `total`) may read `0 / 0` or stale values if the `GpuSweepService.getStatus()` depends on Loki-derived data. The snapshot endpoint itself continues to respond — `buildSnapshot()` wraps the sweep status call in a try/catch and logs a warning rather than throwing. Slot states are unaffected (they come from the DB, not Loki).

**Backend diagnostic**
```bash
# Check Loki pod
kubectl get pods -n monitoring -l app=loki

# Check backend warning logs
kubectl logs -n etri deploy/backend --tail=100 | grep -i "loki\|GpuSweepService\|getStatus.*failed"

# Verify snapshot still returns valid slot data
curl -s http://10.254.177.41:30001/api/realtime/exams/snapshot | jq '{timestamp, operator_race_alerts, sweep_progress}'
```

**Recovery action**
1. `kubectl rollout restart deployment/loki -n monitoring`
2. Once Loki is back, `sweep_progress` auto-repopulates on the next `buildSnapshot()` call.

**Self-heal time**
Slot data continues updating normally. `sweep_progress` resumes automatically when Loki recovers — no manual intervention needed for slots; sweep progress resumes within one poll cycle.

**Demo response**
"The progress counter is temporarily unavailable because our log pipeline is restarting — benchmark slots and timing are unaffected. The progress bar will resume shortly."

---

## Scenario 5 — Backend pod restarts mid-poll (frontend retries SSE/poll)

**Trigger**
The backend NestJS pod is restarted (rolling update, OOM kill, manual rollout).

**Symptom**
Ongoing SSE stream is dropped. Frontend receives a connection error and falls back to polling (or re-connects SSE). During the restart window (≈ 10–30 s) the snapshot endpoint returns 502/503. The `operator_race_alerts` ring buffer in memory is lost on restart.

**Backend diagnostic**
```bash
# Check pod restart count
kubectl get pods -n etri -l app=backend -o wide

# Watch rollout
kubectl rollout status deployment/backend -n etri

# Confirm endpoint recovers
curl -s -o /dev/null -w "%{http_code}" \
  http://10.254.177.41:30001/api/realtime/exams/health
```

**Recovery action**
No manual action required. The frontend reconnects automatically. `operator_race_alerts` resets to 0 (in-memory ring buffer cleared), which is cosmetically misleading but not operationally harmful.

**Self-heal time**
Fully self-healing. Pod restarts in ≈ 10–30 s. SSE clients reconnect within one retry cycle. Slot state is always re-derived from the DB on each `buildSnapshot()` call so no state is lost.

**Demo response**
"The backend pod restarted — this is a Kubernetes self-healing event. The dashboard reconnects automatically within seconds."

---

## Scenario 6 — Dashboard iframe target unreachable (e.g., node4:30890 down)

**Trigger**
One of the bench dashboard processes (e.g., `bench_dashboard.py` on node4 port 30890) crashes or the node becomes unreachable.

**Affected dashboards**

| Node | Port | Script |
|------|------|--------|
| node4 | 30890 | `bench_dashboard.py` (RNGD) |
| node2 | 30891 | `gpu_bench_dashboard_l40.py` (L40) |
| node3 | 30893 | `gpu_bench_dashboard_l40.py` env-var'd for A40 |
| node5 | 30892 | `atomplus_bench_dashboard.py` |

**Symptom**
The iframe in the UI shows a browser-native "connection refused" or blank frame. The realtime snapshot endpoint is unaffected — slot state comes from the DB, not the dashboard process. The slot card may still show `running` correctly.

**Backend diagnostic**
```bash
# Test reachability from the cluster
curl -s -o /dev/null -w "%{http_code}" http://node4:30890/
# or from outside:
curl -s -o /dev/null -w "%{http_code}" http://10.254.177.41:30890/

# Check if the dashboard process is running on the node
ssh node4 "ps aux | grep bench_dashboard"
ssh node4 "ss -tlnp | grep 30890"
```

**Recovery action**
```bash
ssh node4 "cd /path/to/dashboards && nohup python bench_dashboard.py &"
# Or via systemd if configured:
ssh node4 "sudo systemctl restart bench-dashboard"
```

**Self-heal time**
Does not self-heal. The iframe remains blank until the dashboard process is manually restarted on the target node.

**Demo response**
"The visualization panel for node4 is temporarily offline — the underlying benchmark is still running as shown in the slot status. We'll restore the panel view in a moment."

---

## Scenario 7 — Snapshot returns `idle` when exam is actually running (stale slot)

**Trigger**
The `gpu_type` field in the exam DB row does not normalize-match the `model` field from the device registry. The SKU normalization in `buildGpuSlot` strips the `NVIDIA-` prefix and lowercases both sides — if the registry returns an unexpected variant (e.g., `L40S` vs `L40`) the exam is not matched and the slot shows `idle`.

Code path in `buildGpuSlot`:
```typescript
const norm = (s) => (s ?? '').replace(/^NVIDIA-/i, '').toLowerCase();
const mpExam = mpActives.find((e) => norm(e.gpu_type) === skuN);
```

**Symptom**
Slot card shows `status: idle` and `current_exam: null` despite an active exam row in the DB.

**Backend diagnostic**
```bash
# Compare registry model names vs DB gpu_type values
curl -s http://10.254.177.41:30001/api/realtime/exams/snapshot | \
  jq '.slots[] | {node, model, status}'

kubectl exec -n etri deploy/backend -- \
  psql $DATABASE_URL -c \
  "SELECT id, gpu_type, status FROM mp_exam WHERE status='RUNNING';"

# Check device registry directly
curl -s http://10.254.177.41:30001/api/device-registry | jq '.[] | {node, model}'
```

**Recovery action**
1. Identify the mismatched string pair from the diagnostic output.
2. Update the device registry `model` field or the exam `gpu_type` to align with the normalization rule (`strip NVIDIA- prefix, lowercase`).
3. If urgent: patch the exam row's `gpu_type` to match the registry string.

**Self-heal time**
Does not self-heal. Requires a data or code fix. Once strings align, the next `buildSnapshot()` call correctly maps the exam.

**Demo response**
"The slot shows idle due to a model-name mismatch in the device registry — the benchmark is running. This is a configuration issue we have a fix ready for."

---

## Scenario 8 — Snapshot returns `running` when exam actually died (no heartbeat / zombie)

**Trigger**
The exam pod crashed silently (OOM, kernel kill, network partition) without the controller updating the DB row to `ERROR` or `COMPLETED`. The DB row stays `RUNNING` but no new result rows are written.

**Symptom**
Initially the slot shows `running`. After `STALE_THRESHOLD_MS` (2 min) it automatically transitions to `status: stale`. `last_seen` is the timestamp of the last result row written before the crash. `metrics_status` stays `available` (frozen at last known value).

This is the primary zombie-detection mechanism. `buildGpuSlot`:
```typescript
const heartbeatAge = last_seen
  ? Date.now() - new Date(last_seen).getTime()
  : activeExam.started_at
    ? Date.now() - new Date(activeExam.started_at).getTime()
    : Infinity;
status = heartbeatAge >= STALE_THRESHOLD_MS ? 'stale' : 'running';
```

**Backend diagnostic**
```bash
# Find RUNNING exams with no recent result rows
kubectl exec -n etri deploy/backend -- psql $DATABASE_URL -c "
  SELECT e.id, e.gpu_type, e.started_at,
         MAX(r.created_at) AS last_result
  FROM mp_exam e
  LEFT JOIN mp_exam_result r ON r.exam_id = e.id
  WHERE e.status = 'RUNNING'
  GROUP BY e.id
  HAVING MAX(r.created_at) < NOW() - INTERVAL '2 minutes'
     OR MAX(r.created_at) IS NULL;"

# Confirm no active exam pod
kubectl get pods -n etri -l app=exam-runner
```

**Recovery action**
1. System auto-shows `stale` after 2 min — no UI intervention needed.
2. To fully recover: mark the exam `ERROR` in the DB and resubmit.
3. `kubectl delete pod` for any lingering exam pod.

**Self-heal time**
Partial self-heal: slot shows `stale` after 2 min automatically. Full DB cleanup requires manual action.

**Demo response**
"The system detected a zombie job — the benchmark pod died without reporting back. You can see the slot automatically transitioned to 'stale' within two minutes via our heartbeat detection."

---

## Scenario 9 — SSE connection drops and frontend falls back to polling

**Trigger**
Network interruption, proxy timeout, Nginx/ingress connection reset, or backend SSE handler error drops the event stream.

**Symptom**
UI briefly shows a loading/disconnected indicator, then resumes normal display after falling back to HTTP polling. There is a data gap equal to the polling interval (typically 3–5 s). No slot state change.

**Backend diagnostic**
```bash
# Check backend SSE endpoint directly
curl -N -H "Accept: text/event-stream" \
  http://10.254.177.41:30001/api/realtime/exams/snapshot/stream

# Check ingress/proxy timeout config
kubectl describe ingress -n etri | grep -i timeout

# Backend error logs
kubectl logs -n etri deploy/backend --tail=100 | grep -i "sse\|stream\|client disconnect"
```

**Recovery action**
No action required in most cases — the frontend reconnects automatically. If SSE drops continuously: check ingress proxy timeout settings (`proxy_read_timeout` in Nginx, typically set to ≥ 60 s for SSE).

**Self-heal time**
Fully self-healing. Frontend reconnects within one retry interval (≤ 5 s).

**Demo response**
"The live stream momentarily dropped — the dashboard automatically fell back to polling and is already reconnected. No data was lost."

---

## Scenario 10 — Concurrent exams on the same node confuse slot mapping

**Trigger**
Two exam rows in `RUNNING` state share the same `gpu_type` (or `npu_type`) value. `buildGpuSlot` uses `Array.find()` — it returns the first match, silently ignoring the second exam.

Code path:
```typescript
const mpExam = mpActives.find((e) => norm(e.gpu_type) === skuN);
```

**Symptom**
One of the two concurrent exams is invisible on the dashboard. The slot shows only the first-matched exam. `operator_race_alerts` may increment if the operator detects a scheduling conflict.

**Backend diagnostic**
```bash
# Find duplicate gpu_type RUNNING exams
kubectl exec -n etri deploy/backend -- psql $DATABASE_URL -c "
  SELECT gpu_type, COUNT(*) FROM mp_exam
  WHERE status = 'RUNNING'
  GROUP BY gpu_type HAVING COUNT(*) > 1;"

# Check operator_race_alerts in snapshot
curl -s http://10.254.177.41:30001/api/realtime/exams/snapshot | \
  jq .operator_race_alerts
```

**Recovery action**
1. Cancel one of the duplicate exams via the UI or API `DELETE /api/exams/:id`.
2. Investigate why the scheduler allowed two concurrent exams on the same GPU — check sweep concurrency settings and slot locking logic.
3. Ensure `operator_race_alerts` returns to 0 after cancellation.

**Self-heal time**
Does not self-heal. The duplicate exam remains invisible until cancelled. Requires manual cancellation.

**Demo response**
"Two benchmarks were scheduled for the same GPU — our operator race detector flagged this. We're cancelling the duplicate now."

---

## Scenario 11 — Device registry returns `ready` for a not-ready GPU

**Trigger**
The device registry reports `state: ready` for a GPU node that is actually not schedulable (e.g., node tainted, GPU driver crashed, `nvidia-smi` failing). The `DeviceRegistryService.getDevices()` returns the stale cached state.

**Symptom**
The slot shows `status: idle` (ready for work) in the UI. When an exam is submitted to that GPU, the exam pod fails immediately or hangs in `Pending` state. The slot transitions to `error` or `stale` after the exam pod failure.

**Backend diagnostic**
```bash
# Check node GPU health
ssh node2 nvidia-smi

# Check k8s node conditions
kubectl describe node node2 | grep -A5 Conditions

# Check device registry cached state
curl -s http://10.254.177.41:30001/api/device-registry | \
  jq '.[] | select(.node=="node2") | {state, k8s_node_status}'

# Check for GPU resource allocatability
kubectl get node node2 -o json | \
  jq '.status.allocatable["nvidia.com/gpu"]'
```

**Recovery action**
1. Fix the GPU node: restart the nvidia device plugin, reboot if needed.
2. Force a device registry refresh (if there is a cache-invalidation endpoint) or restart the backend to clear the in-process cache.
3. `kubectl taint` the node `NoSchedule` until the GPU is confirmed healthy.

**Self-heal time**
Does not self-heal automatically. The device registry cache must be invalidated or the backend restarted. GPU health must be confirmed manually.

**Demo response**
"The device registry shows this GPU as available, but the driver isn't responding. We'll remove it from the scheduling pool while we investigate."

---

## Scenario 12 — Multiple exams compete for the same GPU slot

**Trigger**
A race condition in the exam submission path allows two API requests to allocate the same GPU slot before either exam row is written to the DB. Both exams enter `PREPARING`, then `RUNNING` on the same physical GPU.

**Symptom**
`operator_race_alerts` counter increments (set by `recordOperatorRaceFailed()`). Both exam rows appear `RUNNING` in the DB for the same `gpu_type`. Only one is shown on the dashboard (first-match behavior, same as Scenario 10). The GPU may be overloaded, causing both exams to fail or produce invalid metrics.

`recordOperatorRaceFailed()` is called by the operator when it detects a conflicting slot assignment:
```typescript
recordOperatorRaceFailed() {
  const since = new Date().toISOString();
  const existing = this.raceAlerts.get(since);
  this.raceAlerts.set(since, { count: (existing?.count ?? 0) + 1, since });
}
```

**Backend diagnostic**
```bash
# Check operator_race_alerts value
curl -s http://10.254.177.41:30001/api/realtime/exams/snapshot | \
  jq .operator_race_alerts

# Find concurrent RUNNING exams on the same GPU
kubectl exec -n etri deploy/backend -- psql $DATABASE_URL -c "
  SELECT gpu_type, array_agg(id) AS exam_ids, COUNT(*) AS concurrent
  FROM mp_exam
  WHERE status IN ('RUNNING','PREPARING')
  GROUP BY gpu_type HAVING COUNT(*) > 1;"

# Check operator logs for race events
kubectl logs -n etri -l app=gpu-operator --tail=200 | grep -i "race\|conflict\|slot"
```

**Recovery action**
1. Cancel all but one of the competing exams via `DELETE /api/exams/:id`.
2. Investigate the slot locking mechanism — ensure the exam submission endpoint acquires a distributed lock or uses a DB transaction with a unique constraint on `(gpu_type, status=RUNNING)`.
3. Monitor `operator_race_alerts` until it stops incrementing.

**Self-heal time**
Does not self-heal. Competing exams remain until manually cancelled. The `operator_race_alerts` counter persists in memory until the backend pod restarts.

**Demo response**
"The race detector caught a double-allocation on this GPU — you can see the alert counter in the top of the dashboard. We're cancelling the duplicate job now."

---

## Realtime Resilience Summary

| # | Scenario | Self-Heals? | Time to Self-Heal | Manual Intervention |
|---|----------|-------------|-------------------|---------------------|
| 1 | Exam transitions to Error | No | — | Resubmit exam |
| 2 | Exam pod killed manually | Partial | 2 min (stale) | Resubmit exam; patch DB if stuck |
| 3 | Operator gRPC unreachable | No | — | Restart operator pod |
| 4 | Loki goes down | Yes (slots only) | 1 poll cycle after Loki recovery | None for slots; sweep progress resumes auto |
| 5 | Backend pod restarts | Yes | ≈ 10–30 s | None |
| 6 | Dashboard iframe unreachable | No | — | Restart dashboard process on node |
| 7 | Snapshot idle for running exam (SKU mismatch) | No | — | Fix model name in registry or DB |
| 8 | Snapshot running for dead exam (zombie) | Partial | 2 min (stale) | Patch DB exam status; delete pod |
| 9 | SSE drops, falls back to polling | Yes | ≤ 5 s | None |
| 10 | Concurrent exams confuse slot mapping | No | — | Cancel duplicate exam |
| 11 | Device registry: false-ready GPU | No | — | Fix GPU driver; restart backend/registry |
| 12 | Race: multiple exams claim same slot | No | — | Cancel duplicate; fix slot-lock logic |

**Self-healing: 3 of 12** (Scenarios 4, 5, 9)
**Partial self-healing: 2 of 12** (Scenarios 2, 8 — cosmetic `stale` state after 2 min; DB cleanup still manual)
**Manual intervention required: 7 of 12** (Scenarios 1, 3, 6, 7, 10, 11, 12)

---

## Quick-reference diagnostic one-liners

```bash
# Full snapshot (pretty-printed)
curl -s http://10.254.177.41:30001/api/realtime/exams/snapshot | jq .

# Slot states summary
curl -s http://10.254.177.41:30001/api/realtime/exams/snapshot | \
  jq '.slots[] | {node, model, status, metrics_status}'

# Race alert count
curl -s http://10.254.177.41:30001/api/realtime/exams/snapshot | jq .operator_race_alerts

# Backend health
curl -s http://10.254.177.41:30001/api/realtime/exams/health | jq .

# All RUNNING/PREPARING exam rows
kubectl exec -n etri deploy/backend -- psql $DATABASE_URL -c \
  "SELECT id, gpu_type, status, started_at FROM mp_exam WHERE status IN ('RUNNING','PREPARING') ORDER BY id DESC;"

# Stale detection: RUNNING exams with no recent result
kubectl exec -n etri deploy/backend -- psql $DATABASE_URL -c "
  SELECT e.id, e.gpu_type, e.started_at, MAX(r.created_at) as last_heartbeat
  FROM mp_exam e LEFT JOIN mp_exam_result r ON r.exam_id = e.id
  WHERE e.status='RUNNING'
  GROUP BY e.id HAVING MAX(r.created_at) < NOW() - INTERVAL '2 minutes' OR MAX(r.created_at) IS NULL;"
```
