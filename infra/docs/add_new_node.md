# Operator Runbook: Adding a New Node to the Cluster

## Overview

This runbook describes how to add a new physical node (worker) to an existing ETRI LLM benchmark cluster. Use this when expanding capacity with new GPUs, NPUs, or compute nodes.

## Prerequisites

1. **Physical node is ready**: power, networking, SSH access
2. **SSH user and key**: kcloud@<new-node-ip> with sudo privileges
3. **Cluster is healthy**: `kubectl get nodes` shows all current nodes Ready
4. **Kubeconfig is valid**: `kubectl cluster-info`

## Step 1: Bootstrap the New Node

The bootstrap script installs dependencies: containerd, kubelet, kernel modules, and device plugins.

```bash
# From your operator workstation:
scp scripts/bootstrap-node.sh kcloud@<new-node-ip>:/tmp/
ssh -p 122 kcloud@<new-node-ip> sudo /tmp/bootstrap-node.sh
```

The script will:
- Install containerd and kubeadm
- Load GPU/NPU kernel modules
- Configure kernel parameters (memory limits, etc.)
- Prepare NFS client mount points

**Expected output**: "Bootstrap complete. Node ready for Kubernetes join."

### Troubleshooting Bootstrap

| Issue | Fix |
|---|---|
| SSH timeout | Verify IP, SSH port (default 122 for kcloud), firewall rules |
| containerd install fails | Check internet connectivity; may need proxy |
| GPU/NPU not detected | Verify hardware is installed; check `lspci` output in SSH session |

## Step 2: Update Cluster Inventory

Add the new node to config/cluster.yaml:

```yaml
workers:
  # ... existing nodes ...
  - name: node6                          # New node
    role: worker
    accelerator: { type: gpu, vendor: nvidia, model: "L40-44GiB", count: 1 }
    ssh: { host: 10.254.184.197, port: 122 }
    labels:
      accelerator-type: gpu
      gpu-vendor: nvidia
      gpu-model: l40-44
```

Also add to kubespray inventory (if using kubespray):

```bash
cat >> kubespray/inventory/etri/hosts.yml <<EOF

[kube_node]
node6 ansible_host=10.254.184.197
EOF
```

## Step 3: Run Kubespray Scale-Up

Kubespray can add the new node without redeploying the entire cluster:

```bash
cd kubespray
ansible-playbook -i inventory/etri/hosts.yml scale.yml \
  --extra-vars "target_node=node6"
```

This will:
- Copy kubelet certificates to node6
- Join node6 to the cluster via kubeadm
- Label the node according to cluster.yaml
- Apply any taints needed

**Expected output**: "node6 successfully joined the cluster"

Verify:
```bash
kubectl get nodes
# node6 should appear with status Ready
```

## Step 4: Configure Node Labels and Taints

Labels determine which workloads can run on this node. Taints prevent unwanted pods.

Run the labeling script:

```bash
cd scripts
bash 04_label_and_taint_nodes.sh --target node6
```

This script:
- Applies `accelerator-type`, `gpu-vendor`, `gpu-model` labels from cluster.yaml
- Adds taints for GPU nodes: `accelerator=<type>:NoSchedule`

Verify labels and taints:
```bash
kubectl describe node node6 | grep -A5 "Labels:\|Taints:"
```

Expected labels:
```
accelerator-type=gpu
gpu-vendor=nvidia
gpu-model=l40-44
```

Expected taints:
```
accelerator=gpu:NoSchedule
```

## Step 5: Deploy Device Plugins (GPU/NPU)

Device plugins expose the hardware to Kubernetes so pods can request it.

### For NVIDIA GPUs:

If not already deployed globally, install NVIDIA GPU operator:

```bash
cd kubernetes
bash 03-deploy-gpu-operator.sh
```

Or update the existing GPU operator to recognize the new node:

```bash
kubectl rollout restart daemonset nvidia-gpu-device-plugin -n kube-system
```

Verify GPU is detected:
```bash
kubectl describe node node6 | grep "nvidia.com/gpu"
# Should show: nvidia.com/gpu: 1
```

### For Furiosa NPUs:

Deploy Furiosa device plugin (if not already present):

```bash
kubectl apply -f k8s/device-plugins/furiosa-rngd-device-plugin.yaml
```

Or restart the daemonset:
```bash
kubectl delete pod -n kube-system -l k8s-app=furiosa-device-plugin
```

Verify NPU is detected:
```bash
kubectl describe node node6 | grep "furiosa.com/npu"
# Should show: furiosa.com/npu: 1
```

## Step 6: Verify NFS Access

The node must be able to mount the shared NFS for results storage:

```bash
ssh kcloud@<new-node-ip>
# Test NFS mount (or verify it's already mounted by bootstrap):
mount | grep nfs
# Should show: /mnt/nfs on ...

# Verify write access:
touch /mnt/nfs/test-node6-$(date +%s)
ls -la /mnt/nfs/ | grep test-node6
```

## Step 7: Test with a Small Workload

Create a test pod to verify the node is fully integrated:

```bash
# For GPU node:
kubectl run test-gpu --image=nvidia/cuda:12.0-runtime-ubuntu20.04 \
  --rm -it --restart=Never \
  -n default \
  --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"node6"},"containers":[{"name":"test","image":"nvidia/cuda:12.0-runtime-ubuntu20.04","command":["nvidia-smi"]}]}}'

# Should output GPU info without errors
```

Or test NPU:

```bash
kubectl run test-npu --image=furiosa/furiosa-runtime:latest \
  --rm -it --restart=Never \
  -n default \
  --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"node6"},"containers":[{"name":"test","image":"furiosa/furiosa-runtime","resources":{"limits":{"furiosa.com/npu":"1"}}}]}}'
```

## Step 8: Add Node to Benchmark Presets (Optional)

If you want benchmarks to automatically use the new node, update benchmark scripts:

```bash
# Edit scripts/11_run_mlperf_performance.sh (or other benchmark scripts):
# Update the nodeSelector or affinity rules to include node6
# Example:
nodeSelector:
  kubernetes.io/hostname: node[2-6]  # Expands range to include node6
```

Or configure via Helm values:

```bash
kubectl set env deploy/etri-llm-backend -n llm-evaluation \
  BENCHMARK_NODE_SELECTOR="kubernetes.io/hostname=node6"
```

## Step 9: Monitor Node Health

Check the node is stable over the next few hours:

```bash
# Watch for any NotReady or MemoryPressure/DiskPressure conditions:
kubectl get nodes -w

# Check for any error events:
kubectl get events -n kube-system --field-selector involvedObject.name=node6

# Monitor resource usage:
kubectl top node node6
```

## Step 10: Update Documentation

Update the cluster inventory in your runbooks:

```bash
# Update docs/runbook.md, docs/migration_guide.md, etc.
# to reflect the new node in capacity tables and provisioning checklists
```

## Post-Addition: Expand Cluster Capacity

Once the node is stable (24+ hours), you can:

1. **Increase benchmark parallelism**: Run multiple benchmarks simultaneously
   ```bash
   bash scripts/11_run_mlperf_performance.sh &
   bash scripts/13_run_mmlu_pro.sh &
   wait
   ```

2. **Enable new model variants**: With more hardware, consider 70B models
   ```bash
   # Update config/model_profiles.yaml to enable llama-3.1-70b-fp8 if you added 4 GPUs total
   ```

3. **Upgrade device driver versions**: With new hardware, may use latest NVIDIA driver
   ```bash
   kubectl set image ds/nvidia-gpu-device-plugin \
     -n kube-system \
     nvidia-gpu-device-plugin=nvidia/k8s-device-plugin:v0.14.0
   ```

## Troubleshooting: Node Join Failures

| Symptom | Likely Cause | Fix |
|---|---|---|
| Node stuck in NotReady | Kubelet not running or TLS cert issue | `ssh node6 sudo systemctl status kubelet`, check logs in /var/log/kubelet.log |
| GPU not showing in node capacity | Device plugin not running | `kubectl logs -n kube-system -l k8s-app=nvidia-gpu-device-plugin` |
| NFS mount fails | NFS server unreachable | Verify NFS server IP in /etc/fstab; check firewall |
| Pod can't schedule on node | Node taint prevents scheduling | Verify taint matches pod toleration; check `kubectl describe node node6` |
| Network connectivity issues | MTU mismatch or subnet misconfiguration | Check `ip link show` and `ip route` on node; compare with existing nodes |

## Rollback: Remove Node

If the node is problematic and must be removed:

```bash
# Drain the node (evict all pods gracefully):
kubectl drain node6 --ignore-daemonsets --delete-emptydir-data

# Remove the node from the cluster:
kubectl delete node node6

# On the node itself, reset kubelet:
ssh kcloud@<node-ip> sudo kubeadm reset

# Update cluster.yaml to remove the entry
```

The cluster continues operating on remaining nodes.
