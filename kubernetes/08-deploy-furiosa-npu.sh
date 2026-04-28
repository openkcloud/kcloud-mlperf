#!/usr/bin/env bash
set -euo pipefail

#########################################################
# FuriosaAI NPU Kubernetes Plugin Deployment
#
# Deploys:
#   1. furiosa-feature-discovery (node labeling)
#   2. furiosa-device-plugin (exposes furiosa.ai/rngd resource)
#
# Prerequisites:
#   - Node with FuriosaAI RNGD NPU joined to cluster
#   - furiosa-driver-rngd installed on the node
#   - furiosa-cdi configured and containerd CDI enabled
#########################################################

NAMESPACE="furiosa-system"

echo "[$(date)] === Deploying FuriosaAI NPU Plugins ==="

# Add Furiosa Helm repository
echo "[$(date)] Adding Furiosa Helm repository..."
helm repo add furiosa https://furiosa-ai.github.io/helm-charts || true
helm repo update

# Create namespace
kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -

# Deploy Feature Discovery
echo "[$(date)] Deploying furiosa-feature-discovery..."
helm upgrade --install furiosa-feature-discovery furiosa/furiosa-feature-discovery \
  -n ${NAMESPACE} \
  --wait \
  --timeout 120s

# Deploy Device Plugin
echo "[$(date)] Deploying furiosa-device-plugin..."
helm upgrade --install furiosa-device-plugin furiosa/furiosa-device-plugin \
  -n ${NAMESPACE} \
  --wait \
  --timeout 120s

# Verify deployment
echo "[$(date)] Verifying deployment..."
kubectl get pods -n ${NAMESPACE}

echo ""
echo "[$(date)] Checking NPU resource on nodes..."
kubectl get nodes -o custom-columns="NAME:.metadata.name,NPU:.status.allocatable.furiosa\.ai/rngd" 2>/dev/null || echo "Resource not yet available, may take a moment"

echo ""
echo "[$(date)] === FuriosaAI NPU Plugin Deployment Complete ==="
