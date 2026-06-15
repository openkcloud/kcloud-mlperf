# Node5 Rebellions Atom+ Join Runbook

## Overview

node5 is a Rebellions Atom+ NPU node that joins the ETRI k8s cluster via a **LEAD-GATED** procedure. This runbook covers the join steps with rollback capability at each stage.

**Hardware Details:**
- **Hostname**: node5 (rebellion-atom-1.internal)
- **Device**: Rebellions Atom+ NPU (2 cores)
- **PCI ID**: 1eff:1220
- **Block Device**: /dev/rsd0
- **Management CLI**: rbln-smi / rbln-stat
- **IP**: 10.254.202.111
- **SSH Port**: 22

**Cluster State Before Join:**
- node5 tainted with `node5.atom-plus/pending=true:NoSchedule`
- Status: `pending_join` (not schedulable)
- Device plugin: Not running until node becomes Ready

## Pre-Join Checklist

Before proceeding, verify:

1. **SSH Access**: Confirm password-less or password-protected SSH to node5
   ```bash
   ssh kcloud@10.254.202.111
   ```

2. **Hardware Ready**: Confirm power, network, and device presence
   ```bash
   ssh kcloud@10.254.202.111 "lspci | grep 1eff:1220"
   ssh kcloud@10.254.202.111 "ls -l /dev/rsd0"
   ```

3. **SUDO_PASS Set**: Required for all node5 operations
   ```bash
   [ -z "$SUDO_PASS" ] && echo "ERROR: SUDO_PASS not set" || echo "OK"
   ```

4. **Control Plane Access**: Verify kubectl context points to control plane (node1)
   ```bash
   kubectl cluster-info
   kubectl get nodes
   ```

5. **Lane C-prep Complete**: Device plugin YAML scaffolded
   ```bash
   ls -l /home/kcloud/etri-llm-deployments/app/k8s/device-plugins/rebellions-atomplus-device-plugin.yaml.template
   ```

## Join Procedure

### STEP 0: Pre-State Checkpoint

Capture cluster state before mutations:

```bash
# Save node state
kubectl get nodes -o yaml > /tmp/nodes-before.yaml

# Save kube-system pods
kubectl get pods -n kube-system -o yaml > /tmp/kube-system-before.yaml

# Save Helm values
helm get values app-chart -n llm-evaluation -o yaml > /tmp/app-chart-before.yaml
```

**Rollback Marker**: If any step fails after this point, all checkpoints are preserved in the script checkpoint directory.

### STEP 1: SSH Probe to node5

Verify SSH connectivity and basic system info:

```bash
ssh kcloud@10.254.202.111 "hostname && uname -r && lsb_release -rs"
```

Expected output:
```
rebellion-atom-1
5.15.0-161-generic
20.04
```

**Rollback**: None required.

### STEP 2: Install Kubernetes v1.28.12 on node5

Install containerd, kubelet, kubeadm, and kubectl on node5. This is done via remote SSH execution of an inline script:

```bash
ssh kcloud@10.254.202.111 "bash -c 'set -euo pipefail
# Step 2a: Install containerd
sudo apt-get update -qq
sudo apt-get install -y -qq containerd
sudo mkdir -p /etc/containerd
sudo bash -c \"containerd config default > /etc/containerd/config.toml\"
sudo sed -i \"s/SystemdCgroup = false/SystemdCgroup = true/\" /etc/containerd/config.toml
sudo systemctl enable --now containerd

# Step 2b: Install kubeadm, kubelet, kubectl (v1.28.12)
K8S_VERSION=\"1.28.12\"
K8S_PKG_VERSION=\"\${K8S_VERSION}-1.1\"
sudo apt-get install -y -qq apt-transport-https ca-certificates curl
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo \"deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /\" | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt-get update -qq
sudo apt-get install -y -qq kubelet=\${K8S_PKG_VERSION} kubeadm=\${K8S_PKG_VERSION} kubectl=\${K8S_PKG_VERSION}
sudo apt-mark hold kubelet kubeadm kubectl
sudo systemctl enable --now kubelet

# Step 2c: Disable swap and configure networking
sudo swapoff -a
sudo sed -i \"/\\\\sswap\\\\s/d\" /etc/fstab || true
sudo modprobe br_netfilter
sudo tee /etc/sysctl.d/99-kubernetes-cri.conf > /dev/null <<EOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sudo sysctl --system -q
'"
```

**Verification**:
```bash
ssh kcloud@10.254.202.111 "kubelet --version && kubeadm version"
```

**Rollback**: Drain node5 and remove k8s packages (manual SSH to node5 required).

### STEP 3: Generate kubeadm Join Token

On the control plane (node1), generate a join token and command:

```bash
kubectl get nodes  # verify connectivity

kubeadm token create --print-join-command
```

Example output:
```
kubeadm join 10.254.177.41:6443 --token xyz123 --discovery-token-ca-cert-hash sha256:abc...
```

**Save this command** — it's needed for STEP 4.

**Rollback**: Token expires after 24 hours. If expired, generate a new one.

### STEP 4: Execute kubeadm Join on node5

On node5, run the join command from STEP 3:

```bash
ssh kcloud@10.254.202.111 "sudo kubeadm join 10.254.177.41:6443 \
  --token xyz123 \
  --discovery-token-ca-cert-hash sha256:abc..."
```

Expected output includes:
```
[preflight] Running pre-flight checks
[kubelet-start] Writing kubelet environment file
[kubelet-start] Starting the kubelet
[kubeconfig] Wrote KubeconfigFile to disk: "/etc/kubernetes/kubelet.conf"
[bootstrap-token] Using token: ...
This node has joined the cluster and a new control token was generated.
```

Check kubelet logs if join fails:
```bash
ssh kcloud@10.254.202.111 "sudo journalctl -xeu kubelet | tail -50"
```

**Rollback**: `ssh kcloud@10.254.202.111 "sudo kubeadm reset -f"`

### STEP 5: Wait for node5 to Reach Ready

Block until node5 becomes Ready:

```bash
kubectl wait --for=condition=Ready node/node5 --timeout=300s
```

Monitor progress:
```bash
kubectl get nodes -w
# or
kubectl describe node node5
```

Expected condition when Ready:
```
Ready     True   KubeletReady,MemoryPressure,DiskPressure
```

**Troubleshooting**:
- If kubelet fails to start: check `/etc/kubernetes/kubelet.conf` on node5
- If networking fails: check CNI pod logs in `kube-system`
- If timeout: `ssh kcloud@10.254.202.111 "sudo journalctl -xeu kubelet | tail -100"`

**Rollback**: Drain node5, reset kubeadm, delete node object from cluster.

### STEP 6: Apply Labels to node5

Label the node for device affinity and benchmarking:

```bash
kubectl label node node5 \
  accelerator-type=npu \
  npu-vendor=rebellions \
  npu-model=atomplus \
  accelerator-count=2 \
  benchmark.openkcloud.io/role=benchmark-worker \
  --overwrite
```

Verify labels:
```bash
kubectl get node node5 --show-labels
```

**Rollback**: Remove labels with `kubectl label node node5 <key>-`

### STEP 7: Apply Rebellions Atom+ Device Plugin

The device plugin manifests are templated with environment variables. Render and apply:

```bash
# Set plugin image and tag
export ATOMPLUS_PLUGIN_IMAGE=rebellions/k8s-device-plugin
export ATOMPLUS_PLUGIN_TAG=atomplus-v1.0.0

# Render the template
DEVICE_PLUGIN_YAML="/home/kcloud/etri-llm-deployments/app/k8s/device-plugins/rebellions-atomplus-device-plugin.yaml.template"
envsubst < "$DEVICE_PLUGIN_YAML" > /tmp/rebellions-atomplus-device-plugin.yaml

# Dry-run first
kubectl apply --dry-run=server -f /tmp/rebellions-atomplus-device-plugin.yaml

# Apply for real
kubectl apply -f /tmp/rebellions-atomplus-device-plugin.yaml
```

**Verification**:
```bash
kubectl get daemonset -A | grep rebellions
kubectl get pods -n furiosa-system -l app.kubernetes.io/name=rebellions-atomplus-device-plugin
```

**Rollback**: `kubectl delete daemonset rebellions-atomplus-device-plugin -n furiosa-system`

### STEP 8: Verify Device Plugin and NPU Resource Advertised

Wait for device plugin pod to be Ready and check NPU resource is advertised:

```bash
kubectl wait \
  --for=condition=Ready pod \
  -l app.kubernetes.io/name=rebellions-atomplus-device-plugin \
  -n furiosa-system \
  --timeout=120s

# Check Allocatable resources
kubectl get node node5 -o jsonpath='{.status.allocatable}' | grep -o "rebellions.ai/atomplus.*"
```

Expected output:
```
rebellions.ai/atomplus:2
```

**If not advertised**:
1. Check device plugin pod logs: `kubectl logs -f -n furiosa-system -l app.kubernetes.io/name=rebellions-atomplus-device-plugin`
2. Check node5 hardware: `ssh kcloud@10.254.202.111 "rbln-smi"`
3. Check PCI device presence: `ssh kcloud@10.254.202.111 "lspci | grep 1eff:1220"`

**Rollback**: Delete device plugin and manually check device on node5.

## Post-Join Verification

After all steps complete, verify:

```bash
# 1. Node is Ready and schedulable
kubectl get nodes node5 -o wide

# 2. Taint is removed (if it was added)
kubectl describe node node5 | grep Taints

# 3. Device plugin is running
kubectl get pods -n furiosa-system -l app.kubernetes.io/name=rebellions-atomplus-device-plugin

# 4. NPU slots visible on dashboard
curl -s http://10.254.177.41:30980/api/devices | jq '.[] | select(.vendor=="rebellions")'

# 5. Frontend shows slots in pending_join state (until taint is removed)
# Visit http://10.254.177.41:30001/dashboard/npu-realtime
```

## Full Rollback Procedure

To completely remove node5 from the cluster:

```bash
# 1. Drain workloads
kubectl drain node5 --ignore-daemonsets --delete-emptydir-data --force --timeout=60s

# 2. Delete device plugin
kubectl delete daemonset rebellions-atomplus-device-plugin -n furiosa-system --ignore-not-found

# 3. Reset kubeadm on node5
ssh kcloud@10.254.202.111 "sudo kubeadm reset -f"

# 4. Delete node object
kubectl delete node node5 --ignore-not-found

# 5. Verify removal
kubectl get nodes
```

## Troubleshooting

### Node Stuck in `NotReady`

Check kubelet status on node5:
```bash
ssh kcloud@10.254.202.111 "sudo systemctl status kubelet"
ssh kcloud@10.254.202.111 "sudo journalctl -xeu kubelet | tail -100"
```

Common causes:
- CNI not installed: Check `kubectl get pods -n kube-system` for CNI pod status
- Disk/Memory pressure: Check `kubectl describe node node5`
- Networking misconfiguration: Check `/etc/kubernetes/kubelet.conf` on node5

### Device Plugin Pod Not Ready

```bash
kubectl describe pod -n furiosa-system -l app.kubernetes.io/name=rebellions-atomplus-device-plugin
kubectl logs -n furiosa-system -l app.kubernetes.io/name=rebellions-atomplus-device-plugin
```

Common causes:
- Image pull failure: Verify image registry access and credentials
- Device not found on node: `ssh kcloud@10.254.202.111 "rbln-smi"`
- Missing device mount in pod spec: Check YAML template

### SSH Failures

Ensure:
1. `$SUDO_PASS` is set in environment
2. SSH key or password auth is working: `ssh kcloud@10.254.202.111 "echo OK"`
3. Network connectivity: `ping 10.254.202.111`
4. SSH port 22 is open: `nc -zv 10.254.202.111 22`

### kubeadm join Fails

Check prerequisites:
1. Control plane API reachable from node5: `ssh kcloud@10.254.202.111 "curl https://10.254.177.41:6443 -k"` (may timeout)
2. Token not expired: Tokens expire after 24 hours
3. Kubelet, kubeadm, kubectl versions match control plane: `ssh kcloud@10.254.202.111 "kubeadm version && kubelet --version"`
4. No conflicting node with same hostname: `kubectl get nodes | grep node5`

## Contact

For escalation or emergencies:
- ETRI Cluster Operations: Reference this runbook location
- Check checkpoints in: `$CHECKPOINT_DIR` (printed by join script)
- Device plugin logs: `kubectl logs -f -n furiosa-system -l app.kubernetes.io/name=rebellions-atomplus-device-plugin`
