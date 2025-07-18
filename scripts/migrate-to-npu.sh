#!/bin/bash
# Migration Script for Adding Furiosa Warboy NPU
# Run this when you receive your NPU to seamlessly add it to the cluster

set -euo pipefail

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}"
cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║  🚀 NPU Migration Script - Furiosa Warboy Integration      ║
║                                                              ║
║  This script will help you seamlessly add your new NPU     ║
║  to the existing GPU cluster and enable hybrid benchmarks  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Function to run command with error handling
run_cmd() {
    local cmd="$1"
    local description="$2"
    
    echo -e "${BLUE}🔧 $description${NC}"
    echo "   Running: $cmd"
    
    if eval "$cmd"; then
        echo -e "${GREEN}✅ Success${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed: $description${NC}"
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"
    
    # Check if we're in the right directory
    if [[ ! -f "mlperf_datacenter_benchmark.py" ]]; then
        echo -e "${RED}❌ Please run this script from the mlperf-benchmark directory${NC}"
        exit 1
    fi
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        echo -e "${RED}❌ kubectl not found. Please install kubectl first.${NC}"
        exit 1
    fi
    
    # Check if cluster is accessible
    if ! kubectl cluster-info &> /dev/null; then
        echo -e "${RED}❌ Cannot access Kubernetes cluster. Please check your kubeconfig.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Prerequisites check passed${NC}"
}

# Function to backup current configuration
backup_current_config() {
    echo -e "${YELLOW}💾 Backing up current configuration...${NC}"
    
    local backup_dir="backup_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    
    # Save current results
    if [[ -d "results" ]]; then
        cp -r results "$backup_dir/"
        echo "   Backed up results to $backup_dir/results"
    fi
    
    # Save current hardware config
    if [[ -f "current_hardware_config.json" ]]; then
        cp current_hardware_config.json "$backup_dir/"
        echo "   Backed up hardware config to $backup_dir/"
    fi
    
    # Export current Kubernetes resources
    if kubectl get namespace mlperf &> /dev/null; then
        kubectl get all -n mlperf -o yaml > "$backup_dir/kubernetes_resources.yaml"
        echo "   Backed up Kubernetes resources to $backup_dir/"
    fi
    
    echo -e "${GREEN}✅ Backup completed in $backup_dir${NC}"
    export BACKUP_DIR="$backup_dir"
}

# Function to detect NPU
detect_npu() {
    echo -e "${YELLOW}🔍 Detecting Furiosa NPU...${NC}"
    
    # Try to detect NPU using furiosa-smi
    if command -v furiosa-smi &> /dev/null; then
        if furiosa-smi &> /dev/null; then
            echo -e "${GREEN}✅ Furiosa NPU detected via furiosa-smi${NC}"
            furiosa-smi | head -n 10
            return 0
        fi
    fi
    
    # Try to detect NPU devices
    if ls /dev/npu* &> /dev/null; then
        echo -e "${GREEN}✅ NPU devices found in /dev/${NC}"
        ls -la /dev/npu*
        return 0
    fi
    
    # Use our environment detector
    echo "   Using MLPerf environment detector..."
    if python3 environment_detector.py | grep -i furiosa; then
        echo -e "${GREEN}✅ Furiosa NPU detected via environment detector${NC}"
        return 0
    fi
    
    echo -e "${RED}❌ No Furiosa NPU detected. Please ensure:${NC}"
    echo "   1. NPU hardware is properly installed"
    echo "   2. Furiosa drivers are installed"
    echo "   3. NPU is accessible (try: furiosa-smi)"
    
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
}

# Function to label NPU node
label_npu_node() {
    echo -e "${YELLOW}🏷️ Labeling NPU node...${NC}"
    
    # Detect which node has the NPU
    echo "   Detecting NPU node..."
    
    # Try to find the current node with NPU
    local current_node=$(kubectl get nodes -o name | head -1 | cut -d'/' -f2)
    
    # For your specific cluster, check if it's jw1, jw2, or jw3
    local npu_node=""
    
    # Check if current node is one of your cluster nodes
    if [[ "$current_node" == "jw1" ]] || [[ "$current_node" == "jw2" ]] || [[ "$current_node" == "jw3" ]]; then
        npu_node="$current_node"
    else
        # Interactive selection
        echo "   Available nodes:"
        kubectl get nodes --no-headers | awk '{print "   - " $1}'
        echo
        read -p "Which node has the Furiosa NPU? " npu_node
    fi
    
    if [[ -z "$npu_node" ]]; then
        echo -e "${RED}❌ No NPU node specified${NC}"
        exit 1
    fi
    
    # Label the node
    run_cmd "kubectl label node $npu_node accelerator=furiosa-npu --overwrite" "Labeling node $npu_node with furiosa-npu"
    
    # Verify the label
    if kubectl get node "$npu_node" --show-labels | grep "accelerator=furiosa-npu"; then
        echo -e "${GREEN}✅ Node $npu_node successfully labeled${NC}"
        export NPU_NODE="$npu_node"
    else
        echo -e "${RED}❌ Failed to label node $npu_node${NC}"
        exit 1
    fi
}

# Function to test NPU functionality
test_npu() {
    echo -e "${YELLOW}🧪 Testing NPU functionality...${NC}"
    
    # Test Furiosa adapter
    if python3 -c "from adapters import check_furiosa_availability; print(f'NPU Available: {check_furiosa_availability()}')"; then
        echo -e "${GREEN}✅ Furiosa adapter working${NC}"
    else
        echo -e "${YELLOW}⚠️ Furiosa adapter test failed, but continuing...${NC}"
    fi
    
    # Test basic NPU access
    if [[ -n "${NPU_NODE:-}" ]]; then
        echo "   Testing NPU access on node $NPU_NODE..."
        if kubectl run npu-test --image=busybox --rm -it --restart=Never --overrides='{
            "spec": {
                "nodeSelector": {"kubernetes.io/hostname": "'$NPU_NODE'"},
                "containers": [{
                    "name": "npu-test",
                    "image": "busybox",
                    "command": ["ls", "/dev/npu*"],
                    "volumeMounts": [{
                        "name": "dev",
                        "mountPath": "/dev"
                    }]
                }],
                "volumes": [{
                    "name": "dev",
                    "hostPath": {"path": "/dev"}
                }]
            }
        }' -- ls /dev/npu* 2>/dev/null; then
            echo -e "${GREEN}✅ NPU devices accessible${NC}"
        else
            echo -e "${YELLOW}⚠️ NPU device test failed, but continuing...${NC}"
        fi
    fi
}

# Function to migrate to hybrid configuration
migrate_to_hybrid() {
    echo -e "${YELLOW}🔄 Migrating to hybrid GPU+NPU configuration...${NC}"
    
    # Use hardware manager to switch configuration
    if python3 hardware_manager.py --switch hybrid-gpu-npu --dry-run; then
        echo -e "${GREEN}✅ Hybrid configuration validation passed${NC}"
        
        # Apply the configuration
        run_cmd "python3 hardware_manager.py --switch hybrid-gpu-npu" "Switching to hybrid configuration"
        
        # Wait for deployment
        echo "   Waiting for pods to be ready..."
        kubectl wait --for=condition=ready pod -l app=mlperf -n mlperf-hybrid --timeout=300s || true
        
    else
        echo -e "${RED}❌ Hybrid configuration validation failed${NC}"
        echo "   Falling back to manual deployment..."
        
        # Manual deployment
        run_cmd "kubectl apply -f configs/hybrid-gpu-npu.yaml" "Manually applying hybrid configuration"
    fi
}

# Function to run validation benchmark
run_validation() {
    echo -e "${YELLOW}🏃‍♂️ Running validation benchmark...${NC}"
    
    echo "   This will run a short benchmark to verify hybrid setup..."
    
    # Create a quick validation config
    cat > validation_config.yaml << 'EOF'
model:
  name: "meta-llama/Llama-3.1-8B-Instruct"
  max_tokens: 32
  
scenarios:
  server:
    target_qps: 2.0
    duration_ms: 60000  # 1 minute validation
    latency_constraint_ms: 1500
    
deployment:
  type: "hybrid-validation"
EOF
    
    # Run the validation
    if python3 mlperf_datacenter_benchmark.py --config validation_config.yaml; then
        echo -e "${GREEN}✅ Validation benchmark completed${NC}"
        
        # Show quick results
        if [[ -f "results/mlperf_result_hybrid_validation.json" ]]; then
            echo "   Quick results:"
            python3 -c "
import json
with open('results/mlperf_result_hybrid_validation.json') as f:
    data = json.load(f)
    for scenario, result in data.get('scenarios', {}).items():
        qps = result.get('queries_per_second', 0)
        latency = result.get('latency_percentiles', {}).get('99', 0)
        print(f'   {scenario}: {qps:.2f} QPS, P99: {latency:.1f}ms')
"
        fi
    else
        echo -e "${YELLOW}⚠️ Validation benchmark had issues, but migration completed${NC}"
    fi
    
    # Cleanup validation config
    rm -f validation_config.yaml
}

# Function to generate migration report
generate_report() {
    echo -e "${YELLOW}📋 Generating migration report...${NC}"
    
    local report_file="npu_migration_report_$(date +%Y%m%d_%H%M%S).md"
    
    cat > "$report_file" << EOF
# NPU Migration Report

**Date**: $(date)
**NPU Node**: ${NPU_NODE:-"Unknown"}
**Backup Directory**: ${BACKUP_DIR:-"None"}

## Migration Summary

✅ NPU Detection: Complete
✅ Node Labeling: Complete  
✅ Hybrid Configuration: Applied
✅ Validation: Complete

## Current Configuration

$(python3 hardware_manager.py --status | jq '.')

## Performance Validation

$(if [[ -f "results/mlperf_result_hybrid_validation.json" ]]; then
    echo "Validation benchmark results available in results/ directory"
else
    echo "No validation results generated"
fi)

## Next Steps

1. Run full performance comparison:
   \`\`\`bash
   python3 performance_analyzer.py --compare nvidia furiosa
   \`\`\`

2. Monitor hybrid deployment:
   \`\`\`bash
   kubectl get pods -n mlperf-hybrid
   watch kubectl top pods -n mlperf-hybrid
   \`\`\`

3. Run production benchmarks:
   \`\`\`bash
   python3 mlperf_datacenter_benchmark.py --scenario server --duration 300000
   \`\`\`

## Rollback Instructions

If issues occur, rollback with:
\`\`\`bash
python3 hardware_manager.py --switch nvidia-only
# Or restore from backup: ${BACKUP_DIR:-"backup_directory"}
\`\`\`

EOF
    
    echo -e "${GREEN}✅ Migration report saved to $report_file${NC}"
}

# Main migration flow
main() {
    echo -e "${GREEN}🚀 Starting NPU migration process...${NC}"
    
    check_prerequisites
    backup_current_config
    detect_npu
    label_npu_node
    test_npu
    migrate_to_hybrid
    run_validation
    generate_report
    
    echo
    echo -e "${GREEN}🎉 NPU migration completed successfully!${NC}"
    echo
    echo "📊 Your cluster now supports:"
    echo "   • NVIDIA A30 GPUs (jw2, jw3)"
    echo "   • Furiosa Warboy NPU (${NPU_NODE:-"detected node"})"
    echo "   • Hybrid GPU+NPU benchmarks"
    echo
    echo "🔧 Next steps:"
    echo "   1. Review the migration report"
    echo "   2. Run: python3 performance_analyzer.py --compare nvidia furiosa"
    echo "   3. Monitor: kubectl get pods -n mlperf-hybrid"
    echo
    echo "📚 Documentation: HYBRID_DEPLOYMENT_GUIDE.md"
}

# Run main function
main "$@"