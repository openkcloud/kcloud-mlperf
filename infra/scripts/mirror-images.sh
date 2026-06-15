#!/usr/bin/env bash
# mirror-images.sh — copy required images from the legacy mondrianai/* registry
#                    into ETRI-owned ghcr.io/etri-llm/*
#                    so a fresh cluster only needs ONE registry account.
#
# ETRI takeover (2026-05-12): destination registry migrated from
# jungwooshim Docker Hub to ETRI-owned GHCR org `ghcr.io/etri-llm`.
#
# Run-once when standing up a new cluster, or whenever a new mondrianai image
# tag is referenced by the chart. Idempotent — re-running is safe (crane
# detects existing manifests and skips uploads).
#
# Mechanism: spawns a short-lived Kubernetes Job on an existing cluster node
# that runs gcr.io/go-containerregistry/crane:debug. The Job uses the
# `image-pull-secret` already deployed in the namespace as the destination
# auth, so no registry credentials are touched on the operator workstation.
# The destination secret MUST be a GHCR PAT with write:packages scope.
#
# Usage:
#   ./mirror-images.sh                     # mirror all known images
#   ./mirror-images.sh --namespace foo     # use a different namespace
#   ./mirror-images.sh --node node3        # pin Job to a specific node
#   ./mirror-images.sh --wait-timeout 600  # seconds (default 300)
#   ./mirror-images.sh --help
#
# Exit codes: 0 ok | 1 missing prereq | 2 user error | 3 mirror failure

set -euo pipefail

NS="llm-evaluation"
NODE="node2"
WAIT_TIMEOUT="300"
JOB_NAME="mirror-mondrianai-to-ghcr"

while [ $# -gt 0 ]; do
  case "$1" in
    --namespace)    NS="$2";          shift 2 ;;
    --node)         NODE="$2";        shift 2 ;;
    --wait-timeout) WAIT_TIMEOUT="$2"; shift 2 ;;
    --help|-h)      grep '^# ' "$0" | sed 's/^# //'; exit 0 ;;
    *)              echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

command -v kubectl >/dev/null 2>&1 || { echo "kubectl not found" >&2; exit 1; }

if ! kubectl -n "$NS" get secret image-pull-secret >/dev/null 2>&1; then
  echo "secret/image-pull-secret missing in namespace $NS — run install-app-chart.sh first" >&2
  exit 1
fi

echo "[mirror-images] applying Job $JOB_NAME in $NS (pinned to $NODE)"
kubectl -n "$NS" delete job "$JOB_NAME" --ignore-not-found=true >/dev/null

cat <<YAML | kubectl -n "$NS" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels:
        app: image-mirror
    spec:
      restartPolicy: Never
      nodeSelector:
        kubernetes.io/hostname: ${NODE}
      containers:
      - name: crane
        image: gcr.io/go-containerregistry/crane:debug
        env:
        - name: DOCKER_CONFIG_JSON
          valueFrom:
            secretKeyRef:
              name: image-pull-secret
              key: .dockerconfigjson
        command: ["/busybox/sh","-c"]
        args:
        - |
          set -ex
          mkdir -p /root/.docker
          printf '%s' "\$DOCKER_CONFIG_JSON" > /root/.docker/config.json
          for pair in \\
            "mondrianai/etri-llm-k8s-api:v1.0.0       ghcr.io/etri-llm/etri-llm-k8s-api:v1.0.0" \\
            "mondrianai/etri-llm-mlperf:v0.2          ghcr.io/etri-llm/etri-llm-mlperf:v0.2" \\
            "mondrianai/etri-llm-mmlu-pro:v0.2        ghcr.io/etri-llm/etri-llm-mmlu-pro:v0.2" ; do
            src=\$(echo "\$pair" | awk '{print \$1}')
            dst=\$(echo "\$pair" | awk '{print \$2}')
            echo "=== mirror \$src -> \$dst ==="
            crane copy "\$src" "\$dst"
          done
          echo "=== done ==="
YAML

echo "[mirror-images] waiting up to ${WAIT_TIMEOUT}s for completion"
if ! kubectl -n "$NS" wait --for=condition=complete --timeout="${WAIT_TIMEOUT}s" "job/$JOB_NAME"; then
  echo "[mirror-images] FAILED — last logs:" >&2
  kubectl -n "$NS" logs "job/$JOB_NAME" --tail=50 >&2 || true
  exit 3
fi

echo "[mirror-images] OK — final tag list (manual verification: GHCR API requires auth):"
for img in ghcr.io/etri-llm/etri-llm-k8s-api:v1.0.0 \
           ghcr.io/etri-llm/etri-llm-mlperf:v0.2 \
           ghcr.io/etri-llm/etri-llm-mmlu-pro:v0.2; do
  printf "  %-60s (verify via: crane manifest %s)\n" "$img" "$img"
done
