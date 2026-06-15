#!/usr/bin/env bash
# WS-T04 — DR drill: PostgreSQL restore from pg_dump backup
# Pre-conditions:
#   - BACKUP_FILE points to a valid pg_dump output file (.dump or .sql)
#   - DATABASE_URL is set (postgres://user:pass@host:port/dbname)
#   - kubectl is configured for the target cluster
#   - Application is scaled down before running this script
#
# Usage:
#   BACKUP_FILE=/backups/postgres/latest.dump \
#   DATABASE_URL=postgres://llm:pass@localhost:5432/llmexam \
#   NAMESPACE=llm-exam \
#   bash dr-pg-restore.sh
set -euo pipefail

NAMESPACE="${NAMESPACE:-llm-exam}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_FILE="${BACKUP_FILE:?BACKUP_FILE must be set (path to pg_dump file)}"
APP_DEPLOYMENT="${APP_DEPLOYMENT:-llm-exam-server}"
PG_STATEFULSET="${PG_STATEFULSET:-postgresql}"

echo "[dr-restore] Checking backup file: $BACKUP_FILE"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "[dr-restore] ERROR: backup file not found: $BACKUP_FILE" >&2
  echo "[dr-restore] GAP: Nightly pg_dump to durable store is not yet confirmed." >&2
  echo "[dr-restore] Action required: provision a CronJob to produce backups." >&2
  exit 1
fi

echo "[dr-restore] Backup file: $(ls -lh "$BACKUP_FILE")"

# Step 1: Scale down the application to prevent writes during restore
echo "[dr-restore] Step 1: Scaling down application ($APP_DEPLOYMENT)"
kubectl scale deployment "$APP_DEPLOYMENT" -n "$NAMESPACE" --replicas=0
kubectl wait deployment "$APP_DEPLOYMENT" -n "$NAMESPACE" \
  --for=jsonpath='{.status.availableReplicas}'=0 --timeout=60s || true
sleep 5

# Step 2: Record pre-restore state
echo "[dr-restore] Step 2: Pre-restore row counts"
psql "$DATABASE_URL" -c "SELECT 'mp_exam', count(*) FROM mp_exam UNION ALL SELECT 'mp_exam_result', count(*) FROM mp_exam_result UNION ALL SELECT 'npu_exam', count(*) FROM npu_exam;" || true

# Step 3: Drop and recreate the database schema
echo "[dr-restore] Step 3: Dropping existing database objects"
DB_NAME=$(echo "$DATABASE_URL" | sed 's|.*/||')
ADMIN_URL=$(echo "$DATABASE_URL" | sed "s|/${DB_NAME}|/postgres|")

psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS ${DB_NAME};"
psql "$ADMIN_URL" -c "CREATE DATABASE ${DB_NAME};"

# Step 4: Restore from pg_dump
echo "[dr-restore] Step 4: Restoring from $BACKUP_FILE"
if [[ "$BACKUP_FILE" == *.dump ]]; then
  pg_restore --no-owner --no-acl -d "$DATABASE_URL" "$BACKUP_FILE"
else
  psql "$DATABASE_URL" < "$BACKUP_FILE"
fi

echo "[dr-restore] Restore complete."

# Step 5: Post-restore validation
echo "[dr-restore] Step 5: Post-restore row counts"
psql "$DATABASE_URL" -c "SELECT 'mp_exam', count(*) FROM mp_exam UNION ALL SELECT 'mp_exam_result', count(*) FROM mp_exam_result UNION ALL SELECT 'npu_exam', count(*) FROM npu_exam;"

# Step 6: Scale application back up
echo "[dr-restore] Step 6: Scaling application back up ($APP_DEPLOYMENT)"
kubectl scale deployment "$APP_DEPLOYMENT" -n "$NAMESPACE" --replicas=1
kubectl wait deployment "$APP_DEPLOYMENT" -n "$NAMESPACE" \
  --for=condition=Available --timeout=120s

echo "[dr-restore] Step 7: Health check"
sleep 5
curl -sf "http://localhost:3000/api/health" | grep -q '"status":"ok"' \
  && echo "[dr-restore] PASS: application healthy after restore" \
  || echo "[dr-restore] WARN: health check did not return ok — check manually"

echo "[dr-restore] DR drill complete."
