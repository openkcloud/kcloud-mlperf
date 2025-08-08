#!/usr/bin/env bash
set -euo pipefail

KEEP=1
while [[ $# -gt 0 ]]; do case $1 in
  --keep) KEEP="$2"; shift 2;;
  *) echo "Unknown arg $1"; exit 2;;
esac; done

echo "Keeping latest ${KEEP} results directories; listing others..."
cd results 2>/dev/null || { echo "No results directory"; exit 0; }

dirs=( $(ls -1dt */ 2>/dev/null || true) )
if [[ ${#dirs[@]} -le ${KEEP} ]]; then
  echo "Nothing to prune"; exit 0
fi

to_delete=( "${dirs[@]:${KEEP}}" )
printf '%s\n' "${to_delete[@]}" | sed 's#/$##' | while read -r d; do
  echo "Would delete: ${d}"  # convert to `rm -rf "$d"` when ready
done

