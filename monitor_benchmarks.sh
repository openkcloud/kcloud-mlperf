#!/bin/bash
#
# Auto-generated MLPerf Benchmark Monitor
# Generated from configuration: config.yaml
# Deployment type: ssh
#

JW2_IP="129.254.202.252"
JW2_USER="jungwooshim"
JW3_IP="129.254.202.253"
JW3_USER="jungwooshim"
RESULTS_DIR="./results"
REMOTE_DIR="~/official_mlperf/inference/language/llama3.1-8b"


echo "🚀 MLPerf Benchmark Monitor (Auto-configured)"
echo "=============================================="
echo "Monitoring MLPerf benchmarks across configured infrastructure"
echo ""

mkdir -p "$RESULTS_DIR"

function check_progress() {
    echo "📊 $(date): Checking benchmark progress..."
    
    # Check jw2 (129.254.202.252)
    echo "🔍 jw2 (129.254.202.252):"
    if ssh $JW2_USER@${JW2_IP} "ps aux | grep -q 'python3.*main.py'"; then
        LAST_REQUEST=$(ssh $JW2_USER@${JW2_IP} "cd $REMOTE_DIR && tail -5 jw2_benchmark.log 2>/dev/null | grep 'Added request' | tail -1 | sed 's/.*request //' | sed 's/\.//' || echo '0'")
        echo "  ✅ RUNNING - Processing request: $LAST_REQUEST/13,368"
        ssh $JW2_USER@${JW2_IP} "cd $REMOTE_DIR && tail -3 jw2_benchmark.log 2>/dev/null | grep 'throughput' | tail -1" || echo "  📊 Performance data loading..."
    else
        echo "  🏁 COMPLETED or STOPPED"
        # Copy results if completed
        if ssh $JW2_USER@${JW2_IP} "[ -f $REMOTE_DIR/jw2_results/mlperf_log_summary.txt ]"; then
            echo "  📁 Copying results..."
            mkdir -p "$RESULTS_DIR/jw2_official"
            scp -r $JW2_USER@${JW2_IP}:$REMOTE_DIR/jw2_results/* "$RESULTS_DIR/jw2_official/" 2>/dev/null
            scp $JW2_USER@${JW2_IP}:$REMOTE_DIR/jw2_benchmark.log "$RESULTS_DIR/jw2_official/" 2>/dev/null
            echo "  📊 Auto-generating visual reports for jw2..."
            python3 generate_visual_reports.py "$RESULTS_DIR/jw2_official" > /dev/null 2>&1
        fi
    fi
    echo ""
    
    # Check jw3 (129.254.202.253)
    echo "🔍 jw3 (129.254.202.253):"
    if ssh $JW3_USER@${JW3_IP} "ps aux | grep -q 'python3.*main.py'"; then
        LAST_REQUEST=$(ssh $JW3_USER@${JW3_IP} "cd $REMOTE_DIR && tail -5 jw3_benchmark.log 2>/dev/null | grep 'Added request' | tail -1 | sed 's/.*request //' | sed 's/\.//' || echo '0'")
        echo "  ✅ RUNNING - Processing request: $LAST_REQUEST/13,368"
        ssh $JW3_USER@${JW3_IP} "cd $REMOTE_DIR && tail -3 jw3_benchmark.log 2>/dev/null | grep 'throughput' | tail -1" || echo "  📊 Performance data loading..."
    else
        echo "  🏁 COMPLETED or STOPPED"
        # Copy results if completed
        if ssh $JW3_USER@${JW3_IP} "[ -f $REMOTE_DIR/jw3_results/mlperf_log_summary.txt ]"; then
            echo "  📁 Copying results..."
            mkdir -p "$RESULTS_DIR/jw3_official"
            scp -r $JW3_USER@${JW3_IP}:$REMOTE_DIR/jw3_results/* "$RESULTS_DIR/jw3_official/" 2>/dev/null
            scp $JW3_USER@${JW3_IP}:$REMOTE_DIR/jw3_benchmark.log "$RESULTS_DIR/jw3_official/" 2>/dev/null
            echo "  📊 Auto-generating visual reports for jw3..."
            python3 generate_visual_reports.py "$RESULTS_DIR/jw3_official" > /dev/null 2>&1
        fi
    fi
    echo ""

}

function main() {
    case "${1:-status}" in
        "status")
            check_progress
            ;;
        "watch")
            while true; do
                clear
                check_progress
                echo "🔄 Auto-refreshing every 60 seconds... (Ctrl+C to stop)"
                sleep 60
            done
            ;;
        "results")
            echo "📊 Collecting final results..."
            check_progress
            
            # Check if all benchmarks completed
            completed_count=0
            if [ -d "$RESULTS_DIR/jw2_official" ]; then
                completed_count=$((completed_count + 1))
            fi
            if [ -d "$RESULTS_DIR/jw3_official" ]; then
                completed_count=$((completed_count + 1))
            fi
            
            if [ "$completed_count" -eq 2 ]; then
                echo "🎉 All benchmarks completed! Generating comprehensive report..."
                echo "📊 Generating comprehensive visual reports..."
                python3 generate_visual_reports.py "$RESULTS_DIR" > /dev/null 2>&1
                echo "✅ Visual reports generated and saved to results/visual_reports_*/"
            else
                echo "⏳ $completed_count/2 benchmarks completed"
            fi
            ;;
        *)
            echo "Usage: $0 [status|watch|results]"
            echo ""
            echo "Commands:"
            echo "  status   - Check current benchmark progress (default)"
            echo "  watch    - Monitor benchmarks with auto-refresh"  
            echo "  results  - Collect final results and generate report"
            ;;
    esac
}

main "$@"
