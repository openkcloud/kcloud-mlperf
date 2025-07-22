#!/usr/bin/env python3
"""
MLPerf Benchmark Completion Estimator
====================================
Estimates completion time based on current progress and generates reports.
"""

import subprocess
import re
import time
from datetime import datetime, timedelta

def get_current_progress():
    """Get current benchmark progress from monitoring script"""
    try:
        result = subprocess.run(['./monitor_official_benchmarks.sh', 'status'], 
                              capture_output=True, text=True, timeout=30)
        
        # Parse jw2 progress
        jw2_match = re.search(r'jw2.*Processing request: (\d+)/13,368', result.stdout)
        jw3_match = re.search(r'jw3.*Processing request: (\d+)/13,368', result.stdout)
        
        jw2_progress = int(jw2_match.group(1)) if jw2_match else 0
        jw3_progress = int(jw3_match.group(1)) if jw3_match else 0
        
        return jw2_progress, jw3_progress
    except Exception as e:
        print(f"Error getting progress: {e}")
        return 0, 0

def estimate_completion_time(progress, total=13368, samples_per_minute=None):
    """Estimate completion time based on current progress"""
    if progress <= 0:
        return "Unknown"
    
    remaining = total - progress
    
    if samples_per_minute:
        minutes_remaining = remaining / samples_per_minute
    else:
        # Assume average rate based on current progress and time elapsed
        # Benchmarks have been running for about 4+ hours, estimate rate
        minutes_remaining = remaining * 2  # Conservative estimate: 0.5 samples/minute
    
    completion_time = datetime.now() + timedelta(minutes=minutes_remaining)
    return completion_time.strftime("%Y-%m-%d %H:%M:%S")

def main():
    print("🔍 MLPerf Benchmark Progress Analysis")
    print("=" * 50)
    
    jw2_progress, jw3_progress = get_current_progress()
    
    print(f"📊 Current Progress:")
    print(f"   jw2: {jw2_progress:,}/13,368 ({jw2_progress/13368*100:.1f}%)")
    print(f"   jw3: {jw3_progress:,}/13,368 ({jw3_progress/13368*100:.1f}%)")
    print(f"   Total: {jw2_progress + jw3_progress:,}/26,736 ({(jw2_progress + jw3_progress)/26736*100:.1f}%)")
    
    print(f"\n⏰ Estimated Completion:")
    jw2_completion = estimate_completion_time(jw2_progress)
    jw3_completion = estimate_completion_time(jw3_progress)
    
    print(f"   jw2: {jw2_completion}")
    print(f"   jw3: {jw3_completion}")
    
    # Check if either benchmark has completed
    if jw2_progress >= 13368:
        print(f"🎉 jw2 COMPLETED!")
    if jw3_progress >= 13368:
        print(f"🎉 jw3 COMPLETED!")
    
    if jw2_progress >= 13368 and jw3_progress >= 13368:
        print(f"\n🎯 ALL BENCHMARKS COMPLETED!")
        print(f"🚀 Generating final visual reports...")
        
        # Generate final comprehensive reports
        try:
            subprocess.run(['python3', 'generate_visual_reports.py', 'results'], 
                         check=True, capture_output=True)
            print(f"✅ Final visual reports generated successfully!")
            
            # Get results
            subprocess.run(['./monitor_official_benchmarks.sh', 'results'], 
                         check=True)
            print(f"✅ Final results collected!")
            
        except subprocess.CalledProcessError as e:
            print(f"❌ Error generating reports: {e}")
    
    print(f"\n📋 Monitor continuously with: ./monitor_official_benchmarks.sh watch")
    print(f"📊 Generate reports anytime with: python3 generate_visual_reports.py results")

if __name__ == "__main__":
    main()