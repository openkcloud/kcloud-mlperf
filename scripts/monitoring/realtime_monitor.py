#!/usr/bin/env python3
"""
MLPerf Real-time CLI Monitor
Integrated monitoring for all benchmark processes with live updates
"""

import os
import sys
import subprocess
import json
import yaml
import time
import threading
from datetime import datetime
from pathlib import Path

class RealTimeMonitor:
    def __init__(self):
        self.config = self.load_config()
        self.monitoring = False
        self.node_status = {}
        
    def load_config(self):
        """Load configuration from config.yaml"""
        config_path = Path.cwd() / "config.yaml"
        if not config_path.exists():
            config_path = Path.cwd() / ".." / ".." / "config.yaml"
        
        with open(config_path, 'r') as f:
            return yaml.safe_load(f)
    
    def clear_screen(self):
        """Clear the terminal screen"""
        os.system('clear' if os.name == 'posix' else 'cls')
    
    def get_node_status(self, node_name, node_config):
        """Get real-time status for a single node"""
        
        status = {
            "name": node_name,
            "ip": node_config["ip"],
            "timestamp": datetime.now().strftime("%H:%M:%S"),
            "benchmark_running": False,
            "progress": "Unknown",
            "performance": "N/A",
            "error": None
        }
        
        try:
            # Check if benchmark is running
            ssh_cmd = [
                "ssh", "-o", "ConnectTimeout=5", 
                f"{node_config['username']}@{node_config['ip']}",
                "ps aux | grep -q 'python3.*main.py' && echo 'RUNNING' || echo 'IDLE'"
            ]
            
            result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0 and result.stdout.strip() == "RUNNING":
                status["benchmark_running"] = True
                
                # Get progress information
                remote_dir = "~/official_mlperf/inference/language/llama3.1-8b"
                
                # Try to get progress from different possible log files
                log_files = [
                    f"{node_name}_full_benchmark.log",
                    f"{node_name}_benchmark.log",
                    f"{node_name}_single_gpu_benchmark.log", 
                    f"{node_name}_multi_gpu_benchmark.log",
                    f"{node_name}_distributed_benchmark.log"
                ]
                
                # Get progress from the working log file
                try:
                    progress_cmd = [
                        "ssh", "-o", "ConnectTimeout=5",
                        f"{node_config['username']}@{node_config['ip']}",
                        f"cd {remote_dir} && tail -5 {node_name}_full_benchmark.log 2>/dev/null | grep 'Added request' | tail -1 | sed 's/.*request //' | sed 's/\\.//' || echo '0'"
                    ]
                    
                    prog_result = subprocess.run(progress_cmd, capture_output=True, text=True, timeout=5)
                    if prog_result.returncode == 0:
                        try:
                            current_sample = int(prog_result.stdout.strip())
                            if current_sample > 0:
                                progress_pct = (current_sample / 13368) * 100
                                status["progress"] = f"{current_sample}/13,368 ({progress_pct:.1f}%)"
                        except ValueError:
                            status["progress"] = "Unknown"
                except:
                    status["progress"] = "Unknown"
                
                # Get performance metrics from the working log file
                try:
                    perf_cmd = [
                        "ssh", "-o", "ConnectTimeout=5",
                        f"{node_config['username']}@{node_config['ip']}",
                        f"cd {remote_dir} && tail -3 {node_name}_full_benchmark.log 2>/dev/null | grep 'throughput' | tail -1 || echo 'Loading...'"
                    ]
                    
                    perf_result = subprocess.run(perf_cmd, capture_output=True, text=True, timeout=5)
                    if perf_result.returncode == 0:
                        perf_line = perf_result.stdout.strip()
                        if "Avg prompt throughput:" in perf_line:
                            # Extract key metrics from throughput line
                            parts = perf_line.split("Avg prompt throughput:")[1]
                            prompt_throughput = parts.split("tokens/s")[0].strip()
                            status["performance"] = f"Prompt: {prompt_throughput} tok/s"
                        else:
                            status["performance"] = "Loading..."
                except:
                    status["performance"] = "N/A"
            
            else:
                status["benchmark_running"] = False
                status["progress"] = "Idle"
                
        except subprocess.TimeoutExpired:
            status["error"] = "Connection timeout"
        except Exception as e:
            status["error"] = f"Connection error: {str(e)[:30]}"
        
        return status
    
    def display_status(self):
        """Display current status of all nodes"""
        
        self.clear_screen()
        
        print("🚀 MLPerf Real-time Benchmark Monitor")
        print("=" * 60)
        print(f"Last Update: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print()
        
        # Header
        print(f"{'Node':<8} {'IP Address':<16} {'Status':<12} {'Progress':<20} {'Performance':<25}")
        print("-" * 85)
        
        # Node status
        for node_data in self.config['infrastructure']['gpu_nodes']:
            node_name = node_data['name']
            node_config = {'ip': node_data['ip'], 'username': node_data['ssh_user']}
            status = self.get_node_status(node_name, node_config)
            
            if status["error"]:
                status_str = f"❌ {status['error']}"
                progress_str = "N/A"
                perf_str = "N/A"
            elif status["benchmark_running"]:
                status_str = "✅ RUNNING"
                progress_str = status["progress"]
                perf_str = status["performance"]
            else:
                status_str = "💤 IDLE"
                progress_str = "Ready"
                perf_str = "Standby"
            
            print(f"{node_name:<8} {status['ip']:<16} {status_str:<12} {progress_str:<20} {perf_str:<25}")
        
        print()
        
        # Summary
        active_count = 0
        for node_data in self.config['infrastructure']['gpu_nodes']:
            node_name = node_data['name']
            node_config = {'ip': node_data['ip'], 'username': node_data['ssh_user']}
            if self.get_node_status(node_name, node_config)["benchmark_running"]:
                active_count += 1
        
        total_nodes = len(self.config['infrastructure']['gpu_nodes'])
        
        print(f"📊 Summary: {active_count}/{total_nodes} nodes actively running benchmarks")
        
        if active_count > 0:
            print("⚡ Active benchmark processes detected")
            print("💡 Benchmarks will auto-complete when datasets are fully processed")
        else:
            print("💤 No active benchmarks - ready to start new runs")
        
        print()
        print("Controls: Ctrl+C to stop monitoring | Use main_controller.py to start benchmarks")
        print("-" * 60)
    
    def start_monitoring(self, refresh_interval=10):
        """Start real-time monitoring with auto-refresh"""
        
        print("🚀 Starting MLPerf Real-time Monitor...")
        print(f"⚡ Auto-refresh every {refresh_interval} seconds")
        print("🛑 Press Ctrl+C to stop monitoring")
        print()
        time.sleep(2)
        
        self.monitoring = True
        
        try:
            while self.monitoring:
                self.display_status()
                time.sleep(refresh_interval)
                
        except KeyboardInterrupt:
            print("\n\n🛑 Monitoring stopped by user")
        except Exception as e:
            print(f"\n\n❌ Monitoring error: {str(e)}")
        finally:
            self.monitoring = False
    
    def show_single_status(self):
        """Show status once without continuous monitoring"""
        self.display_status()

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="MLPerf Real-time Benchmark Monitor")
    parser.add_argument("--watch", action="store_true", 
                       help="Continuous monitoring with auto-refresh")
    parser.add_argument("--interval", type=int, default=10,
                       help="Refresh interval in seconds (default: 10)")
    parser.add_argument("--once", action="store_true",
                       help="Show status once and exit")
    
    args = parser.parse_args()
    
    monitor = RealTimeMonitor()
    
    if args.watch:
        monitor.start_monitoring(args.interval)
    elif args.once:
        monitor.show_single_status()
    else:
        print("MLPerf Real-time Monitor")
        print("Usage:")
        print("  --watch    Start continuous monitoring")
        print("  --once     Show current status")
        print("  --interval Set refresh interval (seconds)")

if __name__ == "__main__":
    main()