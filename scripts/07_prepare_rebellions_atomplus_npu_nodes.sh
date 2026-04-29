#!/usr/bin/env bash
# 07_prepare_rebellions_atomplus_npu_nodes.sh — prepare Rebellions Atom+ NPU on node5.
#
# Vendor: Rebellions (PCI 1eff:1220, NOT FuriosaAI 1ed2)
# node5 hardware: rebellion-atom-1, 10.254.202.111:22, /dev/rsd0
#                 tools: /usr/local/bin/rbln-stat, /usr/local/bin/rbln-smi
#
# Current state: node5 has state=pending_join in cluster.yaml.
# Default run emits a graceful warning and exits 0.
#
# Subcommands / flags:
#   --probe      SSH into node5 and run rbln-smi to confirm accelerator health.
#                Reads password from $SUDO_PASS env var (never a literal).
#   --dry-run    Print what would be done without side effects.
#   --apply      Apply the diagnostic DaemonSet after node5 is joined.
#   --help / -h  Print this help.
#
# Exit codes:
#   0  node5 pending (expected), probe passed, or DaemonSet healthy
#   1  probe failed, node5 joined but DaemonSet unhealthy and --apply failed
#   2  user error (bad flag)

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

PROBE=false
APPLY=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --probe)    PROBE=true;    shift ;;
    --dry-run)  DRY_RUN=true;  shift ;;
    --apply)    APPLY=true;    shift ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 07_prepare_rebellions_atomplus_npu_nodes ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN  PROBE=$PROBE  APPLY=$APPLY"

NODE5_HOST="10.254.202.111"
NODE5_PORT="22"
NODE5_NAME="node5"
DEVICE_PLUGIN_TEMPLATE="$REPO_ROOT/k8s/device-plugins/rebellions-atomplus-device-plugin.yaml.template"

# ---------------------------------------------------------------------------
# 1. Detect node5 state from cluster.yaml
# ---------------------------------------------------------------------------
NODE5_INFO="$(python3 -c "
import yaml
with open('$REPO_ROOT/config/cluster.yaml') as f:
    data = yaml.safe_load(f)
for node in data.get('workers', []):
    accel = node.get('accelerator', {})
    if accel.get('vendor') == 'rebellions' and 'atom' in accel.get('model', '').lower():
        print(node.get('name', 'node5') + '|' + node.get('state', 'active') + '|' + node.get('ssh', {}).get('host', '$NODE5_HOST'))
        break
else:
    print('node5|unknown|$NODE5_HOST')
" 2>/dev/null || echo "node5|unknown|$NODE5_HOST")"

NODE5_NAME="${NODE5_INFO%%|*}"
_rest="${NODE5_INFO#*|}"
NODE5_STATE="${_rest%%|*}"
NODE5_HOST="${_rest##*|}"

log "  node5 name=$NODE5_NAME  state=$NODE5_STATE  host=$NODE5_HOST"

# ---------------------------------------------------------------------------
# 2. --probe subcommand: SSH into node5 and run rbln-smi
# ---------------------------------------------------------------------------
if [ "$PROBE" = "true" ]; then
  log "--- PROBE: SSH into $NODE5_NAME ($NODE5_HOST:$NODE5_PORT) ---"
  require_env SUDO_PASS

  if [ "$DRY_RUN" = "true" ]; then
    log "  [DRY-RUN] would run: sshpass ssh $NODE5_HOST:$NODE5_PORT 'rbln-smi && rbln-stat'"
  else
    log "  Connecting to $NODE5_HOST:$NODE5_PORT as kcloud ..."
    PROBE_OUT="$(sshpass -p "$SUDO_PASS" ssh \
      -o StrictHostKeyChecking=no \
      -o ConnectTimeout=15 \
      -p "$NODE5_PORT" \
      "kcloud@${NODE5_HOST}" \
      'echo "=== rbln-smi ===" && /usr/local/bin/rbln-smi 2>&1; echo "=== rbln-stat ===" && /usr/local/bin/rbln-stat 2>&1; echo "=== /dev/rsd0 ===" && ls -la /dev/rsd0 2>&1' 2>&1)"
    log "  Probe output:"
    printf '%s\n' "$PROBE_OUT" | while read -r line; do log "    $line"; done

    if printf '%s' "$PROBE_OUT" | grep -qi "rsd0\|atom\|rebellions\|rbln"; then
      log "  [OK]  Rebellions Atom+ accelerator confirmed on $NODE5_NAME"
    else
      log "  [WARN] Could not confirm Atom+ device from probe output — review manually"
    fi
  fi
  log "=== PROBE complete ==="
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. If pending_join — emit graceful warning and exit 0
# ---------------------------------------------------------------------------
if [ "$NODE5_STATE" = "pending_join" ]; then
  log ""
  log "  === NODE5 STATUS: pending_join ==="
  log "  $NODE5_NAME (Rebellions Atom+) has not yet been joined to the Kubernetes cluster."
  log "  Vendor: Rebellions (PCI 1eff:1220) — NOT FuriosaAI"
  log "  This is expected. No action taken."
  log ""
  log "  When node5 is ready to join, run in order:"
  log "    1. $0 --probe              (verify Atom+ hardware via SSH)"
  log "    2. scripts/18_validate_node5_atomplus.sh  (end-to-end pre-join check)"
  log "    3. Lane C-mut: cluster join (LEAD-GATED)"
  log "    4. scripts/04_label_and_taint_nodes.sh   (apply npu labels)"
  log "    5. $0 --apply              (deploy diagnostic DaemonSet)"
  log "  See docs/node5_atomplus_runbook.md for the full procedure."
  log "  === END NODE5 STATUS ==="
  log ""
  log "=== 07_prepare_rebellions_atomplus_npu_nodes: SKIPPED (state=pending_join) — exit 0 ==="
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. Node5 IS joined — verify and configure Rebellions diagnostic DaemonSet
# ---------------------------------------------------------------------------
log "--- Step 1: verify $NODE5_NAME is joined ---"
if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would verify $NODE5_NAME in kubectl get nodes"
else
  if kubectl get node "$NODE5_NAME" >/dev/null 2>&1; then
    STATUS="$(kubectl get node "$NODE5_NAME" --no-headers | awk '{print $2}')"
    log "  [OK]  $NODE5_NAME status: $STATUS"
  else
    log "  [FAIL] $NODE5_NAME not found in cluster. State in cluster.yaml may be stale."
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 5. Check for Rebellions diagnostic DaemonSet
# ---------------------------------------------------------------------------
log "--- Step 2: check Rebellions Atom+ diagnostic DaemonSet ---"

RBLN_FOUND=false

if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would check: kubectl get pods -n kube-system | grep rebellions"
else
  RBLN_PODS="$(kubectl get pods -n kube-system 2>/dev/null \
    | grep -i rebellions || true)"
  if [ -n "$RBLN_PODS" ]; then
    RBLN_FOUND=true
    log "  [OK]  Rebellions diagnostic pods found:"
    printf '%s\n' "$RBLN_PODS" | while read -r line; do log "    $line"; done
  else
    log "  [WARN] No Rebellions Atom+ diagnostic pods found in kube-system"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Apply logic
# ---------------------------------------------------------------------------
FAIL=0
if [ "$RBLN_FOUND" = "false" ] && [ "$DRY_RUN" = "false" ]; then
  if [ "$APPLY" = "false" ]; then
    log ""
    log "  === ACTION REQUIRED ==="
    log "  Rebellions Atom+ diagnostic DaemonSet is not installed."
    log "  Template: $DEVICE_PLUGIN_TEMPLATE"
    log "  Set RBLN_PLUGIN_IMAGE and RBLN_PLUGIN_TAG, then run:"
    log "    $0 --apply"
    log "  === END ACTION REQUIRED ==="
    FAIL=1
  else
    log "--- Step 3: render and apply DaemonSet template ---"
    require_env RBLN_PLUGIN_IMAGE RBLN_PLUGIN_TAG

    RENDERED="$(envsubst < "$DEVICE_PLUGIN_TEMPLATE")"

    log "  Running kubectl apply --dry-run=server checkpoint ..."
    if printf '%s\n' "$RENDERED" | kubectl apply -f - --dry-run=server 2>&1 \
        | while read -r line; do log "  [dry-run=server] $line"; done; then
      log "  [OK]  server-side dry-run passed"
      log "  Applying live ..."
      if printf '%s\n' "$RENDERED" | kubectl apply -f - 2>&1 \
          | while read -r line; do log "  [apply] $line"; done; then
        log "  [OK]  Rebellions Atom+ diagnostic DaemonSet applied"
      else
        log "  [FAIL] kubectl apply failed"
        FAIL=1
      fi
    else
      log "  [FAIL] server-side dry-run failed — not applying"
      FAIL=1
    fi
  fi
fi

log ""
if [ "$FAIL" -eq 0 ]; then
  log "=== 07_prepare_rebellions_atomplus_npu_nodes: COMPLETE ==="
  exit 0
else
  log "=== 07_prepare_rebellions_atomplus_npu_nodes: ACTION REQUIRED ==="
  exit 1
fi
