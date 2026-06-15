<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-21 | Updated: 2026-04-21 -->

# kubernetes

## Purpose
Kubernetes deployment configurations for the entire LLM evaluation platform stack. Contains numbered deploy scripts (01–07) that install infrastructure in sequence, a custom Helm chart for the application, vendored Helm charts for observability and GPU support, and raw manifests for PostgreSQL and NFS volumes.

## Key Files

| File | Description |
|------|-------------|
| `01-create-ns.sh` | Creates `llm-evaluation` namespace |
| `02-deploy-nfs-provisioner.sh` | Deploys NFS dynamic storage provisioner via Helm |
| `03-deploy-gpu-operator.sh` | Deploys NVIDIA GPU operator v25.10.0 via Helm |
| `04-deploy-loki.sh` | Deploys Grafana Loki v2.2.1 for log aggregation |
| `05-deploy-prometheus.sh` | Deploys kube-prometheus-stack v79.1.1 |
| `06-deploy-alloy.sh` | Deploys Grafana Alloy v1.4.0 telemetry collector |
| `07-deploy-llm-evaluation.sh` | Deploys LLM evaluation app via `app-chart/` Helm chart |
| `database.yaml` | PostgreSQL: Deployment, Service, Secret, 100Gi PVC |
| `data-volume.yaml` | NFS PersistentVolumes and PVCs: datasets (2Ti), models (2Ti), results (2Ti) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `app-chart/` | Custom Helm chart for LLM evaluation app (4 components: API, frontend, backend, operator) |
| `app-chart/templates/` | K8s manifests per component: deployment.yaml, service.yaml, secret.yaml |
| `kubeconfig/` | Cluster credential files |
| `alloy-1.4.0.tgz` | Vendored Grafana Alloy Helm chart |
| `gpu-operator-25.10.0.tgz` | Vendored NVIDIA GPU Operator Helm chart |
| `grafana-6.11.0.tgz` | Vendored Grafana Helm chart |
| `kube-prometheus-stack-79.1.1.tgz` | Vendored Prometheus stack Helm chart |
| `loki-2.2.1.tgz` | Vendored Grafana Loki Helm chart |
| `nfs-subdir-external-provisioner-4.0.18.tgz` | Vendored NFS provisioner Helm chart |

## App Chart Components

| Component | Image | Port | Service Type |
|-----------|-------|------|-------------|
| `etri-llm-api` | `ghcr.io/etri-llm/etri-llm-k8s-api:v1.0.0` | 9090 | ClusterIP |
| `etri-llm-operator` | `jungwooshim/etri-llm-k8s-operator:v1.0.1` | 8443 | ClusterIP |
| `etri-llm-frontend` | `jungwooshim/etri-cloud-frontend:v1.0.0` | 5173 | NodePort 30001 |
| `etri-llm-backend` | `jungwooshim/etri-cloud-backend:latest` | 9999 | NodePort 30980 |

## For AI Agents

### Working In This Directory
- Deploy scripts **MUST run in order** 01 → 07; each depends on prior resources
- `database.yaml` and `data-volume.yaml` are applied between steps 06 and 07 (see `~/redeploy_full.sh`)
- Modify app configuration in `app-chart/values.yaml` — do NOT edit templates unless adding new resources
- Vendored `.tgz` chart files should NOT be modified — update by replacing with new versions
- `image-pull-secret` must exist in `llm-evaluation` namespace for private registry access

### Testing Requirements
- After full deploy: `kubectl get pods -n llm-evaluation` — expect 5 pods (api, backend, db, frontend, operator)
- Verify services: `kubectl get svc -n llm-evaluation`
- Check Helm releases: `helm list -n llm-evaluation`
- GPU validation: `kubectl get pods -n gpu-operator`
- Monitoring: `kubectl get pods -n monitoring` and `kubectl get pods -n loki`

### Common Patterns
- Each deploy script: `helm upgrade --install <release> <chart> -n <namespace> -f <values>`
- NFS PVs reference external NFS server IP and export paths — update `data-volume.yaml` if NFS config changes
- PostgreSQL secret contains DB credentials referenced by backend pod env vars
- App chart uses `{{ .Values.<component> }}` templating pattern

## Dependencies

### Internal
- Requires cluster from `../../etri-llm-deployments/kubespray/`
- App images built from `../../etri-llm-exam-solution/`
- NFS server must be accessible from all cluster nodes

### External
- Helm 3.x (pre-installed on control plane)
- NFS server with exported paths for datasets, models, results
- Container registry access for `ghcr.io/etri-llm/*` (ETRI-owned) and `jungwooshim/*` (operator image, pre-migrated)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
