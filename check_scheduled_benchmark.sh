#!/bin/bash

# Check status of scheduled MLPerf benchmark
echo "📊 MLPerf Scheduled Benchmark Status Checker"
echo "============================================"
echo "Current time: $(date)"
echo ""

# Check if benchmark is scheduled
echo "🕐 Cron Schedule:"
crontab -l | grep "scheduled_full_mlperf_benchmark.sh" || echo "❌ No scheduled benchmark found"
echo ""

# Check for running benchmarks
echo "🔍 Running Benchmark Processes:"
pgrep -f "scheduled_full_mlperf_benchmark.sh" > /dev/null && echo "✅ Scheduled script is running" || echo "⏸️  No scheduled script running"

# Check for Python MLPerf processes on worker nodes
echo ""
echo "🖥️  Worker Node Status:"
ssh 129.254.202.252 'pgrep -f "main.py.*--scenario.*Server" > /dev/null && echo "jw2: ✅ MLPerf benchmark running" || echo "jw2: ⏸️  No benchmark running"' 2>/dev/null || echo "jw2: ❌ Connection failed"

ssh 129.254.202.253 'pgrep -f "main.py.*--scenario.*Server" > /dev/null && echo "jw3: ✅ MLPerf benchmark running" || echo "jw3: ⏸️  No benchmark running"' 2>/dev/null || echo "jw3: ❌ Connection failed"

# Check for latest results
echo ""
echo "📁 Latest Results:"
LATEST_RESULT=$(ls -td /home/jungwooshim/results/scheduled_run_* 2>/dev/null | head -1)
if [ -n "$LATEST_RESULT" ]; then
    echo "📊 Latest run: $(basename "$LATEST_RESULT")"
    if [ -f "$LATEST_RESULT/benchmark_summary.md" ]; then
        echo "✅ Summary report available"
        echo "📄 Preview:"
        head -15 "$LATEST_RESULT/benchmark_summary.md" | sed 's/^/   /'
    else
        echo "⏳ Benchmark in progress..."
        if [ -f "$LATEST_RESULT/jw2_execution.log" ]; then
            echo "📊 jw2 last activity: $(tail -1 "$LATEST_RESULT/jw2_execution.log" 2>/dev/null | cut -c1-80)..."
        fi
        if [ -f "$LATEST_RESULT/jw3_execution.log" ]; then
            echo "📊 jw3 last activity: $(tail -1 "$LATEST_RESULT/jw3_execution.log" 2>/dev/null | cut -c1-80)..."
        fi
    fi
else
    echo "📭 No scheduled runs found yet"
fi

# Check GPU status
echo ""
echo "🔥 GPU Status:"
ssh 129.254.202.252 'nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits | head -1' 2>/dev/null | awk -F, '{printf "jw2: %s | Mem: %sGB/%sGB | GPU: %s%%\n", $1, $2/1024, $3/1024, $4}' || echo "jw2: ❌ GPU status unavailable"

ssh 129.254.202.253 'nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits | head -1' 2>/dev/null | awk -F, '{printf "jw3: %s | Mem: %sGB/%sGB | GPU: %s%%\n", $1, $2/1024, $3/1024, $4}' || echo "jw3: ❌ GPU status unavailable"

echo ""
echo "⏰ Next scheduled run: Today at 7:00 PM KST"
echo "📊 Use 'watch -n 30 ./check_scheduled_benchmark.sh' for live monitoring"