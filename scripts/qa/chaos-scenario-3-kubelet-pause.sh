#!/usr/bin/env bash
# WS-T01 Scenario 3 — Pause kubelet on node5 for 30s
# Pre-condition: SSH access to node5 with sudo; atomplus pod running on node5.
# Usage: DATABASE_URL=<url> bash chaos-scenario-3-kubelet-pause.sh
set -euo pipefail

NODE="${CHAOS_NODE:-node5}"
NAMESPACE="${NAMESPACE:-llm-exam}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
PAUSE_SECONDS="${PAUSE_SECONDS:-30}"
SSH_USER="${SSH_USER:-ubuntu}"

echo "[chaos-3] Pre-check: atomplus pods on $NODE"
kubectl get pods -n "$NAMESPACE" -o wide | grep "$NODE" | grep -i atomplus || true

echo "[chaos-3] Pausing kubelet on $NODE for ${PAUSE_SECONDS}s via SSH"
ssh "${SSH_USER}@${NODE}" "sudo systemctl stop kubelet && sleep ${PAUSE_SECONDS} && sudo systemctl start kubelet" &
SSH_PID=$!

echo "[chaos-3] Waiting for node-monitor-grace-period (~40s) to mark $NODE NotReady..."
sleep 40

echo "[chaos-3] Node status during pause:"
kubectl get node "$NODE" --no-headers | awk '{print $2}' || true

echo "[chaos-3] Waiting for kubelet to resume and node to become Ready..."
wait $SSH_PID || true

kubectl wait "node/$NODE" --for=condition=Ready --timeout=120s
echo "[chaos-3] $NODE is Ready"

echo "[chaos-3] Asserting: no Unknown pods remain on $NODE after 5 minutes"
sleep 60  # allow rescheduling
UNKNOWN_COUNT=$(kubectl get pods -n "$NAMESPACE" -o wide \
  | awk -v node="$NODE" '$8==node && $4!="Running" && $4!="Completed" && $4!="Terminating" {print}' \
  | wc -l)
echo "[chaos-3] Unknown/non-terminal pods on $NODE: $UNKNOWN_COUNT (expect 0)"
if [ "$UNKNOWN_COUNT" -gt 0 ]; then
  echo "[chaos-3] FAIL: $UNKNOWN_COUNT unexpected pod states on $NODE" >&2
  kubectl get pods -n "$NAMESPACE" -o wide | grep "$NODE" >&2
fi

echo "[chaos-3] Asserting: no zombie RUNNING cells in DB for node5"
ZOMBIE_COUNT=$(psql "$DATABASE_URL" -At -c \
  "SELECT count(*) FROM npu_exam WHERE status='RUNNING' AND node_name='${NODE}' AND updated_at < now() - interval '10 minutes';" 2>/dev/null || echo "0")
echo "[chaos-3] Zombie RUNNING npu_exam rows on $NODE: $ZOMBIE_COUNT (expect 0)"

echo "[chaos-3] Done."
