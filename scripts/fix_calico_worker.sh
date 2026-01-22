#!/bin/bash
# ============================================================================
# fix_calico_worker.sh - Remove Calico CNI configs from worker node
# ============================================================================
# Run this on worker nodes that have Calico CNI conflicts with Flannel
# ============================================================================

set -e

if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
    echo "This script requires root/sudo access"
    exit 1
fi

echo "Removing Calico CNI configuration files..."
sudo rm -f /etc/cni/net.d/10-calico.conflist
sudo rm -f /etc/cni/net.d/calico-kubeconfig

echo "Restarting kubelet to apply changes..."
sudo systemctl restart kubelet

echo "✓ Calico CNI configs removed. Worker node should now use Flannel."
echo ""
echo "Verify with: ls -la /etc/cni/net.d/"
