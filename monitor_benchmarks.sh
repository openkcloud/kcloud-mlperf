#!/bin/bash
#
# Auto-generated MLPerf Benchmark Monitor
# Generated from configuration: config.yaml
# Deployment type: ssh
#

GPU-NODE-1_IP="192.168.1.100"
GPU-NODE-1_USER="username"
GPU-NODE-2_IP="192.168.1.101"
GPU-NODE-2_USER="username"
RESULTS_DIR="./results"
REMOTE_DIR="~/official_mlperf/inference/language/llama3.1-8b"


echo "🚀 MLPerf Benchmark Monitor (Auto-configured)"
echo "=============================================="
echo "Monitoring MLPerf benchmarks across configured infrastructure"
echo ""

mkdir -p "$RESULTS_DIR"

function check_progress() {
    echo "📊 $(date): Checking benchmark progress..."
    
    # Check gpu-node-1 (192.168.1.100)
    echo "🔍 gpu-node-1 (192.168.1.100):"
    if ssh $GPU-NODE-1_USER@${GPU-NODE-1_IP} "ps aux | grep -q 'python3.*main.py'"; then
        LAST_REQUEST=$(ssh $GPU-NODE-1_USER@${GPU-NODE-1_IP} "cd $REMOTE_DIR && tail -5 gpu-node-1_benchmark.log 2>/dev/null | grep 'Added request' | tail -1 | sed 's/.*request //' | sed 's/\.//' || echo '0'")
        echo "  ✅ RUNNING - Processing request: $LAST_REQUEST/13,368"
        ssh $GPU-NODE-1_USER@${GPU-NODE-1_IP} "cd $REMOTE_DIR && tail -3 gpu-node-1_benchmark.log 2>/dev/null | grep 'throughput' | tail -1" || echo "  📊 Performance data loading..."
    else
        echo "  🏁 COMPLETED or STOPPED"
        # Copy results if completed
        if ssh $GPU-NODE-1_USER@${GPU-NODE-1_IP} "[ -f $REMOTE_DIR/gpu-node-1_results/mlperf_log_summary.txt ]"; then
            echo "  📁 Copying results..."
            mkdir -p "$RESULTS_DIR/gpu-node-1_official"
            scp -r $GPU-NODE-1_USER@${GPU-NODE-1_IP}:$REMOTE_DIR/gpu-node-1_results/* "$RESULTS_DIR/gpu-node-1_official/" 2>/dev/null
            scp $GPU-NODE-1_USER@${GPU-NODE-1_IP}:$REMOTE_DIR/gpu-node-1_benchmark.log "$RESULTS_DIR/gpu-node-1_official/" 2>/dev/null
            echo "  📊 Auto-generating visual reports for gpu-node-1..."
            python3 generate_visual_reports.py "$RESULTS_DIR/gpu-node-1_official" > /dev/null 2>&1
        fi
    fi
    echo ""
    
    # Check gpu-node-2 (192.168.1.101)
    echo "🔍 gpu-node-2 (192.168.1.101):"
    if ssh $GPU-NODE-2_USER@${GPU-NODE-2_IP} "ps aux | grep -q 'python3.*main.py'"; then
        LAST_REQUEST=$(ssh $GPU-NODE-2_USER@${GPU-NODE-2_IP} "cd $REMOTE_DIR && tail -5 gpu-node-2_benchmark.log 2>/dev/null | grep 'Added request' | tail -1 | sed 's/.*request //' | sed 's/\.//' || echo '0'")
        echo "  ✅ RUNNING - Processing request: $LAST_REQUEST/13,368"
        ssh $GPU-NODE-2_USER@${GPU-NODE-2_IP} "cd $REMOTE_DIR && tail -3 gpu-node-2_benchmark.log 2>/dev/null | grep 'throughput' | tail -1" || echo "  📊 Performance data loading..."
    else
        echo "  🏁 COMPLETED or STOPPED"
        # Copy results if completed
        if ssh $GPU-NODE-2_USER@${GPU-NODE-2_IP} "[ -f $REMOTE_DIR/gpu-node-2_results/mlperf_log_summary.txt ]"; then
            echo "  📁 Copying results..."
            mkdir -p "$RESULTS_DIR/gpu-node-2_official"
            scp -r $GPU-NODE-2_USER@${GPU-NODE-2_IP}:$REMOTE_DIR/gpu-node-2_results/* "$RESULTS_DIR/gpu-node-2_official/" 2>/dev/null
            scp $GPU-NODE-2_USER@${GPU-NODE-2_IP}:$REMOTE_DIR/gpu-node-2_benchmark.log "$RESULTS_DIR/gpu-node-2_official/" 2>/dev/null
            echo "  📊 Auto-generating visual reports for gpu-node-2..."
            python3 generate_visual_reports.py "$RESULTS_DIR/gpu-node-2_official" > /dev/null 2>&1
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
            if [ -d "$RESULTS_DIR/gpu-node-1_official" ]; then
                completed_count=$((completed_count + 1))
            fi
            if [ -d "$RESULTS_DIR/gpu-node-2_official" ]; then
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
