#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: mlperf|mmlu|report [--help]
- mlperf: Run official MLPerf via mlcr
- mmlu:   Run MMLU on Llama-3.1-8B
- report: Aggregate results for a run (or latest)
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
  mlperf)
    if [[ "${1:-}" == "--dry-run" ]]; then
      echo "[DRY-RUN] Would run mlcr with configs/mlperf.yml"
      echo "Outputs under results/<RUN_ID>/mlperf/{raw,summary}/"
      exit 0
    fi
    require_token "Hugging Face" "HUGGINGFACE_TOKEN"
    /app/scripts/run_mlperf.sh "$@"
    ;;
  mmlu)
    if [[ "${1:-}" == "--dry-run" ]]; then
      echo "[DRY-RUN] Would run MMLU evaluation with configs/mmlu.yml"
      echo "Outputs under results/<RUN_ID>/mmlu/{raw,summary}/"
      exit 0
    fi
    require_token "Hugging Face" "HUGGINGFACE_TOKEN"
    /app/scripts/run_mmlu.sh "$@"
    ;;
  report)
    /usr/bin/env python3 /app/scripts/make_report.py "$@"
    ;;
  *)
    echo "Unknown command: $cmd"; usage; exit 1 ;;
esac


