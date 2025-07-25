#!/usr/bin/env python3
"""
Fix Throughput Comparison Chart
"""
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from pathlib import Path

# Use the latest benchmark results
results_data = {
    'jw2': {
        'samples': 200,
        'duration': 722.6,  # seconds from latest run
        'throughput': 0.277  # samples/sec from latest run
    },
    'jw3': {
        'samples': 200, 
        'duration': 343.0,  # seconds from latest run
        'throughput': 0.583  # samples/sec from latest run
    },
    'distributed': {
        'samples': 400,
        'duration': 1578.0,  # seconds from latest run
        'throughput': 0.25   # samples/sec from latest run
    }
}

def create_fixed_throughput_chart():
    """Create a proper throughput comparison chart"""
    
    # Create figure with subplots
    fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(15, 12))
    fig.suptitle('MLPerf Throughput Analysis - Latest Results', fontsize=20, fontweight='bold', y=0.95)
    
    # 1. Individual Node Throughput
    nodes = ['JW2', 'JW3']
    throughputs = [results_data['jw2']['throughput'], results_data['jw3']['throughput']]
    colors = ['#FF6B6B', '#4ECDC4']
    
    bars1 = ax1.bar(nodes, throughputs, color=colors, alpha=0.8, edgecolor='black', linewidth=1)
    ax1.set_title('Single GPU Throughput\n(200 samples each)', fontsize=14, fontweight='bold')
    ax1.set_ylabel('Samples/Second', fontsize=12)
    ax1.set_ylim(0, max(throughputs) * 1.2)
    
    for bar, val in zip(bars1, throughputs):
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
                f'{val:.3f}', ha='center', va='bottom', fontweight='bold', fontsize=11)
    
    # Add performance difference annotation
    improvement = throughputs[1] / throughputs[0]
    ax1.annotate(f'JW3 is {improvement:.1f}x faster', 
                xy=(1, throughputs[1]), xytext=(1.3, throughputs[1] * 0.8),
                arrowprops=dict(arrowstyle='->', color='red', lw=2),
                fontsize=11, fontweight='bold', color='red')
    
    # 2. Duration Comparison
    durations = [results_data['jw2']['duration']/60, results_data['jw3']['duration']/60]  # Convert to minutes
    bars2 = ax2.bar(nodes, durations, color=colors, alpha=0.8, edgecolor='black', linewidth=1)
    ax2.set_title('Benchmark Duration\n(200 samples each)', fontsize=14, fontweight='bold')
    ax2.set_ylabel('Duration (minutes)', fontsize=12)
    ax2.set_ylim(0, max(durations) * 1.2)
    
    for bar, val in zip(bars2, durations):
        ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.2,
                f'{val:.1f}m', ha='center', va='bottom', fontweight='bold', fontsize=11)
    
    # 3. Sample Processing Rate
    samples = [results_data['jw2']['samples'], results_data['jw3']['samples']]
    bars3 = ax3.bar(nodes, samples, color=colors, alpha=0.8, edgecolor='black', linewidth=1)
    ax3.set_title('Samples Processed\n(Latest Benchmark)', fontsize=14, fontweight='bold')
    ax3.set_ylabel('Sample Count', fontsize=12)
    ax3.set_ylim(0, max(samples) * 1.2)
    
    for bar, val in zip(bars3, samples):
        ax3.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5,
                f'{val}', ha='center', va='bottom', fontweight='bold', fontsize=11)
    
    # 4. Architecture Comparison
    architectures = ['Single GPU\n(Best: JW3)', 'Distributed\n(JW2+JW3)']
    arch_throughput = [results_data['jw3']['throughput'], results_data['distributed']['throughput']]
    arch_colors = ['#4ECDC4', '#9B59B6']
    
    bars4 = ax4.bar(architectures, arch_throughput, color=arch_colors, alpha=0.8, edgecolor='black', linewidth=1)
    ax4.set_title('Architecture Comparison\n(Best Single vs Distributed)', fontsize=14, fontweight='bold')
    ax4.set_ylabel('Combined Throughput (samples/sec)', fontsize=12)
    ax4.set_ylim(0, max(arch_throughput) * 1.3)
    
    for bar, val in zip(bars4, arch_throughput):
        ax4.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
                f'{val:.3f}', ha='center', va='bottom', fontweight='bold', fontsize=11)
    
    # Add speedup annotation
    speedup = results_data['distributed']['throughput'] / results_data['jw3']['throughput']
    if speedup < 1:
        speedup_text = f'Distributed is {1/speedup:.2f}x slower\n(due to coordination overhead)'
        color = 'orange'
    else:
        speedup_text = f'Distributed is {speedup:.2f}x faster'
        color = 'green'
    
    ax4.text(0.5, max(arch_throughput) * 0.8, speedup_text, 
             ha='center', va='center', fontweight='bold', 
             bbox=dict(boxstyle='round,pad=0.5', facecolor=color, alpha=0.3),
             fontsize=10)
    
    # Adjust layout and save
    plt.tight_layout()
    plt.subplots_adjust(top=0.92)
    
    # Save the chart
    chart_path = Path('reports/charts/throughput_comparison.png')
    plt.savefig(chart_path, dpi=300, bbox_inches='tight', facecolor='white')
    print(f"✅ Fixed throughput chart saved: {chart_path}")
    
    return chart_path

if __name__ == "__main__":
    create_fixed_throughput_chart()
    print("🎯 Throughput comparison chart has been fixed!")