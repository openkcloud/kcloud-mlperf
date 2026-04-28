# Cluster Current State Report

**Run ID:** 20260428-072038-a612a54
**Generated:** 2026-04-28T07:24:30Z
**Cluster:** etri-llm-bench

---

## Kubernetes Version

```
Client Version: v1.28.12
Kustomize Version: v5.0.4-0.20230601165947-6ce0bf390ce3
Server Version: v1.28.12
```

---

## Cluster Info

```
Kubernetes control plane is running at https://127.0.0.1:6443
```

---

## Nodes

```
NAME    STATUS   ROLES           AGE   VERSION    INTERNAL-IP      EXTERNAL-IP   OS-IMAGE             KERNEL-VERSION       CONTAINER-RUNTIME
node1   Ready    control-plane   60d   v1.28.12   10.254.177.41    <none>        Ubuntu 22.04.5 LTS   5.15.0-161-generic   containerd://1.7.21
node2   Ready    <none>          60d   v1.28.12   10.254.184.195   <none>        Ubuntu 22.04.5 LTS   5.15.0-176-generic   containerd://1.7.21
node3   Ready    <none>          60d   v1.28.12   10.254.184.196   <none>        Ubuntu 22.04.5 LTS   5.15.0-176-generic   containerd://1.7.21
node4   Ready    <none>          7d    v1.28.12   10.254.202.114   <none>        Ubuntu 22.04.5 LTS   6.8.0-101-generic    containerd://1.7.21
```

All 4 nodes are in **Ready** state.

---

## Master / Control Plane: node1

### Capacity & Allocatable

| Resource          | Capacity        | Allocatable     |
|-------------------|-----------------|-----------------|
| cpu               | 96              | 95800m          |
| memory            | 263683520Ki     | 263056832Ki     |
| ephemeral-storage | 10401954720Ki   | 9586441454080   |
| pods              | 110             | 110             |
| hugepages-1Gi     | 0               | 0               |
| hugepages-2Mi     | 0               | 0               |

### System Info

| Field                    | Value                          |
|--------------------------|--------------------------------|
| OS Image                 | Ubuntu 22.04.5 LTS             |
| Kernel Version           | 5.15.0-161-generic             |
| Architecture             | amd64                          |
| Container Runtime        | containerd://1.7.21            |
| Kubelet Version          | v1.28.12                       |
| Kube-Proxy Version       | v1.28.12                       |
| CPU Vendor               | AMD (family 23, model 49)      |

### Taints

| Key                                       | Effect     |
|-------------------------------------------|------------|
| node-role.kubernetes.io/control-plane     | NoSchedule |

### Key Labels

- `node-role.kubernetes.io/control-plane`
- `node.kubernetes.io/exclude-from-external-load-balancers`
- `kubernetes.io/hostname: node1`

---

## Worker: node2 (NVIDIA GPU — 2x L40)

### Capacity & Allocatable

| Resource          | Capacity        | Allocatable     |
|-------------------|-----------------|-----------------|
| cpu               | 96              | 95900m          |
| memory            | 263681480Ki     | 263316936Ki     |
| nvidia.com/gpu    | 2               | 2               |
| ephemeral-storage | 10401954720Ki   | 9586441454080   |
| pods              | 110             | 110             |

### System Info

| Field                    | Value                          |
|--------------------------|--------------------------------|
| OS Image                 | Ubuntu 22.04.5 LTS             |
| Kernel Version           | 5.15.0-176-generic             |
| Architecture             | amd64                          |
| Container Runtime        | containerd://1.7.21            |
| Kubelet Version          | v1.28.12                       |
| CPU Vendor               | AMD (family 23, model 49)      |
| GPU Product (NFD)        | NVIDIA-L40                     |
| GPU Count (NFD)          | 2                              |
| CUDA Driver Version      | 580.126.09                     |
| GPU Memory               | 46068 MiB each                 |

### Taints

None.

### Key Labels

- `nvidia.com/gpu.product: NVIDIA-L40`
- `nvidia.com/gpu.count: 2`
- `nvidia.com/gpu.family: ada-lovelace`
- `nvidia.com/cuda.driver-version.full: 580.126.09`

---

## Worker: node3 (NVIDIA GPU — 2x A40)

### Capacity & Allocatable

| Resource          | Capacity        | Allocatable     |
|-------------------|-----------------|-----------------|
| cpu               | 16              | 15900m          |
| memory            | 263708148Ki     | 263343604Ki     |
| nvidia.com/gpu    | 2               | 2               |
| ephemeral-storage | 10401954720Ki   | 9586441454080   |
| pods              | 110             | 110             |

### System Info

| Field                    | Value                          |
|--------------------------|--------------------------------|
| OS Image                 | Ubuntu 22.04.5 LTS             |
| Kernel Version           | 5.15.0-176-generic             |
| Architecture             | amd64                          |
| Container Runtime        | containerd://1.7.21            |
| Kubelet Version          | v1.28.12                       |
| CPU Vendor               | AMD (family 23, model 49)      |
| GPU Product (NFD)        | NVIDIA-A40                     |
| GPU Count (NFD)          | 2                              |
| CUDA Driver Version      | 580.126.09                     |
| GPU Memory               | 46068 MiB each                 |

### Taints

None.

### Key Labels

- `nvidia.com/gpu.product: NVIDIA-A40`
- `nvidia.com/gpu.count: 2`
- `nvidia.com/gpu.family: ampere`
- `nvidia.com/cuda.driver-version.full: 580.126.09`

### Note — node3 CPU count anomaly

NFD reports `cpu: 16` (Allocatable: 15900m) vs node1/node2 which have 96 CPUs. This is likely correct hardware (different server CPU configuration) but is notable — node3 is running an 8-CPU-request mlperf workload consuming 52% of CPU capacity.

---

## Worker: node4 (FuriosaAI RNGD NPU)

### Capacity & Allocatable

| Resource          | Capacity        | Allocatable     |
|-------------------|-----------------|-----------------|
| cpu               | 128             | 128             |
| memory            | 528008840Ki     | 527906440Ki     |
| furiosa.ai/rngd   | 1               | 1               |
| ephemeral-storage | 1844296244Ki    | 1699703415657   |
| pods              | 110             | 110             |

### System Info

| Field                    | Value                          |
|--------------------------|--------------------------------|
| OS Image                 | Ubuntu 22.04.5 LTS             |
| Kernel Version           | 6.8.0-101-generic              |
| Architecture             | amd64                          |
| Container Runtime        | containerd://1.7.21            |
| Kubelet Version          | v1.28.12                       |
| CPU Vendor               | Intel (family 6, model 207)    |
| NPU Family               | rngd                           |
| NPU Count                | 1                              |
| FuriosaAI Driver         | 2026.1.0 (96977d5)             |
| FuriosaAI Firmware       | 1.11.0 (cfd5306)               |

### Taints

None.

### Key Labels

- `furiosa.ai/npu: true`
- `furiosa.ai/npu.family: rngd`
- `furiosa.ai/npu.product: rngd`
- `furiosa.ai/npu.count: 1`
- `furiosa.ai/driver.version: 2026.1.0`
- `furiosa.ai/firmware.version: 1.11.0`
- `accelerator: furiosa-rngd`
- `feature.node.kubernetes.io/network-sriov.capable: true`

---

## Namespaces and Pod Tally

### Pod count per namespace

| Namespace           | Pod Count | Notes                                      |
|---------------------|-----------|--------------------------------------------|
| default             | 2         | 2x node-debugger (Error/Completed)         |
| furiosa-system      | 7         | All Running                                |
| gpu-operator        | 17        | All Running or Completed                   |
| kube-system         | 15        | All Running                                |
| llm-evaluation      | 10        | Mix: Running, Completed                    |
| local-path-storage  | 1         | Running                                    |
| loki                | 1         | Running                                    |
| monitoring          | 4         | Running                                    |
| nfs-provisioner     | 1         | Running                                    |

**Total:** ~68 pods across all namespaces.

### llm-evaluation namespace detail

| Pod                          | Status    | Node  | Notes                            |
|------------------------------|-----------|-------|----------------------------------|
| etri-llm-api                 | Running   | node3 | API server                       |
| etri-llm-backend             | Running   | node2 | Deployed 23m ago (fresh deploy)  |
| etri-llm-db                  | Running   | node3 | Postgres DB                      |
| etri-llm-frontend            | Running   | node2 | Deployed 23m ago (fresh deploy)  |
| etri-llm-operator            | Running   | node3 | Operator                         |
| gpu-bench-a40                | Completed | node3 | Benchmark completed 6d6h ago     |
| gpu-bench-l40                | Completed | node2 | Benchmark completed 6d6h ago     |
| mlperf-131-1-1-npr7b         | Running   | node3 | MLPerf job — 8 CPUs / 64Gi RAM  |
| npu-all-benchmarks           | Completed | node4 | NPU benchmark completed 6d8h ago |
| npu-inference-server-node4   | Running   | node4 | NPU inference server (43m old)   |

---

## Helm Releases

| Name                            | Namespace       | Revision | Status   | Chart                                | App Version |
|---------------------------------|-----------------|----------|----------|--------------------------------------|-------------|
| alloy                           | monitoring      | 1        | deployed | alloy-1.4.0                          | v1.11.3     |
| app-chart                       | llm-evaluation  | 5        | deployed | app-chart-0.1.0                      | 1.16.0      |
| furiosa-device-plugin           | furiosa-system  | 1        | deployed | furiosa-device-plugin-2026.1.0       | 2026.1.0    |
| furiosa-feature-discovery       | furiosa-system  | 2        | deployed | furiosa-feature-discovery-2026.1.0   | 2026.1.0    |
| gpu-operator                    | gpu-operator    | 1        | deployed | gpu-operator-v1.0.0-devel            | main-latest |
| loki                            | loki            | 1        | deployed | loki-2.1.1                           | v2.0.0      |
| nfs-subdir-external-provisioner | nfs-provisioner | 1        | deployed | nfs-subdir-external-provisioner-4.0.18 | 4.0.2    |
| prometheus                      | monitoring      | 1        | deployed | prometheus-27.42.2                   | v3.7.3      |

app-chart is at revision 5 — most recently updated (deployed 2026-04-28T06:59:32Z, ~25 min before this run).

---

## Anomalies

1. **node3 CPU count is 16** vs node1/node2 at 96. This is a hardware difference (not a Kubernetes misconfiguration) but is worth noting since mlperf pod requests 8 CPUs = 52% of node3's allocatable.

2. **node-debugger pods in `default` namespace** — two pods with Error/Completed status on node2. These appear to be leftover debug pods from a previous investigation (~29h ago). Not cleaning up automatically.

3. **kube-controller-manager has 3762 restarts** and kube-scheduler has 3759 restarts on node1. This is high and suggests either frequent evictions or an ongoing stability issue with the control plane components.

4. **gpu-operator-node-feature-discovery-worker** on node2 (97 restarts) and node3 (100 restarts) are restart-looping. The workers on node4 and node1 are stable. Possible cause: NFD worker DaemonSet misconfiguration for GPU-only nodes.

5. **node4 has smaller root disk** (~1.8 TiB vs ~10 TiB for node1/2/3). This is likely intentional (RNGD node has less local storage; models/datasets accessed via NFS).

6. **node4 network interface is 10GbE** (enp90s0f0np0 @ 10000 Mbps) vs node1/2/3 which are 1GbE (eno1 @ 1000 Mbps). node4 has faster network, which benefits NFS-based model loading.

7. **app-chart revision 5 deployed within last 30 minutes** — etri-llm-backend and etri-llm-frontend both show 23m age, consistent with a very recent rollout. Monitor for stability.

8. **npu-inference-server-node4 is 43 minutes old** — recently restarted or newly launched NPU inference server. Monitor for stability.
