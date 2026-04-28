#!/usr/bin/env bash
# 08_build_and_push_images.sh — build+push images and record digests into cluster.yaml.
#
# Wraps scripts/build-and-push.sh and additionally:
#   - Captures RepoDigests after push
#   - Writes images.backend.digest and images.frontend.digest into config/cluster.yaml
#
# Usage:
#   ./08_build_and_push_images.sh <version> [--no-push] [--source <path>] [--dry-run] [--help]
#
# Exit codes:
#   0  success
#   1  missing prereq or build/push failure
#   2  user error

set -euo pipefail

case "${1:-}" in
  --help|-h)
    sed -n '/^#!/d; /^[^#]/q; s/^# \{0,1\}//; p' "$0"
    exit 0
    ;;
esac

VERSION="${1:-}"
[ -z "$VERSION" ] && { printf 'ERROR: <version> required (e.g. v13). See --help.\n' >&2; exit 2; }
shift

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/common.sh
source "$SCRIPT_DIR/common.sh"

EXTRA_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --no-push) EXTRA_ARGS+=("--no-push"); shift ;;
    --source)  EXTRA_ARGS+=("--source" "$2"); shift 2 ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 08_build_and_push_images: version=$VERSION ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN"

BUILD_PUSH_SCRIPT="$SCRIPT_DIR/build-and-push.sh"
[ -x "$BUILD_PUSH_SCRIPT" ] || die "build-and-push.sh not found or not executable at $BUILD_PUSH_SCRIPT"

CLUSTER_YAML="$REPO_ROOT/config/cluster.yaml"

BACKEND_REF="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f:
    d = yaml.safe_load(f)
img = d['images']['backend']
print(img['repo'] + ':' + '$VERSION')
")"
FRONTEND_REF="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f:
    d = yaml.safe_load(f)
img = d['images']['frontend']
print(img['repo'] + ':' + '$VERSION')
")"

log "  Backend image:  $BACKEND_REF"
log "  Frontend image: $FRONTEND_REF"

# ---------------------------------------------------------------------------
# 1. Build + push
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" = "true" ]; then
  log "  [DRY-RUN] would run: $BUILD_PUSH_SCRIPT $VERSION ${EXTRA_ARGS[*]:-}"
  log "  [DRY-RUN] would capture RepoDigests after push"
  log "  [DRY-RUN] would update cluster.yaml with digests"
  log "=== 08_build_and_push_images: DRY-RUN COMPLETE ==="
  exit 0
fi

log "--- Step 1: delegating to build-and-push.sh ---"
"$BUILD_PUSH_SCRIPT" "$VERSION" "${EXTRA_ARGS[@]:-}"

# ---------------------------------------------------------------------------
# 2. Capture digests (only if push was not skipped)
# ---------------------------------------------------------------------------
if printf '%s\n' "${EXTRA_ARGS[@]:-}" | grep -q -- '--no-push'; then
  log "  --no-push was set; skipping digest capture (images not in registry)"
  log "=== 08_build_and_push_images: COMPLETE (no-push mode) ==="
  exit 0
fi

log "--- Step 2: capture RepoDigests ---"

get_digest() {
  local image_ref="$1"
  sudo docker inspect --format='{{range .RepoDigests}}{{.}}{{"\n"}}{{end}}' "$image_ref" 2>/dev/null \
    | grep "@sha256:" \
    | head -1 \
    | sed 's/.*@//'
}

BACKEND_DIGEST="$(get_digest "$BACKEND_REF")"
FRONTEND_DIGEST="$(get_digest "$FRONTEND_REF")"

if [ -z "$BACKEND_DIGEST" ]; then
  log "  [WARN] Could not get backend digest — image may not be in local docker (try docker pull)"
  BACKEND_DIGEST="unknown"
fi
if [ -z "$FRONTEND_DIGEST" ]; then
  log "  [WARN] Could not get frontend digest"
  FRONTEND_DIGEST="unknown"
fi

log "  Backend digest:  $(mask_secret "$BACKEND_DIGEST")"
log "  Frontend digest: $(mask_secret "$FRONTEND_DIGEST")"

# ---------------------------------------------------------------------------
# 3. Write digests into cluster.yaml
# ---------------------------------------------------------------------------
log "--- Step 3: update cluster.yaml with digests and tag ---"

python3 - "$CLUSTER_YAML" "$VERSION" "$BACKEND_DIGEST" "$FRONTEND_DIGEST" <<'PYEOF'
import sys, yaml

yaml_file    = sys.argv[1]
version      = sys.argv[2]
backend_dig  = sys.argv[3]
frontend_dig = sys.argv[4]

with open(yaml_file) as f:
    content = f.read()
    data = yaml.safe_load(content)

data['images']['backend']['tag']    = version
data['images']['backend']['digest'] = backend_dig
data['images']['frontend']['tag']   = version
data['images']['frontend']['digest'] = frontend_dig

with open(yaml_file, 'w') as f:
    yaml.dump(data, f, sort_keys=False, allow_unicode=True, default_flow_style=False)

print(f"cluster.yaml updated: backend={backend_dig[:20]}... frontend={frontend_dig[:20]}...")
PYEOF

log "  cluster.yaml updated with version=$VERSION and digests"
log "=== 08_build_and_push_images: COMPLETE ==="
