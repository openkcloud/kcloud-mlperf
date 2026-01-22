#!/bin/bash
# ============================================================================
# free_gpu.sh - Free GPU by killing all processes using it
# ============================================================================
# Run this script directly on the worker node to free GPU memory
# ============================================================================

set -e

if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
    echo "This script requires root/sudo access"
    exit 1
fi

echo "════════════════════════════════════════════════════════════════════"
echo "  Freeing GPU - Killing processes using GPU"
echo "════════════════════════════════════════════════════════════════════"
echo ""

# Check GPU status before
echo "[1/4] Current GPU status:"
nvidia-smi || {
    echo "Error: nvidia-smi not available"
    exit 1
}

echo ""
echo "[2/4] Finding processes using GPU..."

# Get PIDs of processes using GPU
GPU_PIDS=$(nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null | grep -v '^$' || echo "")

if [ -z "$GPU_PIDS" ]; then
    echo "No processes found using GPU"
else
    echo "Found processes: $GPU_PIDS"
    echo ""
    echo "[3/4] Killing GPU processes..."
    
    for pid in $GPU_PIDS; do
        if kill -0 "$pid" 2>/dev/null; then
            echo "  Killing PID $pid..."
            sudo kill -9 "$pid" 2>/dev/null || true
        fi
    done
    
    # Also kill common GPU-using processes by name
    sudo pkill -9 -f "python.*vllm" 2>/dev/null || true
    sudo pkill -9 -f "torch" 2>/dev/null || true
    sudo pkill -9 -f "cuda" 2>/dev/null || true
    
    sleep 2
fi

echo ""
echo "[4/4] GPU status after cleanup:"
nvidia-smi

echo ""
echo "✓ GPU freed successfully"
echo ""
