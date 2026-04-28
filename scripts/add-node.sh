#!/usr/bin/env bash
# add-node.sh — append a new node to the kubespray inventory and join it to the cluster.
#
# Usage:
#   ./add-node.sh <hostname> <ip> [--port 122] [--role kube_node|kube_control_plane] [--password <SUDO_PASS>]
#
# Examples:
#   ./add-node.sh node5 10.254.184.197                           # worker on default port
#   ./add-node.sh node5 10.254.184.197 --port 22 --role kube_node
#   ./add-node.sh edgectrl 10.254.0.50 --role kube_control_plane
#   ./add-node.sh --help
#
# Prereqs:
#   - bootstrap-node.sh has been run on the target host (or will be by this script via ansible)
#   - ssh access from this host to the target on the given port using the given password
#
# Exit codes: 0 ok | 1 missing prereq | 2 user error | 3 inventory write failed | 4 ansible failed

set -euo pipefail

case "${1:-}" in --help|-h) grep '^# ' "$0" | sed 's/^# //'; exit 0 ;; esac
[ "$#" -lt 2 ] && { echo "ERROR: <hostname> <ip> required. See --help." >&2; exit 2; }

NAME="$1"; IP="$2"; shift 2
PORT=122
ROLE=kube_node
PASSWD="${ANSIBLE_PASSWORD:-<SUDO_PASS>}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --role) ROLE="$2"; shift 2 ;;
    --password) PASSWD="$2"; shift 2 ;;
    *) echo "ERROR: unknown flag '$1'." >&2; exit 2 ;;
  esac
done

case "$ROLE" in kube_node|kube_control_plane) ;; *) echo "ERROR: --role must be kube_node or kube_control_plane" >&2; exit 2 ;; esac

INV="$(cd "$(dirname "$0")/../kubespray/inventory/etri" && pwd)/hosts.yml"
[ -f "$INV" ] || { echo "ERROR: inventory $INV not found" >&2; exit 1; }
command -v ansible-playbook >/dev/null || { echo "ERROR: ansible-playbook missing (cd kubespray && pip install -r requirements.txt)" >&2; exit 1; }

# Quick ssh probe
echo "=== probing ssh to $NAME ($IP:$PORT) ==="
sshpass -p "$PASSWD" ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -p "$PORT" "kcloud@$IP" 'hostname && uname -r' || { echo "ERROR: ssh probe failed" >&2; exit 1; }

# Insert into hosts.yml under all.hosts and the role group
python3 - "$INV" "$NAME" "$IP" "$PORT" "$PASSWD" "$ROLE" <<'PY' || { echo "ERROR: inventory edit failed" >&2; exit 3; }
import sys, yaml
inv_path, name, ip, port, pw, role = sys.argv[1:]
with open(inv_path) as f: data = yaml.safe_load(f)
hosts = data.setdefault("all", {}).setdefault("hosts", {})
hosts[name] = {
    "ansible_host": ip,
    "ansible_port": int(port),
    "ansible_user": "kcloud",
    "ansible_password": pw,
    "ansible_become_password": pw,
}
children = data["all"].setdefault("children", {})
group = children.setdefault(role, {}).setdefault("hosts", {}) or {}
children[role]["hosts"] = group
group[name] = None
# kube_node alias for k8s_cluster
if role == "kube_node":
    children.setdefault("k8s_cluster", {}).setdefault("children", {}).setdefault("kube_node", None)
with open(inv_path, "w") as f: yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
print(f"appended {name} ({ip}:{port}) as {role}")
PY

KSPRAY="$(cd "$(dirname "$0")/../kubespray" && pwd)"
echo "=== ansible scale.yml --limit=$NAME ==="
( cd "$KSPRAY" && ansible-playbook -i "$INV" --limit="$NAME" cluster.yml ) || { echo "ERROR: ansible failed" >&2; exit 4; }

echo "=== verify in kubectl ==="
kubectl get nodes "$NAME" -o wide || echo "(kubectl get failed — kubeconfig may not yet reflect the new node; rerun in 1-2 minutes)"

echo "Node $NAME added."
