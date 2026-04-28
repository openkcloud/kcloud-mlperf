# Operator Runbook: Cluster Migration to New Site / Control Plane

## Overview

This runbook describes how to migrate the entire ETRI LLM benchmark cluster to a new physical site, new control plane, or new Kubernetes cluster while preserving all persistent data (results, configurations, credentials).

## Pre-Migration: Inventory and Backup

### 1. Document Current State

```bash
# Capture cluster inventory:
cp config/cluster.yaml backups/cluster-inventory-$(date +%Y%m%d).yaml

# Export helm releases:
helm list -A > backups/helm-releases-$(date +%Y%m%d).txt
helm get values etri-llm -n llm-evaluation > backups/helm-values-$(date +%Y%m%d).yaml

# Export kubernetes secrets (encrypted):
kubectl get secret -n llm-evaluation -o yaml > backups/secrets-$(date +%Y%m%d).yaml
# IMPORTANT: Keep this file secure (store in vault, not in git)

# Export node labels and taints:
for node in $(kubectl get nodes -o name); do
  kubectl describe $node > backups/node-describe-$(basename $node)-$(date +%Y%m%d).txt
done
```

### 2. Snapshot Results NFS

All benchmark results and persistent data live on NFS (mounted at `/mnt/nfs`). Take a snapshot or full copy:

```bash
# Via rsync from control plane:
ssh kcloud@<control-plane-ip> sudo rsync -avz /mnt/nfs/results/ /mnt/backup/etri-results-$(date +%Y%m%d)/

# Via direct SCP (if NFS is exported via SMB/NFS to your workstation):
rsync -avz /mnt/nfs/results/ ./etri-results-backup-$(date +%Y%m%d)/

# Verify backup completeness:
du -sh ./etri-results-backup-$(date +%Y%m%d)/
```

### 3. Export PVC Snapshots

If using Kubernetes persistent volumes (PVCs) for databases or config:

```bash
# Snapshot all PVCs:
for pvc in $(kubectl get pvc -n llm-evaluation -o name); do
  kubectl create volumesnapshot \
    --source-pvc=$(basename $pvc) \
    -n llm-evaluation \
    snapshot-$(basename $pvc)-$(date +%Y%m%d)
done

# Verify snapshots:
kubectl get volumesnapshot -n llm-evaluation
```

## Migration: Setup New Cluster

### 1. Provision New Control Plane and Nodes

**On new hardware/site:**
- Prepare physical nodes (power, networking, SSH access)
- Ensure consistent network naming (same IPs if possible, or update config/cluster.yaml)

### 2. Bootstrap All New Nodes

```bash
# From your operator workstation:
for host in <list-of-new-node-ips>; do
  scp scripts/bootstrap-node.sh kcloud@$host:/tmp/
  ssh -p 122 kcloud@$host sudo /tmp/bootstrap-node.sh
done
```

### 3. Create Kubespray Inventory for New Cluster

Copy the old inventory and update IP addresses:

```bash
cp kubespray/inventory/etri/hosts.yml \
   kubespray/inventory/etri-new/hosts.yml

# Edit the file with new IPs:
vim kubespray/inventory/etri-new/hosts.yml
# Update: [all:vars], ansible_host entries, etc.
```

### 4. Deploy New Kubernetes Cluster

```bash
cd kubespray
ansible-playbook -i inventory/etri-new/hosts.yml cluster.yml
```

Wait for completion (~30 min). Then:

```bash
# Copy admin.conf from control plane:
scp kcloud@<new-control-plane-ip>:/etc/kubernetes/admin.conf ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config

# Verify:
kubectl cluster-info
kubectl get nodes
```

### 5. Deploy Infrastructure Components

```bash
cd kubernetes

bash 02-deploy-nfs-provisioner.sh
bash 03-deploy-gpu-operator.sh
bash 04-deploy-loki.sh
bash 05-deploy-prometheus.sh
bash 06-deploy-alloy.sh

# Verify all pods are running:
kubectl get pods -n monitoring
kubectl get pods -n loki
```

## Restore: Persistent Data and Applications

### 1. Restore Results NFS

Mount NFS and copy results back:

```bash
# Option A: If NFS is on new hardware, copy results to the new NFS mount:
ssh kcloud@<new-control-plane-ip>
sudo mkdir -p /mnt/nfs/results
sudo rsync -avz /mnt/backup/etri-results-$(date +%Y%m%d)/ /mnt/nfs/results/

# Option B: If NFS is unchanged (e.g., external storage), update mount points in PVC:
# Edit kubernetes/nfs-subdir-external-provisioner-*/values.yaml to point to new NFS server IP
```

Verify restoration:

```bash
kubectl get pvc -n llm-evaluation
kubectl describe pvc etri-results -n llm-evaluation
```

### 2. Restore PVC Data from Snapshots

If you took snapshots in step 3 above:

```bash
# For each snapshot, create a new PVC pointing to it:
kubectl create -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: etri-results-restored
  namespace: llm-evaluation
spec:
  dataSource:
    name: snapshot-etri-results-<date>
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteMany
  storageClassName: nfs-client
  resources:
    requests:
      storage: 100Gi
EOF

# Verify data integrity:
kubectl exec -it deployment/etri-llm-backend -n llm-evaluation -- \
  ls -la /workspace/results/ | head -20
```

### 3. Restore Kubernetes Secrets

Secrets (Docker pull credentials, API keys, etc.) were backed up encrypted:

```bash
# Restore from backup:
kubectl apply -f backups/secrets-$(date +%Y%m%d).yaml

# Verify:
kubectl get secrets -n llm-evaluation
kubectl describe secret image-pull-secret -n llm-evaluation
```

### 4. Deploy Application

```bash
cd scripts

# Update values.yaml if image tags changed:
# (Usually not needed; helm chart still references the same v12 or v13 tag)

bash 09_deploy_app_chart.sh

# Verify deployment:
kubectl get deploy -n llm-evaluation
kubectl logs -n llm-evaluation deploy/etri-llm-backend -f
```

### 5. Verify Data Accessibility

Test that frontend can access migrated data:

```bash
# Query a past exam:
curl http://<new-backend-host>/api/mp-exam/1  # (assuming exam ID 1 exists)

# Or via frontend:
open http://<new-frontend-host>/mlperf/main
# Browse exams; you should see all historical exams
```

## Post-Migration: Validation and Cleanup

### 1. Run Sanity Benchmarks

Deploy a small (quick) benchmark to verify the new cluster is functional:

```bash
# Run a single MLPerf accuracy repetition (smaller dataset):
bash scripts/12_run_mlperf_accuracy.sh --data-samples 100 --retry 1
```

Wait for completion (~15 min). Then:

```bash
# Verify results are written and accessible:
ls -la results/$(date +%Y%m%d)/mlperf/
curl http://<new-backend-host>/api/realtime/exams/health
```

### 2. Validate Logs and Monitoring

Check that Loki is collecting logs from new cluster:

```bash
# Query Loki for recent logs:
curl 'http://<loki-host>/loki/api/v1/query_range?query={job="etri-benchmark"}&start=<now-1h>&end=<now>'

# Or via Grafana:
open http://<grafana-host>/d/etri-cluster-status
```

Confirm dashboards show live data from new cluster.

### 3. DNS and External Access

If using DNS names (e.g., `etri-llm.example.com`):

```bash
# Update DNS records to point to new frontend/backend IPs:
nslookup etri-llm.example.com  # Should resolve to new IP

# Or update /etc/hosts on your workstation:
echo "<new-frontend-ip> etri-llm.example.com" | sudo tee -a /etc/hosts
```

### 4. Cleanup Old Cluster (Optional)

Once new cluster is validated and running for ≥24 hours without issues:

```bash
# Preserve backups in a safe location (off-site or vault):
tar -czf backups/etri-cluster-state-pre-migration-$(date +%Y%m%d).tar.gz \
  backups/ config/ kubernetes/

# Optionally decommission old cluster:
# (Keep documentation; may be useful for future reference)
for node in <list-of-old-node-ips>; do
  ssh kcloud@$node sudo poweroff  # Or leave powered, depending on datacenter policy
done
```

## Troubleshooting: Common Migration Issues

| Symptom | Likely Cause | Fix |
|---------|---|---|
| `kubectl get nodes` shows NotReady | Containerd not configured on new nodes | Re-run bootstrap-node.sh on affected node |
| NFS PVC stuck Pending | NFS server IP not reachable or export not shared | Verify NFS server IP in values.yaml; check firewall/routing |
| Pods can't pull images | Old registry credentials don't work on new cluster | Update image-pull-secret with new Docker Hub token |
| Helm deploy fails: "release already exists" | Helm release name conflict with old cluster | `helm delete etri-llm -n llm-evaluation` then re-run install |
| Database (if used) shows stale data | PVC not restored or wrong snapshot selected | Verify PVC data source points to correct snapshot |
| Frontend shows "No exams found" | Database empty or not connected | Check backend logs: `kubectl logs deploy/etri-llm-backend` |
| Loki logs are empty | Logs not reaching new Loki instance | Verify alloy is running and configured with new Loki endpoint |

## Rollback to Old Cluster (If Issues)

If the new cluster is unstable:

```bash
# Revert DNS to point back to old cluster:
nslookup etri-llm.example.com  # Should resolve to old IP

# Inform users:
echo "Migration reverted; using old cluster temporarily" | mail -s "ETRI Cluster Status" team@example.com

# Investigate new cluster issues offline before re-attempting migration
```

## Migration Checklist

- [ ] Inventory and backups created: cluster.yaml, helm values, secrets, node labels
- [ ] Results NFS copied to safe location
- [ ] PVC snapshots taken
- [ ] New hardware provisioned and networked
- [ ] All nodes bootstrapped with bootstrap-node.sh
- [ ] Kubespray inventory updated with new IPs
- [ ] New Kubernetes cluster deployed
- [ ] Infrastructure (NFS, GPU operator, Loki, etc.) deployed
- [ ] Results data restored to new NFS
- [ ] Secrets restored to new cluster
- [ ] Application deployed and running
- [ ] Sanity benchmark completed successfully
- [ ] Historical exams visible in frontend
- [ ] DNS updated (if applicable)
- [ ] Monitoring and logs verified
- [ ] Old cluster decommissioned (optional)
