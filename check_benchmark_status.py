#!/usr/bin/env python3
"""
Check status of scheduled benchmark execution
"""

import subprocess
from datetime import datetime

def check_status():
    print(f"🕐 Current time: {datetime.now().strftime('%H:%M:%S KST')}")
    print()
    
    # Check if benchmark is scheduled
    try:
        result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
        if 'scheduled_full_benchmark.py' in result.stdout:
            print("✅ Full benchmark scheduled for 18:00 KST")
        else:
            print("❌ No benchmark scheduled")
    except:
        print("⚠️  Could not check cron schedule")
    
    # Check if nodes are ready
    nodes = [("jw2", "129.254.202.252"), ("jw3", "129.254.202.253")]
    
    print("\n🔍 Node Status Check:")
    for name, ip in nodes:
        try:
            cmd = f"ssh -o ConnectTimeout=5 jungwooshim@{ip} 'nvidia-smi | head -3'"
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0:
                driver_line = result.stdout.split('\n')[2]
                if '575' in driver_line:
                    print(f"  {name}: ✅ Ready (Driver 575)")
                else:
                    print(f"  {name}: ⚠️  Connected but check driver")
            else:
                print(f"  {name}: ❌ Not accessible")
                
        except:
            print(f"  {name}: ❌ Connection failed")
    
    print(f"\n📅 Scheduled execution: 18:00 KST ({datetime.now().strftime('%Y-%m-%d')})")
    
    # Calculate time until execution
    now = datetime.now()
    if now.hour < 18:
        minutes_until = (18 - now.hour - 1) * 60 + (60 - now.minute)
        print(f"⏱️  Time until execution: {minutes_until} minutes")
    elif now.hour == 18 and now.minute < 5:
        print("🚀 Benchmark should be starting now!")
    else:
        print("⏰ Scheduled time has passed - check logs")

if __name__ == "__main__":
    check_status()