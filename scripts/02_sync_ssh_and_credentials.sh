#!/usr/bin/env bash
# 02_sync_ssh_and_credentials.sh — generate ed25519 SSH key (if missing) and distribute to nodes.
#
# Actions:
#   1. Generate ~/.ssh/etri-llm-bench-ed25519 if not present
#   2. ssh-copy-id (via sshpass) to each active node from cluster.yaml
#   3. Verify key-based auth works for each node
#   4. Print key fingerprint (masked: first 8 + last 8 chars visible)
#
# The SSH password is NEVER written to shell history or scripts.
# It is read exclusively from $SUDO_PASS (sourced from .env by common.sh).
#
# Usage:
#   ./02_sync_ssh_and_credentials.sh [--dry-run] [--help]
#
# Exit codes:
#   0  success
#   1  failure
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

log "=== 02_sync_ssh_and_credentials ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN"

require_env SUDO_PASS

KEY_PATH="$HOME/.ssh/etri-llm-bench-ed25519"
SSH_USER="$(python3 -c "
import yaml
with open('$REPO_ROOT/config/cluster.yaml') as f:
    d = yaml.safe_load(f)
print(d.get('ssh', {}).get('user', 'kcloud'))
")"

# ---------------------------------------------------------------------------
# 1. Generate key if missing
# ---------------------------------------------------------------------------
log "--- Step 1: SSH key generation ---"
if [ -f "$KEY_PATH" ]; then
  log "  Key already exists: $KEY_PATH (idempotent — skipping generation)"
else
  if [ "$DRY_RUN" = "true" ]; then
    log "  [DRY-RUN] would generate: ssh-keygen -t ed25519 -f $KEY_PATH -N ''"
  else
    mkdir -p "$HOME/.ssh"
    chmod 700 "$HOME/.ssh"
    ssh-keygen -t ed25519 -f "$KEY_PATH" -N '' -C "etri-llm-bench-$(date +%Y%m%d)"
    log "  Generated: $KEY_PATH"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Print fingerprint (masked)
# ---------------------------------------------------------------------------
if [ -f "$KEY_PATH" ]; then
  FINGERPRINT="$(ssh-keygen -lf "${KEY_PATH}.pub" 2>/dev/null | awk '{print $2}' || echo 'unknown')"
  FP_LEN="${#FINGERPRINT}"
  if [ "$FP_LEN" -gt 16 ]; then
    FP_START="${FINGERPRINT:0:8}"
    FP_END="${FINGERPRINT: -8}"
    FP_MASKED="${FP_START}***REDACTED***${FP_END}"
  else
    FP_MASKED="${FINGERPRINT}"
  fi
  log "  Key fingerprint (masked): $FP_MASKED"
fi

# ---------------------------------------------------------------------------
# 3. Distribute key to each active node
# ---------------------------------------------------------------------------
log "--- Step 2: ssh-copy-id to each active node ---"

FAIL=0

python3 - "$REPO_ROOT/config/cluster.yaml" <<'PYEOF' | while IFS='|' read -r name role host port state; do
import yaml, sys
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
default_port = data.get('ssh', {}).get('default_port', 22)
all_nodes = []
for n in data.get('control_plane', []):
    all_nodes.append(n)
for n in data.get('workers', []):
    all_nodes.append(n)
for node in all_nodes:
    name  = node.get('name', '')
    role  = node.get('role', 'worker')
    host  = node.get('ssh', {}).get('host', '')
    port  = str(node.get('ssh', {}).get('port', default_port))
    state = node.get('state', 'active')
    print(f"{name}|{role}|{host}|{port}|{state}")
PYEOF
  if [ "$state" = "pending_join" ]; then
    log "  $name: SKIPPED (pending_join)"
    continue
  fi

  log "  Processing $name ($host:$port) ..."

  if [ "$DRY_RUN" = "true" ]; then
    log "  [DRY-RUN] would ssh-copy-id -i ${KEY_PATH}.pub -p $port ${SSH_USER}@${host}"
    log "  [DRY-RUN] would verify key auth: ssh -i $KEY_PATH -p $port ${SSH_USER}@${host} hostname"
    continue
  fi

  # ssh-copy-id using sshpass for the initial password auth
  # SUDO_PASS is used as the SSH login password; never echoed to terminal
  if sshpass -p "$SUDO_PASS" ssh-copy-id \
      -i "${KEY_PATH}.pub" \
      -o StrictHostKeyChecking=no \
      -o PasswordAuthentication=yes \
      -p "$port" \
      "${SSH_USER}@${host}" 2>&1 | while read -r line; do log "    ssh-copy-id: $line"; done; then
    log "  [OK]  key copied to $name"
  else
    log "  [FAIL] ssh-copy-id failed for $name"
    FAIL=1
    continue
  fi

  # Verify key-based auth (no password)
  if ssh \
      -i "$KEY_PATH" \
      -o StrictHostKeyChecking=no \
      -o PasswordAuthentication=no \
      -o BatchMode=yes \
      -o ConnectTimeout=10 \
      -p "$port" \
      "${SSH_USER}@${host}" \
      "hostname" >/dev/null 2>&1; then
    log "  [OK]  key auth verified for $name"
  else
    log "  [FAIL] key auth verification failed for $name"
    FAIL=1
  fi
done

log ""
if [ "$FAIL" -eq 0 ]; then
  log "=== 02_sync_ssh_and_credentials: COMPLETE [idempotent] ==="
  exit 0
else
  log "=== 02_sync_ssh_and_credentials: FAILED on one or more nodes ==="
  exit 1
fi
