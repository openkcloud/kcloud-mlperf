#!/bin/bash
#
# Start MLPerf Benchmarks with Automatic Visual Report Generation
# This script automatically generates visual reports as soon as benchmarks complete
#

echo "🚀 Starting MLPerf Benchmarks with Auto Visual Reporting"
echo "========================================================"
echo ""

# Start the auto report service in background
echo "📊 Starting automatic visual report service..."
./auto_report_service.sh &
AUTO_REPORT_PID=$!
echo "✅ Auto report service started (PID: $AUTO_REPORT_PID)"
echo ""

# Start benchmark monitoring 
echo "🔄 Starting benchmark monitoring..."
echo "   - Visual reports will be auto-generated when benchmarks complete"
echo "   - Reports saved to: results/visual_reports_TIMESTAMP/"
echo "   - Monitor progress with: ./monitor_official_benchmarks.sh watch"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping auto report service..."
    kill $AUTO_REPORT_PID 2>/dev/null
    echo "✅ Cleanup complete"
    exit 0
}

trap cleanup SIGTERM SIGINT

echo "🎯 Auto visual reporting is now active!"
echo "📊 Visual reports will be automatically generated at:"
echo "   - Individual completion: When each GPU finishes"  
echo "   - Final completion: When all benchmarks finish"
echo "   - Location: results/visual_reports_TIMESTAMP/"
echo ""
echo "📋 Available commands:"
echo "   ./monitor_official_benchmarks.sh status   - Check progress"
echo "   ./monitor_official_benchmarks.sh watch    - Live monitoring"
echo "   ./monitor_official_benchmarks.sh results  - Collect final results"
echo ""
echo "⏰ Monitoring started at: $(date)"
echo "🔄 Press Ctrl+C to stop auto reporting service"

# Keep the service running
wait $AUTO_REPORT_PID