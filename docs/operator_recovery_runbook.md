# Operator Recovery Runbook

Emergency procedures for when nodes go NotReady, device plugins crash, or the application needs rollback.

## Quick Reference

| Problem | Quick Fix | Detailed Section |
|---------|-----------|-------------------|
| Node in NotReady | Check kubelet: `systemctl status kubelet` on node | [Node NotReady](#node-notready) |
| Device plugin pod crashed | Restart daemonset: `kubectl rollout restart daemonset/<plugin> -n <ns>` | [Device Plugin Crash](#device-plugin-crash) |
| Backend broken; need rollback | Helm rollback: `helm rollback app-chart -n llm-evaluation` | [Helm Rollback](#helm-rollback) |
| Database migration failed | Revert last migration: `npm run typeorm migration:revert` | [Database Rollback](#database-rollback) |
| Image broken; need version rollback | `kubectl set image deployment/etri-llm-backend ... backend=<old-image:tag>` | [Image Rollback](#image-rollback) |
| Scale down to pause all workloads | `kubectl scale deployment/etri-llm-backend -n llm-evaluation --replicas=0` | [Emergency Pause](#emergency-pause) |

---

## Node NotReady

### Symptoms

```bash
kubectl get nodes
# STATUS: NotReady for one or more nodes
```

### Diagnosis

Check node conditions:
```bash
kubectl describe node <node-name>
# Look for conditions with Status=False
# Examples: Ready=False, MemoryPressure=True, DiskPressure=True
```

SSH to the node and check kubelet:
```bash
ssh kcloud@<node-ip>
sudo systemctl status kubelet
sudo journalctl -xeu kubelet | tail -100
```

### Common Causes and Fixes

**Kubelet Service Stopped**

```bash
# On the node
sudo systemctl start kubelet
sudo systemctl status kubelet
# Should show: active (running)
```

**Kubelet Logs Show "API Server Unreachable"**

```bash
# On the control plane, verify API server is running
kubectl get pods -n kube-system | grep apiserver

# On the node, verify DNS resolution
nslookup <control-plane-ip>
ping <control-plane-ip>
```

**Disk Pressure**

```bash
# On the node
df -h /  # Check root filesystem
df -h /var/lib/kubelet  # Check kubelet data dir

# Clean up old images/containers if needed
docker image prune -a -f
docker container prune -f
```

**Memory Pressure**

```bash
# On the node
free -h
top -b -n 1 | head -20

# Kill memory-intensive processes if safe
sudo pkill -f <process-name>
```

**CNI Network Plugin Not Ready**

```bash
# On control plane, check CNI pods
kubectl get pods -n kube-system | grep -E "cni|weave|flannel|calico"

# If CNI pod is not Running, check its logs
kubectl logs -n kube-system <cni-pod-name>

# Restart CNI daemonset
kubectl rollout restart daemonset/<cni-name> -n kube-system
```

### Recovery

After fixing the underlying issue, the node should return to Ready within 1-2 minutes:

```bash
# Watch node status
kubectl get nodes -w

# Or wait with timeout
kubectl wait --for=condition=Ready node/<node-name> --timeout=120s
```

If node still NotReady after 2 minutes:
1. Check kubelet logs again: `sudo journalctl -xeu kubelet | tail -50`
2. Restart kubelet: `sudo systemctl restart kubelet`
3. Check API server connectivity from the node
4. If persistent, escalate to cluster admin

---

## Device Plugin Crash

### Symptoms

Device plugin pod shows `CrashLoopBackOff` or `Error`:

```bash
kubectl get pods -n kube-system -l k8s-app=nvidia-device-plugin
# or
kubectl get pods -n furiosa-system -l app.kubernetes.io/name=furiosa-device-plugin
kubectl get pods -n furiosa-system -l app.kubernetes.io/name=rebellions-atomplus-device-plugin
```

Device resource not advertised in allocatable:

```bash
kubectl get node node2 -o jsonpath='{.status.allocatable}' | grep -i nvidia
# Empty if plugin crashed
```

### Diagnosis

Check pod logs:
```bash
kubectl logs -n kube-system <pod-name> --tail=100
# or
kubectl logs -n furiosa-system <pod-name> --tail=100
```

Common error patterns:
- `image pull error`: Check image registry, credentials, network
- `device not found`: Check `lspci` on node for device
- `permission denied`: Check device node permissions on host
- `mount failed`: Check /dev access in container spec

Check pod events:
```bash
kubectl describe pod -n kube-system <pod-name>
# Look for events with warnings/errors
```

### Recovery

**Restart Device Plugin DaemonSet**

```bash
# NVIDIA (GPU)
kubectl rollout restart daemonset nvidia-device-plugin -n kube-system

# Furiosa (RNGD)
kubectl rollout restart daemonset furiosa-device-plugin -n furiosa-system

# Rebellions (Atom+)
kubectl rollout restart daemonset rebellions-atomplus-device-plugin -n furiosa-system
```

Wait for pods to be Ready:
```bash
kubectl rollout status daemonset <plugin-name> -n <namespace> --timeout=120s
```

Verify resource advertised:
```bash
# GPU
kubectl get node node2 -o jsonpath='{.status.allocatable.["nvidia.com/gpu"]}'

# RNGD
kubectl get node node4 -o jsonpath='{.status.allocatable.["furiosa.ai/warboy"]}'

# Atom+
kubectl get node node5 -o jsonpath='{.status.allocatable.["rebellions.ai/atomplus"]}'
```

**If Restart Fails**

Check image availability:
```bash
docker pull <device-plugin-image:tag>  # On the node
```

Check node has required labels:
```bash
kubectl get node node2 --show-labels | grep gpu
# Should have gpu=true or similar selector
```

If node not labeled:
```bash
kubectl label node node2 gpu=true --overwrite
kubectl rollout restart daemonset nvidia-device-plugin -n kube-system
```

---

## Helm Rollback

When the application is broken and needs to revert to a previous release.

### Check Release History

```bash
helm list -n llm-evaluation
# Output: NAME | NAMESPACE | REVISION | STATUS | CHART | APP VERSION | UPDATED

helm history app-chart -n llm-evaluation
# Shows all revisions with timestamps
```

### Rollback to Previous Revision

```bash
# Rollback to previous release (auto-detects last good revision)
helm rollback app-chart -n llm-evaluation

# Or rollback to specific revision (e.g., revision 4)
helm rollback app-chart 4 -n llm-evaluation

# Watch rollback progress
kubectl rollout status deployment/etri-llm-backend -n llm-evaluation --timeout=300s
```

### Verify Rollback

```bash
# Check pod status
kubectl get pods -n llm-evaluation

# Check if backend is healthy
curl -s http://10.254.177.41:30980/health | jq '.'

# Check frontend loads
curl -s http://10.254.177.41:30001/ | head -20
```

### Rollback Risks

- **Database migrations**: If new revision had migrations, rollback may leave database in inconsistent state
  - Solution: Run `npm run typeorm migration:revert` to undo migrations
- **Breaking API changes**: Old frontend may not work with new backend
  - Solution: Hard refresh frontend cache (Ctrl+Shift+R)
- **Data loss**: If previous revision used different data model
  - Solution: Check database backup before rolling back

---

## Database Rollback

Revert TypeORM migrations if a migration introduced a breaking change.

### Check Applied Migrations

```bash
kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- \
  npm run typeorm migration:show
```

Example output:
```
Migrations:
  ✓ 1681234567890-InitialMigration
  ✓ 1681234568001-AddExamsTable
  ✓ 1681234569112-AddDeviceComparison
```

### Revert Last Migration

```bash
kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- \
  npm run typeorm migration:revert
```

Check reverted:
```bash
kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- \
  npm run typeorm migration:show
# Last migration should now be unmarked
```

### Revert Specific Migration

If you need to revert a migration from the middle of the chain:

```bash
# 1. Revert all migrations after the target migration
for i in {1..5}; do
  kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- \
    npm run typeorm migration:revert || break
done

# 2. Rebuild application (ormconfig.ts specifies migration paths)
kubectl set image deployment/etri-llm-backend -n llm-evaluation \
  backend=<image>:<new-tag>

# 3. Verify migrations
kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- \
  npm run typeorm migration:show
```

### Database Backup Before Revert

**Critical**: Backup before reverting destructive migrations (dropColumn, dropTable).

```bash
# Backup current state
kubectl exec -it deployment/postgres -n llm-evaluation -- \
  pg_dump -U $DATABASE_USER $DATABASE_NAME > etri_llm_db_backup_$(date +%s).sql

# Verify backup
ls -lh etri_llm_db_backup_*.sql
file etri_llm_db_backup_*.sql
```

Restore if revert fails:
```bash
kubectl exec -it deployment/postgres -n llm-evaluation -- \
  psql -U $DATABASE_USER -d $DATABASE_NAME < etri_llm_db_backup_*.sql
```

---

## Image Rollback

Revert to a previous Docker image if the latest image is broken.

### Check Current Image

```bash
kubectl get deployment etri-llm-backend -n llm-evaluation \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
# Output: jungwooshim/etri-cloud-backend:v15
```

### Rollback to Previous Image

```bash
# Get available images/tags
docker image ls | grep etri-cloud-backend

# Rollback
kubectl set image deployment/etri-llm-backend \
  -n llm-evaluation \
  backend=jungwooshim/etri-cloud-backend:v14

# Watch rollout
kubectl rollout status deployment/etri-llm-backend -n llm-evaluation --timeout=120s
```

### Frontend Image Rollback

```bash
kubectl set image deployment/etri-llm-frontend \
  -n llm-evaluation \
  frontend=jungwooshim/etri-cloud-frontend:v14

kubectl rollout status deployment/etri-llm-frontend -n llm-evaluation --timeout=120s
```

### Verify Image Change

```bash
kubectl get deployment etri-llm-backend -n llm-evaluation \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Check pod is running new image
kubectl get pods -n llm-evaluation -o wide
```

---

## Emergency Pause

Stop all workloads immediately without draining.

### Scale Down Backend

```bash
# Scale to 0 replicas (stops all backend pods)
kubectl scale deployment/etri-llm-backend \
  -n llm-evaluation \
  --replicas=0

# Verify
kubectl get pods -n llm-evaluation | grep backend
# Should show 0/0 ready
```

### Pause GPU Sweep

```bash
curl -X PATCH http://10.254.177.41:30980/api/gpu-sweep/pause/1
```

Or via UI: `/dashboard/sweep-control` → "Pause Sweep"

### Drain GPU Sweep

If pause not enough, drain (cancel all jobs):

```bash
curl -X PATCH http://10.254.177.41:30980/api/gpu-sweep/drain/1
```

### Resume After Fix

Scale backend back up:
```bash
kubectl scale deployment/etri-llm-backend \
  -n llm-evaluation \
  --replicas=3

kubectl rollout status deployment/etri-llm-backend -n llm-evaluation --timeout=120s
```

---

## Branch Revert

If code changes broke the application and Helm rollback isn't enough.

### Get Commit Hash of Broken Version

```bash
git log --oneline | head -10
```

### Revert to Previous Commit

```bash
# Create rollback commit (preferred over force-push)
git revert HEAD

# Push
git push origin main
```

### Rebuild and Redeploy

```bash
# Build new image from reverted code
./docker-push-simple.sh

# Update image tag in Helm values
helm upgrade app-chart <chart-path> \
  -n llm-evaluation \
  --set image.tag=v14

# Verify rollout
kubectl rollout status deployment/etri-llm-backend -n llm-evaluation --timeout=120s
```

---

## Infra Rollback Script

For infrastructure-level changes (Helm chart, Kubernetes manifests):

```bash
bash /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/scripts/17_rollback_last_change.sh
```

This script:
1. Reverts Helm chart to previous version
2. Reverts Kubernetes manifests (if in Git)
3. Restarts affected pods
4. Waits for rollout completion

---

## Emergency Contacts

| Category | Action |
|----------|--------|
| **Node hardware failure** | Escalate to cluster admin; may require physical intervention |
| **Database corruption** | Restore from backup; check `etri_llm_db_backup_*.sql` |
| **Persistent rollback failures** | Check Helm history limit; may need to clean old revisions |
| **Device plugin vendor issue** | Check vendor device plugin documentation; escalate if unresolved |

---

## Prevention Checklist

- [ ] Test migrations on staging cluster before production
- [ ] Keep at least 3 Helm revisions for rollback
- [ ] Daily database backups: `pg_dump ... > backup.sql`
- [ ] Monitor node health: `kubectl get nodes -w`
- [ ] Monitor device plugin status: `kubectl get pods -n kube-system` / `furiosa-system`
- [ ] Verify API health: `curl http://<ip>:30980/health`
- [ ] Test rollback procedure monthly

---

## Troubleshooting Rollback

### Rollback Hangs

Check if pods are stuck in `Terminating`:
```bash
kubectl get pods -n llm-evaluation
# If stuck, force delete:
kubectl delete pod <pod-name> -n llm-evaluation --grace-period=0 --force
```

### Pod CrashLoops After Rollback

```bash
kubectl logs -f deployment/etri-llm-backend -n llm-evaluation

# Common causes:
# 1. Database schema mismatch — run migration revert
# 2. Environment variables removed — check ConfigMap
# 3. PVC mount issue — check storage availability
```

### Helm Rollback Fails

```bash
# List helm resources
helm list -a -n llm-evaluation

# Force rollback
helm rollback app-chart -n llm-evaluation --force --wait=false

# Check hooks
kubectl get pods -n llm-evaluation -l app=app-chart
```

---

**See Also**:
- `docs/operator_runbook.md` — Daily operations
- `docs/node5_atomplus_runbook.md` — Node5 join and rollback
- `docs/dashboard_troubleshooting.md` — Dashboard-specific diagnostics
