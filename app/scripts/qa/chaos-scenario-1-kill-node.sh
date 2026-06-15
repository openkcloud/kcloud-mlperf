#!/usr/bin/env bash
# WS-T01 Scenario 1 — Kill node2 mid-sweep
# Pre-condition: a sweep must be running with cells on node2.
# Usage: SWEEP_ID=<id> bash chaos-scenario-1-kill-node.sh
set -euo pipefail

NODE="${CHAOS_NODE:-node2}"
NAMESPACE="${NAMESPACE:-llm-exam}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
SWEEP_ID="${SWEEP_ID:?SWEEP_ID must be set}"

echo "[chaos-1] Pre-check: pods on $NODE"
kubectl get pods -n "$NAMESPACE" -o wide | grep "$NODE" || true

echo "[chaos-1] Draining $NODE (force-evict all pods)"
kubectl drain "$NODE" \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --force \
  --timeout=60s

echo "[chaos-1] Waiting 30s for dispatcher to detect node loss..."
sleep 30

echo "[chaos-1] Asserting: no zombie RUNNING cells on $NODE after eviction"
ZOMBIE_COUNT=$(psql "$DATABASE_URL" -At -c \
  "SELECT count(*) FROM mp_exam WHERE sweep_id=${SWEEP_ID} AND status='RUNNING' AND node_name='${NODE}';")
echo "[chaos-1] Zombie RUNNING count on $NODE: $ZOMBIE_COUNT (expect 0)"
if [ "$ZOMBIE_COUNT" -gt 0 ]; then
  echo "[chaos-1] FAIL: $ZOMBIE_COUNT zombie RUNNING cells remain on $NODE" >&2
fi

echo "[chaos-1] Cell status summary for sweep $SWEEP_ID:"
psql "$DATABASE_URL" -c \
  "SELECT status, failure_reason, count(*) FROM mp_exam WHERE sweep_id=${SWEEP_ID} GROUP BY 1,2 ORDER BY 1,2;"

echo "[chaos-1] NODE_LOST cells:"
psql "$DATABASE_URL" -At -c \
  "SELECT count(*) FROM mp_exam WHERE sweep_id=${SWEEP_ID} AND failure_reason='NODE_LOST';"

echo "[chaos-1] Rollback: uncordoning $NODE"
kubectl uncordon "$NODE"

echo "[chaos-1] Done. Verify surviving cells complete normally."
