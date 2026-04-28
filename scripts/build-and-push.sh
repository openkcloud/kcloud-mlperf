#!/usr/bin/env bash
# build-and-push.sh — build backend + frontend images, push to Docker Hub, optionally save tarball.
#
# Run from the build host. Requires the etri-llm-exam-solution source tree.
#
# Usage:
#   ./build-and-push.sh <version> [--source <path>] [--no-push] [--save-tar <path>]
#
# Examples:
#   ./build-and-push.sh v13                                              # build + push as v13
#   ./build-and-push.sh v13 --no-push                                    # local build only
#   ./build-and-push.sh v13 --save-tar /tmp/etri-v13.tar.gz              # build + push + save offline tarball
#   ./build-and-push.sh v13 --source /home/kcloud/etri-llm-exam-solution # explicit source path
#
# Defaults:
#   --source: $ETRI_SRC env var, or /tmp/etri-llm-exam-solution, or ./etri-llm-exam-solution
#   Image refs: jungwooshim/etri-llm-backend:<version>, jungwooshim/etri-llm-frontend:<version>
#
# Exit codes: 0 ok | 1 missing prereq | 2 user error | 3 build failure | 4 push failure

set -euo pipefail

# --- args
VERSION="${1:-}"
[ "$VERSION" = "--help" ] || [ "$VERSION" = "-h" ] && { grep '^# ' "$0" | sed 's/^# //'; exit 0; }
[ -z "$VERSION" ] && { echo "ERROR: <version> required (e.g. v13). See --help." >&2; exit 2; }
shift

SRC="${ETRI_SRC:-}"
DO_PUSH=true
SAVE_TAR=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) SRC="$2"; shift 2 ;;
    --no-push) DO_PUSH=false; shift ;;
    --save-tar) SAVE_TAR="$2"; shift 2 ;;
    *) echo "ERROR: unknown flag '$1'. See --help." >&2; exit 2 ;;
  esac
done

# Default source detection
if [ -z "$SRC" ]; then
  for cand in /tmp/etri-llm-exam-solution ./etri-llm-exam-solution; do
    if [ -f "$cand/server/Dockerfile.prod" ]; then SRC="$cand"; break; fi
  done
fi
if [ ! -f "$SRC/server/Dockerfile.prod" ] || [ ! -f "$SRC/web/Dockerfile.prod" ]; then
  echo "ERROR: source tree not found at '$SRC'. Pass --source or set ETRI_SRC." >&2; exit 1
fi

command -v docker >/dev/null || { echo "ERROR: docker missing. Run install-build-host.sh first." >&2; exit 1; }

# --- pre-push login check
if [ "$DO_PUSH" = true ]; then
  if ! sudo docker info 2>/dev/null | grep -q '^ Username:'; then
    echo "ERROR: not logged in to Docker Hub. Run 'docker login' or install-build-host.sh" >&2; exit 4
  fi
fi

BACKEND="jungwooshim/etri-llm-backend:$VERSION"
FRONTEND="jungwooshim/etri-llm-frontend:$VERSION"

echo "=== build $BACKEND ==="
sudo docker build -t "$BACKEND" -f "$SRC/server/Dockerfile.prod" "$SRC/server"

echo "=== build $FRONTEND ==="
sudo docker build -t "$FRONTEND" -f "$SRC/web/Dockerfile.prod" "$SRC/web"

if [ "$DO_PUSH" = true ]; then
  echo "=== push $BACKEND ==="
  sudo docker push "$BACKEND"
  echo "=== push $FRONTEND ==="
  sudo docker push "$FRONTEND"
fi

if [ -n "$SAVE_TAR" ]; then
  echo "=== save offline tarball $SAVE_TAR ==="
  sudo docker save "$BACKEND" "$FRONTEND" | gzip > "$SAVE_TAR"
  ls -lh "$SAVE_TAR"
fi

echo "Done. Backend: $BACKEND  Frontend: $FRONTEND  Pushed: $DO_PUSH${SAVE_TAR:+  Tarball: $SAVE_TAR}"
