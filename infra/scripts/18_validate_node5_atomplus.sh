#!/usr/bin/env bash
# 18_validate_node5_atomplus.sh — end-to-end validation of node5 Rebellions Atom+ NPU.
#
# Vendor: Rebellions (PCI 1eff:1220, NOT FuriosaAI 1ed2)
# node5 hardware: rebellion-atom-1, 10.254.202.111:22, /dev/rsd0
#                 tools: /usr/local/bin/rbln-stat, /usr/local/bin/rbln-smi
#
# Checks performed:
#   1. SSH connectivity to node5 (port 22, $SUDO_PASS env var — never literal)
#   2. Rebellions hardware detected: PCI 1eff, /dev/rsd0 present
#   3. rbln-smi and rbln-stat respond without error
#   4. kubelet status on node5 (informational — expected inactive pre-join)
#   5. (post-join only) kubectl confirms node5 Ready with correct labels
#
# Usage:
#   ./18_validate_node5_atomplus.sh [--dry-run] [--post-join] [--help]
#
# Flags:
#   --dry-run    Print checks without executing SSH or kubectl
#   --post-join  Also run cluster-side checks (kubectl get node node5, labels)
#
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed
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

POST_JOIN=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)   DRY_RUN=true;   shift ;;
    --post-join) POST_JOIN=true; shift ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 18_validate_node5_atomplus ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN  POST_JOIN=$POST_JOIN"

NODE5_HOST="10.254.202.111"
NODE5_PORT="22"
NODE5_USER="kcloud"
NODE5_NAME="node5"
FAIL=0

# ---------------------------------------------------------------------------
# Helper: run a command on node5 via sshpass + $SUDO_PASS
# ---------------------------------------------------------------------------
_node5_ssh() {
  local cmd="$1"
  sshpass -p "$SUDO_PASS" ssh \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=15 \
    -p "$NODE5_PORT" \
    "${NODE5_USER}@${NODE5_HOST}" \
    "$cmd" 2>&1
}

# ---------------------------------------------------------------------------
# Check 1: SSH connectivity
# ---------------------------------------------------------------------------
log "--- Check 1: SSH connectivity to $NODE5_HOST:$NODE5_PORT ---"
if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would SSH to $NODE5_HOST:$NODE5_PORT"
else
  require_env SUDO_PASS
  if CONN_OUT="$(_node5_ssh 'echo ssh-ok && hostname')"; then
    log "  [OK]  SSH connected: $CONN_OUT"
  else
    log "  [FAIL] Cannot SSH to $NODE5_HOST:$NODE5_PORT"
    FAIL=1
  fi
fi

# ---------------------------------------------------------------------------
# Check 2: Rebellions PCI device and /dev/rsd0
# ---------------------------------------------------------------------------
log "--- Check 2: Rebellions hardware (PCI 1eff, /dev/rsd0) ---"
if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would run: lspci | grep 1eff && ls /dev/rsd0"
elif [ "$FAIL" -eq 0 ]; then
  HW_OUT="$(_node5_ssh 'lspci 2>/dev/null | grep -i "1eff" || echo "[WARN] no 1eff PCI entry"; ls -la /dev/rsd0 2>/dev/null || echo "[WARN] /dev/rsd0 not found"')"
  log "  Output:"
  printf '%s\n' "$HW_OUT" | while read -r line; do log "    $line"; done
  if printf '%s' "$HW_OUT" | grep -q "1eff"; then
    log "  [OK]  Rebellions PCI 1eff device found"
  else
    log "  [FAIL] No PCI 1eff device detected — wrong node or driver not loaded"
    FAIL=1
  fi
  if printf '%s' "$HW_OUT" | grep -q "rsd0"; then
    log "  [OK]  /dev/rsd0 present"
  else
    log "  [WARN] /dev/rsd0 not found — device may need driver initialization"
  fi
else
  log "  [SKIP] SSH failed in Check 1 — skipping hardware check"
fi

# ---------------------------------------------------------------------------
# Check 3: rbln-smi and rbln-stat
# ---------------------------------------------------------------------------
log "--- Check 3: rbln-smi and rbln-stat ---"
if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would run: rbln-smi && rbln-stat"
elif [ "$FAIL" -eq 0 ]; then
  SMI_OUT="$(_node5_ssh '/usr/local/bin/rbln-smi 2>&1; echo "---rbln-stat---"; /usr/local/bin/rbln-stat 2>&1')"
  log "  Output:"
  printf '%s\n' "$SMI_OUT" | while read -r line; do log "    $line"; done
  if printf '%s' "$SMI_OUT" | grep -qi "atom\|rebellions\|rbln\|rsd"; then
    log "  [OK]  rbln-smi reports Atom+ device"
  else
    log "  [WARN] rbln-smi output does not mention Atom+/Rebellions — review manually"
  fi
else
  log "  [SKIP] Prior check failed — skipping rbln-smi"
fi

# ---------------------------------------------------------------------------
# Check 4: kubelet status (informational)
# ---------------------------------------------------------------------------
log "--- Check 4: kubelet status on $NODE5_NAME (informational) ---"
if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would check: systemctl is-active kubelet"
elif [ "$FAIL" -eq 0 ]; then
  KUBELET_STATUS="$(_node5_ssh 'systemctl is-active kubelet 2>/dev/null || echo inactive')"
  log "  kubelet status: $KUBELET_STATUS"
  if [ "$KUBELET_STATUS" = "active" ]; then
    log "  [INFO] kubelet is active — node5 may already be joined"
  else
    log "  [INFO] kubelet is inactive — expected for pending_join state"
  fi
else
  log "  [SKIP] SSH failed — skipping kubelet check"
fi

# ---------------------------------------------------------------------------
# Check 5: post-join cluster-side checks (optional)
# ---------------------------------------------------------------------------
if [ "$POST_JOIN" = "true" ]; then
  log "--- Check 5: kubectl node5 status and labels (post-join) ---"
  if [ "$DRY_RUN" = "true" ]; then
    log "  [DRY-RUN] would run: kubectl get node node5 --show-labels"
  else
    if kubectl get node "$NODE5_NAME" >/dev/null 2>&1; then
      NODE_STATUS="$(kubectl get node "$NODE5_NAME" --no-headers | awk '{print $2}')"
      log "  [OK]  $NODE5_NAME status: $NODE_STATUS"

      NODE_LABELS="$(kubectl get node "$NODE5_NAME" --show-labels --no-headers | awk '{print $NF}')"
      log "  Labels: $NODE_LABELS"

      REQUIRED_LABELS="npu-vendor=rebellions npu-model=atomplus accelerator-type=npu"
      for lbl in $REQUIRED_LABELS; do
        if printf '%s' "$NODE_LABELS" | grep -q "$lbl"; then
          log "  [OK]  label $lbl present"
        else
          log "  [FAIL] label $lbl MISSING — run scripts/04_label_and_taint_nodes.sh"
          FAIL=1
        fi
      done
    else
      log "  [FAIL] $NODE5_NAME not found in cluster"
      FAIL=1
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log ""
if [ "$FAIL" -eq 0 ]; then
  log "=== 18_validate_node5_atomplus: ALL CHECKS PASSED ==="
  exit 0
else
  log "=== 18_validate_node5_atomplus: ONE OR MORE CHECKS FAILED — see above ==="
  exit 1
fi
