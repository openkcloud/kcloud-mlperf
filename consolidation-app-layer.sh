#!/usr/bin/env bash
# Consolidation APP-LAYER (idempotent, reproducible) — run AFTER the cluster is provisioned and
# /home/kcloud/jwcluster.kubeconfig is in place. Captures every manual fix from the 2026-06-02
# bring-up so a fresh cluster reproduces the full working stack (storage, app, devices, telemetry,
# observability, live dashboards) with the correct images.
#
#   Usage:  KUBECONFIG=/home/kcloud/jwcluster.kubeconfig SUDO_PASS=... SSHPASS=... bash consolidation-app-layer.sh
#
# Does NOT restore data (that's a one-time migration — see node4:~/restore-data.sh). Sets up empty
# NFS exports + binds PVCs; data restore is separate.
set +e
export KUBECONFIG="${KUBECONFIG:-/home/kcloud/jwcluster.kubeconfig}"
export SUDO_PASS="${SUDO_PASS:-<SUDO_PASS>}"
export SSHPASS="${SSHPASS:-<SUDO_PASS>}"
KT=/home/kcloud/repos/kcloud-tool
K8S=/home/kcloud/etri-llm-deployments/app/kubernetes
NFS_IP=10.254.202.114          # node4 = NFS server (permanent, has the data)
CP_IP=10.254.202.81            # jw1
NODES="10.254.202.81 10.254.202.82 10.254.202.83 10.254.202.114"
APP_NS=llm-evaluation
ssh_n(){ sshpass -e ssh -p 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=10 "kcloud@$1" "${@:2}" 2>&1 | grep -v 'Permanently added'; }

echo "=================== APP-LAYER  $(date -u) ==================="
kubectl config current-context 2>/dev/null | grep -qiv '177.41' || { echo "FATAL: wrong kubeconfig (old cluster)"; exit 9; }

# 1) NFS SERVER on node4 + nfs-common on all nodes (kubelet mounts NFS PVs) -----------------------
echo "--- [1] NFS server on node4 + nfs-common ---"
printf '%s\n' "$SUDO_PASS" | ssh_n "$NFS_IP" "sudo -S bash -c '
  set -e
  DEBIAN_FRONTEND=noninteractive apt-get install -y nfs-kernel-server >/dev/null 2>&1
  # decouple any stale old-cluster NFS mounts so the dirs are LOCAL + exportable
  for m in /mnt/results /mnt/models /mnt/datasets /mnt/etri-llm-evaluation-postgres; do
    mountpoint -q \"\$m\" && { umount \"\$m\" 2>/dev/null || umount -l \"\$m\" 2>/dev/null; }
  done
  sed -i.bak \"/10\.254\.184\.195:/d\" /etc/fstab 2>/dev/null || true
  mkdir -p /mnt/models /mnt/datasets /mnt/results /mnt/etri-llm-evaluation-postgres /nfs-storage
  chmod 0777 /mnt/models /mnt/datasets /mnt/results /mnt/etri-llm-evaluation-postgres /nfs-storage
  cat > /etc/exports <<EOF
/mnt/models                        10.254.202.0/24(rw,sync,no_subtree_check,no_root_squash,fsid=10)
/mnt/datasets                      10.254.202.0/24(rw,sync,no_subtree_check,no_root_squash,fsid=11)
/mnt/results                       10.254.202.0/24(rw,sync,no_subtree_check,no_root_squash,fsid=12)
/mnt/etri-llm-evaluation-postgres  10.254.202.0/24(rw,sync,no_subtree_check,no_root_squash,fsid=13)
/nfs-storage                       10.254.202.0/24(rw,sync,no_subtree_check,no_root_squash,fsid=14)
EOF
  systemctl enable --now nfs-kernel-server >/dev/null 2>&1; exportfs -ra; exportfs -v | sed s/^/\ \ /
'"
for ip in $NODES; do
  printf '%s\n' "$SUDO_PASS" | ssh_n "$ip" "sudo -S bash -c 'dpkg -l nfs-common 2>/dev/null | grep -q ^ii || DEBIAN_FRONTEND=noninteractive apt-get install -y nfs-common >/dev/null 2>&1; echo \"$ip nfs-common ok\"'"
done

# 2) Namespace + static PVs/PVCs + Postgres (corrected NFS server IP node2 -> node4) --------------
echo "--- [2] apply database.yaml + data-volume.yaml (NFS -> node4) ---"
OUT=/home/kcloud/consolidation-manifests; mkdir -p "$OUT"
sed 's/10\.254\.184\.195/'"$NFS_IP"'/g' "$K8S/data-volume.yaml" > "$OUT/data-volume.yaml"
sed 's/10\.254\.184\.195/'"$NFS_IP"'/g' "$K8S/database.yaml"    > "$OUT/database.yaml"
kubectl create namespace "$APP_NS" --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$OUT/data-volume.yaml" -n "$APP_NS"
kubectl apply -f "$OUT/database.yaml" -n "$APP_NS"

# 3) Installer: storage (NFS provisioner) + gpu-operator + webapp (app-chart v50/v46) ------------
#    --skip-observability: loki/prometheus are deployed in step 6 via the vendored deploy scripts
#    (the installer's stage_observability has chart-path bugs). --nfs-server points at node4.
echo "--- [3] installer stack (storage + gpu-operator + webapp) ---"
( cd "$KT" && KUBECONFIG="$KUBECONFIG" SUDO_PASS="$SUDO_PASS" bash scripts/install_kcloud_stack.sh \
    --node-ips "10.254.202.81,10.254.202.82,10.254.202.83,10.254.202.114" \
    --device gpu --ssh-port 22 --nfs-server "$NFS_IP" --skip-observability --skip-benchmarks )

# 3b) Pre-pull the GPU MLPerf/MMLU worker image on BOTH GPU nodes. Benchmark Jobs use
#     docker.io/mondrianai/etri-llm-mlperf:v0.2 (~7.8GB); on 202.x egress the pull is flaky, so a Job that
#     lands on a node without it cached hits ImagePullBackOff (exam → Error). Pre-pull with retries.
echo "--- [3b] pre-pull GPU worker image on jw2/jw3 ---"
for ip in 10.254.202.82 10.254.202.83; do
  printf '%s\n' "$SUDO_PASS" | ssh_n "$ip" "sudo -S bash -c 'crictl images | grep -q etri-llm-mlperf || for i in 1 2 3 4; do crictl pull mondrianai/etri-llm-mlperf:v0.2 && break; sleep 15; done; echo \"$ip worker-image: \$(crictl images | grep -c etri-llm-mlperf)\"'"
done

# 4) Device registry ConfigMap (A30 jw2/jw3 + RNGD node4) + node labels + backend re-read --------
echo "--- [4] device ConfigMap + node labels ---"
kubectl label node jw2 accelerator-type=gpu gpu-vendor=nvidia gpu-model=a30 --overwrite 2>/dev/null
kubectl label node jw3 accelerator-type=gpu gpu-vendor=nvidia gpu-model=a30 --overwrite 2>/dev/null
kubectl label node node4 accelerator-type=npu npu-vendor=furiosa npu-model=rngd --overwrite 2>/dev/null
[ -f /home/kcloud/new-cluster-fixed.yaml ] && kubectl create configmap etri-llm-cluster-config -n "$APP_NS" \
  --from-file=cluster.yaml=/home/kcloud/new-cluster-fixed.yaml --dry-run=client -o yaml | kubectl apply -f -
# RBAC: let the backend (default SA) READ exams.resources.etri.llm CRs. Without this
# the backend logs "Could not read Exam CR ...: 403" every status refresh and can't
# do CR-based completion/operator-race detection (falls back to gRPC, noisy + degraded).
kubectl apply -f - <<'RBAC'
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: etri-llm-backend-exam-viewer
  namespace: llm-evaluation
subjects:
  - { kind: ServiceAccount, name: default, namespace: llm-evaluation }
roleRef:
  kind: ClusterRole
  name: exam-viewer-role
  apiGroup: rbac.authorization.k8s.io
RBAC
kubectl rollout restart deploy/etri-llm-backend -n "$APP_NS" 2>/dev/null

# 5) Furiosa RNGD device plugin (mixed GPU+NPU cluster: gpu-operator already installed) -----------
echo "--- [5] furiosa RNGD device plugin ---"
( cd "$KT" && KUBECONFIG="$KUBECONFIG" SUDO_PASS="$SUDO_PASS" bash scripts/install_kcloud_stack.sh \
    --node-ips "10.254.202.81,10.254.202.82,10.254.202.83,10.254.202.114" \
    --device npu-rngd --ssh-port 22 --nfs-server "$NFS_IP" --only operators )

# 6) Observability: Loki (loki:3100) + Prometheus (prometheus-server:80, NodePort 30900) +
#    furiosa-metrics-exporter (NPU telemetry). Backend telemetry queries Prometheus; worker pushes
#    logs to loki.loki.svc. --------------------------------------------------------------------
echo "--- [6] loki + prometheus + furiosa-metrics-exporter ---"
kubectl create namespace loki --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
helm status loki -n loki >/dev/null 2>&1 || bash "$K8S/04-deploy-loki.sh"
helm status prometheus -n monitoring >/dev/null 2>&1 || bash "$K8S/05-deploy-prometheus.sh"
kubectl patch svc prometheus-server -n monitoring --type=json \
  -p '[{"op":"replace","path":"/spec/type","value":"NodePort"},{"op":"add","path":"/spec/ports/0/nodePort","value":30900}]' 2>/dev/null
helm repo add furiosa https://furiosa-ai.github.io/helm-charts >/dev/null 2>&1; helm repo update furiosa >/dev/null 2>&1
helm status furiosa-metrics-exporter -n furiosa-system >/dev/null 2>&1 || \
  helm install -n furiosa-system furiosa-metrics-exporter furiosa/furiosa-metrics-exporter \
    --set service.enableScrapAnnotations=true --set service.port=6254 --set service.targetPort=6254

# 7) Per-host GPU live dashboards on jw2/jw3 (embedded MLPerf iframes 30891/30893) ---------------
echo "--- [7] per-host GPU dashboards on jw2/jw3 ---"
DASH=/home/kcloud/etri-llm-exam-solution/web/scripts/gpu_bench_dashboard_l40.py
deploy_dash(){ local ip=$1 node=$2 port=$3
  sshpass -e scp -P 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PreferredAuthentications=password -o PubkeyAuthentication=no "$DASH" "kcloud@$ip:/home/kcloud/gpu_bench_dashboard.py" 2>/dev/null
  ssh_n "$ip" "cat > /home/kcloud/run-gpu-dash.sh" <<WRAP
#!/bin/bash
export GPU_BENCH_DASHBOARD_PORT=$port GPU_BENCH_DASHBOARD_NODE=$node
export GPU_BENCH_DASHBOARD_LABEL="NVIDIA A30" GPU_BENCH_DASHBOARD_FILTER=A30
export GPU_BENCH_BACKEND_URL=http://$CP_IP:30980
exec python3 /home/kcloud/gpu_bench_dashboard.py
WRAP
  printf '%s\n' "$SUDO_PASS" | ssh_n "$ip" "sudo -S bash -c 'chmod +x /home/kcloud/run-gpu-dash.sh; systemctl reset-failed gpu-bench 2>/dev/null; systemctl stop gpu-bench 2>/dev/null; systemd-run --unit=gpu-bench --collect bash /home/kcloud/run-gpu-dash.sh; sleep 2; systemctl is-active gpu-bench'"
}
[ -f "$DASH" ] && { deploy_dash 10.254.202.82 jw2 30891; deploy_dash 10.254.202.83 jw3 30893; }

# 7b) RNGD live bench dashboard on node4:30890 (embedded iframe on the /npu-eval/rngd page).
#     The RNGD eval page points its <LiveBenchDashboard> iframe at http://10.254.202.114:30890/.
#     Script reads live furiosa-smi telemetry + queries the backend for the NPU-vs-GPU TT100T panel.
RNGD_DASH=/home/kcloud/etri-llm-exam-solution/web/scripts/rngd_bench_dashboard.py
if [ -f "$RNGD_DASH" ]; then
  sshpass -e scp -P 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PreferredAuthentications=password -o PubkeyAuthentication=no "$RNGD_DASH" "kcloud@$NFS_IP:/home/kcloud/bench_dashboard.py" 2>/dev/null
  ssh_n "$NFS_IP" "cat > /home/kcloud/run-rngd-dash.sh" <<WRAP
#!/bin/bash
export BENCH_DASHBOARD_PORT=30890
export BENCH_DASHBOARD_BACKEND_URL=http://$CP_IP:30980/api/npu-eval/list
exec python3 /home/kcloud/bench_dashboard.py
WRAP
  printf '%s\n' "$SUDO_PASS" | ssh_n "$NFS_IP" "sudo -S bash -c 'chmod +x /home/kcloud/run-rngd-dash.sh; systemctl reset-failed rngd-bench-dashboard 2>/dev/null; systemctl stop rngd-bench-dashboard 2>/dev/null; systemd-run --unit=rngd-bench-dashboard --collect bash /home/kcloud/run-rngd-dash.sh; sleep 2; systemctl is-active rngd-bench-dashboard'"
fi

# 8) RNGD inference server (node4:8000) + MMLU-Pro JSONL + model config caps -----------------------
#    GATING FIX for ALL NPU benchmarks and NPU realtime telemetry. The node4 venv furiosa-llm is
#    2026.1.0 and CANNOT load the 2025.3.x compiled artifact (NextGenArtifact "missing field
#    `inputs`"); the pod image furiosaai/furiosa-llm:2025.3.3 MATCHES the artifact. Also: cap the
#    Llama configs to 8192 ctx so A30 (24GB) vLLM KV cache fits, and materialise the MMLU-Pro
#    parquet as JSONL (the backend npu-eval loader reads .jsonl, not .parquet).
echo "--- [8] RNGD inference server + dataset/model prep ---"

# 8a) node4 prep script: cap model contexts + convert MMLU-Pro parquet -> JSONL (idempotent).
ssh_n "$NFS_IP" "cat > /home/kcloud/npu-node4-prep.sh" <<'PREP'
#!/bin/bash
set -e
VENVPY=/home/kcloud/furiosa-llm-venv/bin/python
for m in Llama-3.1-8B-Instruct Llama-3.1-8B-Instruct-FP8 Llama-3.1-8B-FP8-v2026; do
  f=/mnt/models/$m/config.json
  [ -f "$f" ] || continue
  [ -f "$f.orig-131072" ] || cp "$f" "$f.orig-131072"
  python3 - "$f" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
if int(d.get("max_position_embeddings",0))>8192:
    d["max_position_embeddings"]=8192; json.dump(d,open(p,"w"),indent=2); print("capped",p)
else: print("ok",p)
PY
done
if [ -f /mnt/datasets/mmlu-pro/test.parquet ] && [ ! -f /mnt/datasets/mmlu-pro/test.jsonl ]; then
  [ -x "$VENVPY" ] || VENVPY=python3
  "$VENVPY" - <<'PY'
import pandas as pd, json
LET="ABCDEFGHIJKLMNOP"
df=pd.read_parquet("/mnt/datasets/mmlu-pro/test.parquet")
with open("/mnt/datasets/mmlu-pro/test.jsonl","w") as f:
    for _,r in df.iterrows():
        opts=list(r["options"]); body="\n".join(f"{LET[i]}. {o}" for i,o in enumerate(opts))
        q=str(r["question"]).strip()+"\n"+body+"\n\nAnswer with the single letter of the correct option.\nAnswer:"
        f.write(json.dumps({"question_id":int(r["question_id"]),"question":q,
                            "answer":str(r["answer"]).strip().upper(),"category":str(r.get("category",""))})+"\n")
print("converted mmlu-pro -> test.jsonl rows", len(df))
PY
fi
PREP
printf '%s\n' "$SUDO_PASS" | ssh_n "$NFS_IP" "sudo -S bash /home/kcloud/npu-node4-prep.sh"

# 8b) pre-pull the version-matched furiosa-llm image (flaky 202.x egress -> retry up to 3x).
printf '%s\n' "$SUDO_PASS" | ssh_n "$NFS_IP" "sudo -S bash -c 'crictl images | grep -q \"furiosaai/furiosa-llm.*2025.3.3\" || for i in 1 2 3; do crictl pull furiosaai/furiosa-llm:2025.3.3 && break; sleep 10; done'"

# 8c) write + apply the inference-server pod manifest (nodeSelector pins node4; rngd request forces it).
cat > "$OUT/npu-inference-server.yaml" <<'NPUMANIFEST'
apiVersion: v1
kind: Pod
metadata:
  labels: { app: npu-inference, device-type: npu }
  name: npu-inference-server
  namespace: llm-evaluation
spec:
  nodeSelector: { kubernetes.io/hostname: node4 }
  hostNetwork: true
  restartPolicy: Always
  containers:
  - name: furiosa-llm
    image: furiosaai/furiosa-llm:2025.3.3
    imagePullPolicy: IfNotPresent
    command: [furiosa-llm, serve, furiosa-ai/Llama-3.1-8B-Instruct-FP8,
              --revision=v2025.3.0, --host=0.0.0.0, --port=8000, "--devices=npu:0:*"]
    env:
    - { name: HF_HUB_OFFLINE, value: "1" }
    - { name: TRANSFORMERS_OFFLINE, value: "1" }
    ports: [{ containerPort: 8000, hostPort: 8000, name: http, protocol: TCP }]
    livenessProbe:  { httpGet: { path: /health, port: 8000 }, initialDelaySeconds: 360, periodSeconds: 30 }
    readinessProbe: { httpGet: { path: /health, port: 8000 }, initialDelaySeconds: 300, periodSeconds: 10 }
    resources:
      limits:   { cpu: "8", furiosa.ai/rngd: "1", memory: 64Gi }
      requests: { cpu: "8", furiosa.ai/rngd: "1", memory: 64Gi }
    securityContext: { seccompProfile: { type: Unconfined } }
    volumeMounts: [{ mountPath: /root/.cache/huggingface, name: root-hf-cache }]
  volumes:
  - hostPath: { path: /root/.cache/huggingface, type: Directory }
    name: root-hf-cache
NPUMANIFEST
kubectl apply -f "$OUT/npu-inference-server.yaml"

# 8d) wait for the server to answer /health (model load ~1-5 min; cached artifact is faster).
echo -n "    waiting for node4:8000/health "
for i in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://$NFS_IP:8000/health 2>/dev/null)" = "200" ] && { echo " READY"; break; }
  echo -n "."; sleep 10
done

echo "=================== APP-LAYER DONE  $(date -u) ==================="
echo "NOTE: benchmark results ingest lazily on GET /api/mp-exam/status/:id (UI polling triggers it)."
echo "NOTE: data restore is separate — node4:~/restore-data.sh (postgres-dump.sql via psql; model/dataset/results tars)."
echo "NOTE: Step 8 (model config caps, MMLU-Pro JSONL, RNGD inference server) needs the restored models/"
echo "      datasets + /root/.cache/huggingface compiled artifact. On a FRESH install run order is:"
echo "      provision -> app-layer (steps 1-7 deploy stack) -> restore-data.sh -> RE-RUN app-layer (idempotent;"
echo "      step 8 now finds the data and activates). The step is guarded to skip cleanly when data is absent."
