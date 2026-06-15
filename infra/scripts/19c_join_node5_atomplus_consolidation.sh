#!/usr/bin/env bash
# 19c_join_node5_atomplus_consolidation.sh
# Join node5 (Rebellions ATOM / "Atom+", RBLN-CA22 ×2) to the CONSOLIDATION jw
# cluster (control plane = jw1 @ 10.254.202.81). Verified working 2026-06-04.
#
# WHY THIS EXISTS (vs the older 19_join_node5.sh):
#   1. The old script generated its join command against the OLD cluster control
#      plane (node1 @ 10.254.177.41 — a FORBIDDEN, read-only host). This script
#      generates the token from jw1 and rewrites the printed 127.0.0.1 endpoint
#      to jw1's real IP so node5 actually reaches the consolidation API server.
#   2. A plain `kubeadm join` does NOT install the kubespray-style nginx-proxy
#      static pod (local API LB on 127.0.0.1:6443). Without it, kube-proxy and
#      calico-node on the new worker try to reach the API at 127.0.0.1:6443,
#      get "connection refused", never program the ClusterIP ipvs rules, and
#      the node stays NotReady (calico Init:CrashLoopBackOff). This script
#      replicates the nginx-proxy static pod + /etc/nginx/nginx.conf from an
#      existing worker (node4) — that is the step that makes node5 go Ready.
#
# Node5 RBLN prerequisites (already satisfied as of 2026-06-04 — the historical
# rebel-compiler-vs-driver mismatch is resolved): kernel driver/dkms/firmware
# all 3.0.0; rbln-sdk / rebel-compiler / optimum-rbln / vllm_rbln all 0.10.3;
# `rbln-stat` shows 2× RBLN-CA22. Device registry: node5/Atom+ is in
# new-cluster-fixed.yaml -> etri-llm-cluster-config ConfigMap (consolidation-app-layer.sh).
#
# Usage:
#   SUDO_PASS=... bash 19c_join_node5_atomplus_consolidation.sh            # full join
#   SUDO_PASS=... DRY_RUN=true bash 19c_join_node5_atomplus_consolidation.sh
#   SUDO_PASS=... bash 19c_join_node5_atomplus_consolidation.sh --rollback # remove node5
set -euo pipefail

NODE5_IP="10.254.202.111"
NODE5_NAME="node5"
SSH_USER="kcloud"
CP_IP="10.254.202.81"          # jw1 consolidation control plane
CP_PORT="6443"
EXISTING_WORKER_IP="10.254.202.114"   # node4 — source of the nginx-proxy LB files
KUBECONFIG="${KUBECONFIG:-/home/kcloud/jwcluster.kubeconfig}"
export KUBECONFIG

: "${SUDO_PASS:?ERROR: SUDO_PASS must be set}"
: "${DRY_RUN:=false}"
ROLLBACK=false
for a in "${@:-}"; do [ "$a" = "--rollback" ] && ROLLBACK=true; done

log(){ echo "[$(date +%H:%M:%S)] $*"; }
SSH(){ sshpass -p "$SUDO_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$@"; }
SCP(){ sshpass -p "$SUDO_PASS" scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$@"; }
node5(){ SSH "${SSH_USER}@${NODE5_IP}" "$@"; }
node5_sudo(){ node5 "echo '$SUDO_PASS' | sudo -S bash -c '$*'"; }

# SAFETY: never operate against the old cluster.
if echo "$CP_IP" | grep -qE '10\.254\.177\.41|10\.254\.184\.19[56]'; then
  echo "FATAL: control plane points at a FORBIDDEN old-cluster IP. Abort."; exit 9
fi

if [ "$ROLLBACK" = "true" ]; then
  log "ROLLBACK: draining + removing node5"
  kubectl drain "$NODE5_NAME" --ignore-daemonsets --delete-emptydir-data --force --timeout=60s || true
  node5_sudo "kubeadm reset -f; rm -f /etc/kubernetes/manifests/nginx-proxy.yml" || true
  kubectl delete node "$NODE5_NAME" --ignore-not-found || true
  log "ROLLBACK done."; exit 0
fi

# --- STEP 1: generate join command from jw1, rewrite endpoint to jw1 real IP ---
log "STEP 1: generating join token from control plane ($CP_IP)"
JOIN_RAW="$(SSH "${SSH_USER}@${CP_IP}" "echo '$SUDO_PASS' | sudo -S kubeadm token create --print-join-command" 2>/dev/null)"
JOIN_CMD="$(echo "$JOIN_RAW" | sed "s#127.0.0.1:${CP_PORT}#${CP_IP}:${CP_PORT}#; s#[0-9.]\+:${CP_PORT}#${CP_IP}:${CP_PORT}#")"
echo "$JOIN_CMD" | grep -q "${CP_IP}:${CP_PORT}" || { echo "FATAL: join cmd does not target ${CP_IP}"; exit 2; }
log "join targets ${CP_IP}:${CP_PORT} (OK)"

if [ "$DRY_RUN" = "true" ]; then log "[DRY-RUN] would prep+join node5 and install nginx-proxy LB"; exit 0; fi

# --- STEP 2: prep node5 (swap off, br_netfilter, containerd systemd cgroup, clean state) ---
log "STEP 2: preparing node5"
node5_sudo "swapoff -a || true; modprobe br_netfilter || true; \
  printf \"net.bridge.bridge-nf-call-iptables=1\nnet.ipv4.ip_forward=1\n\" >/etc/sysctl.d/99-k8s.conf; sysctl --system -q || true; \
  if [ -f /etc/containerd/config.toml ]; then sed -i \"s/SystemdCgroup = false/SystemdCgroup = true/\" /etc/containerd/config.toml; fi; \
  systemctl enable --now containerd; systemctl restart containerd; \
  kubeadm reset -f >/dev/null 2>&1 || true"

# --- STEP 3: join ---
log "STEP 3: kubeadm join"
node5 "echo '$SUDO_PASS' | sudo -S ${JOIN_CMD}"

# --- STEP 4: install the kubespray-style nginx-proxy local API LB (THE KEY FIX) ---
log "STEP 4: replicating nginx-proxy local LB from existing worker (${EXISTING_WORKER_IP})"
TMP_NGINX="$(mktemp)"; TMP_MANIFEST="$(mktemp)"
SSH "${SSH_USER}@${EXISTING_WORKER_IP}" "echo '$SUDO_PASS' | sudo -S cat /etc/nginx/nginx.conf" > "$TMP_NGINX"
SSH "${SSH_USER}@${EXISTING_WORKER_IP}" "echo '$SUDO_PASS' | sudo -S cat /etc/kubernetes/manifests/nginx-proxy.yml" > "$TMP_MANIFEST"
grep -q "${CP_IP}:${CP_PORT}" "$TMP_NGINX" || { echo "FATAL: source nginx.conf upstream != ${CP_IP}"; exit 4; }
# stage to node5:/tmp then sudo cp (cp doesn't read stdin -> no password/stdin clash)
SCP "$TMP_NGINX"    "${SSH_USER}@${NODE5_IP}:/tmp/nginx.conf"
SCP "$TMP_MANIFEST" "${SSH_USER}@${NODE5_IP}:/tmp/nginx-proxy.yml"
node5_sudo "mkdir -p /etc/nginx /etc/kubernetes/manifests; cp /tmp/nginx.conf /etc/nginx/nginx.conf; cp /tmp/nginx-proxy.yml /etc/kubernetes/manifests/nginx-proxy.yml; rm -f /tmp/nginx.conf /tmp/nginx-proxy.yml"
node5_sudo "systemctl enable kubelet; systemctl restart kubelet"
rm -f "$TMP_NGINX" "$TMP_MANIFEST"

# --- STEP 5: wait Ready ---
log "STEP 5: waiting for node5 Ready (LB + calico recovery, up to 4m)"
kubectl wait --for=condition=Ready "node/${NODE5_NAME}" --timeout=240s \
  || { kubectl describe node "$NODE5_NAME" | tail -20; echo "node5 not Ready"; exit 5; }

# --- STEP 6: label ---
log "STEP 6: labeling node5"
for l in accelerator-type=npu npu-vendor=rebellions npu-model=atomplus accelerator-count=2 benchmark.openkcloud.io/role=benchmark-worker; do
  kubectl label node "$NODE5_NAME" "$l" --overwrite
done

log "=== node5 (Rebellions Atom+) joined + Ready ==="
kubectl get nodes -o wide | grep -E "NAME|${NODE5_NAME}"
log "Reminder: node5/Atom+ is in new-cluster-fixed.yaml; re-run consolidation-app-layer.sh"
log "  (or kubectl rollout restart deploy/etri-llm-backend -n llm-evaluation) so the UI shows it."
log "Rollback: SUDO_PASS=... bash $0 --rollback"
