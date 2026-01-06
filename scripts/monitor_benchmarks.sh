#!/bin/bash
# ============================================================================
# monitor_benchmarks.sh - Real-time Benchmark Monitoring
# ============================================================================
# This script provides real-time monitoring of running benchmark jobs.
# ============================================================================

NAMESPACE="mlperf"
REFRESH_INTERVAL=${1:-10}

echo "============================================================================"
echo "              MLPerf/MMLU Benchmark Monitor"
echo "============================================================================"
echo "Namespace: ${NAMESPACE}"
echo "Refresh interval: ${REFRESH_INTERVAL}s (pass as argument to change)"
echo "Press Ctrl+C to exit"
echo "============================================================================"
echo ""

while true; do
    clear
    echo "============================================================================"
    echo "              MLPerf/MMLU Benchmark Monitor - $(date)"
    echo "============================================================================"
    echo ""
    
    echo "=== Jobs ==="
    kubectl get jobs -n ${NAMESPACE} 2>/dev/null || echo "No jobs found"
    echo ""
    
    echo "=== Pods ==="
    kubectl get pods -n ${NAMESPACE} 2>/dev/null || echo "No pods found"
    echo ""
    
    echo "=== Recent Pod Logs (last 20 lines) ==="
    POD=$(kubectl get pods -n ${NAMESPACE} --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null)
    if [ -n "$POD" ]; then
        echo "Pod: $POD"
        echo "---"
        kubectl logs "$POD" -n ${NAMESPACE} --tail=20 2>/dev/null || echo "No logs available"
    else
        echo "No pods running"
    fi
    echo ""
    
    echo "============================================================================"
    echo "Refreshing in ${REFRESH_INTERVAL}s... (Ctrl+C to exit)"
    
    sleep ${REFRESH_INTERVAL}
done