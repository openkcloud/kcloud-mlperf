#!/bin/bash
# ============================================================================
# bootstrap_cluster_and_bench.sh
# End-to-end bootstrap from bare-metal (master + GPU worker) to running
# benchmarks (MLPerf, MMLU, Inference).
# Prereqs:
#   - Run on the master node (control-plane) host.
#   - SSH access to worker host with sudo privileges.
#   - HF_TOKEN exported for model downloads.
# Usage:
#   HF_TOKEN=xxxx WORKER_HOST=1.2.3.4 WORKER_USER=kcloud ./scripts/bootstrap_cluster_and_bench.sh [--smoke]
# ============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
K8S_DIR="$PROJECT_DIR/k8s"

WORKER_LIST_FILE="${WORKER_LIST_FILE:-$PROJECT_DIR/config/workers.txt}"
SMOKE_MODE=false
HF_TOKEN="${HF_TOKEN:-}"
WORKER_CLEAN="${WORKER_CLEAN:-1}" # 1=clean/reset worker before join

for arg in "$@"; do
    case $arg in
        --smoke) SMOKE_MODE=true ;;
        --help|-h)
            echo "Usage: HF_TOKEN=<token> [WORKER_LIST_FILE=path] $0 [--smoke]"
            echo "Env: WORKER_CLEAN=1 (default) to auto kubeadm reset on workers"
            echo "workers file format: one worker per line, '#'-comments allowed,"
            echo "  examples:"
            echo "    kcloud@129.254.202.129"
            echo "    129.254.202.130                 # defaults to user 'kcloud'"
            echo "    kcloud@129.254.202.129 -p 122   # extra ssh opts (port 122)"
            exit 0 ;;
    esac
done

if [ -z "$HF_TOKEN" ]; then
    echo "ERROR: HF_TOKEN must be set"
    exit 1
fi

if [ ! -f "$WORKER_LIST_FILE" ]; then
    echo "ERROR: Worker list file not found: $WORKER_LIST_FILE"
    exit 1
fi

status() { echo "[$(date '+%H:%M:%S')] $*"; }

load_workers() {
    WORKERS=()
    WORKER_SSH_OPTS=()
    while IFS= read -r line || [[ -n "$line" ]]; do
        # strip trailing CR
        line="${line%$'\r'}"
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

        # first token = user@host or host; rest = ssh opts (e.g., -p 122)
        read -r first rest <<< "$line"

        if [[ "$first" == *"@"* ]]; then
            worker_entry="$first"
        else
            worker_entry="${WORKER_USER:-kcloud}@$first"
        fi

        WORKERS+=("$worker_entry")
        WORKER_SSH_OPTS+=("$rest")
    done < "$WORKER_LIST_FILE"

    status "Loaded ${#WORKERS[@]} worker(s) from $WORKER_LIST_FILE: ${WORKERS[*]}"

    if [ ${#WORKERS[@]} -eq 0 ]; then
        echo "ERROR: No workers found in $WORKER_LIST_FILE"
        exit 1
    fi
}

main() {
    status "Step 0: Preparing environment"
    cd "$PROJECT_DIR"
    load_workers
    WORKER_NODE_NAMES=()

    status "Step 1: Master node setup (non-interactive)"
    AUTO_YES=1 "$SCRIPT_DIR/setup_master_node.sh"

    status "Step 2: Generate fresh join command"
    JOIN_CMD=$(kubeadm token create --print-join-command)
    echo "$JOIN_CMD" > /tmp/k8s_join_command.sh

    status "Step 3-6: Configure and join workers from $WORKER_LIST_FILE"
    idx=0
    for WH in "${WORKERS[@]}"; do
        idx=$((idx+1))
        HOST="${WH#*@}"
        USER="${WH%@*}"
        SSH_OPTS_STR="${WORKER_SSH_OPTS[$((idx-1))]}"
        read -r -a SSH_OPTS_ARR <<< "$SSH_OPTS_STR"

        # Convert ssh -p to scp -P for port option where present
        SCP_OPTS_ARR=()
        need_port=0
        for opt in "${SSH_OPTS_ARR[@]}"; do
            if [ $need_port -eq 1 ]; then
                SCP_OPTS_ARR+=("$opt")
                need_port=0
                continue
            fi
            if [ "$opt" = "-p" ]; then
                SCP_OPTS_ARR+=("-P")
                need_port=1
                continue
            fi
            SCP_OPTS_ARR+=("$opt")
        done

        status "[Worker $idx] Setup on ${USER}@${HOST}"
        scp "${SCP_OPTS_ARR[@]}" "$SCRIPT_DIR/setup_worker_node.sh" "${USER}@${HOST}:/tmp/"
        ssh "${SSH_OPTS_ARR[@]}" -t "${USER}@${HOST}" "AUTO_YES=1 /tmp/setup_worker_node.sh"

        if [ "$WORKER_CLEAN" = "1" ]; then
            status "[Worker $idx] Cleanup previous kubeadm state (reset)"
            ssh "${SSH_OPTS_ARR[@]}" -t "${USER}@${HOST}" "\
                sudo kubeadm reset -f && \
                sudo systemctl stop kubelet || true && \
                sudo ip link set cni0 down 2>/dev/null || true && \
                sudo ip link delete cni0 2>/dev/null || true && \
                sudo ip link delete flannel.1 2>/dev/null || true && \
                sudo rm -rf /var/run/flannel /run/flannel || true && \
                sudo rm -rf /etc/kubernetes /var/lib/kubelet /var/run/kubernetes /etc/cni/net.d /var/lib/cni && \
                sudo systemctl restart containerd || true"
        fi

        if [ "$WORKER_CLEAN" = "1" ]; then
            status "[Worker $idx] Ensure old node object is removed (if any)"
            NODE_NAME=$(ssh "${SSH_OPTS_ARR[@]}" "${USER}@${HOST}" "hostname")
            kubectl delete node "$NODE_NAME" --ignore-not-found
        fi

        status "[Worker $idx] Join cluster"
        ssh "${SSH_OPTS_ARR[@]}" -t "${USER}@${HOST}" "sudo $JOIN_CMD"

        NODE_NAME=$(ssh "${SSH_OPTS_ARR[@]}" "${USER}@${HOST}" "hostname")
        status "[Worker $idx] Waiting for node object ($NODE_NAME) to appear"
        for _ in $(seq 1 60); do
            if kubectl get node "$NODE_NAME" >/dev/null 2>&1; then
                break
            fi
            sleep 5
        done
        status "[Worker $idx] Waiting for node Ready ($NODE_NAME)"
        kubectl wait --for=condition=Ready "node/$NODE_NAME" --timeout=300s || true
        kubectl get node "$NODE_NAME" -o wide

        status "[Worker $idx] Labeling GPU presence"
        kubectl label node "$NODE_NAME" nvidia.com/gpu.present=true --overwrite
        WORKER_NODE_NAMES+=("$NODE_NAME")
    done

    status "Step 7: Install NVIDIA device plugin DaemonSet"
    primary_url="https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.5/nvidia-device-plugin.yml"
    fallback_url1="https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.4/nvidia-device-plugin.yml"
    fallback_url2="https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.13.0/nvidia-device-plugin.yml"
    applied=false
    for url in "$primary_url" "$fallback_url1" "$fallback_url2"; do
        status "Applying device plugin from $url"
        if kubectl apply -f "$url"; then
            applied=true
            break
        else
            status "Failed to apply from $url, trying next..."
        fi
    done
    if [ "$applied" = true ]; then
        kubectl rollout status daemonset/nvidia-device-plugin-daemonset -n kube-system --timeout=300s || true
    else
        status "ERROR: Could not install NVIDIA device plugin (all URLs failed)"
        exit 1
    fi

    status "Step 7b: Waiting for GPU resources to be advertised"
    for node in "${WORKER_NODE_NAMES[@]}"; do
        status "Waiting for nvidia.com/gpu on node $node"
        for _ in $(seq 1 60); do
            gpu=$(kubectl get node "$node" -o jsonpath='{.status.allocatable.nvidia\.com/gpu}' 2>/dev/null || true)
            if [ -n "$gpu" ] && [ "$gpu" != "0" ]; then
                status "Node $node: nvidia.com/gpu allocatable=$gpu"
                break
            fi
            sleep 5
        done

        gpu=$(kubectl get node "$node" -o jsonpath='{.status.allocatable.nvidia\.com/gpu}' 2>/dev/null || true)
        if [ -z "$gpu" ] || [ "$gpu" = "0" ]; then
            status "ERROR: Node $node does not advertise GPUs yet."
            status "Hint: NVIDIA device plugin needs NVML access. Ensure containerd default runtime is set to nvidia (nvidia-ctk --set-as-default)."
            kubectl get pods -n kube-system -l name=nvidia-device-plugin-ds -o wide || true
            kubectl logs -n kube-system -l name=nvidia-device-plugin-ds --tail=120 || true
            kubectl describe node "$node" | grep -n "nvidia.com/gpu" -C2 || true
            exit 1
        fi
    done

    status "Step 8: Create RuntimeClass 'nvidia'"
    cat <<EOF | kubectl apply -f -
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: nvidia
handler: nvidia
EOF

    status "Step 9: Namespace and secrets"
    kubectl apply -f "$K8S_DIR/00-namespace.yaml"
    kubectl delete secret hf-token -n mlperf --ignore-not-found
    kubectl create secret generic hf-token --from-literal=HF_TOKEN="$HF_TOKEN" -n mlperf

    status "Step 10: Run benchmarks (smoke=$SMOKE_MODE)"
    if [ "$SMOKE_MODE" = true ]; then
        "$SCRIPT_DIR/run_benchmarks.sh" --smoke
    else
        "$SCRIPT_DIR/run_benchmarks.sh"
    fi

    status "All steps completed."
}

main "$@"
