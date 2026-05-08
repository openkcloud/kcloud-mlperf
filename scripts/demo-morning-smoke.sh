#!/usr/bin/env bash
# Demo-morning smoke check — run 60 min before audience.
# Validates: cluster Ready, app pods Running, /comparison serves seconds, all 4
# Streamlit dashboards reachable.  Exits non-zero on any failure.

set -euo pipefail

BACKEND="${BACKEND:-http://10.254.177.41:30980}"
FRONTEND="${FRONTEND:-http://10.254.177.41:30001}"
NS=llm-evaluation
PASS="✅"
FAIL="❌"
WARN="⚠️ "

failed=0

step() {
  local label="$1"; shift
  local result
  if "$@" >/dev/null 2>&1; then
    echo "$PASS $label"
  else
    echo "$FAIL $label"
    failed=$((failed + 1))
  fi
}

echo "=== ETRI demo-morning smoke check ==="
echo

echo "--- Cluster ---"
step "All 5 nodes Ready" \
  bash -c 'kubectl get nodes --no-headers | awk "{print \$2}" | grep -vE "^Ready" | wc -l | grep -q "^0$"'

echo "--- App pods ---"
for app in etri-llm-backend etri-llm-frontend etri-llm-db etri-llm-api etri-llm-operator; do
  step "Pod $app Running" \
    bash -c "kubectl get pods -n $NS -l app=$app --no-headers | awk '{print \$3}' | grep -q '^Running\$'"
done

echo "--- API health ---"
step "Backend /api/mp-exam/list returns 200" \
  bash -c "curl -sf -m 5 '$BACKEND/api/mp-exam/list?limit=1' | grep -q '\"status\":true'"
step "Frontend index serves 200" \
  bash -c "curl -sf -m 5 '$FRONTEND/' | grep -q '<html'"

echo "--- /comparison cross-vendor scale (TT100T should be 1.2-2.0 s for L40/A40/RNGD/Atom+) ---"
tmpresp=$(mktemp)
trap 'rm -f "$tmpresp"' EXIT
if curl -sf -m 10 "$BACKEND/api/comparison/list?benchmark=mlperf&limit=20" -o "$tmpresp" 2>/dev/null \
  && python3 -c "
import json, sys
data = json.load(open('$tmpresp'))
runs = data.get('data', {}).get('runs', [])
seen_each, ok = {}, True
for r in runs:
    hw = r.get('hardware', {})
    canonical = hw.get('canonical') if isinstance(hw, dict) else hw
    tt = r.get('metrics', {}).get('tt100t_seconds')
    if tt is None or tt == 0:
        continue
    if tt < 0.5 or tt > 5.0:
        print(f'out-of-range TT100T id={r.get(\"id\")} {canonical}: {tt:.4f} s')
        ok = False
    if canonical not in seen_each:
        seen_each[canonical] = tt
for hw, tt in sorted(seen_each.items()):
    print(f'   {hw}: {tt:.3f} s (sample row)')
sys.exit(0 if ok and seen_each else 1)
"; then
  echo "$PASS cross-vendor TT100T scale OK"
else
  echo "$FAIL cross-vendor TT100T scale check failed"
  failed=$((failed + 1))
fi

echo "--- Streamlit dashboards (per-device live tiles, must be reachable from demo-laptop network) ---"
declare -A boards=(
  [L40]="10.254.184.195:30891"
  [A40]="10.254.184.196:30893"
  [RNGD]="10.254.202.114:30890"
  [Atom+]="10.254.202.111:30892"
)
for hw in "${!boards[@]}"; do
  step "Streamlit $hw http://${boards[$hw]}/" \
    bash -c "curl -sf -m 5 -o /dev/null 'http://${boards[$hw]}/'"
done

echo
if [[ $failed -gt 0 ]]; then
  echo "$FAIL  $failed step(s) failed.  Investigate before demo."
  exit 1
else
  echo "$PASS  All smoke checks passed.  Ready for demo."
fi
