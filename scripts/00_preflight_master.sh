#!/usr/bin/env bash
# 00_preflight_master.sh — verify operator workstation prerequisites before any deployment.
#
# Checks:
#   - Required tools present: kubectl, helm, ansible, sshpass, yq/python3-yaml
#   - kubeconfig is valid and kubectl can reach the cluster (kubectl get nodes)
#   - Git working tree is clean (no uncommitted changes)
#
# Usage:
#   ./00_preflight_master.sh [--dry-run] [--help]
#
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed
#   2  user error (bad flag)
#
# Logs to: logs/$RUN_ID/00_preflight_master.log

set -euo pipefail

# --- help
case "${1:-}" in
  --help|-h)
    sed -n '/^#!/d; /^[^#]/q; s/^# \{0,1\}//; p' "$0"
    exit 0
    ;;
esac

# --- source common helpers
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/common.sh
source "$SCRIPT_DIR/common.sh"

# --- parse flags
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 00_preflight_master: operator workstation preflight ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN"

FAIL=0

# ---------------------------------------------------------------------------
# Helper: check_tool NAME [version_flag]
# ---------------------------------------------------------------------------
check_tool() {
  local name="$1"
  local ver_flag="${2:---version}"
  if command -v "$name" >/dev/null 2>&1; then
    local ver
    ver="$("$name" "$ver_flag" 2>&1 | head -1 || true)"
    log "  [OK]  $name  ($ver)"
    return 0
  else
    log "  [FAIL] $name — not found in PATH"
    FAIL=1
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 1. Required CLI tools
# ---------------------------------------------------------------------------
log "--- 1. Required CLI tools ---"

check_tool kubectl version || true
check_tool helm version   || true
check_tool ansible --version || true
check_tool sshpass --version 2>/dev/null || {
  # sshpass prints version to stderr with exit 1 on some versions
  if command -v sshpass >/dev/null 2>&1; then
    log "  [OK]  sshpass (version output varies)"
  else
    log "  [FAIL] sshpass — not found (apt install sshpass)"
    FAIL=1
  fi
}

# yq OR python3+yaml
YQ_OK=false
PY_OK=false
if command -v yq >/dev/null 2>&1; then
  yq_ver="$(yq --version 2>&1 | head -1 || true)"
  log "  [OK]  yq ($yq_ver)"
  YQ_OK=true
fi
if command -v python3 >/dev/null 2>&1 && python3 -c "import yaml" 2>/dev/null; then
  py_ver="$(python3 --version 2>&1)"
  log "  [OK]  python3+yaml ($py_ver)"
  PY_OK=true
fi
if [ "$YQ_OK" = false ] && [ "$PY_OK" = false ]; then
  log "  [FAIL] neither yq nor python3-yaml found (apt install python3-yaml OR snap install yq)"
  FAIL=1
fi

# ---------------------------------------------------------------------------
# 2. kubeconfig validity
# ---------------------------------------------------------------------------
log "--- 2. kubeconfig connectivity ---"
KUBECONFIG_PATH="${KUBECONFIG:-$HOME/.kube/config}"
if [ ! -f "$KUBECONFIG_PATH" ]; then
  log "  [FAIL] kubeconfig not found at $KUBECONFIG_PATH"
  FAIL=1
else
  log "  [OK]  kubeconfig file exists: $KUBECONFIG_PATH"
  if [ "$DRY_RUN" = "true" ]; then
    log "  [DRY-RUN] skipping kubectl get nodes"
  else
    if kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
      NODE_COUNT="$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' ')"
      log "  [OK]  kubectl get nodes succeeded ($NODE_COUNT nodes visible)"
    else
      log "  [FAIL] kubectl get nodes failed — check KUBECONFIG / cluster connectivity"
      FAIL=1
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 3. Git working tree cleanliness
# ---------------------------------------------------------------------------
log "--- 3. Git working tree ---"
if ! command -v git >/dev/null 2>&1; then
  log "  [WARN] git not found, skipping tree-cleanliness check"
elif ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "  [WARN] not inside a git repo, skipping tree-cleanliness check"
else
  DIRTY="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)"
  if [ -z "$DIRTY" ]; then
    BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    log "  [OK]  working tree is clean (branch=$BRANCH commit=$COMMIT)"
  else
    DIRTY_COUNT="$(printf '%s\n' "$DIRTY" | wc -l | tr -d ' ')"
    log "  [WARN] working tree has $DIRTY_COUNT uncommitted change(s):"
    printf '%s\n' "$DIRTY" | while read -r line; do log "         $line"; done
    log "  Consider committing or stashing before deployment."
    # not a hard FAIL — warn only
  fi
fi

# ---------------------------------------------------------------------------
# 4. Summary table
# ---------------------------------------------------------------------------
log ""
log "=== PREFLIGHT SUMMARY ==="
log ""
printf '%-30s %s\n' "Check" "Result" | tee -a "$LOG_DIR/00_preflight_master.log"
printf '%-30s %s\n' "-----" "------" | tee -a "$LOG_DIR/00_preflight_master.log"
printf '%-30s %s\n' "kubectl"         "$(command -v kubectl >/dev/null 2>&1 && echo PASS || echo FAIL)" | tee -a "$LOG_DIR/00_preflight_master.log"
printf '%-30s %s\n' "helm"            "$(command -v helm    >/dev/null 2>&1 && echo PASS || echo FAIL)" | tee -a "$LOG_DIR/00_preflight_master.log"
printf '%-30s %s\n' "ansible"         "$(command -v ansible >/dev/null 2>&1 && echo PASS || echo FAIL)" | tee -a "$LOG_DIR/00_preflight_master.log"
printf '%-30s %s\n' "sshpass"         "$(command -v sshpass >/dev/null 2>&1 && echo PASS || echo FAIL)" | tee -a "$LOG_DIR/00_preflight_master.log"
printf '%-30s %s\n' "yq or python3+yaml" "$([ "$YQ_OK" = true ] || [ "$PY_OK" = true ] && echo PASS || echo FAIL)" | tee -a "$LOG_DIR/00_preflight_master.log"
printf '%-30s %s\n' "kubeconfig file" "$([ -f "${KUBECONFIG:-$HOME/.kube/config}" ] && echo PASS || echo FAIL)" | tee -a "$LOG_DIR/00_preflight_master.log"
if [ "$DRY_RUN" = "true" ]; then
  printf '%-30s %s\n' "kubectl get nodes" "SKIPPED (dry-run)" | tee -a "$LOG_DIR/00_preflight_master.log"
fi
log ""

if [ "$FAIL" -eq 0 ]; then
  log "RESULT: ALL PREFLIGHT CHECKS PASSED [validated, not executed]"
  exit 0
else
  log "RESULT: ONE OR MORE PREFLIGHT CHECKS FAILED — fix issues above before proceeding"
  exit 1
fi
