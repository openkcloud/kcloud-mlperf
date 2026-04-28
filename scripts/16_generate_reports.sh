#!/usr/bin/env bash
# 16_generate_reports.sh — concatenate all reports/*.md into a summary and print ANSI table.
#
# Actions:
#   1. Concatenate all reports/*.md into reports/${RUN_ID}_summary.md
#   2. Print a compact ANSI status table to stdout
#
# Usage:
#   ./16_generate_reports.sh [--no-color] [--dry-run] [--help]
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

NO_COLOR=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)   DRY_RUN=true;  shift ;;
    --no-color)  NO_COLOR=true; shift ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 16_generate_reports ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN"

REPORT_DIR="$REPO_ROOT/reports"
SUMMARY_FILE="$REPORT_DIR/${RUN_ID}_summary.md"

# ANSI colors (disabled with --no-color or when not a tty)
if [ "$NO_COLOR" = "false" ] && [ -t 1 ]; then
  C_GREEN='\033[0;32m'
  C_RED='\033[0;31m'
  C_YELLOW='\033[0;33m'
  C_CYAN='\033[0;36m'
  C_BOLD='\033[1m'
  C_RESET='\033[0m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_CYAN=''; C_BOLD=''; C_RESET=''
fi

if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would concatenate reports/*.md -> $SUMMARY_FILE"
  log "  [DRY-RUN] would print ANSI status table"
  log "=== 16_generate_reports: DRY-RUN COMPLETE ==="
  exit 0
fi

mkdir -p "$REPORT_DIR"

# ---------------------------------------------------------------------------
# 1. Collect existing report files
# ---------------------------------------------------------------------------
log "--- Step 1: collecting report files ---"

mapfile -t REPORT_FILES < <(find "$REPORT_DIR" -maxdepth 1 -name '*.md' \
  -not -name "${RUN_ID}_summary.md" \
  | sort)

if [ "${#REPORT_FILES[@]}" -eq 0 ]; then
  log "  [WARN] No .md report files found in $REPORT_DIR"
fi

# ---------------------------------------------------------------------------
# 2. Write summary file
# ---------------------------------------------------------------------------
log "--- Step 2: writing summary $SUMMARY_FILE ---"

{
  printf '# ETRI LLM Benchmark — Run Summary\n\n'
  printf '**RUN_ID**: %s  \n' "$RUN_ID"
  printf '**Generated**: %s  \n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '---\n\n'

  for report_file in "${REPORT_FILES[@]}"; do
    fname="$(basename "$report_file")"
    printf '## Source: %s\n\n' "$fname"
    cat "$report_file"
    printf '\n\n---\n\n'
    log "  included: $fname"
  done

  # Also append log summaries
  printf '## Pipeline Log Summary\n\n'
  printf 'Log directory: `logs/%s/`\n\n' "$RUN_ID"
  if [ -d "$REPO_ROOT/logs/$RUN_ID" ]; then
    printf '| Log File | Size |\n'
    printf '|----------|------|\n'
    find "$REPO_ROOT/logs/$RUN_ID" -name '*.log' | sort | while read -r lf; do
      lname="$(basename "$lf")"
      lsize="$(wc -l < "$lf") lines"
      printf '| %s | %s |\n' "$lname" "$lsize"
    done
  fi
} > "$SUMMARY_FILE"

log "  Summary written: $SUMMARY_FILE"

# ---------------------------------------------------------------------------
# 3. Parse per-script verdict from log files for status table
# ---------------------------------------------------------------------------
log "--- Step 3: ANSI status table ---"

# Collect script outcomes by scanning log files
declare -A SCRIPT_STATUS

SCRIPTS_ORDERED=(
  "00_preflight_master"
  "01_preflight_workers"
  "02_sync_ssh_and_credentials"
  "03_inventory_nodes"
  "04_label_and_taint_nodes"
  "05_prepare_gpu_nodes"
  "06_prepare_rngd_npu_nodes"
  "07_prepare_atomplus_npu_nodes"
  "08_build_and_push_images"
  "09_deploy_services"
  "10_run_smoke_tests"
  "11_run_mlperf_performance"
  "12_run_mlperf_accuracy"
  "13_run_mmlu_pro"
  "14_collect_results"
  "15_validate_legitimacy"
  "16_generate_reports"
)

for script_name in "${SCRIPTS_ORDERED[@]}"; do
  log_file="$REPO_ROOT/logs/$RUN_ID/${script_name}.log"
  if [ ! -f "$log_file" ]; then
    SCRIPT_STATUS["$script_name"]="NOT_RUN"
    continue
  fi

  last_line="$(tail -1 "$log_file" 2>/dev/null || true)"
  if printf '%s' "$last_line" | grep -qi 'PASSED\|COMPLETE\|PASS\b\|exit 0\|healthy'; then
    SCRIPT_STATUS["$script_name"]="PASS"
  elif printf '%s' "$last_line" | grep -qi 'FAIL\|ERROR\|FAILED\|ACTION REQUIRED'; then
    SCRIPT_STATUS["$script_name"]="FAIL"
  elif printf '%s' "$last_line" | grep -qi 'SKIP\|pending_join\|DRY-RUN'; then
    SCRIPT_STATUS["$script_name"]="SKIP"
  else
    SCRIPT_STATUS["$script_name"]="UNKNOWN"
  fi
done

# Print table
printf '\n'
printf "${C_BOLD}%-45s %-10s${C_RESET}\n" "Script" "Status"
printf '%-45s %-10s\n' "$(printf '%0.s-' {1..45})" "$(printf '%0.s-' {1..10})"

for script_name in "${SCRIPTS_ORDERED[@]}"; do
  status="${SCRIPT_STATUS[$script_name]:-NOT_RUN}"
  case "$status" in
    PASS)    color="$C_GREEN" ;;
    FAIL)    color="$C_RED"   ;;
    SKIP)    color="$C_YELLOW";;
    NOT_RUN) color="$C_CYAN"  ;;
    *)       color=""         ;;
  esac
  printf "%-45s ${color}%-10s${C_RESET}\n" "$script_name" "$status"
done
printf '\n'

# Write plain-text version into the summary
{
  printf '\n## Pipeline Status Table\n\n'
  printf '| Script | Status |\n'
  printf '|--------|--------|\n'
  for script_name in "${SCRIPTS_ORDERED[@]}"; do
    printf '| %s | %s |\n' "$script_name" "${SCRIPT_STATUS[$script_name]:-NOT_RUN}"
  done
} >> "$SUMMARY_FILE"

log "=== 16_generate_reports: COMPLETE ==="
log "Summary: $SUMMARY_FILE"
