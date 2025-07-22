#!/bin/bash
#
# Stop MLPerf Benchmarks on All Nodes
#

echo "🛑 Stopping MLPerf Benchmarks..."

# Stop on jw2
echo "🔍 Stopping jw2 (129.254.202.252)..."
ssh jungwooshim@129.254.202.252 "
    echo 'Killing Python MLPerf processes...'
    pkill -f 'python3.*main.py' 2>/dev/null || true
    pkill -9 -f 'python3.*main.py' 2>/dev/null || true
    
    echo 'Killing bash wrapper processes...'  
    pkill -f 'bash.*mlperf' 2>/dev/null || true
    pkill -9 -f 'bash.*mlperf' 2>/dev/null || true
    
    echo 'Final check...'
    if ps aux | grep -q 'python3.*main.py' | grep -v grep; then
        echo 'Some processes may still be running - they will finish naturally'
    else
        echo 'All MLPerf processes stopped on jw2'
    fi
"

# Stop on jw3  
echo "🔍 Stopping jw3 (129.254.202.253)..."
ssh jungwooshim@129.254.202.253 "
    echo 'Killing Python MLPerf processes...'
    pkill -f 'python3.*main.py' 2>/dev/null || true  
    pkill -9 -f 'python3.*main.py' 2>/dev/null || true
    
    echo 'Killing bash wrapper processes...'
    pkill -f 'bash.*mlperf' 2>/dev/null || true
    pkill -9 -f 'bash.*mlperf' 2>/dev/null || true
    
    echo 'Final check...'
    if ps aux | grep -q 'python3.*main.py' | grep -v grep; then
        echo 'Some processes may still be running - they will finish naturally'  
    else
        echo 'All MLPerf processes stopped on jw3'
    fi
"

echo "✅ Stop commands sent to both nodes"
echo "💡 Use: python3 scripts/monitoring/realtime_monitor.py --once to verify"