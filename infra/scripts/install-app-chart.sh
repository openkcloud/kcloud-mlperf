#!/usr/bin/env bash
# install-app-chart.sh — wrapper for `helm upgrade --install` of the ETRI LLM app chart.
#
# Usage:
#   ./install-app-chart.sh                                   # default namespace llm-evaluation
#   LLM_NS=llm-evaluation-staging ./install-app-chart.sh     # alt namespace via env
#   ./install-app-chart.sh --values ./custom-values.yaml     # override values file
#   ./install-app-chart.sh --dry-run
#   ./install-app-chart.sh --help
#
# Exit codes: 0 ok | 1 missing prereq | 2 user error | 3 helm failure

set -euo pipefail

NS="${LLM_NS:-llm-evaluation}"
VALUES=""
DRY_RUN=false
case "${1:-}" in
  --help|-h) grep '^# ' "$0" | sed 's/^# //'; exit 0 ;;
esac
while [ "$#" -gt 0 ]; do
  case "$1" in
    --values) VALUES="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "ERROR: unknown flag '$1'. See --help." >&2; exit 2 ;;
  esac
done

CHART_DIR="$(cd "$(dirname "$0")/../kubernetes/app-chart" && pwd)"
[ -d "$CHART_DIR" ] || { echo "ERROR: chart not found at $CHART_DIR" >&2; exit 1; }
[ -z "$VALUES" ] && VALUES="$CHART_DIR/values.yaml"
[ -f "$VALUES" ] || { echo "ERROR: values file '$VALUES' not found" >&2; exit 1; }

command -v helm >/dev/null || { echo "ERROR: helm missing" >&2; exit 1; }
command -v kubectl >/dev/null || { echo "ERROR: kubectl missing" >&2; exit 1; }

# Ensure namespace exists
if ! kubectl get ns "$NS" >/dev/null 2>&1; then
  echo "Creating namespace $NS"
  kubectl create ns "$NS"
fi

ARGS=(-n "$NS" app-chart "$CHART_DIR" -f "$VALUES")
$DRY_RUN && ARGS+=(--dry-run)

echo "=== helm upgrade --install (namespace=$NS values=$VALUES dry-run=$DRY_RUN) ==="
helm upgrade --install "${ARGS[@]}"

if [ "$DRY_RUN" = false ]; then
  echo "=== rollout status ==="
  kubectl rollout status -n "$NS" deploy/etri-llm-backend --timeout=180s
  kubectl rollout status -n "$NS" deploy/etri-llm-frontend --timeout=180s
fi
