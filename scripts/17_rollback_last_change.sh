#!/usr/bin/env bash
# 17_rollback_last_change.sh — apply rollback scripts from backups/$RUN_ID/ in reverse order.
#
# Reads rollback files from backups/$RUN_ID/ (e.g. 04_label_rollback.sh).
# Presents them in reverse creation order and offers to apply each.
# Requires --yes to apply without interactive confirmation.
#
# Usage:
#   ./17_rollback_last_change.sh [--run-id <ID>] [--yes] [--dry-run] [--help]
#
# Flags:
#   --run-id <ID>   Roll back a specific RUN_ID (default: current $RUN_ID)
#   --yes           Apply all rollbacks without interactive confirmation
#
# Exit codes:
#   0  rollback(s) applied (or nothing to roll back)
#   1  rollback failed
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

AUTO_YES=false
TARGET_RUN_ID="$RUN_ID"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true;          shift ;;
    --yes)     AUTO_YES=true;          shift ;;
    --run-id)  TARGET_RUN_ID="$2";     shift 2 ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 17_rollback_last_change ==="
log "RUN_ID=$RUN_ID  TARGET_RUN_ID=$TARGET_RUN_ID  DRY_RUN=$DRY_RUN  AUTO_YES=$AUTO_YES"

BACKUP_DIR="$REPO_ROOT/backups/$TARGET_RUN_ID"

if [ ! -d "$BACKUP_DIR" ]; then
  log "  No backup directory found for RUN_ID=$TARGET_RUN_ID at $BACKUP_DIR"
  log "  Nothing to roll back."

  # List available run IDs for reference
  if [ -d "$REPO_ROOT/backups" ]; then
    log "  Available backup RUN_IDs:"
    ls "$REPO_ROOT/backups/" 2>/dev/null | while read -r rid; do
      log "    $rid"
    done
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Discover rollback files in reverse order
# ---------------------------------------------------------------------------
log "--- Step 1: discover rollback scripts in $BACKUP_DIR ---"

mapfile -t ROLLBACK_FILES < <(
  find "$BACKUP_DIR" -name '*_rollback.sh' -type f \
  | sort -r
)

if [ "${#ROLLBACK_FILES[@]}" -eq 0 ]; then
  log "  No rollback scripts found in $BACKUP_DIR"
  log "  Nothing to roll back."
  exit 0
fi

log "  Found ${#ROLLBACK_FILES[@]} rollback script(s):"
for f in "${ROLLBACK_FILES[@]}"; do
  log "    $(basename "$f")"
done

# ---------------------------------------------------------------------------
# 2. Apply rollbacks (in reverse order)
# ---------------------------------------------------------------------------
log ""
FAIL=0

for rollback_script in "${ROLLBACK_FILES[@]}"; do
  script_name="$(basename "$rollback_script")"
  log "--- Processing: $script_name ---"

  # Show content for review
  log "  Contents:"
  while IFS= read -r line; do
    log "    $line"
  done < "$rollback_script"
  log ""

  if [ "$DRY_RUN" = "true" ]; then
    log "  [DRY-RUN] would apply: $rollback_script"
    continue
  fi

  # Confirm
  if [ "$AUTO_YES" = "false" ]; then
    printf '%s Apply rollback %s? [y/N] ' "$(date '+%Y-%m-%dT%H:%M:%S')" "$script_name"
    read -r ans
    case "$ans" in
      [Yy]|[Yy][Ee][Ss]) : ;;
      *)
        log "  Skipped: $script_name"
        continue
        ;;
    esac
  else
    log "  --yes passed, applying without prompt"
  fi

  log "  Applying $script_name ..."
  if bash "$rollback_script" 2>&1 | while read -r line; do log "    [rollback] $line"; done; then
    log "  [OK]  $script_name applied"
  else
    log "  [FAIL] $script_name failed"
    FAIL=1
  fi
done

log ""
if [ "$FAIL" -eq 0 ]; then
  log "=== 17_rollback_last_change: COMPLETE ==="
  exit 0
else
  log "=== 17_rollback_last_change: ONE OR MORE ROLLBACKS FAILED ==="
  exit 1
fi
