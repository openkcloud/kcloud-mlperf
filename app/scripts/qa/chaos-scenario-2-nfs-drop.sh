#!/usr/bin/env bash
# WS-T01 Scenario 2 — Drop NFS connectivity for 60s during benchmark
# Pre-condition: pumba must be installed and accessible in PATH.
# Usage: EXAM_ID=<id> BENCHMARK_POD=<pod-name> bash chaos-scenario-2-nfs-drop.sh
set -euo pipefail

NAMESPACE="${NAMESPACE:-llm-exam}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
EXAM_ID="${EXAM_ID:?EXAM_ID must be set}"
CHAOS_DURATION="${CHAOS_DURATION:-60s}"

echo "[chaos-2] Pre-check: NFS mounts on benchmark nodes"
kubectl get pods -n "$NAMESPACE" -o wide | grep Running || true

# Identify the NFS server pod (adjust label selector as needed)
NFS_POD=$(kubectl get pods -n nfs-system -l role=nfs-server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null \
  || kubectl get pods -n "$NAMESPACE" -l role=nfs-server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null \
  || echo "")

if [ -z "$NFS_POD" ]; then
  echo "[chaos-2] WARNING: NFS server pod not found via label selector. Set NFS_POD env var manually." >&2
  NFS_POD="${NFS_POD:-nfs-server-pod-name}"
fi

echo "[chaos-2] Injecting 100% packet loss on NFS pod '$NFS_POD' for $CHAOS_DURATION via pumba"
pumba netem \
  --tc-image gaiadocker/iproute2 \
  --duration "$CHAOS_DURATION" \
  loss --percent 100 \
  "$NFS_POD" &

PUMBA_PID=$!
echo "[chaos-2] pumba PID=$PUMBA_PID — chaos active for $CHAOS_DURATION"

echo "[chaos-2] Waiting for chaos duration to elapse..."
wait $PUMBA_PID || true

echo "[chaos-2] Chaos ended. NFS should reconnect automatically."
sleep 10

echo "[chaos-2] Asserting: result persisted for exam $EXAM_ID"
RESULT_COUNT=$(psql "$DATABASE_URL" -At -c \
  "SELECT count(*) FROM mp_exam_result WHERE exam_id=${EXAM_ID};")
echo "[chaos-2] Result rows for exam $EXAM_ID: $RESULT_COUNT (expect 1)"
if [ "$RESULT_COUNT" -ne 1 ]; then
  echo "[chaos-2] WARN: expected 1 result row, got $RESULT_COUNT" >&2
fi

echo "[chaos-2] Asserting: no duplicate result rows"
DUP_COUNT=$(psql "$DATABASE_URL" -At -c \
  "SELECT count(*) FROM (SELECT exam_id FROM mp_exam_result WHERE exam_id=${EXAM_ID} GROUP BY exam_id,result_number HAVING count(*)>1) sub;")
echo "[chaos-2] Duplicate result rows: $DUP_COUNT (expect 0)"

echo "[chaos-2] Done."
