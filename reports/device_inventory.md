# Device Inventory Report

**Run ID:** 20260428-072038-a612a54
**Generated:** 2026-04-28T07:24:30Z

---

## node2 — NVIDIA GPU (2x L40)

### nvidia-smi -L

```
GPU 0: NVIDIA L40 (UUID: GPU-[REDACTED])
GPU 1: NVIDIA L40 (UUID: GPU-[REDACTED])
```

### nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv

```
name, driver_version, memory.total [MiB]
NVIDIA L40, 580.126.09, 46068 MiB
NVIDIA L40, 580.126.09, 46068 MiB
```

### Summary

| Field               | Value           |
|---------------------|-----------------|
| Device count        | 2               |
| Model               | NVIDIA L40      |
| GPU Family          | Ada Lovelace    |
| Compute Capability  | 8.9             |
| Memory per GPU      | 46068 MiB (~45 GiB) |
| Driver version      | 580.126.09      |
| CUDA runtime        | 13.0            |

### Kubelet Device Plugin Status (gpu-operator namespace)

| Pod                                  | Status    | Age  |
|--------------------------------------|-----------|------|
| nvidia-device-plugin-daemonset-rg5qb | Running   | 60d  |
| nvidia-container-toolkit-daemonset-v9bjb | Running | 60d |
| nvidia-dcgm-exporter-t62kf           | Running   | 60d  |
| nvidia-operator-validator-gh7gr      | Running   | 60d  |
| gpu-feature-discovery-c74b2          | Running   | 60d  |
| nvidia-cuda-validator-l2rgd          | Completed | 7d   |

All GPU operator components on node2 are healthy.

---

## node3 — NVIDIA GPU (2x A40)

### nvidia-smi -L

```
GPU 0: NVIDIA A40 (UUID: GPU-[REDACTED])
GPU 1: NVIDIA A40 (UUID: GPU-[REDACTED])
```

### nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv

```
name, driver_version, memory.total [MiB]
NVIDIA A40, 580.126.09, 46068 MiB
NVIDIA A40, 580.126.09, 46068 MiB
```

### Summary

| Field               | Value           |
|---------------------|-----------------|
| Device count        | 2               |
| Model               | NVIDIA A40      |
| GPU Family          | Ampere          |
| Compute Capability  | 8.6             |
| Memory per GPU      | 46068 MiB (~45 GiB) |
| Driver version      | 580.126.09      |
| CUDA runtime        | 13.0            |

### Kubelet Device Plugin Status (gpu-operator namespace)

| Pod                                  | Status    | Age  |
|--------------------------------------|-----------|------|
| nvidia-device-plugin-daemonset-gjwj5 | Running   | 60d  |
| nvidia-container-toolkit-daemonset-6r98r | Running | 60d |
| nvidia-dcgm-exporter-wjphm           | Running   | 60d  |
| nvidia-operator-validator-llfxv      | Running   | 60d  |
| gpu-feature-discovery-rb2vm          | Running   | 60d  |
| nvidia-cuda-validator-wjfh7          | Completed | 7d   |

All GPU operator components on node3 are healthy.

### Note — GPU allocation

node3 currently has 1 of 2 GPUs allocated (nvidia.com/gpu request: 1, by the mlperf-131-1-1-npr7b pod). 1 GPU remains free for scheduling.

---

## node4 — FuriosaAI RNGD NPU

### furiosactl

`furiosactl` binary is not installed. `furiosa-smi` is available.

### furiosa-smi info

```
+------+--------+-----------------+---------+---------+--------------+
| Arch | Device | Firmware        | Temp.   | Power   | PCI-BDF      |
+------+--------+-----------------+---------+---------+--------------+
| rngd | npu0   | 1.11.0, cfd5306 | 33.01°C | 40.32 W | 0000:27:00.0 |
+------+--------+-----------------+---------+---------+--------------+
```

### furiosa-smi version

```
- furiosa-smi:     2026.1.0
- device driver:   2026.1.0, 96977d5
```

### lsmod (furiosa entries)

```
furiosa_rngd    331776  136
```

Driver module `furiosa_rngd` is loaded. Reference count 136 indicates active use.

### lspci (furiosa entries)

```
0000:27:00.0 Processing accelerators: FuriosaAI, Inc. RNGD (rev 01)
```

Hardware confirmed present at PCI bus 0000:27:00.0.

### Summary

| Field               | Value               |
|---------------------|---------------------|
| Device count        | 1                   |
| Model               | RNGD                |
| Architecture        | rngd                |
| PCI BDF             | 0000:27:00.0        |
| Driver version      | 2026.1.0 (96977d5)  |
| Firmware version    | 1.11.0 (cfd5306)    |
| Temperature         | 33.01°C             |
| Power draw          | 40.32 W             |
| K8s resource name   | furiosa.ai/rngd     |

### Kubelet Device Plugin Status (furiosa-system namespace)

| Pod                                                              | Status  | Node  | Age |
|------------------------------------------------------------------|---------|-------|-----|
| furiosa-device-plugin-wmrgj                                      | Running | node4 | 7d  |
| furiosa-feature-discovery-7mfhq                                  | Running | node4 | 7d  |
| furiosa-feature-discovery-node-feature-discovery-gc-57fdb6vpk5x  | Running | node4 | 7d  |
| furiosa-feature-discovery-node-feature-discovery-master-7dwgjlm  | Running | node1 | 7d  |
| furiosa-feature-discovery-node-feature-discovery-worker-76pv7    | Running | node2 | 7d  |
| furiosa-feature-discovery-node-feature-discovery-worker-98c5v    | Running | node3 | 7d  |
| furiosa-feature-discovery-node-feature-discovery-worker-mw4kn    | Running | node4 | 7d  |

The `furiosa-device-plugin` is running and the RNGD resource (`furiosa.ai/rngd: 1`) is exposed in node4's Allocatable. The NPU is currently allocated (used by `npu-inference-server-node4`).

### NPU Allocation Status

- Allocatable: `furiosa.ai/rngd: 1`
- Allocated:   `furiosa.ai/rngd: 1` (by `npu-inference-server-node4`, 43m old)
- Available:   0 (fully utilized)
