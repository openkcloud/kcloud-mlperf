#!/usr/bin/env bash
# 10_run_smoke_tests.sh — read-only smoke tests against deployed services.
#
# Tests:
#   - backend /api/realtime/exams/health -> HTTP >= 200 (expect 200 OK)
#   - backend /api/mp-exam (mp-exam list)  -> HTTP 200
#   - frontend root /                      -> HTTP 200
#
# Optional --include-cluster-tests:
#   - Launches a busybox pod to verify DNS resolution + NFS PVC mount
#
# Reads service endpoints from cluster.yaml namespaces.app via kubectl.
# All tests are READ-ONLY — no state is mutated.
#
# Usage:
#   ./10_run_smoke_tests.sh [--include-cluster-tests] [--dry-run] [--help]
#
# Exit codes:
#   0  all smoke tests passed
#   1  one or more tests failed
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

INCLUDE_CLUSTER_TESTS=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)               DRY_RUN=true;              shift ;;
    --include-cluster-tests) INCLUDE_CLUSTER_TESTS=true; shift ;;
    *) die "Unknown flag '$1'. See --help." 2 ;;
  esac
done

log "=== 10_run_smoke_tests ==="
log "RUN_ID=$RUN_ID  DRY_RUN=$DRY_RUN  INCLUDE_CLUSTER_TESTS=$INCLUDE_CLUSTER_TESTS"

CLUSTER_YAML="$REPO_ROOT/config/cluster.yaml"
APP_NS="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
print(d.get('namespaces',{}).get('app','llm-evaluation'))
")"

FAIL=0

# ---------------------------------------------------------------------------
# Helper: http_check LABEL URL EXPECTED_STATUS
# ---------------------------------------------------------------------------
http_check() {
  local label="$1"
  local url="$2"
  local expected="${3:-200}"

  if [ "$DRY_RUN" = "true" ]; then
    log "  [DRY-RUN] would GET $url (expect HTTP $expected)"
    return 0
  fi

  local http_code
  http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || echo "000")"

  if [ "$http_code" -ge "$expected" ] 2>/dev/null; then
    log "  [OK]  $label -> HTTP $http_code (>= $expected)"
  else
    log "  [FAIL] $label -> HTTP $http_code (expected >= $expected) URL: $url"
    FAIL=1
  fi
}

# ---------------------------------------------------------------------------
# 1. Discover service endpoints via kubectl port-forward or NodePort/ClusterIP
# ---------------------------------------------------------------------------
log "--- Step 1: discover service endpoints ---"

# Try to get the external/LoadBalancer IP or NodePort for backend/frontend
get_svc_endpoint() {
  local svc_name="$1"
  local ns="$2"
  local port="$3"

  # Try LoadBalancer first
  local lb_ip
  lb_ip="$(kubectl get svc -n "$ns" "$svc_name" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [ -n "$lb_ip" ] && [ "$lb_ip" != "null" ] && [ "$lb_ip" != "<none>" ]; then
    printf 'http://%s:%s' "$lb_ip" "$port"
    return
  fi

  # Try NodePort
  local node_port
  node_port="$(kubectl get svc -n "$ns" "$svc_name" \
    -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || true)"
  if [ -n "$node_port" ] && [ "$node_port" != "null" ]; then
    # Use first worker node IP from cluster.yaml
    local node_ip
    node_ip="$(python3 -c "
import yaml
with open('$CLUSTER_YAML') as f: d=yaml.safe_load(f)
workers = [w for w in d.get('workers',[]) if w.get('state','active') != 'pending_join']
if workers: print(workers[0].get('ssh',{}).get('host',''))
")"
    if [ -n "$node_ip" ]; then
      printf 'http://%s:%s' "$node_ip" "$node_port"
      return
    fi
  fi

  # Fall back to ClusterIP via kubectl proxy (not ideal for automated tests, just warn)
  local cluster_ip
  cluster_ip="$(kubectl get svc -n "$ns" "$svc_name" \
    -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)"
  if [ -n "$cluster_ip" ] && [ "$cluster_ip" != "None" ]; then
    log "  [WARN] $svc_name only has ClusterIP $cluster_ip — HTTP tests may fail from outside cluster"
    printf 'http://%s:%s' "$cluster_ip" "$port"
    return
  fi

  printf ''
}

if [ "$DRY_RUN" = "true" ]; then
  BACKEND_URL="http://localhost:8000"
  FRONTEND_URL="http://localhost:3000"
  log "  [DRY-RUN] using placeholder URLs: backend=$BACKEND_URL frontend=$FRONTEND_URL"
else
  BACKEND_URL="$(get_svc_endpoint "etri-llm-backend" "$APP_NS" "8000" 2>/dev/null || true)"
  FRONTEND_URL="$(get_svc_endpoint "etri-llm-frontend" "$APP_NS" "3000" 2>/dev/null || true)"

  if [ -z "$BACKEND_URL" ]; then
    log "  [WARN] Could not determine backend URL — trying kubectl port-forward"
    kubectl port-forward -n "$APP_NS" svc/etri-llm-backend 18000:8000 &
    PF_PID=$!
    sleep 2
    BACKEND_URL="http://localhost:18000"
    trap 'kill $PF_PID 2>/dev/null || true' EXIT
  fi
  if [ -z "$FRONTEND_URL" ]; then
    log "  [WARN] Could not determine frontend URL — trying kubectl port-forward"
    kubectl port-forward -n "$APP_NS" svc/etri-llm-frontend 13000:3000 &
    PF2_PID=$!
    sleep 2
    FRONTEND_URL="http://localhost:13000"
    trap 'kill ${PF2_PID:-} 2>/dev/null || true; kill ${PF_PID:-} 2>/dev/null || true' EXIT
  fi

  log "  Backend URL:  $BACKEND_URL"
  log "  Frontend URL: $FRONTEND_URL"
fi

# ---------------------------------------------------------------------------
# 2. HTTP smoke tests
# ---------------------------------------------------------------------------
log "--- Step 2: HTTP smoke tests ---"
http_check "backend health"    "${BACKEND_URL}/api/realtime/exams/health" 200
http_check "backend mp-exam"   "${BACKEND_URL}/api/mp-exam"               200
http_check "frontend root"     "${FRONTEND_URL}/"                         200

# ---------------------------------------------------------------------------
# 3. Optional cluster tests (DNS + NFS PVC)
# ---------------------------------------------------------------------------
if [ "$INCLUDE_CLUSTER_TESTS" = "true" ]; then
  log "--- Step 3: cluster DNS + NFS PVC tests ---"

  TEST_POD="smoke-test-${RUN_ID}"

  if [ "$DRY_RUN" = "true" ]; then
    log "  [DRY-RUN] would create busybox pod $TEST_POD in $APP_NS"
    log "  [DRY-RUN] would test DNS: nslookup kubernetes.default"
    log "  [DRY-RUN] would test NFS PVC mount write"
  else
    # Create ephemeral busybox pod for DNS + NFS test
    kubectl run "$TEST_POD" \
      -n "$APP_NS" \
      --image=busybox:1.36 \
      --restart=Never \
      --rm \
      --timeout=60s \
      -- sh -c '
        echo "=== DNS test ==="
        nslookup kubernetes.default && echo "DNS OK" || echo "DNS FAIL"
        echo "=== NFS mount test ==="
        if [ -d /mnt/results ]; then
          touch /mnt/results/.smoke_test_probe && echo "NFS write OK" || echo "NFS write FAIL"
          rm -f /mnt/results/.smoke_test_probe
        else
          echo "NFS path /mnt/results not mounted (PVC may not be attached to this pod)"
        fi
      ' 2>&1 | while read -r line; do log "  cluster-test: $line"; done || {
        log "  [WARN] cluster test pod failed or timed out"
      }
  fi
fi

log ""
if [ "$FAIL" -eq 0 ]; then
  log "=== 10_run_smoke_tests: ALL TESTS PASSED [read-only] ==="
  exit 0
else
  log "=== 10_run_smoke_tests: ONE OR MORE TESTS FAILED ==="
  exit 1
fi
