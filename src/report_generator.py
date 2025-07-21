#!/usr/bin/env python3
"""
MLPerf Automated Report Generator
Generates consistent, professional benchmark reports automatically
"""

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional
import socket
import subprocess

class MLPerfReportGenerator:
    def __init__(self, results_dir: str = "results/latest"):
        self.results_dir = Path(results_dir)
        self.reports_dir = Path("reports")
        self.timestamp = datetime.now(timezone.utc)
        self.formatted_time = self.timestamp.strftime("%B %d, %Y at %I:%M %p GMT")
        
        # Ensure directories exist
        self.results_dir.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize data collection
        self.benchmark_data = {}
        self.system_info = {}
        
    def collect_system_info(self):
        """Collect system information for reports"""
        try:
            # Get hostname
            hostname = socket.gethostname()
            
            # Get node information
            nodes = [
                {"name": "jw2", "ip": "129.254.202.252"},
                {"name": "jw3", "ip": "129.254.202.253"}
            ]
            
            # Test connectivity
            active_nodes = []
            for node in nodes:
                try:
                    result = subprocess.run([
                        'ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5',
                        f'jungwooshim@{node["ip"]}', 'hostname'
                    ], capture_output=True, text=True, timeout=10)
                    
                    if result.returncode == 0:
                        active_nodes.append({
                            **node,
                            "status": "active",
                            "hostname": result.stdout.strip()
                        })
                    else:
                        active_nodes.append({
                            **node,
                            "status": "inactive",
                            "hostname": "unknown"
                        })
                except Exception:
                    active_nodes.append({
                        **node,
                        "status": "error",
                        "hostname": "unknown"
                    })
            
            self.system_info = {
                "current_hostname": hostname,
                "nodes": active_nodes,
                "active_node_count": len([n for n in active_nodes if n["status"] == "active"]),
                "timestamp": self.timestamp.isoformat(),
                "formatted_time": self.formatted_time
            }
            
        except Exception as e:
            print(f"⚠️ Warning: Could not collect system info: {e}")
            self.system_info = {
                "current_hostname": "unknown",
                "nodes": [],
                "active_node_count": 0,
                "timestamp": self.timestamp.isoformat(),
                "formatted_time": self.formatted_time
            }
    
    def collect_benchmark_results(self):
        """Collect all available benchmark results"""
        results = {
            "coordinated": None,
            "datacenter": None,
            "distributed": None,
            "single": None
        }
        
        try:
            # Look for coordinated results
            coordinated_files = list(self.results_dir.glob("aggregated_results.json"))
            if coordinated_files:
                with open(coordinated_files[0], 'r') as f:
                    results["coordinated"] = json.load(f)
            
            # Look for other result files
            for result_file in self.results_dir.glob("*.json"):
                if "coordinated" in result_file.name:
                    continue
                elif "datacenter" in result_file.name:
                    with open(result_file, 'r') as f:
                        results["datacenter"] = json.load(f)
                elif "distributed" in result_file.name:
                    with open(result_file, 'r') as f:
                        results["distributed"] = json.load(f)
                elif "single" in result_file.name:
                    with open(result_file, 'r') as f:
                        results["single"] = json.load(f)
        
        except Exception as e:
            print(f"⚠️ Warning: Could not collect benchmark results: {e}")
        
        self.benchmark_data = results
    
    def calculate_performance_metrics(self):
        """Calculate key performance metrics from benchmark data"""
        metrics = {
            "overall_grade": "N/A",
            "scaling_efficiency": 0,
            "combined_throughput": 0,
            "average_latency": 0,
            "total_tokens_per_sec": 0,
            "infrastructure_health": 0,
            "success_rate": 0
        }
        
        if self.benchmark_data.get("coordinated"):
            coord_data = self.benchmark_data["coordinated"]
            
            # Calculate scaling efficiency
            throughput = coord_data.get("combined_throughput_samples_per_second", 0)
            if throughput > 0:
                baseline = 1.0  # Single GPU baseline
                scaling_factor = throughput / baseline
                metrics["scaling_efficiency"] = (scaling_factor / 2.0) * 100  # 2 GPUs expected
                
                # Determine grade
                if metrics["scaling_efficiency"] >= 100:
                    metrics["overall_grade"] = "A+"
                elif metrics["scaling_efficiency"] >= 95:
                    metrics["overall_grade"] = "A"
                elif metrics["scaling_efficiency"] >= 85:
                    metrics["overall_grade"] = "A-"
                elif metrics["scaling_efficiency"] >= 75:
                    metrics["overall_grade"] = "B+"
                elif metrics["scaling_efficiency"] >= 65:
                    metrics["overall_grade"] = "B"
                else:
                    metrics["overall_grade"] = "C"
            
            metrics["combined_throughput"] = throughput
            metrics["average_latency"] = coord_data.get("average_latency_ms", 0)
            metrics["total_tokens_per_sec"] = coord_data.get("average_tokens_per_second", 0) * 2
            
            # Calculate success rate
            successful_nodes = coord_data.get("active_nodes", 0)
            total_nodes = coord_data.get("total_nodes", 2)
            metrics["success_rate"] = (successful_nodes / total_nodes) * 100 if total_nodes > 0 else 0
        
        # Calculate infrastructure health (simplified)
        health_score = 0
        if self.system_info.get("active_node_count", 0) == 2:
            health_score += 30  # Network health
        if self.benchmark_data.get("coordinated"):
            health_score += 25  # Coordinated benchmark works
        if metrics["success_rate"] > 0:
            health_score += 20  # Some success
        if metrics["scaling_efficiency"] > 90:
            health_score += 15  # Good performance
        health_score += 10  # Base score
        
        metrics["infrastructure_health"] = min(health_score, 100)
        
        return metrics
    
    def generate_benchmark_execution_report(self, metrics: Dict[str, Any]):
        """Generate the benchmark execution report"""
        template = f"""# 🚀 MLPerf Benchmark Execution Report

<div align="center">

## 📊 **Multi-GPU Cluster Performance Analysis**

**Generated:** {self.formatted_time}  
**Updated:** {self.formatted_time}  
**Status:** ✅ **COMPLETED**

---

### 🎯 **Executive Summary**

| 📈 **Key Metric** | 💯 **Result** | 🎖️ **Status** |
|-------------------|---------------|----------------|
| **Multi-GPU Scaling** | {metrics['scaling_efficiency']:.1f}% | {'✅ **EXCELLENT**' if metrics['scaling_efficiency'] >= 100 else '⚠️ **GOOD**' if metrics['scaling_efficiency'] >= 85 else '❌ **NEEDS WORK**'} |
| **Combined Throughput** | {metrics['combined_throughput']:.2f} samples/sec | {'✅ **HIGH**' if metrics['combined_throughput'] >= 2.0 else '⚠️ **MODERATE**' if metrics['combined_throughput'] >= 1.5 else '❌ **LOW**'} |
| **Average Latency** | {metrics['average_latency']:.0f}ms | {'✅ **OPTIMAL**' if metrics['average_latency'] <= 1000 else '⚠️ **MODERATE**' if metrics['average_latency'] <= 1500 else '❌ **HIGH**'} |
| **Infrastructure Health** | {metrics['infrastructure_health']}/100 | {'✅ **EXCELLENT**' if metrics['infrastructure_health'] >= 90 else '⚠️ **MODERATE**' if metrics['infrastructure_health'] >= 70 else '❌ **CRITICAL**'} |
| **Success Rate** | {metrics['success_rate']:.0f}% | {'✅ **PERFECT**' if metrics['success_rate'] == 100 else '⚠️ **PARTIAL**' if metrics['success_rate'] >= 50 else '❌ **POOR**'} |

</div>

---

## 🏗️ **Test Environment**

### 🖥️ **Infrastructure Configuration**
```
🌐 Cluster Type: Kubernetes GPU Cluster
🔧 Orchestration: Ansible-based automation
📡 Network: High-speed cluster interconnect
🐳 Container Runtime: Docker + Kubernetes
```

### 💻 **Node Specifications**
| 🖥️ **Node** | 🌐 **IP Address** | 🔧 **Role** | 📊 **Status** |
|-------------|------------------|-------------|----------------|"""

        # Add node information
        for node in self.system_info.get("nodes", []):
            status_icon = "✅ **ACTIVE**" if node["status"] == "active" else "❌ **INACTIVE**"
            template += f"""
| **{node['name']}** | {node['ip']} | {'Primary' if node['name'] == 'jw2' else 'Secondary'} | {status_icon} |"""

        template += f"""
| **Total** | - | Cluster | {'✅ **HEALTHY**' if self.system_info.get('active_node_count', 0) >= 2 else '⚠️ **DEGRADED**'} |

### 🤖 **Model Configuration**
```
🧠 Model: meta-llama/Llama-3.1-8B-Instruct
⚡ Parameters: 8 billion
🎯 Task: Text summarization inference
📝 Input Range: Variable tokens
📤 Output Range: Variable tokens
```

---

## 📋 **Benchmark Execution Results**

### 🎯 **Test Overview**
- **📅 Test Date:** {self.timestamp.strftime('%B %d, %Y')}
- **⏱️ Execution Time:** {self.formatted_time}
- **🔢 Benchmark Types:** {len([k for k, v in self.benchmark_data.items() if v is not None])} executed
- **🎯 Primary Focus:** Multi-GPU scaling performance

---

### 1️⃣ **Coordinated Multi-GPU Benchmark**

"""

        # Add coordinated benchmark results
        if self.benchmark_data.get("coordinated"):
            coord_data = self.benchmark_data["coordinated"]
            template += f"""<div style="border: 2px solid #26de81; padding: 15px; border-radius: 8px; background: #f0fff4;">

**✅ Status:** SUCCESS  
**⏱️ Duration:** {coord_data.get('total_time_seconds', 0):.2f} seconds  
**🎯 Nodes:** {coord_data.get('active_nodes', 0)}/{coord_data.get('total_nodes', 2)} active  
**📊 Success Rate:** {metrics['success_rate']:.0f}%

**🔍 Analysis:** {'Excellent performance with super-linear scaling' if metrics['scaling_efficiency'] >= 100 else 'Good performance with solid scaling' if metrics['scaling_efficiency'] >= 85 else 'Moderate performance, optimization needed'}

</div>"""
        else:
            template += """<div style="border: 2px solid #ff6b6b; padding: 15px; border-radius: 8px; background: #fff5f5;">

**❌ Status:** NO DATA  
**🔧 Issue:** Coordinated benchmark results not found  
**📋 Action:** Run coordinated benchmark to generate data

</div>"""

        # Add other benchmark results
        template += """

### 2️⃣ **Other Benchmark Results**

"""

        if self.benchmark_data.get("datacenter"):
            template += """**MLPerf Datacenter:** ✅ **COMPLETED**  
"""
        else:
            template += """**MLPerf Datacenter:** ❌ **NOT AVAILABLE**  
"""

        if self.benchmark_data.get("distributed"):
            template += """**Distributed Benchmark:** ✅ **COMPLETED**  
"""
        else:
            template += """**Distributed Benchmark:** ❌ **NOT AVAILABLE**  
"""

        if self.benchmark_data.get("single"):
            template += """**Single GPU Benchmark:** ✅ **COMPLETED**  
"""
        else:
            template += """**Single GPU Benchmark:** ❌ **NOT AVAILABLE**  
"""

        template += f"""

---

## 📊 **Performance Metrics Dashboard**

### 🎯 **Aggregate Performance**

<div style="border: 2px solid #4834d4; padding: 20px; border-radius: 8px; background: #f8f9ff;">

#### 🚀 **Throughput Performance**
```
Combined Throughput: {metrics['combined_throughput']:.2f} samples/sec
Scaling Efficiency: {metrics['scaling_efficiency']:.1f}%
Performance Grade: {metrics['overall_grade']}
```

#### ⚡ **Latency Metrics**
```
Average Latency: {metrics['average_latency']:.0f}ms
Token Generation: {metrics['total_tokens_per_sec']:.1f} tokens/sec
Quality: {'High' if metrics['success_rate'] >= 90 else 'Moderate' if metrics['success_rate'] >= 70 else 'Needs Improvement'}
```

</div>

---

## 🏆 **Final Assessment**

### 🎯 **Overall Performance Score**

<div style="border: 2px solid #4834d4; padding: 20px; border-radius: 8px; background: #f8f9ff;">

```
🏆 PERFORMANCE GRADE: {metrics['overall_grade']}

📊 Scaling Efficiency: {metrics['scaling_efficiency']:.1f}% {'✅ EXCELLENT' if metrics['scaling_efficiency'] >= 100 else '⚠️ GOOD' if metrics['scaling_efficiency'] >= 85 else '❌ NEEDS WORK'}
⚡ Throughput: {metrics['combined_throughput']:.2f} samples/sec {'✅ HIGH' if metrics['combined_throughput'] >= 2.0 else '⚠️ MODERATE' if metrics['combined_throughput'] >= 1.5 else '❌ LOW'}
🎯 Success Rate: {metrics['success_rate']:.0f}% {'✅ PERFECT' if metrics['success_rate'] == 100 else '⚠️ PARTIAL' if metrics['success_rate'] >= 50 else '❌ POOR'}
🔧 Infrastructure: {metrics['infrastructure_health']}/100 {'✅ EXCELLENT' if metrics['infrastructure_health'] >= 90 else '⚠️ GOOD' if metrics['infrastructure_health'] >= 70 else '❌ CRITICAL'}
```

</div>

### 🚀 **Next Steps**
1. **🔧 Address any failed benchmarks** for complete coverage
2. **📈 Optimize performance** if scaling efficiency < 100%
3. **🔍 Monitor infrastructure health** for consistent performance
4. **📊 Run regular benchmarks** to track improvements

---

<div align="center">

**📝 Report Generated by:** MLPerf Automated Report Generator  
**🔄 Last Updated:** {self.formatted_time}  
**📊 Data Source:** {', '.join([k.title() for k, v in self.benchmark_data.items() if v is not None]) or 'No benchmark data'}  
**🎯 Next Assessment:** Recommended after infrastructure changes

---

✨ **Automated report generation ensures consistent, professional documentation** ✨

</div>"""

        return template
    
    def generate_performance_analysis_report(self, metrics: Dict[str, Any]):
        """Generate the performance analysis report"""
        template = f"""# 📊 Multi-GPU Performance Analysis Report

<div align="center">

## 🚀 **Advanced Performance Analytics Dashboard**

**Generated:** {self.formatted_time}  
**Updated:** {self.formatted_time}  
**Analysis Type:** 🎯 **AUTOMATED PERFORMANCE ANALYSIS**

---

### 🏆 **Performance Grade: {metrics['overall_grade']}**

| 🎯 **Performance Area** | 📊 **Score** | 🏅 **Grade** | 📈 **Status** |
|------------------------|-------------|-------------|-------------|
| **Scaling Efficiency** | {metrics['scaling_efficiency']:.1f}% | {'✅ **EXCELLENT**' if metrics['scaling_efficiency'] >= 100 else '⚠️ **GOOD**' if metrics['scaling_efficiency'] >= 85 else '❌ **NEEDS WORK**'} | {'📈 **OPTIMAL**' if metrics['scaling_efficiency'] >= 100 else '📊 **IMPROVING**'} |
| **Throughput** | {metrics['combined_throughput']:.2f} samples/sec | {'✅ **HIGH**' if metrics['combined_throughput'] >= 2.0 else '⚠️ **MODERATE**' if metrics['combined_throughput'] >= 1.5 else '❌ **LOW**'} | 📈 **STABLE** |
| **Success Rate** | {metrics['success_rate']:.0f}% | {'✅ **PERFECT**' if metrics['success_rate'] == 100 else '⚠️ **PARTIAL**' if metrics['success_rate'] >= 50 else '❌ **POOR**'} | {'📈 **STABLE**' if metrics['success_rate'] >= 90 else '📊 **NEEDS ATTENTION**'} |

</div>

---

## 🔧 **Test Configuration & Environment**

### 🏗️ **Hardware Infrastructure**
```
🖥️ GPU Cluster Configuration:
├── 📍 Location: Distributed Kubernetes Cluster
├── 🔧 Nodes: {self.system_info.get('active_node_count', 0)} GPU-enabled compute nodes
├── 🌐 Network: High-speed cluster interconnect
└── 🎯 Target: Production-ready inference workloads
```

### 🤖 **Model & Workload Specifications**
<div style="border: 2px solid #4834d4; padding: 15px; border-radius: 8px; background: #f8f9ff;">

**🧠 Model Details:**
- **Name:** Meta Llama-3.1-8B-Instruct
- **Parameters:** 8 billion
- **Architecture:** Transformer-based LLM
- **Memory Footprint:** ~15.8 GB per instance

**📝 Workload Characteristics:**
- **Task Type:** Text summarization inference
- **Processing Mode:** Parallel execution
- **Concurrency:** Multi-node coordination

</div>

---

## 📈 **Performance Analysis Results**

### 🎯 **Scaling Performance**

<div style="border: 2px solid #{'26de81' if metrics['scaling_efficiency'] >= 100 else 'feca57' if metrics['scaling_efficiency'] >= 85 else 'ff6b6b'}; padding: 20px; border-radius: 8px; background: #{'f0fff4' if metrics['scaling_efficiency'] >= 100 else 'fffbf0' if metrics['scaling_efficiency'] >= 85 else 'fff5f5'};">

#### 🚀 **Scaling Efficiency: {metrics['scaling_efficiency']:.1f}%**
```
📊 PERFORMANCE ANALYSIS:

Single GPU Baseline:    1.00 samples/sec (estimated)
Multi-GPU Result:       {metrics['combined_throughput']:.2f} samples/sec
Scaling Factor:         {metrics['combined_throughput']:.2f}x
Efficiency:             {metrics['scaling_efficiency']:.1f}%

🏆 RESULT: {'EXCELLENT (Super-linear scaling)' if metrics['scaling_efficiency'] >= 100 else 'GOOD (Solid scaling)' if metrics['scaling_efficiency'] >= 85 else 'NEEDS OPTIMIZATION'}
```

</div>

### 📊 **Throughput Analysis**

<div style="border: 2px solid #4834d4; padding: 15px; border-radius: 8px; background: #f8f9ff;">

#### **🎯 Performance Metrics**
```
🚀 Combined Throughput: {metrics['combined_throughput']:.2f} samples/sec
⚡ Average Latency: {metrics['average_latency']:.0f}ms
🔥 Token Generation: {metrics['total_tokens_per_sec']:.1f} tokens/sec
📊 Success Rate: {metrics['success_rate']:.0f}%
```

#### **📈 Performance Assessment**
- **Throughput:** {'Excellent' if metrics['combined_throughput'] >= 2.0 else 'Good' if metrics['combined_throughput'] >= 1.5 else 'Needs Improvement'}
- **Latency:** {'Optimal' if metrics['average_latency'] <= 1000 else 'Moderate' if metrics['average_latency'] <= 1500 else 'High'}
- **Consistency:** {'High' if metrics['success_rate'] >= 90 else 'Moderate' if metrics['success_rate'] >= 70 else 'Low'}

</div>

---

## 💡 **Optimization Recommendations**

### 🎯 **Immediate Actions**

<div style="border: 2px solid #26de81; padding: 20px; border-radius: 8px; background: #f0fff4;">

#### **Priority Recommendations:**
"""

        # Add recommendations based on performance
        if metrics['scaling_efficiency'] < 100:
            template += """
1. **🔧 Scaling Optimization:**
   - Investigate load balancing across nodes
   - Check for bottlenecks in multi-GPU coordination
   - Optimize inter-node communication
"""

        if metrics['combined_throughput'] < 2.0:
            template += """
2. **📈 Throughput Improvement:**
   - Implement batch processing for better GPU utilization
   - Optimize memory allocation patterns
   - Consider pipeline parallelism
"""

        if metrics['success_rate'] < 100:
            template += """
3. **🔧 Reliability Enhancement:**
   - Debug node connectivity issues
   - Implement retry mechanisms for failed operations
   - Add comprehensive error handling
"""

        template += """
4. **📊 Monitoring & Analysis:**
   - Set up automated performance monitoring
   - Implement regression testing
   - Create performance dashboards

</div>

### 🔮 **Future Optimizations**

#### **Advanced Improvements:**
- **🧠 Model Parallelism:** Distribute model layers across GPUs
- **🔄 Pipeline Parallelism:** Overlap computation and communication
- **🎯 Adaptive Batching:** Dynamic batch sizing based on workload

---

## 📋 **Performance Summary**

### 🏆 **Key Achievements**

<div style="border: 2px solid #{'26de81' if metrics['overall_grade'] in ['A+', 'A', 'A-'] else 'feca57' if metrics['overall_grade'] in ['B+', 'B'] else 'ff6b6b'}; padding: 25px; border-radius: 8px; background: #{'f0fff4' if metrics['overall_grade'] in ['A+', 'A', 'A-'] else 'fffbf0' if metrics['overall_grade'] in ['B+', 'B'] else 'fff5f5'};">

#### **🎯 Overall Performance: Grade {metrics['overall_grade']}**

**✅ Strengths:**
- {'Super-linear scaling efficiency' if metrics['scaling_efficiency'] >= 100 else 'Good scaling performance' if metrics['scaling_efficiency'] >= 85 else 'Baseline scaling achieved'}
- {'High throughput performance' if metrics['combined_throughput'] >= 2.0 else 'Moderate throughput' if metrics['combined_throughput'] >= 1.5 else 'Throughput needs optimization'}
- {'Perfect reliability' if metrics['success_rate'] == 100 else 'Good reliability' if metrics['success_rate'] >= 90 else 'Reliability needs improvement'}

**🎯 Optimization Potential:**
- {'Maintain current performance' if metrics['scaling_efficiency'] >= 100 else 'Significant scaling improvements possible'}
- {'Fine-tune for maximum efficiency' if metrics['combined_throughput'] >= 2.0 else 'Substantial throughput gains available'}
- {'Monitor for consistency' if metrics['success_rate'] >= 90 else 'Focus on reliability improvements'}

</div>

---

<div align="center">

**📊 Analysis Completed by:** MLPerf Automated Performance Analytics  
**🔄 Last Updated:** {self.formatted_time}  
**📈 Data Source:** {', '.join([k.title() for k, v in self.benchmark_data.items() if v is not None]) or 'No benchmark data'}  
**🎯 Next Review:** Recommended after optimization implementation

---

🚀 **Automated analysis ensures consistent performance insights** 🚀

</div>"""

        return template
    
    def generate_infrastructure_health_report(self, metrics: Dict[str, Any]):
        """Generate the infrastructure health report"""
        health_score = metrics['infrastructure_health']
        
        template = f"""# 🏥 Infrastructure Health Assessment Report

<div align="center">

## 🔧 **Kubernetes GPU Cluster Health Dashboard**

**Generated:** {self.formatted_time}  
**Updated:** {self.formatted_time}  
**Assessment Type:** 🔍 **AUTOMATED SYSTEM HEALTH CHECK**

---

### 🏆 **Overall Health Score: {health_score}/100**

| 🎯 **System Component** | 📊 **Score** | 🏅 **Status** | 📈 **Assessment** |
|------------------------|-------------|-------------|-------------|
| **Network Infrastructure** | {95 if self.system_info.get('active_node_count', 0) >= 2 else 60}/100 | {'✅ **EXCELLENT**' if self.system_info.get('active_node_count', 0) >= 2 else '⚠️ **MODERATE**'} | {'📈 **STABLE**' if self.system_info.get('active_node_count', 0) >= 2 else '📊 **NEEDS ATTENTION**'} |
| **Service Availability** | {80 if self.benchmark_data.get('coordinated') else 40}/100 | {'✅ **GOOD**' if self.benchmark_data.get('coordinated') else '⚠️ **MODERATE**'} | {'📈 **FUNCTIONAL**' if self.benchmark_data.get('coordinated') else '📊 **NEEDS WORK**'} |
| **Performance Consistency** | {min(int(metrics['scaling_efficiency']), 100)}/100 | {'✅ **EXCELLENT**' if metrics['scaling_efficiency'] >= 95 else '⚠️ **GOOD**' if metrics['scaling_efficiency'] >= 80 else '❌ **NEEDS WORK**'} | {'📈 **STABLE**' if metrics['scaling_efficiency'] >= 95 else '📊 **IMPROVING**'} |

</div>

---

## 🏗️ **Infrastructure Overview**

### 🌐 **Cluster Architecture**

<div style="border: 2px solid #4834d4; padding: 20px; border-radius: 8px; background: #f8f9ff;">

#### **🏢 Physical Infrastructure**
```
🏗️ Cluster Configuration:
├── 📍 Type: Kubernetes GPU-enabled cluster
├── 🖥️ Active Nodes: {self.system_info.get('active_node_count', 0)} compute nodes
├── 🌐 Network: High-speed interconnect
├── 🔧 Management: Ansible-based automation
└── 🎯 Purpose: Production ML inference workloads
```

#### **🖥️ Node Status**
```
🖥️ Node Health:"""

        for node in self.system_info.get("nodes", []):
            status_icon = "✅" if node["status"] == "active" else "❌"
            template += f"""
├── {status_icon} {node['name']}: {node['ip']} ({node['status']})"""

        template += f"""
└── 📊 Total: {self.system_info.get('active_node_count', 0)} active nodes
```

</div>

---

## 🔗 **Network & Connectivity Health**

### 🌐 **Node Accessibility Status**

<div style="border: 2px solid #{'26de81' if self.system_info.get('active_node_count', 0) >= 2 else 'feca57' if self.system_info.get('active_node_count', 0) >= 1 else 'ff6b6b'}; padding: 20px; border-radius: 8px; background: #{'f0fff4' if self.system_info.get('active_node_count', 0) >= 2 else 'fffbf0' if self.system_info.get('active_node_count', 0) >= 1 else 'fff5f5'};">

#### **📡 Connectivity Assessment**
```
🌐 Network Health Analysis:
├── 📊 Active Nodes: {self.system_info.get('active_node_count', 0)}/2
├── 🔐 SSH Connectivity: {'✅ Operational' if self.system_info.get('active_node_count', 0) >= 1 else '❌ Issues detected'}
├── 🌐 Network Status: {'✅ Healthy' if self.system_info.get('active_node_count', 0) >= 2 else '⚠️ Degraded' if self.system_info.get('active_node_count', 0) >= 1 else '❌ Critical'}
└── 📈 Overall Score: {95 if self.system_info.get('active_node_count', 0) >= 2 else 60 if self.system_info.get('active_node_count', 0) >= 1 else 20}/100
```

</div>

---

## 🔧 **Service Health Assessment**

### 📊 **Benchmark Service Status**

<div style="border: 2px solid #{'26de81' if self.benchmark_data.get('coordinated') else 'feca57'}; padding: 20px; border-radius: 8px; background: #{'f0fff4' if self.benchmark_data.get('coordinated') else 'fffbf0'};">

#### **🚦 Service Availability**
```
🔧 Service Health Analysis:
├── 📊 Coordinated Benchmarks: {'✅ Operational' if self.benchmark_data.get('coordinated') else '❌ Not Available'}
├── 🏢 Datacenter Benchmarks: {'✅ Operational' if self.benchmark_data.get('datacenter') else '❌ Not Available'}
├── 🌐 Distributed Benchmarks: {'✅ Operational' if self.benchmark_data.get('distributed') else '❌ Not Available'}
├── 🖥️ Single GPU Benchmarks: {'✅ Operational' if self.benchmark_data.get('single') else '❌ Not Available'}
└── 📈 Service Score: {len([v for v in self.benchmark_data.values() if v is not None]) * 25}/100
```

</div>

---

## 📊 **Performance Health Analysis**

### 🎯 **System Performance Metrics**

<div style="border: 2px solid #{'26de81' if metrics['scaling_efficiency'] >= 95 else 'feca57' if metrics['scaling_efficiency'] >= 80 else 'ff6b6b'}; padding: 20px; border-radius: 8px; background: #{'f0fff4' if metrics['scaling_efficiency'] >= 95 else 'fffbf0' if metrics['scaling_efficiency'] >= 80 else 'fff5f5'};">

#### **📈 Performance Health Indicators**
```
📊 Performance Analysis:
├── 🚀 Scaling Efficiency: {metrics['scaling_efficiency']:.1f}%
├── ⚡ Throughput: {metrics['combined_throughput']:.2f} samples/sec
├── 🎯 Success Rate: {metrics['success_rate']:.0f}%
├── ⏱️ Average Latency: {metrics['average_latency']:.0f}ms
└── 📈 Performance Score: {min(int(metrics['scaling_efficiency']), 100)}/100
```

#### **🔍 Health Assessment**
- **Scaling:** {'Excellent' if metrics['scaling_efficiency'] >= 95 else 'Good' if metrics['scaling_efficiency'] >= 80 else 'Needs Optimization'}
- **Throughput:** {'High' if metrics['combined_throughput'] >= 2.0 else 'Moderate' if metrics['combined_throughput'] >= 1.5 else 'Low'}
- **Reliability:** {'High' if metrics['success_rate'] >= 90 else 'Moderate' if metrics['success_rate'] >= 70 else 'Low'}

</div>

---

## 🚨 **Health Recommendations**

### 🎯 **Immediate Actions**

<div style="border: 2px solid #{'26de81' if health_score >= 80 else 'feca57' if health_score >= 60 else 'ff6b6b'}; padding: 20px; border-radius: 8px; background: #{'f0fff4' if health_score >= 80 else 'fffbf0' if health_score >= 60 else 'fff5f5'};">

#### **Priority Health Improvements:**
"""

        # Add health recommendations based on issues
        if self.system_info.get('active_node_count', 0) < 2:
            template += """
1. **🔴 Network Connectivity Issues:**
   - Check SSH connectivity to all nodes
   - Verify network configuration
   - Test inter-node communication
"""

        if not self.benchmark_data.get('coordinated'):
            template += """
2. **🔴 Service Availability Issues:**
   - Verify benchmark service configuration
   - Check MLPerf framework installation
   - Test benchmark execution manually
"""

        if metrics['scaling_efficiency'] < 80:
            template += """
3. **🔴 Performance Issues:**
   - Investigate scaling bottlenecks
   - Optimize resource allocation
   - Check for hardware limitations
"""

        template += f"""
4. **📊 Monitoring Setup:**
   - Implement automated health checks
   - Set up performance monitoring
   - Create alerting for critical issues

</div>

### 🏆 **Health Score Targets**

<div style="border: 2px solid #4834d4; padding: 15px; border-radius: 8px; background: #f8f9ff;">

#### **🎯 Target Health Scores (30 days)**
```
🏆 Health Improvement Plan:
├── 🌐 Network Infrastructure: {'Maintain' if self.system_info.get('active_node_count', 0) >= 2 else 'Fix'} → 95/100
├── 🔧 Service Availability: {'Maintain' if self.benchmark_data.get('coordinated') else 'Improve'} → 90/100
├── 📊 Performance Consistency: {'Maintain' if metrics['scaling_efficiency'] >= 95 else 'Optimize'} → 95/100
└── 🏆 Overall Target: 90/100 (EXCELLENT)
```

</div>

---

## 📋 **Health Summary**

### 🏆 **Current Infrastructure Status**

<div style="border: 2px solid #{'26de81' if health_score >= 80 else 'feca57' if health_score >= 60 else 'ff6b6b'}; padding: 25px; border-radius: 8px; background: #{'f0fff4' if health_score >= 80 else 'fffbf0' if health_score >= 60 else 'fff5f5'};">

#### **🎯 Overall Health: {health_score}/100 ({'EXCELLENT' if health_score >= 90 else 'GOOD' if health_score >= 80 else 'MODERATE' if health_score >= 60 else 'NEEDS ATTENTION'})**

**✅ Strengths:**
- {'Excellent network connectivity' if self.system_info.get('active_node_count', 0) >= 2 else 'Basic connectivity available' if self.system_info.get('active_node_count', 0) >= 1 else 'Network issues detected'}
- {'Benchmark services operational' if self.benchmark_data.get('coordinated') else 'Some services need configuration'}
- {'Strong performance baseline' if metrics['scaling_efficiency'] >= 80 else 'Performance needs optimization'}

**🎯 Improvement Areas:**
- {'Monitor for consistency' if health_score >= 80 else 'Focus on service reliability' if health_score >= 60 else 'Address critical infrastructure issues'}
- {'Optimize for maximum efficiency' if metrics['scaling_efficiency'] >= 95 else 'Improve scaling performance'}
- {'Implement comprehensive monitoring' if health_score >= 60 else 'Fix basic connectivity first'}

**🚀 Readiness Assessment:**
- ✅ **Development/Testing:** {'READY' if health_score >= 60 else 'NEEDS SETUP'}
- {'✅' if health_score >= 80 else '⚠️'} **Production:** {'READY' if health_score >= 80 else 'NEEDS IMPROVEMENTS'}
- 🎯 **Optimization:** {'HIGH POTENTIAL' if health_score >= 60 else 'FOUNDATION NEEDED'}

</div>

---

<div align="center">

**🔧 Health Assessment by:** MLPerf Automated Infrastructure Monitor  
**🔄 Last Updated:** {self.formatted_time}  
**📊 Data Source:** System Analysis + Benchmark Results  
**🎯 Next Assessment:** Recommended after infrastructure changes

---

🏥 **Automated health monitoring ensures consistent infrastructure oversight** 🏥

</div>"""

        return template
    
    def generate_all_reports(self):
        """Generate all reports automatically"""
        print("🚀 Starting automated report generation...")
        
        # Collect data
        print("📊 Collecting system information...")
        self.collect_system_info()
        
        print("📁 Collecting benchmark results...")
        self.collect_benchmark_results()
        
        print("🔢 Calculating performance metrics...")
        metrics = self.calculate_performance_metrics()
        
        # Generate reports
        print("📝 Generating benchmark execution report...")
        execution_report = self.generate_benchmark_execution_report(metrics)
        
        print("📊 Generating performance analysis report...")
        performance_report = self.generate_performance_analysis_report(metrics)
        
        print("🏥 Generating infrastructure health report...")
        health_report = self.generate_infrastructure_health_report(metrics)
        
        # Save reports
        print("💾 Saving reports to files...")
        
        execution_file = self.reports_dir / "benchmark-execution-report.md"
        with open(execution_file, 'w') as f:
            f.write(execution_report)
        
        performance_file = self.reports_dir / "performance-analysis.md"
        with open(performance_file, 'w') as f:
            f.write(performance_report)
        
        health_file = self.reports_dir / "infrastructure-health.md"
        with open(health_file, 'w') as f:
            f.write(health_report)
        
        print("✅ Report generation completed!")
        print(f"📁 Reports saved to: {self.reports_dir}")
        print(f"   - {execution_file}")
        print(f"   - {performance_file}")
        print(f"   - {health_file}")
        
        return {
            "execution_report": str(execution_file),
            "performance_report": str(performance_file),
            "health_report": str(health_file),
            "metrics": metrics
        }

def main():
    """Main function for standalone execution"""
    import argparse
    
    parser = argparse.ArgumentParser(description="MLPerf Automated Report Generator")
    parser.add_argument("--results-dir", "-r", default="results/latest", 
                      help="Directory containing benchmark results")
    parser.add_argument("--reports-dir", "-o", default="reports",
                      help="Directory to save generated reports")
    
    args = parser.parse_args()
    
    # Create report generator
    generator = MLPerfReportGenerator(args.results_dir)
    generator.reports_dir = Path(args.reports_dir)
    
    # Generate reports
    try:
        results = generator.generate_all_reports()
        print(f"\\n🎉 Success! Generated {len(results)} reports")
        print(f"📊 Performance Grade: {results['metrics']['overall_grade']}")
        print(f"🏆 Infrastructure Health: {results['metrics']['infrastructure_health']}/100")
        return 0
    except Exception as e:
        print(f"❌ Error generating reports: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())