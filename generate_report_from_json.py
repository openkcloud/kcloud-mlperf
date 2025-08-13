#!/usr/bin/env python3
"""
Generate HTML report from existing JSON benchmark results
"""
import json
import sys
from datetime import datetime
from pathlib import Path

def generate_report_from_json(json_file):
    """Generate HTML report from JSON results file"""

    json_path = Path(json_file)
    if not json_path.exists():
        print(f"❌ File not found: {json_file}")
        return None

    # Load results
    with open(json_path, 'r') as f:
        results = json.load(f)

    # If we were given a raw MLPerf list (accuracy log), try sibling summary.json first
    if isinstance(results, list):
        sibling_summary = json_path.parent / 'summary.json'
        if sibling_summary.exists():
            with open(sibling_summary, 'r') as sf:
                results = json.load(sf)
        else:
            samples_count = len(results)
            results = {
                'metadata': {'samples': samples_count},
                'performance': {
                    'throughput_samples_per_second': 0,
                    'total_time_seconds': 0,
                },
                'accuracy': {},
            }

    # If this is our normalized summary.json, no further normalization needed
    if isinstance(results, dict) and ('performance' in results or 'accuracy' in results):
        pass

    # Extract data with fallbacks for MLPerf and MMLU summaries
    metadata = results.get('metadata', {})
    performance = results.get('performance', {})
    accuracy = results.get('accuracy', {})

    samples = (
        metadata.get('samples')
        or performance.get('samples_processed')
        or results.get('samples', 0)
    )
    throughput = (
        performance.get('throughput_samples_per_second')
        or results.get('throughput', 0)
        or 0
    )
    tokens_per_sec = performance.get('throughput_tokens_per_second', 0)
    total_time = (
        performance.get('total_time_seconds')
        or performance.get('total_time_seconds_estimated')
        or results.get('total_time', 0)
        or 0
    )

    # ROUGE scores for MLPerf accuracy
    rouge_scores = {
        'rouge-1': accuracy.get('rouge1', results.get('rouge_scores', {}).get('rouge-1', 0) if isinstance(results.get('rouge_scores', {}), dict) else 0),
        'rouge-2': accuracy.get('rouge2', results.get('rouge_scores', {}).get('rouge-2', 0) if isinstance(results.get('rouge_scores', {}), dict) else 0),
        'rouge-l': accuracy.get('rougeL', results.get('rouge_scores', {}).get('rouge-l', 0) if isinstance(results.get('rouge_scores', {}), dict) else 0),
    }

    # MMLU accuracy support
    mmlu_acc = accuracy.get('mmlu_acc')

    # Optional latency metrics (s)
    ttft = performance.get('ttft_mean_s')
    tbot = performance.get('tpot_mean_s') or performance.get('tbt_mean_s')
    lat_mean = performance.get('latency_mean_s')
    lat_p50 = performance.get('latency_p50_s')
    lat_p90 = performance.get('latency_p90_s')

    # Derived metrics
    baseline_throughput = 0.75  # only used when throughput is present
    show_perf = bool(throughput and throughput > 0)
    speedup_factor = (throughput / baseline_throughput) if (show_perf and baseline_throughput) else 0
    time_saved = ((float(samples or 0) / baseline_throughput) - float(total_time)) if (show_perf and samples and total_time) else 0
    avg_time_per_sample = None
    if total_time and samples:
        avg_time_per_sample = float(total_time) / max(int(samples), 1)
    elif show_perf:
        avg_time_per_sample = 1.0 / max(float(throughput), 1e-9)
    safe_throughput = float(throughput) if show_perf else 1e-9

    title_suffix = []
    if metadata.get('scenario'):
        title_suffix.append(metadata['scenario'])
    if metadata.get('mode'):
        title_suffix.append(metadata['mode'])
    title_suffix_str = ' • '.join(title_suffix)

    # Pre-render optional blocks to avoid f-string backslash issues
    mmlu_card = ""
    if mmlu_acc is not None:
        mmlu_card = (
            '<div class="metric-card">'
            f'<div class="metric-value">{mmlu_acc*100:.2f}%</div>'
            '<div class="metric-label">MMLU Accuracy</div>'
            '</div>'
        )

    perf_section = ""
    if show_perf:
        perf_section = (
            '<div class="section comparison">'
            '<h3>⚡ Performance</h3>'
            f'<p><strong>Throughput:</strong> {throughput:.2f} samples/sec</p>'
            f'<p><strong>Tokens/sec:</strong> {tokens_per_sec:.2f}</p>'
            f'<p><strong>Baseline (for reference):</strong> {baseline_throughput} samples/sec</p>'
            f'<p><strong>Estimated Gain:</strong> <span class="improvement">{(speedup_factor-1)*100:.0f}%</span></p>'
            f'<p><strong>Time Saved:</strong> <span class="success">{time_saved:.1f} seconds</span></p>'
            '</div>'
        )

    projection_section = ""
    if show_perf:
        projection_section = (
            '<div class="section">'
            '<h3>🔮 Full Dataset Projection</h3>'
            f'<p>Based on this {samples}-sample benchmark:</p>'
            '<div style="background: #e3f2fd; padding: 15px; border-radius: 6px; margin: 10px 0;">'
            '<p><strong>Full Dataset (13,368 samples) Estimates:</strong></p>'
            f'<p>• <strong>Time Required:</strong> {13368/safe_throughput/60:.0f} minutes ({13368/safe_throughput:.0f} seconds)</p>'
            f'<p>• <strong>Baseline Time:</strong> {13368/baseline_throughput/60:.0f} minutes</p>'
            f'<p>• <strong>Time Savings:</strong> <span class="success">{(13368/baseline_throughput - 13368/safe_throughput)/60:.0f} minutes saved</span></p>'
            '</div>'
            '</div>'
        )

    html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Benchmark Report - {samples} Samples{(' • ' + title_suffix_str) if title_suffix_str else ''}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #f8f9fa; }}
        .container {{ max-width: 1000px; margin: 30px auto; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }}
        .header h1 {{ margin: 0; font-size: 2.2em; font-weight: 300; }}
        .content {{ padding: 30px; }}
        .metrics-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 25px 0; }}
        .metric-card {{ background: #f8f9fa; padding: 20px; border-radius: 10px; text-align: center; border-left: 4px solid #667eea; }}
        .metric-value {{ font-size: 1.8em; font-weight: 600; color: #2c3e50; }}
        .metric-label {{ color: #6c757d; font-size: 0.9em; margin-top: 5px; }}
        .section {{ margin: 30px 0; padding: 20px; background: #f8f9fa; border-radius: 8px; }}
        .section h3 {{ color: #2c3e50; margin-top: 0; }}
        .comparison {{ background: #e8f5e8; border-left: 4px solid #28a745; }}
        .accuracy {{ background: #fff3cd; border-left: 4px solid #ffc107; }}
        .success {{ color: #28a745; font-weight: 600; }}
        .improvement {{ background: #d4edda; padding: 8px 12px; border-radius: 6px; display: inline-block; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 MLPerf Benchmark Report</h1>
            <p>{samples} Samples • Generated on {datetime.now().strftime("%B %d, %Y at %H:%M:%S")}</p>
        </div>
        
        <div class="content">
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value">{throughput if show_perf else 0:.2f}</div>
                    <div class="metric-label">Samples/Second</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{tokens_per_sec if tokens_per_sec else 0:.2f}</div>
                    <div class="metric-label">Tokens/Second</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{total_time:.1f}s</div>
                    <div class="metric-label">Total Time</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{(rouge_scores.get('rouge-1') or 0):.3f}</div>
                    <div class="metric-label">ROUGE-1</div>
                </div>
                {mmlu_card}
            </div>
            
            {perf_section}
            
            <div class="section accuracy">
                <h3>🎯 Accuracy</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                    <div><strong>ROUGE-1:</strong> {(rouge_scores.get('rouge-1') or 0):.4f}</div>
                    <div><strong>ROUGE-2:</strong> {(rouge_scores.get('rouge-2') or 0):.4f}</div>
                    <div><strong>ROUGE-L:</strong> {(rouge_scores.get('rouge-l') or 0):.4f}</div>
                    {('<div><strong>MMLU Acc:</strong> {:.2f}%</div>'.format(mmlu_acc*100)) if mmlu_acc is not None else ''}
                </div>
            </div>
            
            <div class="section">
                <h3>📊 Detailed Metrics</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <p><strong>Samples Processed:</strong> {samples}</p>
                        <p><strong>Average Time/Sample:</strong> {(avg_time_per_sample or 0):.3f}s</p>
                        <p><strong>Dataset:</strong> {metadata.get('task','CNN-DailyMail')}</p>
                    </div>
                    <div>
                        <p><strong>Model:</strong> LLaMA 3.1-8B</p>
                        <p><strong>Scenario:</strong> {metadata.get('scenario','N/A')} • <strong>Mode:</strong> {metadata.get('mode','N/A')}</p>
                        <p><strong>TTFT:</strong> {(ttft or 0)*1000:.1f} ms • <strong>TBT:</strong> {(tbot or 0)*1000:.1f} ms</p>
                    </div>
                </div>
            </div>
            
            {projection_section}
            
            <div style="text-align: center; margin-top: 30px; color: #6c757d; font-size: 0.9em; border-top: 1px solid #e9ecef; padding-top: 20px;">
                <p>🤖 Auto-generated from {json_path.name} | Report created {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}</p>
            </div>
        </div>
    </div>
</body>
</html>'''
    
    # Generate output filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    html_file = json_path.parent / f"benchmark_report_{samples}_samples_{timestamp}.html"
    
    # Save HTML report
    with open(html_file, 'w') as f:
        f.write(html_content)
    
    print(f"📋 HTML report generated: {html_file}")
    return html_file

def main():
    if len(sys.argv) != 2:
        print("Usage: python generate_report_from_json.py <json_file>")
        print("Example: python generate_report_from_json.py benchmark_results_100_samples.json")
        sys.exit(1)
    
    json_file = sys.argv[1]
    generate_report_from_json(json_file)

if __name__ == "__main__":
    main()