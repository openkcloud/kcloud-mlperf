#!/usr/bin/env bash
# 09_deploy_services.sh — deploy app chart with digest pre-check and rollout status.
#
# Wraps scripts/install-app-chart.sh and additionally:
#   - Verifies images.backend.digest and images.frontend.digest in cluster.yaml are non-empty
#   - Refuses to deploy images with "latest" tag or empty digest
#   - Triggers kubectl rollout status for each Deployment after deploy
#
# Usage:
#   ./09_deploy_services.sh [--dry-run] [--values <file>] [--namespace <ns>] [--help]
#
# Exit codes:
#   0  deployed and rollout succeeded
#   1  pre-check failed or deploy failed
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

VALUES_FILE=""
NAMESPACE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)   DRY_RUN=true; shift ;;
    --values)    VALUES_FILE="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2";   shift 2 ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 09_deploy_services ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN"

CLUSTER_YAML="$REPO_ROOT/config/cluster.yaml"
INSTALL_SCRIPT="$SCRIPT_DIR/install-app-chart.sh"
[ -x "$INSTALL_SCRIPT" ] || die "install-app-chart.sh not found at $INSTALL_SCRIPT"

# ---------------------------------------------------------------------------
# 1. Read image metadata from cluster.yaml
# ---------------------------------------------------------------------------
BACKEND_TAG="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d['images']['backend']['tag'])
")"
BACKEND_DIGEST="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d['images']['backend'].get('digest',''))
")"
FRONTEND_TAG="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d['images']['frontend']['tag'])
")"
FRONTEND_DIGEST="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d['images']['frontend'].get('digest',''))
")"
APP_NS="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d.get('namespaces',{}).get('app','llm-evaluation'))
")"
[ -n "$NAMESPACE" ] && APP_NS="$NAMESPACE"

log "  Backend:  tag=$BACKEND_TAG  digest=$(mask_secret "${BACKEND_DIGEST:-<empty>}")"
log "  Frontend: tag=$FRONTEND_TAG  digest=$(mask_secret "${FRONTEND_DIGEST:-<empty>}")"
log "  Namespace: $APP_NS"

# ---------------------------------------------------------------------------
# 2. Pre-checks: refuse "latest" tag or empty digest
# ---------------------------------------------------------------------------
log "--- Step 1: image digest pre-check ---"
FAIL=0

for label in "backend" "frontend"; do
  if [ "$label" = "backend" ]; then
    tag="$BACKEND_TAG"; digest="$BACKEND_DIGEST"
  else
    tag="$FRONTEND_TAG"; digest="$FRONTEND_DIGEST"
  fi

  if [ "$tag" = "latest" ]; then
    log "  [FAIL] $label tag is 'latest' — refusing to deploy. Run 08_build_and_push_images.sh first."
    FAIL=1
  fi

  if [ -z "$digest" ] || [ "$digest" = '""' ] || [ "$digest" = "''" ]; then
    log "  [FAIL] $label digest is empty — refusing to deploy. Run 08_build_and_push_images.sh first."
    FAIL=1
  fi
done

if [ "$FAIL" -ne 0 ]; then
  log "=== 09_deploy_services: PRE-CHECK FAILED — deploy aborted ==="
  exit 1
fi

log "  [OK]  Digest pre-check passed"

# ---------------------------------------------------------------------------
# 3. Deploy
# ---------------------------------------------------------------------------
log "--- Step 2: delegate to install-app-chart.sh ---"

HELM_ARGS=()
[ -n "$VALUES_FILE" ] && HELM_ARGS+=("--values" "$VALUES_FILE")
[ "$DRY_RUN" = "true" ] && HELM_ARGS+=("--dry-run")

LLM_NS="$APP_NS" "$INSTALL_SCRIPT" "${HELM_ARGS[@]:-}"

# ---------------------------------------------------------------------------
# 4. Rollout status (already done by install-app-chart.sh for non-dry-run,
#    but we add explicit logging here for pipeline audit trail)
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" = "false" ]; then
  log "--- Step 3: rollout status verification ---"
  for deploy in etri-llm-backend etri-llm-frontend; do
    if kubectl get deploy -n "$APP_NS" "$deploy" >/dev/null 2>&1; then
      log "  Waiting for $deploy rollout ..."
      if kubectl rollout status -n "$APP_NS" "deploy/$deploy" --timeout=300s; then
        log "  [OK]  $deploy rollout complete"
      else
        log "  [FAIL] $deploy rollout timed out or failed"
        FAIL=1
      fi
    else
      log "  [WARN] Deployment $deploy not found in $APP_NS (chart may use different name)"
    fi
  done
fi

log ""
if [ "$FAIL" -eq 0 ]; then
  log "=== 09_deploy_services: COMPLETE ==="
  exit 0
else
  log "=== 09_deploy_services: FAILED ==="
  exit 1
fi
