#!/bin/bash
#
# Auto Visual Report Service
# Continuously monitors for new MLPerf results and auto-generates visual reports
#

RESULTS_BASE="/home/jungwooshim/results"
CHECK_INTERVAL=60  # Check every 60 seconds
LOG_FILE="/home/jungwooshim/auto_report_service.log"

echo "🚀 Starting Auto Visual Report Service" | tee -a "$LOG_FILE"
echo "📁 Monitoring: $RESULTS_BASE" | tee -a "$LOG_FILE"
echo "⏰ Check interval: ${CHECK_INTERVAL}s" | tee -a "$LOG_FILE"
echo "📋 Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "$(date): Service started" >> "$LOG_FILE"
echo "----------------------------------------" | tee -a "$LOG_FILE"

# Keep track of processed results
PROCESSED_FILE="/tmp/mlperf_processed_results.txt"
touch "$PROCESSED_FILE"

function log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" | tee -a "$LOG_FILE"
}

function check_for_new_results() {
    local found_new=false
    
    # Check for new result directories
    for result_dir in "$RESULTS_BASE"/*official*; do
        if [ -d "$result_dir" ]; then
            # Check if this directory has been processed
            if ! grep -q "$result_dir" "$PROCESSED_FILE" 2>/dev/null; then
                # Check if directory contains MLPerf result files
                if [ -f "$result_dir/mlperf_log_summary.txt" ] || [ -f "$result_dir/mlperf_log_accuracy.json" ]; then
                    log_message "📊 New results detected: $(basename $result_dir)"
                    
                    # Generate visual reports
                    log_message "🎯 Generating visual reports for $(basename $result_dir)..."
                    if python3 /home/jungwooshim/generate_visual_reports.py "$result_dir" >> "$LOG_FILE" 2>&1; then
                        log_message "✅ Visual reports generated successfully for $(basename $result_dir)"
                        echo "$result_dir" >> "$PROCESSED_FILE"
                        found_new=true
                    else
                        log_message "❌ Failed to generate visual reports for $(basename $result_dir)"
                    fi
                fi
            fi
        fi
    done
    
    # Check for updates to existing result directories
    for result_dir in "$RESULTS_BASE"/*official*; do
        if [ -d "$result_dir" ] && grep -q "$result_dir" "$PROCESSED_FILE" 2>/dev/null; then
            # Check if results were updated (look for newer files)
            if [ -f "$result_dir/mlperf_log_summary.txt" ]; then
                local last_visual_report=$(find "$result_dir" -name "visual_reports_*" -type d | head -1)
                if [ -n "$last_visual_report" ]; then
                    # Check if summary is newer than last visual report
                    if [ "$result_dir/mlperf_log_summary.txt" -nt "$last_visual_report" ]; then
                        log_message "🔄 Results updated, regenerating visual reports for $(basename $result_dir)..."
                        if python3 /home/jungwooshim/generate_visual_reports.py "$result_dir" >> "$LOG_FILE" 2>&1; then
                            log_message "✅ Updated visual reports generated for $(basename $result_dir)"
                            found_new=true
                        fi
                    fi
                fi
            fi
        fi
    done
    
    # Generate comprehensive report if multiple results available
    local result_count=$(find "$RESULTS_BASE" -name "*official*" -type d | wc -l)
    if [ "$result_count" -gt 1 ] && [ "$found_new" = true ]; then
        log_message "📊 Multiple results detected, generating comprehensive comparison report..."
        if python3 /home/jungwooshim/generate_visual_reports.py "$RESULTS_BASE" >> "$LOG_FILE" 2>&1; then
            log_message "✅ Comprehensive visual comparison report generated"
        fi
    fi
    
    return 0
}

function cleanup() {
    log_message "🛑 Auto Visual Report Service stopping..."
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Main monitoring loop
log_message "🔄 Starting monitoring loop..."
while true; do
    check_for_new_results
    
    # Check if benchmarks are still running
    if pgrep -f "python3.*main.py.*--scenario.*Server" > /dev/null; then
        log_message "⏳ Benchmarks still running, continuing to monitor..."
    fi
    
    sleep "$CHECK_INTERVAL"
done