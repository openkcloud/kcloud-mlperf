# MLPerf Hybrid Hardware Deployment Guide

## 🎯 Overview

This guide helps you prepare for and deploy MLPerf benchmarks across mixed hardware environments, specifically designed for scenarios where you have both **NVIDIA GPUs** and **Furiosa NPUs** in the same cluster.

**Perfect for your scenario:**
- Current: jw1 (control), jw2/jw3 (NVIDIA A30 GPUs)  
- Future: Adding Furiosa Warboy NPU to the cluster

---

## 🔮 Future-Proofing Your Environment

### Phase 1: Current Setup (NVIDIA Only)
```bash
# Your current working configuration
./scripts/deploy.sh --type kubernetes --accelerator nvidia
```

### Phase 2: Adding Furiosa NPU (Upcoming)
```bash
# When you receive the Warboy NPU
python3 hardware_manager.py --detect
python3 hardware_manager.py --switch hybrid-gpu-npu
```

### Phase 3: Dynamic Switching (Future Changes)
```bash
# Automatically adapt to any hardware changes
python3 hardware_manager.py --status
python3 hardware_manager.py --switch $(python3 hardware_manager.py --detect)
```

---

## 🛠️ Hardware Manager Commands

### Check Current Status
```bash
# See what hardware is detected and what's running
python3 hardware_manager.py --status
```

**Example Output:**
```json
{
  "current_configuration": "nvidia-only",
  "detected_hardware": {
    "accelerators": [
      {"vendor": "nvidia", "model": "A30", "memory_gb": 24.0},
      {"vendor": "nvidia", "model": "A30", "memory_gb": 24.0}
    ]
  },
  "recommended_config": "nvidia-only",
  "deployment_status": {"kubernetes": true}
}
```

### Detect Optimal Configuration
```bash
# Get recommendation based on detected hardware
python3 hardware_manager.py --detect
```

### Switch Configurations
```bash
# List available configurations
python3 hardware_manager.py --list

# Test configuration (dry run)
python3 hardware_manager.py --switch hybrid-gpu-npu --dry-run

# Apply configuration
python3 hardware_manager.py --switch hybrid-gpu-npu
```

---

## 🔄 Configuration Scenarios

### Scenario 1: Adding Furiosa NPU to Your Cluster

**When you receive the Warboy NPU:**

1. **Install on existing node or add new node**
2. **Label the NPU node**:
   ```bash
   kubectl label node <npu-node> accelerator=furiosa-npu
   ```

3. **Auto-detect and switch**:
   ```bash
   python3 hardware_manager.py --detect
   # Should output: hybrid-gpu-npu
   
   python3 hardware_manager.py --switch hybrid-gpu-npu
   ```

4. **Verify deployment**:
   ```bash
   kubectl get pods -n mlperf-hybrid
   # Should show: mlperf-jw2-nvidia, mlperf-jw3-nvidia, mlperf-warboy-npu
   ```

### Scenario 2: NPU-Only Testing

**If you want to test only the Furiosa NPU:**

```bash
python3 hardware_manager.py --switch furiosa-only
kubectl apply -f configs/furiosa-cluster.yaml
```

### Scenario 3: Performance Comparison

**Compare GPU vs NPU performance:**

```bash
# Run both configurations and compare
python3 hardware_manager.py --switch nvidia-only
# Wait for completion, then:
python3 hardware_manager.py --switch furiosa-only  
# Wait for completion, then:

python3 performance_analyzer.py --compare nvidia furiosa
```

---

## 📊 Performance Analysis

### Automatic Performance Comparison
```bash
# After running hybrid benchmarks
python3 performance_analyzer.py --results-dir ./results

# Generate comprehensive report
python3 performance_analyzer.py --output-format both
```

### Expected Performance Profiles

| Configuration | Expected QPS | Scaling Factor | Use Case |
|---------------|--------------|----------------|----------|
| nvidia-only | 2.05 | 1.0x | Current setup |
| furiosa-only | 2.0 | 1.2x | NPU testing |
| hybrid-gpu-npu | 4.05 | 1.8x | Maximum performance |

### Performance Monitoring
```bash
# Real-time monitoring during benchmark
watch kubectl top pods -n mlperf-hybrid

# Resource utilization
kubectl describe pods -n mlperf-hybrid | grep -A 5 "Requests\|Limits"
```

---

## 🔧 Troubleshooting Future Hardware Changes

### NPU Detection Issues
```bash
# Check NPU availability
python3 -c "from adapters import check_furiosa_availability; print(check_furiosa_availability())"

# List NPU devices  
python3 -c "from adapters import list_furiosa_devices; print(list_furiosa_devices())"

# Check NPU driver
furiosa-smi
```

### Configuration Conflicts
```bash
# Reset to clean state
python3 hardware_manager.py --switch development --dry-run
kubectl delete namespace mlperf mlperf-hybrid --ignore-not-found

# Re-detect and deploy
python3 hardware_manager.py --detect
python3 hardware_manager.py --switch <detected-config>
```

### Mixed Hardware Issues
```bash
# Validate hybrid configuration
python3 hardware_manager.py --switch hybrid-gpu-npu --dry-run

# Check node labels
kubectl get nodes --show-labels | grep accelerator

# Verify resource availability
kubectl describe nodes | grep -A 5 "Allocatable\|Allocated"
```

---

## 📈 Optimization Strategies

### Load Balancing Configuration

**For optimal performance distribution:**

```yaml
# In hybrid-gpu-npu.yaml
nodes:
  - name: "jw2-nvidia"
    target_qps: 1.0
    weight: 1.0  # Adjust based on actual performance
    
  - name: "jw3-nvidia" 
    target_qps: 1.0
    weight: 1.0
    
  - name: "warboy-npu"
    target_qps: 2.0
    weight: 2.0  # NPU typically faster
```

### Performance Tuning

**GPU Optimization:**
```bash
export CUDA_VISIBLE_DEVICES=0
export OMP_NUM_THREADS=8
```

**NPU Optimization:**
```bash
export NPU_VISIBLE_DEVICES=0
export FURIOSA_LOG_LEVEL=INFO
```

### Resource Allocation

**Kubernetes Resource Requests:**
```yaml
resources:
  requests:
    nvidia.com/gpu: "1"      # GPU nodes
    furiosa.ai/npu: "1"      # NPU nodes
    cpu: "4"
    memory: "16Gi"
```

---

## 🎯 Best Practices for Hardware Transitions

### 1. Gradual Migration Strategy
```bash
# Week 1: Test new hardware
python3 hardware_manager.py --switch furiosa-only --dry-run

# Week 2: Run side-by-side comparisons  
python3 performance_analyzer.py --compare nvidia furiosa

# Week 3: Deploy hybrid configuration
python3 hardware_manager.py --switch hybrid-gpu-npu
```

### 2. Performance Validation
```bash
# Before any hardware change
python3 mlperf_datacenter_benchmark.py --scenario server --duration 60000
cp results/mlperf_result_*.json baseline_performance.json

# After hardware change
python3 mlperf_datacenter_benchmark.py --scenario server --duration 60000
python3 performance_analyzer.py --compare baseline current
```

### 3. Rollback Plan
```bash
# Always keep working configuration
cp current_hardware_config.json backup_config.json

# Quick rollback if needed
python3 hardware_manager.py --switch nvidia-only
```

---

## 📚 Configuration Files Reference

### Available Templates
- `nvidia-multi-gpu.yaml` - Your current 2-GPU setup
- `furiosa-cluster.yaml` - Pure NPU configuration  
- `hybrid-gpu-npu.yaml` - Mixed GPU+NPU (your future setup)
- `single-node.yaml` - Development/testing

### Environment Variables
```bash
# Hardware detection
export ACCELERATOR_TYPE="auto"  # Detects hybrid setup

# Performance tuning
export SERVER_TARGET_QPS="4.0"  # Combined target for hybrid
export OFFLINE_TARGET_QPS="40.0"

# Resource control
export CUDA_VISIBLE_DEVICES="0"  # GPU selection
export NPU_VISIBLE_DEVICES="0"   # NPU selection
```

---

## 🚀 Quick Commands for Different Scenarios

### Preparing for NPU Arrival
```bash
# Test current setup is working
python3 hardware_manager.py --status

# Prepare NPU configuration
kubectl create namespace mlperf-hybrid
```

### When NPU Arrives
```bash
# 1. Detect new hardware
python3 environment_detector.py

# 2. Switch to hybrid mode
python3 hardware_manager.py --switch hybrid-gpu-npu

# 3. Run comparative benchmark
python3 mlperf_datacenter_benchmark.py --scenario server
```

### Regular Operations
```bash
# Quick status check
python3 hardware_manager.py --status | jq '.recommended_config'

# Performance monitoring
python3 performance_analyzer.py --results-dir ./results

# Switch configurations
python3 hardware_manager.py --list
python3 hardware_manager.py --switch <config-name>
```

---

## ✅ Validation Checklist

### Before Hardware Changes
- [ ] Current benchmark results saved
- [ ] Configuration backed up
- [ ] Node labels verified
- [ ] Resource quotas checked

### After Hardware Changes  
- [ ] New hardware detected correctly
- [ ] Configuration switched successfully
- [ ] Benchmark runs without errors
- [ ] Performance meets expectations
- [ ] Resource utilization optimal

### Ongoing Monitoring
- [ ] Regular performance comparisons
- [ ] Resource usage tracking
- [ ] Configuration drift detection
- [ ] Backup configurations maintained

---

## 🆘 Emergency Procedures

### If Hybrid Deployment Fails
```bash
# 1. Stop current deployment
kubectl delete namespace mlperf-hybrid

# 2. Return to working configuration
python3 hardware_manager.py --switch nvidia-only

# 3. Investigate issue
python3 hardware_manager.py --switch hybrid-gpu-npu --dry-run
```

### If Performance Degrades
```bash
# 1. Compare with baseline
python3 performance_analyzer.py --compare baseline current

# 2. Check resource allocation
kubectl top pods -n mlperf-hybrid

# 3. Adjust configuration
# Edit configs/hybrid-gpu-npu.yaml as needed
```

---

This guide ensures your MLPerf benchmark infrastructure is ready for any hardware changes and can automatically adapt to new accelerators while maintaining optimal performance.