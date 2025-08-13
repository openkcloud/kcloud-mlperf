#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: smoke|all-in-one|help
- smoke:      Run 10-step smoke (scripts/smoke_all_10.sh)
- all-in-one: Run full pipeline (scripts/run_all_in_one.sh)
EOF
}

require_token() {
  local name="$1" var="$2"
  if [[ -z "${!var:-}" ]]; then
    echo "오류: ${name} 토큰이 없습니다 / Missing ${name} token" >&2
    echo "Set it via --env-file .env or environment (exit 2)" >&2
    exit 2
  fi
}

cmd="${1:-help}"; shift || true

case "$cmd" in
  help|--help|-h) usage; exit 0 ;;
  smoke)
    # Ensure caches exist and are writable for arbitrary uid:gid
    export HF_HOME="${HF_HOME:-/app/.cache/huggingface}"
    mkdir -p "$HF_HOME" /app/results 2>/dev/null || true
    chmod -R 777 "$HF_HOME" /app/results 2>/dev/null || true
    /app/scripts/smoke_all_10.sh "$@"
    ;;
  all-in-one)
    export HF_HOME="${HF_HOME:-/app/.cache/huggingface}"
    mkdir -p "$HF_HOME" /app/results 2>/dev/null || true
    chmod -R 777 "$HF_HOME" /app/results 2>/dev/null || true
    /app/scripts/run_all_in_one.sh "$@"
    ;;
  *)
    echo "Unknown command: $cmd"; usage; exit 1 ;;
esac


