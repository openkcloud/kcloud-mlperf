#!/usr/bin/env bash
set -e

#########################################################
# 전체 재배포 스크립트
#
# 주의: 아래 변수를 환경에 맞게 수정하세요.
#########################################################
HOME_DIR="/home/kcloud"
KUBESPRAY_DIR="${HOME_DIR}/etri-llm-deployments/kubespray"
KUBERNETES_DIR="${HOME_DIR}/$(ls ${HOME_DIR} | grep '^mondrianai-etri-llm-deployments')/kubernetes"
BECOME_PASSWORD="<SUDO_PASS>"

LOG_FILE="${HOME_DIR}/redeploy.log"
exec > >(tee -a ${LOG_FILE}) 2>&1

echo "[$(date)] === Starting Full Redeployment ==="

# 1. Reset Cluster
echo "[$(date)] Step 1: Resetting Kubernetes Cluster..."
cd "${KUBESPRAY_DIR}"
ansible-playbook -i inventory/etri reset.yml -b -e "ansible_become_password=${BECOME_PASSWORD}" --extra-vars "reset_confirmation=yes"

echo "[$(date)] Cluster reset complete."

# 2. Install Cluster
echo "[$(date)] Step 2: Installing Kubernetes Cluster (This may take 20-30 mins)..."
./01-provision.sh

echo "[$(date)] Cluster installation complete."

# 3. Setup Kubeconfig
echo "[$(date)] Step 3: Setting up kubeconfig..."
mkdir -p "${HOME_DIR}/.kube"
cp "${KUBESPRAY_DIR}/inventory/etri/artifacts/admin.conf" "${HOME_DIR}/.kube/config"
chmod 600 "${HOME_DIR}/.kube/config"

# Wait for nodes to be ready
echo "[$(date)] Waiting for nodes to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=300s

# 4. Deploy Services
echo "[$(date)] Step 4: Deploying Application Services..."
cd "${KUBERNETES_DIR}"

echo "[$(date)] - 01-create-ns.sh"
./01-create-ns.sh

echo "[$(date)] - 02-deploy-nfs-provisioner.sh"
./02-deploy-nfs-provisioner.sh

echo "[$(date)] - 03-deploy-gpu-operator.sh"
./03-deploy-gpu-operator.sh
# Wait for GPU operator to establish CRDs
sleep 30

echo "[$(date)] - 04-deploy-loki.sh"
./04-deploy-loki.sh

echo "[$(date)] - 05-deploy-prometheus.sh"
./05-deploy-prometheus.sh

echo "[$(date)] - 06-deploy-alloy.sh"
./06-deploy-alloy.sh

echo "[$(date)] - Creating llm-evaluation namespace and applying data volumes"
kubectl create ns llm-evaluation --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f data-volume.yaml
kubectl apply -f database.yaml

echo "[$(date)] - Waiting for database to be ready..."
kubectl wait --for=condition=Available deployment/etri-llm-db -n llm-evaluation --timeout=120s 2>/dev/null || true
sleep 10

echo "[$(date)] - 07-deploy-llm-evaluation.sh"
./07-deploy-llm-evaluation.sh

echo "[$(date)] === Redeployment Completed Successfully ==="
