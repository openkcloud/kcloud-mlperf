# Network and Storage Report

**Run ID:** 20260428-072038-a612a54
**Generated:** 2026-04-28T07:24:30Z

---

## NFS Configuration

### NFS Server: node2 (10.254.184.195)

node2 runs the NFS server (`nfsd` is mounted on `/proc/fs/nfsd`). It exports the following paths observed as active mounts:

| Export Path                                       | Purpose                    |
|---------------------------------------------------|----------------------------|
| `/mnt/models`                                     | Model files (shared RWX)   |
| `/mnt/datasets`                                   | Dataset files (shared RWX) |
| `/mnt/results`                                    | Results storage (RWX)      |
| `/mnt/etri-lllm-evaluation-nfs-server`            | NFS provisioner root       |
| `/mnt/etri-llm-evaluation-postgres`               | Postgres data (RWO)        |
| `/mnt/etri-lllm-evaluation-nfs-server/loki-*`     | Loki storage               |
| `/mnt/etri-lllm-evaluation-nfs-server/monitoring-*` | Prometheus storage       |

### NFS Mounts by Node

#### node1 (control-plane)
No NFS mounts observed. Control plane does not mount NFS volumes.

#### node2 (NFS server + client for its own exports)
```
nfsd on /proc/fs/nfsd type nfsd (rw,relatime)   [server daemon]
10.254.184.195:/mnt/etri-lllm-evaluation-nfs-server/loki-storage-loki-0-pvc-... → kubelet pod volume (NFSv4.2)
10.254.184.195:/mnt/models       → kubelet pod volume (NFSv4.2, rsize/wsize=1048576)
10.254.184.195:/mnt/datasets     → kubelet pod volume (NFSv4.2, rsize/wsize=1048576)
10.254.184.195:/mnt/results      → kubelet pod volume (NFSv4.2, rsize/wsize=1048576)
```

#### node3 (NFS client)
```
nfsd on /proc/fs/nfsd type nfsd (rw,relatime)   [nfsd loaded but serving node3 local exports]
10.254.184.195:/mnt/etri-llm-evaluation-postgres         → postgres-pv-volume (NFSv4.2)
10.254.184.195:/mnt/etri-lllm-evaluation-nfs-server      → nfs-provisioner root (NFSv4.2)
10.254.184.195:/mnt/etri-lllm-evaluation-nfs-server/monitoring-prometheus-server-pvc-... → prometheus storage (NFSv4.2)
10.254.184.195:/mnt/models    → kubelet pod volume (NFSv4.2)
10.254.184.195:/mnt/datasets  → kubelet pod volume (NFSv4.2)
10.254.184.195:/mnt/results   → kubelet pod volume (NFSv4.2)
```

#### node4 (NFS client — direct host mounts)
```
10.254.184.195:/mnt/models    → /mnt/models    (NFSv4.2, rsize/wsize=1048576)
10.254.184.195:/mnt/datasets  → /mnt/datasets  (NFSv4.2, rsize/wsize=1048576)
10.254.184.195:/mnt/results   → /mnt/results   (NFSv4.2, rsize/wsize=1048576)
```

Note: node4 mounts NFS paths directly at `/mnt/*` on the host (not just via kubelet), which makes them available to the NPU inference server outside of Kubernetes volume management.

All NFS mounts use NFSv4.2 with 1 MiB read/write block sizes, hard mount with TCP, timeo=600, retrans=2.

---

## Persistent Volumes (PVs)

```
NAME                                       CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM                            STORAGECLASS
dataset-nfs-pv                             2Ti        RWX            Retain           Bound    llm-evaluation/dataset-nfs-pvc   (manual)
model-nfs-pv                               2Ti        RWX            Retain           Bound    llm-evaluation/model-nfs-pvc     (manual)
postgres-pv-volume                         100Gi      RWO            Retain           Bound    llm-evaluation/postgres-pvc      (manual)
pvc-4e2ca941-...                           400Gi      RWO            Delete           Bound    monitoring/prometheus-server     nfs-client
pvc-846c2725-...                           500Gi      RWX            Delete           Bound    loki/storage-loki-0              nfs-client
results-nfs-pv                             2Ti        RWX            Retain           Bound    llm-evaluation/results-nfs-pvc   (manual)
```

**Total provisioned:** 3x 2TiB (6 TiB RWX) + 100 GiB + 400 GiB + 500 GiB ≈ 7 TiB total storage.

---

## Persistent Volume Claims (PVCs)

| Namespace      | PVC Name           | Status | Volume              | Capacity | Access | StorageClass |
|----------------|--------------------|--------|---------------------|----------|--------|--------------|
| llm-evaluation | dataset-nfs-pvc    | Bound  | dataset-nfs-pv      | 2Ti      | RWX    | (manual)     |
| llm-evaluation | model-nfs-pvc      | Bound  | model-nfs-pv        | 2Ti      | RWX    | (manual)     |
| llm-evaluation | postgres-pvc       | Bound  | postgres-pv-volume  | 100Gi    | RWO    | (manual)     |
| llm-evaluation | results-nfs-pvc    | Bound  | results-nfs-pv      | 2Ti      | RWX    | (manual)     |
| loki           | storage-loki-0     | Bound  | pvc-846c2725-...    | 500Gi    | RWX    | nfs-client   |
| monitoring     | prometheus-server  | Bound  | pvc-4e2ca941-...    | 400Gi    | RWO    | nfs-client   |

All PVCs are **Bound**. No unbound or pending claims.

---

## Storage Classes

| Name                 | Provisioner                                          | Reclaim  | Binding Mode        | Expand |
|----------------------|------------------------------------------------------|----------|---------------------|--------|
| local-path (default) | rancher.io/local-path                                | Delete   | WaitForFirstConsumer | false |
| nfs-client (default) | cluster.local/nfs-subdir-external-provisioner        | Delete   | Immediate           | true   |

Two storage classes are marked as default simultaneously (`local-path` and `nfs-client`). This dual-default configuration can cause ambiguity in dynamic provisioning — Kubernetes will use the last-created default when no storageClass is specified in a PVC.

---

## Network

### Primary Interface Speed per Node

| Node  | Interface       | Speed     | Notes                            |
|-------|-----------------|-----------|----------------------------------|
| node1 | eno1            | 1000 Mbps | 1 GbE                            |
| node2 | eno1            | 1000 Mbps | 1 GbE — NFS server node          |
| node3 | eno1            | 1000 Mbps | 1 GbE                            |
| node4 | enp90s0f0np0    | 10000 Mbps | 10 GbE — SR-IOV capable, NPU node |

node4 has a 10x faster uplink than the other nodes. This is advantageous for NFS model loading (large model files) to the RNGD NPU. The NFS server (node2) is on 1 GbE, so the effective throughput to node4 is capped at ~125 MB/s.

### CNI

Calico is in use (calico-node DaemonSet on all 4 nodes, calico-kube-controllers on node1).

### DNS

CoreDNS is serving cluster DNS (not `kube-dns`).

| Service    | Namespace   | Cluster-IP   | Ports                  |
|------------|-------------|--------------|------------------------|
| coredns    | kube-system | 10.233.0.3   | 53/UDP, 53/TCP, 9153/TCP |

Note: The service is named `coredns` (not `kube-dns`). DNS ClusterIP is `10.233.0.3`.

### Pod Network

Calico pod CIDR: `10.233.x.x` (observed from pod IPs). Node CIDR subnets:
- node1: 10.233.102.x
- node2: 10.233.75.x
- node3: 10.233.71.x
- node4: 10.233.74.x

---

## Anomalies

1. **Two default StorageClasses** (`local-path` and `nfs-client` are both marked default). Kubernetes behavior is undefined when multiple defaults exist — the admission controller may reject PVCs without an explicit storageClass. Recommend un-marking one.

2. **NFS server is also a worker node** (node2). The NFS server (`nfsd`) runs directly on node2, which also runs GPU workloads and app-chart services. This creates a single point of failure for all NFS-backed storage (6+ TiB of PVs).

3. **node4 NFS mounts are host-level** (not kubelet-managed). The paths `/mnt/models`, `/mnt/datasets`, `/mnt/results` are mounted directly on the node OS. If kubelet restarts or the host reboots, these may not automount without `/etc/fstab` entries or systemd mount units. Verify persistence configuration.

4. **NFS bottleneck**: node2 NFS server is 1 GbE. node4 (10 GbE) NPU inference server loads models over NFS — effective model-load throughput is capped by the server-side 1 GbE link (~125 MB/s). For large FP8 models this could be a significant bottleneck.
