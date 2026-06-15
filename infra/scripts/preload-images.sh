#!/usr/bin/env bash
# preload-images.sh — push a docker-saved tarball onto every cluster node's containerd.
#
# Use case: offline / air-gapped onboarding, or when you want pods to start immediately
# without registry pull. Imports into containerd's `k8s.io` namespace so kubelet
# (`imagePullPolicy: IfNotPresent` or `Never`) finds the image without pulling.
#
# Usage:
#   ./preload-images.sh <tarball.tar.gz> [--inventory <path>] [--limit node1,node2]
#
# Examples:
#   ./preload-images.sh /tmp/etri-v13.tar.gz                                   # all nodes
#   ./preload-images.sh /tmp/etri-v13.tar.gz --limit node2,node3              # subset
#   ./preload-images.sh /tmp/etri-v13.tar.gz --inventory ../kubespray/inventory/etri/hosts.yml
#
# Requires sshpass + the kubespray inventory hosts.yml for ssh details.
# Exit codes: 0 ok | 1 missing prereq | 2 user error | 3 ssh/scp failure | 4 ctr import failure

set -euo pipefail

TARBALL="${1:-}"
[ "$TARBALL" = "--help" ] || [ "$TARBALL" = "-h" ] && { grep '^# ' "$0" | sed 's/^# //'; exit 0; }
[ -z "$TARBALL" ] && { echo "ERROR: <tarball> required. See --help." >&2; exit 2; }
[ -f "$TARBALL" ] || { echo "ERROR: tarball '$TARBALL' not found." >&2; exit 2; }
shift

INVENTORY="${KUBESPRAY_INVENTORY:-$(dirname "$0")/../kubespray/inventory/etri/hosts.yml}"
LIMIT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --inventory) INVENTORY="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    *) echo "ERROR: unknown flag '$1'. See --help." >&2; exit 2 ;;
  esac
done

[ -f "$INVENTORY" ] || { echo "ERROR: inventory '$INVENTORY' not found. Pass --inventory." >&2; exit 1; }
command -v sshpass >/dev/null || { echo "ERROR: sshpass missing (apt install sshpass)." >&2; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 missing." >&2; exit 1; }

# Parse inventory (yaml) for nodes
mapfile -t NODES < <(python3 - "$INVENTORY" <<'PY'
import sys, re
hosts = {}
current = None
key = None
with open(sys.argv[1]) as f:
    text = f.read()
# very simple parser — works for the etri kubespray inventory shape
import yaml
data = yaml.safe_load(text)
for name, fields in (data.get("all", {}).get("hosts") or {}).items():
    print(f"{name}|{fields.get('ansible_host','')}|{fields.get('ansible_port','22')}|{fields.get('ansible_user','kcloud')}|{fields.get('ansible_password','')}")
PY
)

if [ -n "$LIMIT" ]; then
  IFS=',' read -ra ALLOWED <<<"$LIMIT"
  FILTERED=()
  for line in "${NODES[@]}"; do
    name="${line%%|*}"
    for allow in "${ALLOWED[@]}"; do
      [ "$name" = "$allow" ] && FILTERED+=("$line")
    done
  done
  NODES=("${FILTERED[@]}")
fi

[ "${#NODES[@]}" -eq 0 ] && { echo "ERROR: no nodes matched (limit='$LIMIT')." >&2; exit 2; }

REMOTE_TAR="/tmp/$(basename "$TARBALL")"
for node in "${NODES[@]}"; do
  IFS='|' read -r name ip port user pass <<<"$node"
  echo "=== $name ($ip:$port) ==="
  sshpass -p "$pass" scp -o StrictHostKeyChecking=no -P "$port" "$TARBALL" "$user@$ip:$REMOTE_TAR" || { echo "scp failed for $name" >&2; exit 3; }
  sshpass -p "$pass" ssh -o StrictHostKeyChecking=no -p "$port" "$user@$ip" "echo '$pass' | sudo -S sh -c 'gunzip -c $REMOTE_TAR | ctr -n k8s.io images import - && rm $REMOTE_TAR'" || { echo "ctr import failed on $name" >&2; exit 4; }
  echo "  imported on $name"
done

echo "Preload done across ${#NODES[@]} node(s)."
