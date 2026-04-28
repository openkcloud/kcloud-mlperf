#!/usr/bin/env bash
# common.sh — shared helpers sourced by all numbered pipeline scripts.
#
# DO NOT execute directly. Source it:
#   source "$(dirname "$0")/common.sh"
#
# Exports:
#   RUN_ID        — set by caller or defaulted to timestamp
#   LOG_DIR       — logs/$RUN_ID  (auto-created)
#   REPO_ROOT     — absolute path to repo root
#   DRY_RUN       — "true" or "false" (set by caller before sourcing, or parsed by scripts)
#
# Functions:
#   log MSG           — timestamped log to stdout + LOG_DIR/<caller-basename>.log
#   die MSG [code]    — log error to stderr, exit with code (default 1)
#   confirm PROMPT    — interactive yes/no; auto-yes if CI=true or DRY_RUN=true
#   dry_run_or CMD... — run CMD if not dry-run; print "[DRY-RUN] would: CMD" otherwise
#   for_each_node_yaml CALLBACK  — iterate workers from config/cluster.yaml
#   mask_secret STR   — replace token-looking strings with ***REDACTED***
#   require_env VAR [VAR...]  — die if any env var is unset or empty

# ---------------------------------------------------------------------------
# Repo root detection — works regardless of cwd
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------------------------------------------------------------------------
# Load .env (gitignored credentials) if present
# ---------------------------------------------------------------------------
_ENV_FILE="$REPO_ROOT/.env"
if [ -f "$_ENV_FILE" ]; then
  # set -a exports every variable defined in .env
  set -a
  # shellcheck source=/dev/null
  source "$_ENV_FILE"
  set +a
fi

# ---------------------------------------------------------------------------
# RUN_ID and LOG_DIR
# ---------------------------------------------------------------------------
: "${RUN_ID:=$(date +%Y%m%d-%H%M%S)-$(head -c4 /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' || printf '%04x' $RANDOM)}"
export RUN_ID

LOG_DIR="$REPO_ROOT/logs/$RUN_ID"
export LOG_DIR
mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# DRY_RUN default
# ---------------------------------------------------------------------------
: "${DRY_RUN:=false}"
export DRY_RUN

# ---------------------------------------------------------------------------
# Caller basename used in log filenames
# ---------------------------------------------------------------------------
_CALLER_BASENAME="$(basename "${BASH_SOURCE[1]:-common}" .sh)"

# ---------------------------------------------------------------------------
# log — timestamped message to stdout and log file
# ---------------------------------------------------------------------------
log() {
  local ts
  ts="$(date '+%Y-%m-%dT%H:%M:%S')"
  local msg="[$ts] $*"
  printf '%s\n' "$msg"
  printf '%s\n' "$msg" >> "$LOG_DIR/${_CALLER_BASENAME}.log"
}

# ---------------------------------------------------------------------------
# die — log error to stderr + log file, then exit
# ---------------------------------------------------------------------------
die() {
  local msg="$1"
  local code="${2:-1}"
  local ts
  ts="$(date '+%Y-%m-%dT%H:%M:%S')"
  local line="[$ts] ERROR: $msg"
  printf '%s\n' "$line" >&2
  printf '%s\n' "$line" >> "$LOG_DIR/${_CALLER_BASENAME}.log" 2>/dev/null || true
  exit "$code"
}

# ---------------------------------------------------------------------------
# confirm — interactive y/N prompt; auto-yes when CI=true or DRY_RUN=true
# ---------------------------------------------------------------------------
confirm() {
  local prompt="${1:-Continue?}"
  if [ "${CI:-false}" = "true" ] || [ "$DRY_RUN" = "true" ]; then
    log "[auto-confirm] $prompt -> yes (CI=$CI DRY_RUN=$DRY_RUN)"
    return 0
  fi
  printf '%s [y/N] ' "$prompt"
  local ans
  read -r ans
  case "$ans" in
    [Yy]|[Yy][Ee][Ss]) return 0 ;;
    *) log "Aborted by user."; return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# dry_run_or — execute command or print dry-run notice
# ---------------------------------------------------------------------------
dry_run_or() {
  if [ "$DRY_RUN" = "true" ]; then
    log "[DRY-RUN] would run: $*"
  else
    log "[RUN] $*"
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# mask_secret — redact token-looking strings (40+ hex chars, bearer tokens, etc.)
# ---------------------------------------------------------------------------
mask_secret() {
  local input="$1"
  # Redact: long hex strings (SHA/tokens >= 32 chars), Bearer tokens, passwords
  printf '%s' "$input" \
    | sed -E 's/[0-9a-fA-F]{32,}/***REDACTED***/g' \
    | sed -E 's/(Bearer |token=|password=|secret=|key=)[^[:space:]]*/\1***REDACTED***/gi'
}

# ---------------------------------------------------------------------------
# require_env — verify required environment variables are set
# ---------------------------------------------------------------------------
require_env() {
  local missing=0
  for var in "$@"; do
    if [ -z "${!var:-}" ]; then
      printf 'ERROR: required env var %s is not set (check .env or export it)\n' "$var" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
}

# ---------------------------------------------------------------------------
# _yaml_query — read a value from cluster.yaml using yq or python3
# Usage: _yaml_query '.workers[0].name'
# ---------------------------------------------------------------------------
_yaml_query() {
  local expr="$1"
  local yaml_file="$REPO_ROOT/config/cluster.yaml"
  if command -v yq >/dev/null 2>&1; then
    yq e "$expr" "$yaml_file"
  else
    python3 -c "
import yaml, sys
with open('$yaml_file') as f:
    data = yaml.safe_load(f)
# evaluate simple dot-notation path
import re
expr = '''$expr'''
# strip leading dot and split on dots not inside brackets
parts = re.split(r'\.(?![^\[]*\])', expr.lstrip('.'))
cur = data
for p in parts:
    m = re.match(r'^(\w+)\[(\d+)\]$', p)
    if m:
        cur = cur[m.group(1)][int(m.group(2))]
    elif p:
        cur = cur[p] if isinstance(cur, dict) else None
    if cur is None:
        break
print(cur if cur is not None else '')
"
  fi
}

# ---------------------------------------------------------------------------
# for_each_node_yaml CALLBACK
# Iterates over all nodes (control_plane + workers) from cluster.yaml.
# Calls CALLBACK with args: name role host port state labels_json
#
# Example:
#   for_each_node_yaml my_handler
#   my_handler() { local name=$1 role=$2 host=$3 port=$4 state=$5; ... }
# ---------------------------------------------------------------------------
for_each_node_yaml() {
  local callback="$1"
  local yaml_file="$REPO_ROOT/config/cluster.yaml"

  python3 - "$yaml_file" "$callback" <<'PYEOF'
import sys, yaml, subprocess, json

yaml_file = sys.argv[1]
callback  = sys.argv[2]

with open(yaml_file) as f:
    data = yaml.safe_load(f)

ssh_defaults = data.get('ssh', {})
default_port = ssh_defaults.get('default_port', 22)

all_nodes = []
for node in data.get('control_plane', []):
    node.setdefault('role', 'master')
    all_nodes.append(node)
for node in data.get('workers', []):
    node.setdefault('role', 'worker')
    all_nodes.append(node)

for node in all_nodes:
    name   = node.get('name', '')
    role   = node.get('role', 'worker')
    host   = node.get('ssh', {}).get('host', '')
    port   = str(node.get('ssh', {}).get('port', default_port))
    state  = node.get('state', 'active')
    labels = json.dumps(node.get('labels', {}))
    subprocess.run([callback, name, role, host, port, state, labels])
PYEOF
}

# ---------------------------------------------------------------------------
# _ssh_cmd — run a command on a remote node via sshpass
# Usage: _ssh_cmd HOST PORT "remote command"
# Reads password from $SUDO_PASS (never echoed)
# ---------------------------------------------------------------------------
_ssh_cmd() {
  local host="$1"
  local port="$2"
  local cmd="$3"
  local ssh_user
  ssh_user="$(python3 -c "
import yaml
with open('$REPO_ROOT/config/cluster.yaml') as f:
    d = yaml.safe_load(f)
print(d.get('ssh', {}).get('user', 'kcloud'))
")"
  if [ -n "${SUDO_PASS:-}" ]; then
    sshpass -p "$SUDO_PASS" ssh \
      -o StrictHostKeyChecking=no \
      -o ConnectTimeout=10 \
      -p "$port" \
      "${ssh_user}@${host}" \
      "$cmd"
  else
    ssh \
      -o StrictHostKeyChecking=no \
      -o ConnectTimeout=10 \
      -p "$port" \
      "${ssh_user}@${host}" \
      "$cmd"
  fi
}

log "common.sh loaded (RUN_ID=$RUN_ID LOG_DIR=$LOG_DIR DRY_RUN=$DRY_RUN)"
