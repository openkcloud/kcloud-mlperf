> Note: ETRI takeover migration 2026-05-12 — directory previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming); now ETRI-owned at `/home/kcloud/etri-llm-deployments/app/`. Container images previously under `mondrianai/*` Docker Hub org are migrating to `ghcr.io/etri-llm/*`. Historical mentions of the legacy names below are preserved for context.

# node5 Rebellions Atom+ Integration Report

**Status:** ready_to_apply
**RUN_ID:** 20260428-083516-4b786d4
**Worker:** worker-4 (Lane C-mut)
**Gate:** AWAITING team-lead "PROCEED WITH NODE5 JOIN" signal

---

## Pre-flight Verification (DRY-RUN)

### Control Plane Health (verified live)

| Check | Result |
|---|---|
| node1 (control-plane) | Ready |
| node2 (gpu worker) | Ready |
| node3 (gpu worker) | Ready |
| node4 (furiosa RNGD worker) | Ready |
| node5 | NOT YET JOINED |
| kube-controller-manager-node1 | Running |
| kube-scheduler-node1 | Running |
| calico-kube-controllers | Running |
| k8s version | v1.28.12 |
| container runtime | containerd://1.7.21 |

### node5 Target Spec

| Field | Value |
|---|---|
| hostname | node5 |
| IP | 10.254.202.111 |
| SSH port | 22 |
| NPU | 2x Rebellions Atom+ |
| OS | Ubuntu 22.04 (expected) |
| k8s target version | v1.28.12 |

### Device Plugin

- Source: `k8s/device-plugins/rebellions-atomplus-device-plugin.yaml.template`
- Produced by: worker-3 (Lane C-prep, task #3)
- **NOTE:** As of DRY-RUN preparation, the template file still contains furiosa-branded labels/names. Worker-3 (task #3) is in_progress and is expected to correct vendor=rebellions labels before PROCEED signal is issued.
- Expected resource name on node: `rebellions.ai/atomplus`

---

## Apply Commands

Execute **after** team-lead sends "PROCEED WITH NODE5 JOIN":

```bash
# Source credentials
source /home/kcloud/etri-llm-deployments/app/.env

# Set device plugin image vars (confirm with team-lead if uncertain)
export ATOMPLUS_PLUGIN_IMAGE=rebellions/k8s-device-plugin
export ATOMPLUS_PLUGIN_TAG=atomplus-v1.0.0

# Run the join script (DRY_RUN=false executes for real)
cd /home/kcloud/etri-llm-deployments/app
DRY_RUN=false bash scripts/19_join_node5.sh
```

### Step-by-step (manual equivalent)

```bash
# 1. Capture pre-state
kubectl get nodes -o yaml > .omc/checkpoints/20260428-083516-4b786d4/nodes-before.yaml
helm get values app-chart -n llm-evaluation -o yaml > .omc/checkpoints/20260428-083516-4b786d4/helm-before.yaml

# 2. Install k8s components on node5 (via SSH)
sshpass -p "$SUDO_PASS" ssh -p 22 kcloud@10.254.202.111 \
  "echo '$SUDO_PASS' | sudo -S bash -s" < scripts/19_join_node5.sh

# 3. Generate join command (from node1/control-plane)
JOIN_CMD=$(kubeadm token create --print-join-command)
echo "$JOIN_CMD" > .omc/checkpoints/20260428-083516-4b786d4/join-command.txt

# 4. Execute join on node5
sshpass -p "$SUDO_PASS" ssh -p 22 kcloud@10.254.202.111 \
  "echo '$SUDO_PASS' | sudo -S $JOIN_CMD"

# 5. Wait for Ready
kubectl wait --for=condition=Ready node/node5 --timeout=300s

# 6. Apply labels
kubectl label node node5 \
  accelerator-type=npu \
  npu-vendor=rebellions \
  npu-model=atomplus \
  accelerator-count=2 \
  benchmark.openkcloud.io/role=benchmark-worker \
  --overwrite

# 7. Render + dry-run device plugin
export ATOMPLUS_PLUGIN_IMAGE=rebellions/k8s-device-plugin
export ATOMPLUS_PLUGIN_TAG=atomplus-v1.0.0
envsubst < k8s/device-plugins/rebellions-atomplus-device-plugin.yaml.template \
  > .omc/checkpoints/20260428-083516-4b786d4/rebellions-atomplus-device-plugin-rendered.yaml

kubectl apply --dry-run=server \
  -f .omc/checkpoints/20260428-083516-4b786d4/rebellions-atomplus-device-plugin-rendered.yaml

# 8. Apply device plugin (only after dry-run passes)
kubectl apply \
  -f .omc/checkpoints/20260428-083516-4b786d4/rebellions-atomplus-device-plugin-rendered.yaml

# 9. Verify pod Running and resource advertised
kubectl wait --for=condition=Ready pod \
  -l app.kubernetes.io/name=rebellions-atomplus-device-plugin \
  -n furiosa-system --timeout=120s

kubectl get node node5 -o jsonpath='{.status.allocatable}' | grep rebellions.ai/atomplus
```

---

## Rollback Commands

Run at any failure point or to undo the join:

```bash
# Remove device plugin DaemonSet
kubectl delete daemonset rebellions-atomplus-device-plugin -n furiosa-system --ignore-not-found

# Drain node5
kubectl drain node5 --ignore-daemonsets --delete-emptydir-data --force --timeout=60s

# Reset kubeadm on node5
sshpass -p "$SUDO_PASS" ssh -p 22 kcloud@10.254.202.111 \
  "echo '$SUDO_PASS' | sudo -S kubeadm reset -f"

# Remove node from cluster
kubectl delete node node5 --ignore-not-found

# Or use the built-in rollback flag:
DRY_RUN=false bash scripts/19_join_node5.sh --rollback
```

---

## Checkpoint Location

```
.omc/checkpoints/20260428-083516-4b786d4/
  nodes-before.yaml                              # pre-state snapshot
  kube-system-pods-before.yaml
  furiosa-ns-pods-before.yaml
  helm-app-chart-before.yaml
  join-command.txt                               # created at runtime
  rebellions-atomplus-device-plugin-rendered.yaml  # rendered at runtime
  nodes-after.yaml                               # post-state snapshot
  furiosa-ns-pods-after.yaml
```

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| node5 SSH unreachable | Pre-flight probe at step 1; script exits early |
| k8s version mismatch | Script pins v1.28.12 packages with apt-mark hold |
| Device plugin vendor label mismatch | Worker-3 (task #3) must complete before PROCEED |
| kubeadm join token expiry (24h) | Token generated immediately before join step |
| Device plugin image not found | Verify ATOMPLUS_PLUGIN_IMAGE/TAG env vars before apply |
| Partial join leaves dirty state | Rollback hook at every step; kubeadm reset + kubectl delete node |

---

## Checkpoint Verification

checkpoint_verified_by_worker_4

Verified 2026-04-28 by worker-4. All pre-state checkpoint files confirmed present in `.omc/checkpoints/20260428-083516-4b786d4/`:

| File | Size | Written by |
|---|---|---|
| nodes-before.yaml | 74017 bytes | team-lead |
| helm-values-before.yaml | 1260 bytes | team-lead |
| helm-history-before.txt | 720 bytes | team-lead |
| deployments-before.yaml | 14266 bytes | team-lead |

Lane C-mut is STANDING BY. No cluster mutation has occurred. Awaiting "PROCEED WITH NODE5 JOIN" from team-lead.
