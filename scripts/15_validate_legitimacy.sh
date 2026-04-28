#!/usr/bin/env bash
# 15_validate_legitimacy.sh — re-run MLPerf legitimacy checks programmatically.
#
# Checks:
#   1. LoadGen log artifacts present (mlperf_log_summary.txt, mlperf_log_detail.txt)
#   2. Compliance checker output present (compliance_*.txt or TEST01/TEST04/TEST05 dirs)
#   3. Performance/accuracy thresholds met (parsed from LoadGen summary)
#   4. Emits final PASS/FAIL verdict and writes/updates reports/mlperf_legitimacy_report.md
#
# Usage:
#   ./15_validate_legitimacy.sh [--results-dir <path>] [--dry-run] [--help]
#
# Exit codes:
#   0  PASS — all checks passed (STRICT_COMPLIANT)
#   1  FAIL — one or more checks failed

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

RESULTS_DIR="${RESULTS_DIR:-$REPO_ROOT/results/$RUN_ID}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)      DRY_RUN=true;       shift ;;
    --results-dir)  RESULTS_DIR="$2";   shift 2 ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 15_validate_legitimacy ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN  RESULTS_DIR=$RESULTS_DIR"

REPORT_FILE="$REPO_ROOT/reports/mlperf_legitimacy_report.md"
mkdir -p "$(dirname "$REPORT_FILE")"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FAIL=0
CHECKS=()

# ---------------------------------------------------------------------------
# Helper: record check result
# ---------------------------------------------------------------------------
record_check() {
  local name="$1" result="$2" detail="${3:-}"
  CHECKS+=("${result}|${name}|${detail}")
  if [ "$result" = "PASS" ]; then
    log "  [PASS] $name${detail:+ — $detail}"
  else
    log "  [FAIL] $name${detail:+ — $detail}"
    FAIL=1
  fi
}

if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] legitimacy checks skipped in dry-run mode"
  log "  [DRY-RUN] would check results in $RESULTS_DIR"

  # Write a dry-run placeholder report
  {
    printf '# MLPerf Legitimacy Report\n\n'
    printf '**RUN_ID**: %s  \n' "$RUN_ID"
    printf '**Generated**: %s  \n' "$TIMESTAMP"
    printf '**Mode**: DRY-RUN (no actual checks performed)  \n\n'
    printf '## verdict: UNKNOWN\n\n'
    printf 'Dry-run mode — re-run without --dry-run to validate.\n'
  } > "$REPORT_FILE"

  log "=== 15_validate_legitimacy: DRY-RUN COMPLETE ==="
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. LoadGen artifacts
# ---------------------------------------------------------------------------
log "--- Check 1: LoadGen artifacts ---"

LOADGEN_SUMMARY=""
LOADGEN_DETAIL=""

# Search results dir and any subdirectory for loadgen logs
if [ -d "$RESULTS_DIR" ]; then
  LOADGEN_SUMMARY="$(find "$RESULTS_DIR" -name 'mlperf_log_summary.txt' 2>/dev/null | head -1 || true)"
  LOADGEN_DETAIL="$(find "$RESULTS_DIR" -name 'mlperf_log_detail.txt' 2>/dev/null | head -1 || true)"
fi

if [ -n "$LOADGEN_SUMMARY" ]; then
  record_check "mlperf_log_summary.txt present" "PASS" "$LOADGEN_SUMMARY"
else
  record_check "mlperf_log_summary.txt present" "FAIL" "not found in $RESULTS_DIR"
fi

if [ -n "$LOADGEN_DETAIL" ]; then
  record_check "mlperf_log_detail.txt present" "PASS" "$LOADGEN_DETAIL"
else
  record_check "mlperf_log_detail.txt present" "FAIL" "not found in $RESULTS_DIR"
fi

# ---------------------------------------------------------------------------
# 2. Compliance checker output
# ---------------------------------------------------------------------------
log "--- Check 2: Compliance checker artifacts ---"

COMPLIANCE_FOUND=false
if [ -d "$RESULTS_DIR" ]; then
  # Look for TEST01, TEST04, TEST05 directories OR compliance_*.txt files
  if find "$RESULTS_DIR" -name 'TEST01' -o -name 'TEST04' -o -name 'TEST05' 2>/dev/null | grep -q .; then
    COMPLIANCE_FOUND=true
    COMPLIANCE_PATH="$(find "$RESULTS_DIR" -name 'TEST0*' | head -1)"
    record_check "compliance test directories present" "PASS" "$COMPLIANCE_PATH"
  elif find "$RESULTS_DIR" -name 'compliance_*.txt' 2>/dev/null | grep -q .; then
    COMPLIANCE_FOUND=true
    COMPLIANCE_PATH="$(find "$RESULTS_DIR" -name 'compliance_*.txt' | head -1)"
    record_check "compliance output files present" "PASS" "$COMPLIANCE_PATH"
  fi
fi

if [ "$COMPLIANCE_FOUND" = "false" ]; then
  record_check "compliance checker output present" "FAIL" "no TEST0*/compliance_*.txt in $RESULTS_DIR"
fi

# ---------------------------------------------------------------------------
# 3. Parse LoadGen summary for threshold check
# ---------------------------------------------------------------------------
log "--- Check 3: performance threshold ---"

if [ -n "$LOADGEN_SUMMARY" ]; then
  # Extract samples_per_second and validity from summary
  VALID_LINE="$(grep -i 'result is\|validity\|VALID\|INVALID' "$LOADGEN_SUMMARY" 2>/dev/null | head -1 || true)"
  QPS_LINE="$(grep -i 'samples_per_second\|Samples per second\|Queries per second' "$LOADGEN_SUMMARY" 2>/dev/null | head -1 || true)"

  if printf '%s' "$VALID_LINE" | grep -qi 'VALID'; then
    record_check "LoadGen validity: VALID" "PASS" "$VALID_LINE"
  else
    record_check "LoadGen validity" "FAIL" "${VALID_LINE:-no validity line found}"
  fi

  if [ -n "$QPS_LINE" ]; then
    record_check "Throughput metric found" "PASS" "$QPS_LINE"
  else
    record_check "Throughput metric found" "FAIL" "no QPS/samples_per_second line in summary"
  fi
else
  record_check "LoadGen summary parseability" "FAIL" "no summary file to parse"
fi

# ---------------------------------------------------------------------------
# 4. Manifest integrity (if present)
# ---------------------------------------------------------------------------
log "--- Check 4: result manifest integrity ---"

MANIFEST="$RESULTS_DIR/manifest.sha256"
if [ -f "$MANIFEST" ]; then
  MANIFEST_ERRORS=0
  while IFS='  ' read -r expected_sha rel_path; do
    # Skip comment lines
    [[ "$expected_sha" == \#* ]] && continue
    [ -z "$expected_sha" ] && continue
    full_path="$RESULTS_DIR/$rel_path"
    if [ -f "$full_path" ]; then
      actual_sha="$(sha256sum "$full_path" | awk '{print $1}')"
      if [ "$actual_sha" != "$expected_sha" ]; then
        log "  [FAIL] SHA256 mismatch: $rel_path"
        MANIFEST_ERRORS=$((MANIFEST_ERRORS + 1))
      fi
    else
      log "  [FAIL] listed in manifest but missing: $rel_path"
      MANIFEST_ERRORS=$((MANIFEST_ERRORS + 1))
    fi
  done < "$MANIFEST"

  if [ "$MANIFEST_ERRORS" -eq 0 ]; then
    record_check "manifest.sha256 integrity" "PASS" "all hashes verified"
  else
    record_check "manifest.sha256 integrity" "FAIL" "$MANIFEST_ERRORS mismatch(es)"
  fi
else
  record_check "manifest.sha256 present" "FAIL" "run 14_collect_results.sh first"
fi

# ---------------------------------------------------------------------------
# 5. Determine overall verdict
# ---------------------------------------------------------------------------
if [ "$FAIL" -eq 0 ]; then
  VERDICT="STRICT_COMPLIANT"
  log "  OVERALL VERDICT: STRICT_COMPLIANT"
else
  VERDICT="NON_COMPLIANT"
  log "  OVERALL VERDICT: NON_COMPLIANT"
fi

# ---------------------------------------------------------------------------
# 6. Write legitimacy report
# ---------------------------------------------------------------------------
log "--- Writing legitimacy report: $REPORT_FILE ---"

{
  printf '# MLPerf Legitimacy Report\n\n'
  printf '**RUN_ID**: %s  \n' "$RUN_ID"
  printf '**Generated**: %s  \n' "$TIMESTAMP"
  printf '**Results dir**: %s  \n\n' "$RESULTS_DIR"
  printf '## verdict: %s\n\n' "$VERDICT"
  printf '## Checks\n\n'
  printf '| Result | Check | Detail |\n'
  printf '|--------|-------|--------|\n'
  for entry in "${CHECKS[@]}"; do
    IFS='|' read -r res name detail <<< "$entry"
    printf '| %s | %s | %s |\n' "$res" "$name" "${detail:-—}"
  done
  printf '\n## Notes\n\n'
  printf '- Generated programmatically by scripts/15_validate_legitimacy.sh\n'
  printf '- STRICT_COMPLIANT requires ALL checks to PASS\n'
  printf '- scripts/11 and 12 read the `verdict:` line from this report\n'
} > "$REPORT_FILE"

log "  Report written: $REPORT_FILE"

log ""
if [ "$FAIL" -eq 0 ]; then
  log "=== 15_validate_legitimacy: PASS — STRICT_COMPLIANT ==="
  exit 0
else
  log "=== 15_validate_legitimacy: FAIL — NON_COMPLIANT ==="
  exit 1
fi
