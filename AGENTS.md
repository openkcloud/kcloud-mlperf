<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-21 | Updated: 2026-04-21 -->

# etri-llm-deployments / app
<!-- Migrated 2026-05-12: this directory was previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming). It now lives under ETRI ownership at `/home/kcloud/etri-llm-deployments/app/`. -->


## Purpose
Enhanced deployment fork that extends `etri-llm-deployments` with application-specific Kubernetes deployment. Contains Helm charts for the LLM evaluation app, GPU operator, observability stack (Loki, Prometheus, Alloy), NFS provisioner, and PostgreSQL. This is the **application deployment** layer — infrastructure provisioning is in the sibling `etri-llm-deployments/` directory.

## Key Files

| File | Description |
|------|-------------|
| `kubernetes/01-create-ns.sh` | Creates `llm-evaluation` namespace |
| `kubernetes/02-deploy-nfs-provisioner.sh` | Deploys NFS dynamic storage provisioner |
| `kubernetes/03-deploy-gpu-operator.sh` | Deploys NVIDIA GPU operator v25.10.0 |
| `kubernetes/04-deploy-loki.sh` | Deploys Grafana Loki for log aggregation |
| `kubernetes/05-deploy-prometheus.sh` | Deploys Prometheus monitoring stack |
| `kubernetes/06-deploy-alloy.sh` | Deploys Grafana Alloy telemetry collector |
| `kubernetes/07-deploy-llm-evaluation.sh` | Deploys the LLM evaluation app via Helm |
| `kubernetes/database.yaml` | PostgreSQL deployment, service, secret, 100Gi PVC |
| `kubernetes/data-volume.yaml` | NFS PV/PVC for datasets, models, results (2Ti each) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `kubernetes/` | All k8s deployment configs, Helm charts, deploy scripts (see `kubernetes/AGENTS.md`) |
| `kubespray/` | Kubespray copy (same as sibling `etri-llm-deployments/kubespray/`) |

## For AI Agents

### Working In This Directory
- Deploy scripts **must run in order** (01 → 07) — each depends on prior infrastructure
- `redeploy_full.sh` at `~/` automates the full sequence
- The `kubernetes/app-chart/values.yaml` is the main config for the LLM evaluation app
- Vendored Helm chart tarballs (`.tgz`) in `kubernetes/` — do not modify directly
- `database.yaml` and `data-volume.yaml` are applied with `kubectl apply -f` before the app chart

### Testing Requirements
- After deployment: `kubectl get pods -n llm-evaluation` — all 5 pods should be Running
- Frontend: `curl http://<node-ip>:30001`
- Backend API: `curl http://<node-ip>:30980`
- GPU operator: `kubectl get pods -n gpu-operator`
- Monitoring: `kubectl get pods -n monitoring`

### Common Patterns
- Each `0X-deploy-*.sh` script wraps a `helm upgrade --install` command
- App images: `ghcr.io/etri-llm/etri-llm-k8s-api:v1.0.0`, `jungwooshim/etri-llm-k8s-operator:v1.0.1` (operator image already migrated), `ghcr.io/etri-llm/etri-llm-frontend:v1.0.0`, `ghcr.io/etri-llm/etri-llm-backend:latest`
- Secrets pulled via `image-pull-secret` (dockerconfigjson type)

## Dependencies

### Internal
- Requires cluster provisioned by `../etri-llm-deployments/kubespray/`
- App images built from `../etri-llm-exam-solution/`
- Called by `~/redeploy_full.sh`

### External
- Helm 3.x
- NVIDIA GPU Operator 25.10.0
- Grafana Loki 2.2.1, Prometheus (kube-prometheus-stack 79.1.1), Alloy 1.4.0
- NFS server (external to cluster)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
