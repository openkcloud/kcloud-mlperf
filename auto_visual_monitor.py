#!/usr/bin/env python3
"""
Auto Visual Monitor for Live MLPerf Benchmarks
==============================================
Automatically generates visual reports when benchmark results are updated.

Usage:
    python3 auto_visual_monitor.py [--watch] [--interval 30]
"""

import time
import subprocess
import argparse
import sys
from pathlib import Path
from datetime import datetime

def check_benchmark_status():
    """Check if benchmarks are currently running"""
    try:
        result = subprocess.run(['./monitor_official_benchmarks.sh', 'status'], 
                              capture_output=True, text=True, cwd='/home/jungwooshim')
        return "RUNNING" in result.stdout
    except:
        return False

def get_benchmark_results():
    """Get current benchmark progress"""
    try:
        result = subprocess.run(['./monitor_official_benchmarks.sh', 'results'], 
                              capture_output=True, text=True, cwd='/home/jungwooshim')
        return result.stdout
    except:
        return "No results available"

def generate_visual_reports():
    """Generate visual reports for current results"""
    print(f"📊 {datetime.now().strftime('%H:%M:%S')} - Generating visual reports...")
    try:
        result = subprocess.run(['python3', 'generate_visual_reports.py', 'results'], 
                              capture_output=True, text=True, cwd='/home/jungwooshim')
        if result.returncode == 0:
            print(f"✅ Visual reports generated successfully")
            # Find the latest report directory
            results_dir = Path('/home/jungwooshim/results')
            report_dirs = list(results_dir.glob('**/visual_reports_*'))
            if report_dirs:
                latest_report = max(report_dirs, key=lambda x: x.stat().st_mtime)
                print(f"📁 Latest report: {latest_report.name}")
                return str(latest_report)
        else:
            print(f"⚠️  Report generation failed: {result.stderr}")
    except Exception as e:
        print(f"❌ Error generating reports: {e}")
    return None

def monitor_loop(interval=30):
    """Monitor benchmarks and generate reports periodically"""
    print(f"🔄 Starting MLPerf visual monitoring (interval: {interval}s)")
    print(f"📊 Will auto-generate visual reports every {interval} seconds")
    print(f"⏰ Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 60)
    
    last_report_time = 0
    
    while True:
        try:
            current_time = time.time()
            is_running = check_benchmark_status()
            
            print(f"\n🕐 {datetime.now().strftime('%H:%M:%S')} - Status Check")
            
            if is_running:
                print("✅ Benchmarks are RUNNING")
                # Generate reports every interval while running
                if current_time - last_report_time >= interval:
                    latest_report = generate_visual_reports()
                    if latest_report:
                        print(f"📈 Updated visual reports available")
                    last_report_time = current_time
                else:
                    time_until_next = int(interval - (current_time - last_report_time))
                    print(f"⏳ Next report update in {time_until_next}s")
            else:
                print("⏸️  Benchmarks not currently running")
                # Generate final report if benchmarks finished
                if last_report_time > 0:  # Had been running before
                    print("📊 Generating final comprehensive report...")
                    generate_visual_reports()
                    print("🎯 Monitoring complete - benchmarks finished")
                    break
            
            # Show current progress
            results = get_benchmark_results()
            if "samples" in results.lower():
                progress_lines = [line for line in results.split('\n') 
                                if 'samples' in line.lower() and ('/' in line or 'progress' in line.lower())]
                if progress_lines:
                    print(f"📈 Progress: {progress_lines[0][:100]}...")
            
            time.sleep(10)  # Check every 10 seconds
            
        except KeyboardInterrupt:
            print(f"\n\n⏹️  Monitoring stopped by user")
            print(f"📊 Generating final visual report...")
            generate_visual_reports()
            break
        except Exception as e:
            print(f"❌ Error in monitoring loop: {e}")
            time.sleep(30)

def main():
    parser = argparse.ArgumentParser(description='Auto Visual Monitor for MLPerf Benchmarks')
    parser.add_argument('--watch', action='store_true', 
                       help='Watch for changes and auto-generate reports')
    parser.add_argument('--interval', type=int, default=30,
                       help='Report generation interval in seconds (default: 30)')
    parser.add_argument('--once', action='store_true',
                       help='Generate reports once and exit')
    
    args = parser.parse_args()
    
    if args.once or not args.watch:
        # Generate reports once
        print("📊 Generating visual reports...")
        latest_report = generate_visual_reports()
        if latest_report:
            print(f"✅ Reports generated successfully")
            print(f"📁 Location: {latest_report}")
        else:
            print("❌ Failed to generate reports")
            sys.exit(1)
    else:
        # Start monitoring loop
        monitor_loop(args.interval)

if __name__ == "__main__":
    main()