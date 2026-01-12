#!/bin/bash
# ============================================================================
# deploy_to_worker.sh - Deploy and Setup Remote Worker Node
# ============================================================================
# Deploys the worker setup script to the remote A30 GPU server and runs it.
# ============================================================================

set -e

# Configuration
REMOTE_HOST="129.254.202.129"
REMOTE_USER="kcloud"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================================================"
echo "       Deploy to Remote GPU Worker (A30)"
echo "============================================================================"
echo ""
echo "Remote server: ${REMOTE_USER}@${REMOTE_HOST}"
echo ""

# ============================================================================
# Step 1: Copy setup script to remote server
# ============================================================================
echo "[1/4] Copying worker setup script to remote server..."
scp "${SCRIPT_DIR}/setup_worker_node.sh" ${REMOTE_USER}@${REMOTE_HOST}:/tmp/

# ============================================================================
# Step 2: Run setup script on remote server
# ============================================================================
echo "[2/4] Running setup script on remote server..."
ssh -t ${REMOTE_USER}@${REMOTE_HOST} "chmod +x /tmp/setup_worker_node.sh && /tmp/setup_worker_node.sh"

# ============================================================================
# Step 3: Get join command from master
# ============================================================================
echo "[3/4] Getting join command from master..."
if [ -f /tmp/k8s_join_command.sh ]; then
    JOIN_CMD=$(cat /tmp/k8s_join_command.sh)
    echo "Join command: ${JOIN_CMD}"
else
    echo "Join command not found. Please run setup_master_node.sh first."
    echo "Then run: kubeadm token create --print-join-command"
    read -p "Enter the join command: " JOIN_CMD
fi

# ============================================================================
# Step 4: Join worker to cluster
# ============================================================================
echo "[4/4] Joining worker to cluster..."
ssh -t ${REMOTE_USER}@${REMOTE_HOST} "sudo ${JOIN_CMD}"

echo ""
echo "============================================================================"
echo "                    Worker Deployment Complete!"
echo "============================================================================"
echo ""
echo "Verifying nodes..."
kubectl get nodes
echo ""
echo "Checking GPU availability (may take a minute)..."
sleep 10
kubectl describe node -l node-role.kubernetes.io/worker | grep -A10 "Allocatable:" || true