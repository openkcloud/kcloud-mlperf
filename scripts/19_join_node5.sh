#!/usr/bin/env bash
# 19_join_node5.sh — Join node5 (Rebellions Atom+) to the k8s cluster.
#
# LEAD-GATED: Do NOT execute without explicit team-lead approval.
# RUN_ID: 20260428-083516-4b786d4
#
# Pre-requisites:
#   - Lane C-prep (task #3) complete: rebellions-atomplus-device-plugin.yaml.template ready
#   - SUDO_PASS env var set (sourced from .env)
#   - kubectl context pointing to node1 (control plane)
#   - kubeadm, kubectl v1.28.12 available on this host
#
# NOTE: The device plugin YAML is a diagnostic-only DaemonSet (rebellions-atomplus-diagnostic).
#   It runs rbln-smi for health observability but does NOT register rebellions.ai/atomplus
#   resources with the kubelet scheduler. Schedulable resource registration requires an
#   official Rebellions k8s device plugin (not yet available upstream).
#
# Image defaults:
#   RBLN_PLUGIN_IMAGE defaults to ubuntu:22.04 — the template mounts rbln-smi from the
#   host at /usr/local/bin via hostPath, so any base image with /bin/sh works.
#   Override via env if a Rebellions-specific image is available.
#
# Usage:
#   DRY_RUN=false bash scripts/19_join_node5.sh               # full join
#   DRY_RUN=true  bash scripts/19_join_node5.sh               # prints commands only
#   DRY_RUN=false bash scripts/19_join_node5.sh --skip-device-plugin  # join+label only
#   DRY_RUN=false bash scripts/19_join_node5.sh --rollback    # undo join
#
# Exit codes: 0 ok | 1 prereq failure | 2 join failure | 3 label failure | 4 device plugin failure

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/scripts/common.sh"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
NODE5_IP="10.254.202.111"
NODE5_PORT="22"
NODE5_NAME="node5"
SSH_USER="kcloud"
K8S_VERSION="1.28.12"
CHECKPOINT_DIR="$REPO_ROOT/../etri-llm-exam-solution/.omc/checkpoints/20260428-083516-4b786d4"
DEVICE_PLUGIN_YAML="$REPO_ROOT/k8s/device-plugins/rebellions-atomplus-device-plugin.yaml.template"
RBLN_NAMESPACE="kube-system"

: "${SUDO_PASS:?ERROR: SUDO_PASS must be set (source .env)}"
: "${DRY_RUN:=false}"

# Parse flags
SKIP_DEVICE_PLUGIN=false
ROLLBACK=false
for arg in "$@"; do
  case "$arg" in
    --skip-device-plugin) SKIP_DEVICE_PLUGIN=true ;;
    --rollback) ROLLBACK=true ;;
  esac
done

mkdir -p "$CHECKPOINT_DIR"

ssh_node5() {
  sshpass -p "$SUDO_PASS" ssh \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=10 \
    -p "$NODE5_PORT" \
    "${SSH_USER}@${NODE5_IP}" "$@"
}

# ---------------------------------------------------------------------------
# ROLLBACK
# ---------------------------------------------------------------------------
rollback() {
  log "ROLLBACK: removing node5 from cluster"
  kubectl delete daemonset rebellions-atomplus-diagnostic -n "$RBLN_NAMESPACE" --ignore-not-found || true
  kubectl drain "$NODE5_NAME" --ignore-daemonsets --delete-emptydir-data --force --timeout=60s || true
  ssh_node5 "echo '$SUDO_PASS' | sudo -S kubeadm reset -f" || true
  kubectl delete node "$NODE5_NAME" --ignore-not-found || true
  log "ROLLBACK complete — node5 removed from cluster"
}

if [ "$ROLLBACK" = "true" ]; then
  rollback
  exit 0
fi

# ---------------------------------------------------------------------------
# STEP 0: Capture pre-state checkpoint
# ---------------------------------------------------------------------------
log "STEP 0: capturing pre-state checkpoint"
dry_run_or kubectl get nodes -o yaml > "$CHECKPOINT_DIR/nodes-before.yaml"
dry_run_or kubectl get pods -n kube-system -o yaml > "$CHECKPOINT_DIR/kube-system-pods-before.yaml"
dry_run_or kubectl get pods -n "$RBLN_NAMESPACE" -o yaml > "$CHECKPOINT_DIR/rbln-ns-pods-before.yaml" 2>/dev/null || true
dry_run_or helm get values app-chart -n llm-evaluation -o yaml > "$CHECKPOINT_DIR/helm-app-chart-before.yaml" 2>/dev/null || true
log "checkpoint saved to $CHECKPOINT_DIR"

# ---------------------------------------------------------------------------
# STEP 1: Probe SSH to node5
# ---------------------------------------------------------------------------
log "STEP 1: probing SSH to node5 ($NODE5_IP:$NODE5_PORT)"
dry_run_or ssh_node5 "hostname && uname -r && lsb_release -rs" \
  || die "SSH probe to node5 failed — check SUDO_PASS and network" 1

# ---------------------------------------------------------------------------
# STEP 2: Install containerd + kubelet + kubeadm + kubectl on node5
# ---------------------------------------------------------------------------
log "STEP 2: installing k8s v${K8S_VERSION} components on node5"

INSTALL_SCRIPT=$(cat <<'EOFINSTALL'
set -euo pipefail

K8S_VERSION="1.28.12"
K8S_PKG_VERSION="${K8S_VERSION}-1.1"

# containerd
if ! command -v containerd &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq containerd
  mkdir -p /etc/containerd
  containerd config default > /etc/containerd/config.toml
  sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
  systemctl enable --now containerd
else
  echo "containerd already installed: $(containerd --version)"
fi

# kubeadm / kubelet / kubectl
if ! dpkg -l kubelet 2>/dev/null | grep -q "^ii.*${K8S_VERSION}"; then
  apt-get update -qq
  apt-get install -y -qq apt-transport-https ca-certificates curl
  curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key \
    | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
  echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' \
    > /etc/apt/sources.list.d/kubernetes.list
  apt-get update -qq
  apt-get install -y -qq \
    kubelet="${K8S_PKG_VERSION}" \
    kubeadm="${K8S_PKG_VERSION}" \
    kubectl="${K8S_PKG_VERSION}"
  apt-mark hold kubelet kubeadm kubectl
  systemctl enable --now kubelet
else
  echo "kubelet ${K8S_VERSION} already installed"
fi

# disable swap
swapoff -a
sed -i '/\sswap\s/d' /etc/fstab || true

# br_netfilter + sysctl
modprobe br_netfilter
cat > /etc/sysctl.d/99-kubernetes-cri.conf <<EOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system -q
EOFINSTALL
)

if [ "$DRY_RUN" = "true" ]; then
  log "[DRY-RUN] would run k8s install script on node5"
else
  ssh_node5 "echo '$SUDO_PASS' | sudo -S bash -s" <<< "$INSTALL_SCRIPT" \
    || die "k8s component install on node5 failed" 2
fi

# ---------------------------------------------------------------------------
# STEP 3: Generate kubeadm join command from control plane (node1)
# ---------------------------------------------------------------------------
log "STEP 3: generating kubeadm join token from control plane"
dry_run_or bash -c "kubectl get nodes"

if [ "$DRY_RUN" = "true" ]; then
  log "[DRY-RUN] would run: kubeadm token create --print-join-command"
  JOIN_CMD="kubeadm join 10.254.177.41:6443 --token <DRY-RUN-TOKEN> --discovery-token-ca-cert-hash sha256:<DRY-RUN-HASH>"
else
  JOIN_CMD="$(kubeadm token create --print-join-command 2>/dev/null)" \
    || die "kubeadm token create failed" 2
  echo "$JOIN_CMD" > "$CHECKPOINT_DIR/join-command.txt"
  log "join command saved to checkpoint"
fi

# ---------------------------------------------------------------------------
# STEP 4: Execute kubeadm join on node5
# ---------------------------------------------------------------------------
log "STEP 4: running kubeadm join on node5"
if [ "$DRY_RUN" = "true" ]; then
  log "[DRY-RUN] would SSH to node5 and run: sudo $JOIN_CMD"
else
  ssh_node5 "echo '$SUDO_PASS' | sudo -S $JOIN_CMD" \
    || die "kubeadm join on node5 failed — check logs on node5: journalctl -xeu kubelet" 2
fi

# ---------------------------------------------------------------------------
# STEP 5: Wait for node5 to become Ready
# ---------------------------------------------------------------------------
log "STEP 5: waiting for node5 to reach Ready state (timeout 300s)"
if [ "$DRY_RUN" = "true" ]; then
  log "[DRY-RUN] would run: kubectl wait --for=condition=Ready node/node5 --timeout=300s"
else
  kubectl wait --for=condition=Ready node/node5 --timeout=300s \
    || { kubectl describe node node5; die "node5 did not become Ready within 300s" 2; }
  kubectl get nodes -o wide
fi

# ---------------------------------------------------------------------------
# STEP 6: Apply labels to node5
# ---------------------------------------------------------------------------
log "STEP 6: applying labels to node5"
LABELS=(
  "accelerator-type=npu"
  "npu-vendor=rebellions"
  "npu-model=atomplus"
  "accelerator-count=2"
  "benchmark.openkcloud.io/role=benchmark-worker"
)
for label in "${LABELS[@]}"; do
  dry_run_or kubectl label node "$NODE5_NAME" "$label" --overwrite
done
log "labels applied"

# ---------------------------------------------------------------------------
# STEP 7: Dry-run apply diagnostic DS, then apply if passes
# ---------------------------------------------------------------------------
if [ "$SKIP_DEVICE_PLUGIN" = "true" ]; then
  log "STEP 7: --skip-device-plugin set — skipping diagnostic DaemonSet apply"
else
  log "STEP 7: applying Rebellions Atom+ diagnostic DaemonSet"

  if [ ! -f "$DEVICE_PLUGIN_YAML" ]; then
    die "device plugin yaml not found at: $DEVICE_PLUGIN_YAML" 4
  fi

  # Template uses RBLN_PLUGIN_IMAGE / RBLN_PLUGIN_TAG (not ATOMPLUS_PLUGIN_*)
  # Default to ubuntu:22.04 — host-mounted rbln-smi via hostPath works with any base image
  : "${RBLN_PLUGIN_IMAGE:=ubuntu}"
  : "${RBLN_PLUGIN_TAG:=22.04}"
  export RBLN_PLUGIN_IMAGE RBLN_PLUGIN_TAG

  RENDERED_YAML="$CHECKPOINT_DIR/rebellions-atomplus-diagnostic-rendered.yaml"
  dry_run_or bash -c "envsubst < '$DEVICE_PLUGIN_YAML' > '$RENDERED_YAML'"

  log "running server-side dry-run for diagnostic DaemonSet"
  dry_run_or kubectl apply --dry-run=server -f "$RENDERED_YAML" \
    || die "diagnostic DaemonSet dry-run failed — fix yaml before applying" 4

  log "dry-run passed — applying diagnostic DaemonSet"
  dry_run_or kubectl apply -f "$RENDERED_YAML"

  # ---------------------------------------------------------------------------
  # STEP 8: Verify diagnostic pod Running and rbln-smi invoked
  # ---------------------------------------------------------------------------
  log "STEP 8: verifying diagnostic pod and rbln-smi output"

  if [ "$DRY_RUN" = "true" ]; then
    log "[DRY-RUN] would run:"
    log "  kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=rebellions-atomplus-diagnostic -n $RBLN_NAMESPACE --timeout=120s"
    log "  kubectl logs -l app.kubernetes.io/name=rebellions-atomplus-diagnostic -n $RBLN_NAMESPACE --tail=30 | grep -E 'rbln-smi|Atom'"
    log "  kubectl get node node5 -o jsonpath='{.status.allocatable}' (WARN only if rebellions.ai/atomplus absent)"
  else
    kubectl wait \
      --for=condition=Ready pod \
      -l "app.kubernetes.io/name=rebellions-atomplus-diagnostic" \
      -n "$RBLN_NAMESPACE" \
      --timeout=120s \
      || { kubectl describe pods -n "$RBLN_NAMESPACE" -l "app.kubernetes.io/name=rebellions-atomplus-diagnostic"; die "diagnostic pod not Ready within 120s" 4; }

    log "checking rbln-smi invocation in diagnostic pod logs"
    kubectl logs \
      -l "app.kubernetes.io/name=rebellions-atomplus-diagnostic" \
      -n "$RBLN_NAMESPACE" \
      --tail=30 \
      | grep -E "rbln-smi|Atom" \
      && log "rbln-smi output confirmed in diagnostic pod" \
      || log "[WARN] rbln-smi/Atom not yet visible in logs — pod may still be initializing"

    # WARN only — diagnostic DS does not register scheduler resources
    ALLOCATABLE="$(kubectl get node node5 -o jsonpath='{.status.allocatable}')"
    log "node5 allocatable: $ALLOCATABLE"
    if echo "$ALLOCATABLE" | grep -q "rebellions.ai/atomplus"; then
      log "INFO: node5 advertises rebellions.ai/atomplus in Allocatable"
    else
      log "[WARN] rebellions.ai/atomplus NOT in node5 Allocatable — expected for diagnostic-only DS."
      log "       Schedulable resource registration requires an official Rebellions k8s device plugin (not yet available upstream)."
      log "       Diagnostic DS provides health visibility only via rbln-smi."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Post-state checkpoint
# ---------------------------------------------------------------------------
log "capturing post-state checkpoint"
dry_run_or kubectl get nodes -o yaml > "$CHECKPOINT_DIR/nodes-after.yaml"
dry_run_or kubectl get pods -n "$RBLN_NAMESPACE" -o yaml > "$CHECKPOINT_DIR/rbln-ns-pods-after.yaml"

log "=== node5 join complete ==="
log "Checkpoint: $CHECKPOINT_DIR"
log "Rollback:   DRY_RUN=false bash scripts/19_join_node5.sh --rollback"
