#!/bin/bash
# ============================================================================
# install_nvidia_plugin.sh - Install NVIDIA Device Plugin on K8s Cluster
# ============================================================================
# Run this on the master node after the worker has joined.
# ============================================================================

set -e

echo "============================================================================"
echo "       Installing NVIDIA Device Plugin"
echo "============================================================================"

# Check if worker node is ready
echo "Checking nodes..."
kubectl get nodes

# Install NVIDIA device plugin
echo ""
echo "Installing NVIDIA Device Plugin..."
kubectl create -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.0/nvidia-device-plugin.yml

# Wait for plugin to be ready
echo ""
echo "Waiting for NVIDIA device plugin to be ready..."
sleep 30

# Check GPU availability
echo ""
echo "Checking GPU availability on worker nodes..."
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}: GPU={.status.allocatable.nvidia\.com/gpu}{"\n"}{end}'

echo ""
echo "============================================================================"
echo "                    NVIDIA Device Plugin Installed!"
echo "============================================================================"
echo ""
echo "To verify GPU is working, run a test pod:"
echo "  kubectl run gpu-test --rm -it --restart=Never --image=nvidia/cuda:12.0-base --limits=nvidia.com/gpu=1 -- nvidia-smi"
echo ""