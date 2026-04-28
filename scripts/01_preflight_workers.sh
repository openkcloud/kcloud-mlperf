#!/usr/bin/env bash
# 01_preflight_workers.sh — SSH into each non-pending worker and verify prerequisites.
#
# Checks per node:
#   - hostname resolves
#   - OS is Ubuntu 22.04
#   - kernel >= 5.15
#   - swap is off
#   - containerd >= 1.7 is installed
#
# Reads node list from config/cluster.yaml. Skips nodes with state=pending_join.
#
# Usage:
#   ./01_preflight_workers.sh [--dry-run] [--help]
#
# Exit codes:
#   0  all reachable nodes passed
#   1  one or more nodes failed checks
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

log "=== 01_preflight_workers: worker node preflight ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN"

OVERALL_FAIL=0

# ---------------------------------------------------------------------------
# check_node NAME HOST PORT
# ---------------------------------------------------------------------------
check_node() {
  local name="$1"
  local host="$2"
  local port="$3"
  local node_fail=0

  log "--- node: $name ($host:$port) ---"

  if [ "$DRY_RUN" = "true" ]; then
    log "  [DRY-RUN] skipping SSH checks for $name"
    return 0
  fi

  # Collect all facts in one SSH round-trip
  local facts
  if ! facts="$(_ssh_cmd "$host" "$port" '
    echo "HOSTNAME=$(hostname)"
    echo "OS=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d \")"
    echo "KERNEL=$(uname -r)"
    echo "SWAP_LINES=$(swapon --show 2>/dev/null | wc -l)"
    CTR=$(containerd --version 2>/dev/null | awk "{print \$3}" || echo "not_found")
    echo "CONTAINERD=$CTR"
  ' 2>&1)"; then
    log "  [FAIL] cannot SSH to $name at $host:$port"
    OVERALL_FAIL=1
    return 1
  fi

  # Parse facts
  local hostname os_str kernel swap_lines containerd_ver
  hostname="$(     printf '%s\n' "$facts" | grep '^HOSTNAME='   | cut -d= -f2)"
  os_str="$(       printf '%s\n' "$facts" | grep '^OS='         | cut -d= -f2-)"
  kernel="$(       printf '%s\n' "$facts" | grep '^KERNEL='     | cut -d= -f2)"
  swap_lines="$(   printf '%s\n' "$facts" | grep '^SWAP_LINES=' | cut -d= -f2)"
  containerd_ver="$(printf '%s\n' "$facts" | grep '^CONTAINERD=' | cut -d= -f2)"

  # Hostname
  log "  hostname:    $hostname"

  # OS check
  if printf '%s' "$os_str" | grep -qi '22.04'; then
    log "  [OK]  OS: $os_str"
  else
    log "  [FAIL] OS not Ubuntu 22.04: '$os_str'"
    node_fail=1
  fi

  # Kernel >= 5.15
  local kver_major kver_minor
  kver_major="$(printf '%s' "$kernel" | cut -d. -f1)"
  kver_minor="$(printf '%s' "$kernel" | cut -d. -f2)"
  if [ "$kver_major" -gt 5 ] || { [ "$kver_major" -eq 5 ] && [ "$kver_minor" -ge 15 ]; }; then
    log "  [OK]  kernel: $kernel (>= 5.15)"
  else
    log "  [FAIL] kernel $kernel is below 5.15"
    node_fail=1
  fi

  # Swap off
  if [ "${swap_lines:-0}" -le 1 ]; then
    # wc -l on empty output = 0; header line = 1 means no active swap
    log "  [OK]  swap: off"
  else
    log "  [FAIL] swap is active ($((swap_lines - 1)) partition(s))"
    node_fail=1
  fi

  # containerd >= 1.7
  if [ "$containerd_ver" = "not_found" ] || [ -z "$containerd_ver" ]; then
    log "  [FAIL] containerd not found"
    node_fail=1
  else
    local c_major c_minor
    # strip leading 'v'
    local c_clean="${containerd_ver#v}"
    c_major="$(printf '%s' "$c_clean" | cut -d. -f1)"
    c_minor="$(printf '%s' "$c_clean" | cut -d. -f2)"
    if [ "$c_major" -gt 1 ] || { [ "$c_major" -eq 1 ] && [ "$c_minor" -ge 7 ]; }; then
      log "  [OK]  containerd: $containerd_ver (>= 1.7)"
    else
      log "  [FAIL] containerd $containerd_ver is below 1.7"
      node_fail=1
    fi
  fi

  if [ "$node_fail" -eq 0 ]; then
    log "  RESULT: $name PASS"
  else
    log "  RESULT: $name FAIL"
    OVERALL_FAIL=1
  fi
}

# ---------------------------------------------------------------------------
# Iterate nodes from cluster.yaml
# ---------------------------------------------------------------------------
_node_callback() {
  local name="$1" role="$2" host="$3" port="$4" state="$5"
  # skip control_plane (preflight_master covers the workstation side)
  # skip pending_join nodes
  if [ "$state" = "pending_join" ]; then
    log "--- node: $name — SKIPPED (state=pending_join) ---"
    return 0
  fi
  check_node "$name" "$host" "$port"
}

# Export functions needed by the python subprocess callback
export -f check_node log die _ssh_cmd _node_callback
export OVERALL_FAIL REPO_ROOT LOG_DIR DRY_RUN SUDO_PASS RUN_ID

# We need a different approach since for_each_node_yaml uses subprocess
# Parse cluster.yaml directly with python3 and iterate in bash
python3 - "$REPO_ROOT/config/cluster.yaml" <<'PYEOF' | while IFS='|' read -r name role host port state _labels; do
import yaml, sys
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
default_port = data.get('ssh', {}).get('default_port', 22)
all_nodes = []
for n in data.get('control_plane', []):
    n.setdefault('role', 'master')
    all_nodes.append(n)
for n in data.get('workers', []):
    n.setdefault('role', 'worker')
    all_nodes.append(n)
for node in all_nodes:
    name  = node.get('name', '')
    role  = node.get('role', 'worker')
    host  = node.get('ssh', {}).get('host', '')
    port  = str(node.get('ssh', {}).get('port', default_port))
    state = node.get('state', 'active')
    print(f"{name}|{role}|{host}|{port}|{state}|")
PYEOF
  if [ "$state" = "pending_join" ]; then
    log "--- node: $name --- SKIPPED (state=pending_join) ---"
    continue
  fi
  check_node "$name" "$host" "$port"
done

log ""
if [ "$OVERALL_FAIL" -eq 0 ]; then
  log "=== 01_preflight_workers: ALL NODES PASSED [validated] ==="
  exit 0
else
  log "=== 01_preflight_workers: ONE OR MORE NODES FAILED ==="
  exit 1
fi
