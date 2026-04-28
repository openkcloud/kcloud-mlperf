#!/usr/bin/env bash
# 05_prepare_gpu_nodes.sh — sanity-check NVIDIA GPU Operator on node2/node3.
#
# Checks:
#   - GPU Operator pods are running in the gpu-operator namespace
#   - nvidia-smi works inside the nvidia-driver-daemonset pod on each GPU node
#
# --dry-run prints what would be checked/installed without executing.
# Install path: scaffold only — if operator is missing, emits "operator action required"
# and does NOT install automatically.
#
# Usage:
#   ./05_prepare_gpu_nodes.sh [--dry-run] [--help]
#
# Exit codes:
#   0  GPU operator healthy on all GPU nodes
#   1  operator unhealthy or missing (action required)
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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 05_prepare_gpu_nodes ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN"

FAIL=0

# ---------------------------------------------------------------------------
# 1. Check GPU operator namespace + pods
# ---------------------------------------------------------------------------
log "--- Step 1: GPU Operator pod health ---"

if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would run: kubectl get pods -n gpu-operator"
  log "  [DRY-RUN] would check pod readiness for all gpu-operator pods"
else
  if ! kubectl get namespace gpu-operator >/dev/null 2>&1; then
    log "  [FAIL] namespace 'gpu-operator' does not exist"
    log ""
    log "  === OPERATOR ACTION REQUIRED ==="
    log "  The NVIDIA GPU Operator is not installed."
    log "  To install (do NOT run this script for installation — use helm):"
    log "    helm repo add nvidia https://helm.ngc.nvidia.com/nvidia"
    log "    helm repo update"
    log "    helm install gpu-operator nvidia/gpu-operator \\"
    log "      -n gpu-operator --create-namespace \\"
    log "      --set driver.enabled=true \\"
    log "      --set toolkit.enabled=true \\"
    log "      --set devicePlugin.enabled=true"
    log "  === END OPERATOR ACTION REQUIRED ==="
    FAIL=1
  else
    log "  Namespace gpu-operator exists."
    POD_STATUS="$(kubectl get pods -n gpu-operator --no-headers 2>/dev/null || true)"
    if [ -z "$POD_STATUS" ]; then
      log "  [FAIL] No pods found in gpu-operator namespace"
      FAIL=1
    else
      TOTAL="$(printf '%s\n' "$POD_STATUS" | wc -l | tr -d ' ')"
      NOT_RUNNING="$(printf '%s\n' "$POD_STATUS" | grep -v -E 'Running|Completed' | wc -l | tr -d ' ')"
      log "  Pods in gpu-operator: $TOTAL total, $NOT_RUNNING not Running/Completed"
      if [ "$NOT_RUNNING" -gt 0 ]; then
        log "  [FAIL] Some GPU operator pods are not healthy:"
        printf '%s\n' "$POD_STATUS" | grep -v -E 'Running|Completed' \
          | while read -r line; do log "    $line"; done
        FAIL=1
      else
        log "  [OK]  All GPU operator pods are Running/Completed"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 2. Check nvidia-smi via exec on each GPU node
# ---------------------------------------------------------------------------
log "--- Step 2: nvidia-smi check on GPU nodes ---"

# Get GPU node names from cluster.yaml
GPU_NODES="$(python3 -c "
import yaml
with open('$REPO_ROOT/config/cluster.yaml') as f:
    data = yaml.safe_load(f)
for node in data.get('workers', []):
    accel = node.get('accelerator', {})
    if accel.get('vendor') == 'nvidia' and node.get('state', 'active') != 'pending_join':
        print(node['name'])
")"

if [ -z "$GPU_NODES" ]; then
  log "  No active NVIDIA GPU nodes found in cluster.yaml"
else
  for gpu_node in $GPU_NODES; do
    log "  Checking nvidia-smi on $gpu_node ..."

    if [ "$DRY_RUN" = "true" ]; then
      log "  [DRY-RUN] would find nvidia-driver pod on $gpu_node and exec nvidia-smi"
      continue
    fi

    # Find the nvidia-driver pod on this node
    DRIVER_POD="$(kubectl get pods -n gpu-operator \
      --field-selector "spec.nodeName=${gpu_node}" \
      --no-headers 2>/dev/null \
      | grep nvidia-driver \
      | awk '{print $1}' \
      | head -1 || true)"

    if [ -z "$DRIVER_POD" ]; then
      log "  [FAIL] No nvidia-driver pod found on $gpu_node"
      log "         (operator may not have scheduled driver pod yet)"
      FAIL=1
      continue
    fi

    log "  Using pod: $DRIVER_POD"
    if kubectl exec -n gpu-operator "$DRIVER_POD" -- nvidia-smi \
        --query-gpu=name,memory.total,driver_version \
        --format=csv,noheader 2>&1 \
        | while read -r line; do log "    nvidia-smi: $line"; done; then
      log "  [OK]  nvidia-smi succeeded on $gpu_node"
    else
      log "  [FAIL] nvidia-smi failed on $gpu_node"
      FAIL=1
    fi
  done
fi

log ""
if [ "$FAIL" -eq 0 ]; then
  log "=== 05_prepare_gpu_nodes: GPU OPERATOR HEALTHY [validated, not executed] ==="
  exit 0
else
  log "=== 05_prepare_gpu_nodes: ACTION REQUIRED — see messages above ==="
  exit 1
fi
