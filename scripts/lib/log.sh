#!/usr/bin/env bash
# scripts/lib/log.sh — logging helpers for kcloud-tool installer
# Source this file; do not execute directly.

# Colors — only when stderr is a terminal
if [[ -t 2 ]]; then
  _CLR_RESET='\033[0m'
  _CLR_INFO='\033[0;36m'
  _CLR_WARN='\033[0;33m'
  _CLR_ERROR='\033[0;31m'
  _CLR_STEP='\033[1;32m'
else
  _CLR_RESET=''
  _CLR_INFO=''
  _CLR_WARN=''
  _CLR_ERROR=''
  _CLR_STEP=''
fi

_log_ts() { date '+%Y-%m-%dT%H:%M:%S'; }

log_info()  { printf "${_CLR_INFO}[INFO ] %s %s${_CLR_RESET}\n"  "$(_log_ts)" "$*" >&2; }
log_warn()  { printf "${_CLR_WARN}[WARN ] %s %s${_CLR_RESET}\n"  "$(_log_ts)" "$*" >&2; }
log_error() { printf "${_CLR_ERROR}[ERROR] %s %s${_CLR_RESET}\n" "$(_log_ts)" "$*" >&2; }
log_step()  { printf "${_CLR_STEP}[STEP ] %s %s${_CLR_RESET}\n"  "$(_log_ts)" "$*" >&2; }

# redact — print a safe placeholder for any secret-adjacent value.
# Usage:  log_info "Token: $(redact token)"
#         In all cases, NEVER pass the actual secret value to log_* functions.
redact() {
  local label="${1:-value}"
  printf '[REDACTED:%s]' "$label"
}
