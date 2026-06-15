# kcloud-mlperf

**Combined release artifact** for the kcloud / ETRI LLM evaluation platform — a single,
self-contained repository that bundles the web application, cluster infrastructure, the
one-command installer, and the MLPerf benchmark harness for GPU↔NPU LLM benchmarking on
Kubernetes (NVIDIA A30, FuriosaAI RNGD, Rebellions Atom+).

> **Development happens in three separate repos; releases are assembled here.**
> Open PRs against the component repos and re-cut a release — don't develop directly here.

## What's inside

| Path | Component | Source repo (private dev) |
|------|-----------|----------------------------|
| [`app/`](app/) | Web application — React frontend (`web/`) + NestJS backend (`server/`): run benchmarks, live GPU/NPU telemetry, comparison dashboards, leaderboards | `jshim0978/etri-llm-benchmarking-tool` |
| [`infra/`](infra/) | Cluster infrastructure — Helm chart, k8s manifests, Atom+ assets, ops scripts, kubespray **inventories** (upstream kubespray excluded; fetch separately) | `jshim0978/etri-llm-benchmarking-infra` |
| [`installer/`](installer/) | One-command installers, namespace-scoped deploy templates, benchmark jobs, test harness, **and the rack4 deploy package** ([`installer/rack4/`](installer/rack4/)) | `kcloud-tool` |
| [`benchmarks/`](benchmarks/) | MLPerf harness — `mlcommons_inference`, `mmlu_pro` (submodules), CNN/DM + MMLU-Pro code | (original `kcloud-mlperf`) |

---

# Installation

There are two supported paths:

- **A. Shared, pre-existing cluster via a Deploy/jump server** — *this is exactly how the demonstration
  server (openKcloud Rack 4) was installed.* Namespace-scoped, ClusterIP-only, zero impact on the host cluster.
- **B. A cluster you own** — the one-command installer that can also provision nodes.

## A. Deploy to a shared cluster via a jump server (the Rack 4 method)

This reproduces the exact, verified install performed on the Rack 4 demonstration server on 2026-06-08
(see [`installer/rack4/RACK4-KCLOUD-TOOL-INSTALL.ko.md`](installer/rack4/RACK4-KCLOUD-TOOL-INSTALL.ko.md)
for the original operations record). The rack is a **shared, pre-existing** OpenStack-on-Kubernetes service
(KubeSphere / kube-ovn). The install is **non-destructive**: every object lives inside one new namespace
(`kcloud-tool`), identified by `app.kubernetes.io/managed-by=kcloud-tool`; the only cluster-scoped objects
are the namespace itself and (optionally, with approval) the ETRI app's CRD/ClusterRoles.

### Design rules this method follows (assume nothing)
- **Namespace-scoped only** — never touch `kube-system`, `openstack`, `ceph-*`, ingress, or other namespaces.
- **ClusterIP-first** — no NodePort, no LoadBalancer, no Ingress. Access is via `kubectl port-forward` over an SSH tunnel.
- **No cluster mutation** — no kubespray/provisioning, no operators/CNI/StorageClass changes, no node reboots, no sudo.
- **Pod Security Admission `restricted`**, label-scoped everything, reversible by label.

### 0. Access (jump host — no direct compute-node SSH)

```bash
# Deploy/jump server: uplink 10.254.202.104 : port 12150  (internal 192.168.90.150)
ssh -p 12150 kcloud@10.254.202.104
export KUBECONFIG=$HOME/.kube/config
kubectl cluster-info        # confirm you can reach the cluster
```

### 1. Read-only preflight (verify, change nothing)

```bash
# RBAC: confirm you can create namespaced objects
for r in namespaces serviceaccounts roles rolebindings configmaps \
         persistentvolumeclaims jobs secrets services deployments; do
  echo -n "$r: "; kubectl auth can-i create $r -n kcloud-tool
done
# Storage: Rack 4 exposes rook-ceph StorageClasses (used below)
kubectl get sc                 # expect: general (RBD, RWO), general-multi-attach (CephFS, RWX)
kubectl get ns kcloud-tool     # expect: NotFound (created in step 2)
```

### 2. Apply the namespace-scoped package (in order)

All manifests are in [`installer/rack4/`](installer/rack4/). Copy that directory to the Deploy server, then:

```bash
cd installer/rack4

# 2.1 namespace (PSA enforce=restricted) + RBAC + results PVC (general, 1Gi RWO)
kubectl apply -f 00-namespace.yaml
kubectl apply -f 10-rbac-config-pvc.yaml

# 2.2 benchmark layer — scripts (ConfigMaps) + Jobs
kubectl apply -f 10-smoke.yaml -f 20-smoke-job.yaml
kubectl apply -f 30-cpu-benchmark.yaml
kubectl apply -f 41-endpoint-netcheck.yaml \
              -f 42-endpoint-single-generation.yaml \
              -f 43-endpoint-microbench.yaml

# 2.3 lightweight WebUI (Deployment + ClusterIP Service, python:3.11-slim)
kubectl apply -f 50-webui.yaml

# 2.4 app storage — postgres PVC (general, RWO) + model/dataset/results PVCs (general-multi-attach, RWX) + postgres
kubectl apply -f 60-app-storage.yaml
```

**Optional — the full ETRI web app** (frontend + backend + k8s-api + operator). This needs a CRD and
ClusterRoles, so it requires **explicit infra-owner approval** (cluster-scoped objects). The DB password is
generated as a fresh random Secret at apply time — never commit a real value:

```bash
# create a random DB Secret first (example)
kubectl -n kcloud-tool create secret generic etri-llm-db \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -base64 24)" \
  --from-literal=DATABASE_PASSWORD="$(openssl rand -base64 24)"

kubectl apply -f official-crd.yaml     # CRD exams.resources.etri.llm  (approval required)
kubectl apply -f official-rest.yaml    # api / backend / frontend / operator — all ClusterIP
kubectl apply -f rack4-cluster.yaml    # cluster-config ConfigMap (empty control_plane/workers)
```

> The operator can run namespace-scoped (`WATCH_NAMESPACE=kcloud-tool`). Accelerator-node Jobs require a
> device-plugin (not installed on Rack 4) — for a shared rack, run **endpoint-call benchmarks** (the backend
> calls an external inference endpoint) instead of on-cluster accelerator Jobs.

### 3. Verify

```bash
kubectl -n kcloud-tool get jobs        # smoke / cpu-benchmark / endpoint-* → Complete
kubectl -n kcloud-tool get pods,svc    # webui (and app) Running; Services are ClusterIP
```

### 4. Access (ClusterIP → port-forward over SSH tunnel)

```bash
# on the Deploy server:
kubectl -n kcloud-tool port-forward svc/kcloud-mlperf-webui 18080:80 --address 0.0.0.0
# (full app instead) kubectl -n kcloud-tool port-forward svc/etri-llm-frontend-service 5173:5173

# from your workstation:
ssh -L 18080:127.0.0.1:18080 -p 12150 kcloud@10.254.202.104
#   → open http://localhost:18080   (or http://192.168.90.150:18080 on the deploy host)
```

WebUI API: `GET /healthz`, `GET /api/config`, `POST /api/run`, `GET /api/runs`.
Results persist to the `kcloud-mlperf-results` PVC (`/mnt/datasets/webui-runs/`).

### 5. Rollback / uninstall (label-scoped — dry-run first)

```bash
kill "$(cat ~/kcloud-render/webui-portforward.pid)" 2>/dev/null   # stop port-forward

kubectl -n kcloud-tool delete deploy,svc,job,configmap,rolebinding,role,serviceaccount \
  -l app.kubernetes.io/managed-by=kcloud-tool --dry-run=server     # preview
kubectl -n kcloud-tool delete deploy,svc -l app.kubernetes.io/managed-by=kcloud-tool
kubectl -n kcloud-tool delete job        -l app.kubernetes.io/managed-by=kcloud-tool
kubectl -n kcloud-tool delete configmap  -l app.kubernetes.io/managed-by=kcloud-tool
kubectl -n kcloud-tool delete rolebinding,role,serviceaccount -l app.kubernetes.io/managed-by=kcloud-tool
# PVCs and namespace: delete only with separate approval
# kubectl -n kcloud-tool delete pvc -l app.kubernetes.io/managed-by=kcloud-tool
# kubectl delete namespace kcloud-tool
```

## B. Install to a cluster you own (one-command)

For a cluster you control (optionally provisioning the nodes), use the installer in [`installer/`](installer/):

```bash
cd installer
./install_kcloud_stack.sh --node-ips "10.x.x.1,10.x.x.2,10.x.x.3"   # full stack
./install_pilot_k8s.sh    --node-ips "10.x.x.1,10.x.x.2,10.x.x.3"   # benchmarks only
```

Both support `--validate-only` (read-only preflight) and `--dry-run` (render + plan, no apply).
See [`installer/docs/`](installer/docs/) for the full reference.

---

## Configuration & secrets

No real credentials are committed. Copy the example files and inject real values via Kubernetes Secrets / env:

- `infra/config/credentials.example.env` — SSH/sudo, Docker Hub, HuggingFace, GitHub, Furiosa
- Placeholders used throughout: `${HF_TOKEN}`, `<DB_PASSWORD>`, `<SUDO_PASS>`

## Components & versions

- Kubernetes 1.28+; accelerators: NVIDIA A30 (GPU), FuriosaAI RNGD (NPU), Rebellions Atom+ (NPU)
- App images (Docker Hub): `jungwooshim/etri-llm-frontend`, `-backend`, `-k8s-api:v1.0.0`, `-k8s-operator:v1.0.1`
- Rebellions Atom+ stack: KMD/dkms/fw `3.0.0`, rbln-sdk/compiler/optimum/vllm `0.10.3`, container-toolkit `0.2.1`

## License

See [LICENSE](LICENSE).
