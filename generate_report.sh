#!/bin/bash
# Generate HTML/Markdown report from JSON
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="reports_${TIMESTAMP}"
mkdir -p "$REPORT_DIR"

# Find JSON file
JSON_FILE=$(find . -name "benchmark_results*.json" -o -name "mlperf_*.json" | head -1)

if [ -n "$JSON_FILE" ]; then
    python3 generate_report_from_json.py "$JSON_FILE"
    
    # Move report to reports directory
    HTML_REPORT=$(find . -name "benchmark_report_*.html" -mmin -1 | head -1)
    if [ -n "$HTML_REPORT" ]; then
        mv "$HTML_REPORT" "$REPORT_DIR/"
        echo "Report generated: $REPORT_DIR/$(basename $HTML_REPORT)"
    fi
else
    echo "No JSON file found for report generation"
    exit 1
fi
