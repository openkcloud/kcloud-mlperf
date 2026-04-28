#!/usr/bin/env bash
# 11_run_mlperf_performance.sh — dispatch MLPerf inference performance scenario.
#
# SCAFFOLD — reads MLPerf legitimacy verdict from reports/mlperf_legitimacy_report.md.
#
# If verdict is STRICT_COMPLIANT:
#   Dispatches via POST /api/mp-exam/create with performance scenario parameters
#   (scenario=offline, precision=fp8, model=Llama-3.1-8B-Instruct).
#
# If verdict is anything else:
#   Exits 78 (sysexits EX_CONFIG — configuration error).
#
# Usage:
#   ./11_run_mlperf_performance.sh [--dry-run] [--help]
#
# Exit codes:
#   0   dispatch succeeded (or dry-run)
#   1   dispatch failed
#   2   user error
#   78  MLPerf compliance verdict is not STRICT_COMPLIANT

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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 11_run_mlperf_performance ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN"

LEGITIMACY_REPORT="$REPO_ROOT/reports/mlperf_legitimacy_report.md"

log "MLPerf compliance status: see $LEGITIMACY_REPORT"
log "This script dispatches MLPerf PERFORMANCE (offline) scenario."

# ---------------------------------------------------------------------------
# 1. Check legitimacy report
# ---------------------------------------------------------------------------
log "--- Step 1: read legitimacy verdict ---"

if [ ! -f "$LEGITIMACY_REPORT" ]; then
  log "  [FAIL] Legitimacy report not found: $LEGITIMACY_REPORT"
  log "  Run 15_validate_legitimacy.sh first, or generate report manually."
  exit 78
fi

VERDICT="$(grep -i 'verdict\|VERDICT\|STRICT_COMPLIANT\|NON_COMPLIANT\|PARTIAL' \
  "$LEGITIMACY_REPORT" 2>/dev/null \
  | head -1 \
  | grep -o 'STRICT_COMPLIANT\|NON_COMPLIANT\|PARTIAL_COMPLIANT\|UNKNOWN' \
  || true)"

log "  Verdict extracted: '${VERDICT:-<not found>}'"

if [ "$VERDICT" != "STRICT_COMPLIANT" ]; then
  log ""
  log "  === MLPerf compliance is NOT STRICT_COMPLIANT ==="
  log "  Verdict: '${VERDICT:-unknown}'"
  log "  Performance scenario dispatch is blocked."
  log "  Resolve compliance issues in $LEGITIMACY_REPORT"
  log "  and re-run 15_validate_legitimacy.sh before dispatching."
  log "  Exiting with code 78 (EX_CONFIG)."
  exit 78
fi

log "  [OK]  Verdict is STRICT_COMPLIANT — proceeding with dispatch"

# ---------------------------------------------------------------------------
# 2. Load dispatch parameters from cluster.yaml
# ---------------------------------------------------------------------------
CLUSTER_YAML="$REPO_ROOT/config/cluster.yaml"
MODEL="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d['targets']['primary']['model'])
")"
PRECISION="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d['targets']['primary']['precision'])
")"
APP_NS="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d.get('namespaces',{}).get('app','llm-evaluation'))
")"

log "  model=$MODEL  precision=$PRECISION  ns=$APP_NS"

# Request body for performance scenario (offline)
REQUEST_BODY="$(python3 -c "
import json
body = {
    'scenario': 'offline',
    'data_number': 24576,
    'precision': '$PRECISION',
    'model': '$MODEL',
    'run_id': '$RUN_ID',
    'tags': ['mlperf-5.1', 'performance', 'offline']
}
print(json.dumps(body))
")"

log "  Request body: $REQUEST_BODY"

# ---------------------------------------------------------------------------
# 3. Dispatch
# ---------------------------------------------------------------------------
log "--- Step 2: dispatch via operator pipeline ---"

# Discover backend URL (same logic as smoke tests)
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

if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would POST to ${BACKEND_URL}/api/mp-exam/create"
  log "  [DRY-RUN] body: $REQUEST_BODY"
  log "=== 11_run_mlperf_performance: DRY-RUN COMPLETE ==="
  exit 0
fi

HTTP_CODE="$(curl -s -o "$LOG_DIR/11_dispatch_response.json" \
  -w '%{http_code}' \
  -X POST \
  -H 'Content-Type: application/json' \
  -d "$REQUEST_BODY" \
  --max-time 30 \
  "${BACKEND_URL}/api/mp-exam/create" 2>/dev/null || echo "000")"

log "  Dispatch HTTP code: $HTTP_CODE"
log "  Response saved to: $LOG_DIR/11_dispatch_response.json"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
  log "  [OK]  Performance scenario dispatched successfully"
  log "=== 11_run_mlperf_performance: COMPLETE ==="
  exit 0
else
  log "  [FAIL] Dispatch returned HTTP $HTTP_CODE"
  log "=== 11_run_mlperf_performance: FAILED ==="
  exit 1
fi
