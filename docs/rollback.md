# Rollback Guide

Application-level rollback procedures for the LLM evaluation platform. Distinct from infrastructure rollback (see `/home/kcloud/etri-llm-deployments/app/scripts/17_rollback_last_change.sh`).

## Helm Rollback

Revert to previous stable application release without infrastructure changes.

### List Recent Releases
```bash
helm list -n llm-evaluation
# Output:
# NAME       NAMESPACE       REVISION  UPDATED     STATUS
# app-chart  llm-evaluation  12        2026-04-28  deployed
```

### Rollback to Previous Version
```bash
# Rollback one release back (from revision 12 → 11)
helm rollback app-chart -n llm-evaluation

# Rollback to specific revision (e.g., revision 4 = v11)
helm rollback app-chart 4 -n llm-evaluation

# Verify rollback in progress
kubectl rollout status deployment/etri-llm-backend -n llm-evaluation
```

### Verify Rollback Success
```bash
# Check pod is running
kubectl get pods -n llm-evaluation | grep etri-llm

# Check logs for startup errors
kubectl logs -n llm-evaluation deployment/etri-llm-backend --tail=50

# Test API endpoint
curl http://10.254.177.41:30980/api/health
```

## Database Rollback

Migrations in `server/src/migrations/`.

**List applied migrations**: `kubectl exec -n llm-evaluation deployment/etri-llm-backend -- npm run typeorm migration:show`

**Revert last migration**: `npm run typeorm migration:revert`

**Revert step=N**: `npm run typeorm migration:revert -- --step=3`

**Backup before revert**:
```bash
kubectl exec -n llm-evaluation deployment/postgres -- \
  pg_dump -U $DATABASE_USER $DATABASE_NAME > backup.sql
```

**Risk**: Revert with `dropColumn` loses data. Only rollback if feature not yet used.

## Frontend Cache Invalidation

After rollback, operators may see stale UI. Tell them to hard-refresh: `Ctrl+Shift+R` or `Cmd+Shift+R` + clear service worker in DevTools.

## Per-Feature Rollback

**Disable GPU Sweep** (without full rollback): `kubectl set env deployment/etri-llm-backend -n llm-evaluation GPU_SWEEP_ENABLED=false`

**Force SSE → poll fallback**: `kubectl scale deployment/etri-llm-realtime -n llm-evaluation --replicas=0`

## Kubectl Rollback (if not using Helm)

**View history**: `kubectl rollout history deployment/etri-llm-backend -n llm-evaluation`

**Undo last**: `kubectl rollout undo deployment/etri-llm-backend -n llm-evaluation`

## Post-Rollback Checklist

- [ ] Health check endpoint returns 200
- [ ] Exam list page loads and displays exams
- [ ] Real-time dashboard shows GPU devices
- [ ] No 5xx errors in pod logs
- [ ] Database migration was compatible with previous code
- [ ] Frontend cache cleared for operators
- [ ] Monitor metrics (CPU, memory, request latency) for 5 minutes

## Emergency: Complete Infra Rollback

If application rollback fails or introduces worse problems:

```bash
# Stop the app entirely
kubectl scale deployment/etri-llm-backend -n llm-evaluation --replicas=0

# Run infra rollback script (escalate to DevOps)
/home/kcloud/etri-llm-deployments/app/scripts/17_rollback_last_change.sh
```

This reverts Helm chart, cluster configuration, and database migrations to the previous consistent state.

**Time to recover**: ~5 minutes
**Data loss risk**: Minimal if rollback is within 1 hour of problem
