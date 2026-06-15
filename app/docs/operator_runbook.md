# Operator Runbook

Operational procedures for the LLM evaluation platform running on Kubernetes in the ETRI cluster.

## Dashboard Access

- **Web UI**: `http://10.254.177.41:30001/`
- **Backend API**: `http://10.254.177.41:30980/api/`
- **Cluster**: 4 GPU SKUs across node2/node3 (L40, A40, L40-44GiB, A40-44GiB)

## Daily Health Check

1. **GPU Dashboard**: Visit `http://10.254.177.41:30001/dashboard/gpu-realtime`
   - 4 GPU devices show `idle`/`running`/`preparing`/`error`
   - SSE updates every 2s (timestamps change)
   - Sweep progress visible; no red alerts

2. **Check logs**: `kubectl logs -n llm-evaluation deployment/etri-llm-backend --tail=100 | grep -E "ERROR|5[0-9]{2}"`

3. **Exam queue**: Visit `/mlperf/` or `/mmlu/`
   - Exams progressing; none stuck >5 min in `Idle`
   - Failed exams show error messages

## Triaging a Failed Exam

### Step 1: Locate the Exam
1. Go to MLPerf or MMLU exam list
2. Filter or search for exam with `Status: Failed`
3. Click the exam row to open detail view

### Step 2: View Error Log
- Error message displays below the exam metadata
- Typical failures:
  - **"Operator race failed"** — GPU node did not pick up exam within 90s; sweep will retry with stagger
  - **"gRPC timeout"** — Evaluation service unreachable; check external service health
  - **"DB constraint violation"** — Data conflict; check backend logs

### Step 3: Check Backend Logs
```bash
kubectl logs -n llm-evaluation deployment/etri-llm-backend \
  --tail=500 | grep -i "exam-id-or-name"
```

### Step 4: Decide Action
- **Transient error** (network spike, pod restart) — Click "Retry" button if available
- **Persistent error** — Escalate to DevOps; do not retry exams repeatedly

## Sweep Operations

### Check Sweep Status
```bash
curl http://10.254.177.41:30980/api/gpu-sweep/status
# Returns: { enabled, active_sweep, node_state: { node2, node3 } }
```

### Pause Sweep (Allow Running Cells to Finish)
Navigate to `http://10.254.177.41:30001/dashboard/sweep-control` (admin-gated)

Or via API:
```bash
curl -X PATCH http://10.254.177.41:30980/api/gpu-sweep/pause/{sweep_id}
```

### Drain Sweep (Stop All Cells Immediately)
Via UI: Click "Drain" button on sweep-control page

Or via API (idempotent):
```bash
curl -X PATCH http://10.254.177.41:30980/api/gpu-sweep/drain/{sweep_id}
```

### Hide Sweep Runs from List (Demo Safety)
On MLPerf/MMLU exam list, toggle "Hide sweep runs" — hides all `[sweep:*]`-tagged exams from operators.

## Accessing Raw Artifacts

### View Exam Result Files
1. Go to exam detail page
2. Scroll to "Files" section
3. Download result JSON, metrics CSV, or logs

### Direct NFS Access (Advanced)
Exam results stored on NFS PVC mounted at:
```bash
/mnt/result/  # On backend pod
```

List exams and results:
```bash
kubectl exec -n llm-evaluation deployment/etri-llm-backend -- \
  ls -lh /mnt/result/ | head -20
```

## Rollback Procedures

### Application Rollback (Helm)
Revert to previous stable release:
```bash
# List recent releases
helm list -n llm-evaluation

# Rollback app-chart to previous version (e.g., v11)
helm rollback app-chart 4 -n llm-evaluation

# Verify rollback
kubectl rollout status deployment/etri-llm-backend -n llm-evaluation
```

### Database Rollback
Migrations located in `server/src/migrations/`:

1. **Check applied migrations**:
   ```bash
   kubectl exec -n llm-evaluation deployment/etri-llm-backend -- \
     npm run typeorm migration:show
   ```

2. **Revert last migration**:
   ```bash
   npm run typeorm migration:revert
   ```

3. **Revert specific migration** (if needed):
   - Edit `ormconfig.ts` migration path to exclude the target migration
   - Rebuild and redeploy

**Note**: Database rollback is destructive if migration has `dropColumn` or `dropTable`. Always backup before reverting.

### Frontend Cache Invalidation
Browsers may cache old frontend code. Tell operators to:
1. **Hard refresh**: `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)
2. **Clear service worker**: Open DevTools → Application → Service Workers → Unregister
3. **Clear site data**: DevTools → Application → Clear site data

## Common Gotchas

**Ampere FP8**: A40 SKUs lack FP8 tensor cores; sweep auto-excludes `fp8 + bs=4` on these.

**Operator race**: If exam stays `Idle` >90s, marked `OperatorRaceFailed`, re-queued with 60s stagger. After 10 races/hour, sweep auto-pauses.

**Quiet window**: If `QUIET_WINDOW_CRON` enabled, blocks dispatch 09:00–18:00 KST on demo days. Disable: `kubectl set env deployment/etri-llm-backend -n llm-evaluation QUIET_WINDOW_CRON=""`

**SSE cap**: 20 subscribers max; excess get `503 + X-Fallback: poll`, fall back to 5s polling.

## Emergency Procedures

**Scale down to pause**:
```bash
kubectl scale deployment/etri-llm-backend -n llm-evaluation --replicas=0
```

**Pod logs**: `kubectl logs -f -n llm-evaluation deployment/etri-llm-backend`

**Database backup**:
```bash
kubectl exec -n llm-evaluation deployment/postgres -- \
  pg_dump -U $DATABASE_USER $DATABASE_NAME > backup.sql
```

## Key Contacts
- **DevOps**: `/home/kcloud/etri-llm-deployments/app/scripts/17_rollback_last_change.sh` for infra rollback
- **Evaluation Service**: gRPC health check at `$GRPC_SERVICE_URL:50051`
