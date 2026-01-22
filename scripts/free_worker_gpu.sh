#!/bin/bash
# ============================================================================
# free_worker_gpu.sh - Free GPU on worker nodes by killing processes
# ============================================================================
# This script kills all processes using GPU on worker nodes
# Can be run from master node using kubectl debug or directly on worker
# ============================================================================

set -e

NODE_NAME="${1:-jw3}"

echo "Checking GPU usage on node: $NODE_NAME"
echo ""

# Check if node exists
if ! kubectl get node "$NODE_NAME" &>/dev/null; then
    echo "Error: Node $NODE_NAME not found"
    exit 1
fi

# Get node status
NODE_STATUS=$(kubectl get node "$NODE_NAME" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
if [ "$NODE_STATUS" != "True" ]; then
    echo "Warning: Node $NODE_NAME is not Ready"
    echo "Attempting to free GPU anyway..."
fi

echo "Creating debug pod to check and free GPU on $NODE_NAME..."
echo ""

# Create a debug pod that will check GPU and kill processes
kubectl run free-gpu-debug-$NODE_NAME \
    --image=nvidia/cuda:12.0.0-base-ubuntu22.04 \
    --rm -i --restart=Never \
    --overrides='
{
  "spec": {
    "hostNetwork": true,
    "hostPID": true,
    "nodeName": "'$NODE_NAME'",
    "containers": [{
      "name": "free-gpu",
      "image": "nvidia/cuda:12.0.0-base-ubuntu22.04",
      "command": ["/bin/bash", "-c"],
      "args": ["echo \"Checking GPU processes...\"; nvidia-smi; echo \"\"; echo \"Killing all processes using GPU...\"; pkill -f python || true; pkill -f vllm || true; pkill -f torch || true; sleep 2; echo \"\"; echo \"GPU status after cleanup:\"; nvidia-smi || echo \"nvidia-smi not available in container\""],
      "securityContext": {
        "privileged": true
      },
      "volumeMounts": [{
        "name": "dev",
        "mountPath": "/dev"
      }]
    }],
    "volumes": [{
      "name": "dev",
      "hostPath": {
        "path": "/dev"
      }
    }]
  }
}' 2>&1 || {
    echo ""
    echo "Debug pod method failed. Trying alternative approach..."
    echo ""
    echo "To free GPU manually on $NODE_NAME, SSH to it and run:"
    echo "  sudo nvidia-smi"
    echo "  sudo fuser -v /dev/nvidia*"
    echo "  sudo killall -9 python python3 vllm || true"
    echo ""
    echo "Or use nvidia-smi to kill specific processes:"
    echo "  sudo nvidia-smi --query-compute-apps=pid --format=csv,noheader | xargs -r sudo kill -9"
}
