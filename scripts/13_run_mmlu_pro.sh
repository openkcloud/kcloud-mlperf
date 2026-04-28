#!/usr/bin/env bash
# 13_run_mmlu_pro.sh — dispatch an MMLU-Pro evaluation run via mm-exam endpoint.
#
# Reads benchmark config from cluster.yaml (targets.mmlu_pro).
# Only runs if cluster smoke test passes (10_run_smoke_tests.sh).
#
# Usage:
#   ./13_run_mmlu_pro.sh [--samples N] [--skip-smoke-check] [--dry-run] [--help]
#
# Flags:
#   --samples N         Samples per subject (default: from cluster.yaml, fallback 100)
#   --skip-smoke-check  Skip prerequisite smoke test
#
# Exit codes:
#   0  dispatch succeeded (or dry-run)
#   1  smoke test failed or dispatch failed
#   2  user error

set -euo pipefail

case "${1:-}" in
  --help|-h)
    sed -n '/^#!/d; /^[^#]/q; s/^# \{0,1\}//; p' "$0"
    exit 0
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/common.sh
source "$SCRIPT_DIR/common.sh"

CLUSTER_YAML="$REPO_ROOT/config/cluster.yaml"
DEFAULT_SAMPLES="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d.get('targets',{}).get('mmlu_pro',{}).get('sample_per_subject',100))
")"

SAMPLES="$DEFAULT_SAMPLES"
SKIP_SMOKE=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)         DRY_RUN=true; shift ;;
    --samples)         SAMPLES="$2"; shift 2 ;;
    --skip-smoke-check) SKIP_SMOKE=true; shift ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 13_run_mmlu_pro ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN  SAMPLES=$SAMPLES  SKIP_SMOKE=$SKIP_SMOKE"

APP_NS="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d.get('namespaces',{}).get('app','llm-evaluation'))
")"
MODEL="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d.get('targets',{}).get('primary',{}).get('model','meta-llama/Llama-3.1-8B-Instruct'))
")"
ACCURACY_METRIC="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d.get('targets',{}).get('mmlu_pro',{}).get('accuracy_metric','pass@1'))
")"

FAIL=0

# ---------------------------------------------------------------------------
# 1. Prerequisite smoke test
# ---------------------------------------------------------------------------
log "--- Step 1: smoke test prerequisite ---"

if [ "$SKIP_SMOKE" = "true" ]; then
  log "  [SKIP] --skip-smoke-check passed"
elif [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would run 10_run_smoke_tests.sh"
else
  if "$SCRIPT_DIR/10_run_smoke_tests.sh" 2>&1 \
      | while read -r line; do log "  smoke: $line"; done; then
    log "  [OK]  Smoke tests passed"
  else
    log "  [FAIL] Smoke tests failed — aborting MMLU-Pro dispatch"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 2. Build request body
# ---------------------------------------------------------------------------
REQUEST_BODY="$(python3 -c "
import json
body = {
    'model': '$MODEL',
    'sample_per_subject': $SAMPLES,
    'accuracy_metric': '$ACCURACY_METRIC',
    'dataset': 'TIGER-Lab/MMLU-Pro',
    'run_id': '$RUN_ID',
    'tags': ['mmlu-pro', 'accuracy']
}
print(json.dumps(body))
")"

log "  Request: $REQUEST_BODY"

# ---------------------------------------------------------------------------
# 3. Discover backend URL
# ---------------------------------------------------------------------------
BACKEND_URL="${BACKEND_URL:-}"
if [ -z "$BACKEND_URL" ]; then
  BACKEND_SVC_IP="$(kubectl get svc -n "$APP_NS" etri-llm-backend \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [ -n "$BACKEND_SVC_IP" ]; then
    BACKEND_URL="http://${BACKEND_SVC_IP}:8000"
  else
    BACKEND_URL="http://localhost:8000"
    log "  [WARN] Could not auto-detect backend URL, using $BACKEND_URL"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Dispatch
# ---------------------------------------------------------------------------
log "--- Step 2: dispatch MMLU-Pro evaluation ---"

if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would POST to ${BACKEND_URL}/api/mm-exam/create"
  log "  [DRY-RUN] body: $REQUEST_BODY"
  log "=== 13_run_mmlu_pro: DRY-RUN COMPLETE ==="
  exit 0
fi

HTTP_CODE="$(curl -s -o "$LOG_DIR/13_mmlu_response.json" \
  -w '%{http_code}' \
  -X POST \
  -H 'Content-Type: application/json' \
  -d "$REQUEST_BODY" \
  --max-time 30 \
  "${BACKEND_URL}/api/mm-exam/create" 2>/dev/null || echo "000")"

log "  Dispatch HTTP code: $HTTP_CODE"
log "  Response saved to: $LOG_DIR/13_mmlu_response.json"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
  log "  [OK]  MMLU-Pro dispatched successfully"
  log "=== 13_run_mmlu_pro: COMPLETE ==="
  exit 0
else
  log "  [FAIL] Dispatch returned HTTP $HTTP_CODE"
  log "=== 13_run_mmlu_pro: FAILED ==="
  exit 1
fi
