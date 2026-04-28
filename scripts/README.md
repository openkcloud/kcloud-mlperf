# Cluster migration & onboarding scripts

A small set of bash scripts that wrap the recurring operational workflows for the
ETRI LLM benchmark cluster:

- bring up a brand-new cluster from scratch
- add a node to the existing cluster
- rebuild + redeploy the application
- preload images for offline / air-gapped onboarding

All scripts have `--help`, use `set -euo pipefail`, and return non-zero on errors.
They expect to be run from the `scripts/` directory inside this repo.

---

## Prerequisites (once per operator workstation)

```bash
sudo apt-get update -qq
sudo apt-get install -y ansible kubectl helm sshpass python3-yaml
```

If you also need to build images on this host:
```bash
./scripts/install-build-host.sh    # installs docker, optional Hub login
```

---

## Recipe 1: rebuild + redeploy the app (most common)

```bash
# 1. Build new images. Bumps from v12 -> v13 (or any tag you choose).
./scripts/build-and-push.sh v13 --source /home/kcloud/etri-llm-exam-solution

# 2. Update the helm chart values.yaml to the new tag.
sed -i 's|jungwooshim/etri-llm-backend:.*|jungwooshim/etri-llm-backend:v13"|' \
    kubernetes/app-chart/values.yaml
sed -i 's|jungwooshim/etri-llm-frontend:.*|jungwooshim/etri-llm-frontend:v13"|' \
    kubernetes/app-chart/values.yaml

# 3. Apply.
./scripts/install-app-chart.sh
```

---

## Recipe 2: add a brand-new node

```bash
# 1. On the new host, install kube prereqs.
scp scripts/bootstrap-node.sh kcloud@<NEWNODE_IP>:/tmp/
ssh -p 122 kcloud@<NEWNODE_IP> sudo /tmp/bootstrap-node.sh

# 2. From the operator workstation, append it to inventory + run kubespray.
./scripts/add-node.sh node5 10.254.184.197 --role kube_node

# 3. (Optional) preload current images so workloads start instantly.
./scripts/build-and-push.sh v13 --no-push --save-tar /tmp/etri-v13.tar.gz
./scripts/preload-images.sh /tmp/etri-v13.tar.gz --limit node5
```

---

## Recipe 3: bring up a brand-new cluster from scratch

```bash
# 0. Have an inventory ready at kubespray/inventory/etri/hosts.yml.

# 1. Bootstrap every host.
for host in $(yq '.all.hosts | keys | .[]' kubespray/inventory/etri/hosts.yml); do
  scp scripts/bootstrap-node.sh kcloud@$host:/tmp/
  ssh kcloud@$host sudo /tmp/bootstrap-node.sh
done

# 2. Run kubespray cluster.yml.
( cd kubespray && ansible-playbook -i inventory/etri/hosts.yml cluster.yml )

# 3. Copy admin.conf to your kubeconfig.
sudo cp /etc/kubernetes/admin.conf ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config

# 4. Deploy infra components (NFS, GPU operator, Loki, Prometheus, Alloy).
cd kubernetes
bash 02-deploy-nfs-provisioner.sh
bash 03-deploy-gpu-operator.sh
bash 04-deploy-loki.sh
bash 05-deploy-prometheus.sh
bash 06-deploy-alloy.sh

# 5. Deploy the app.
cd ..
./scripts/install-app-chart.sh
```

For the operator (mondrianai/etri-llm-k8s-operator) and apt operator (etri-llm-k8s-api), the helm chart wires those automatically when `install-app-chart.sh` runs.

---

## Recipe 4: rotate Docker Hub credentials

```bash
# 1. Generate a new token at https://hub.docker.com/settings/security
# 2. Update the build host:
DOCKERHUB_TOKEN=dckr_pat_NEW ./scripts/install-build-host.sh
# 3. Update the in-cluster pull secret:
kubectl create secret docker-registry image-pull-secret \
    --docker-username=jungwooshim \
    --docker-password=dckr_pat_NEW \
    --docker-server=https://index.docker.io/v1/ \
    -n llm-evaluation \
    --dry-run=client -o yaml | kubectl apply -f -
```

---

## Operator-only files (NOT in repo)

The following live on the operator workstation only and are gitignored:

- `kubernetes/kubeconfig/admin.conf` — cluster admin certs
- `~/.docker/config.json` — Docker Hub token
- `~/.git-credentials` — GitHub PAT

If you wipe the workstation, regenerate via:
- `kubeconfig`: scp from any control-plane node `/etc/kubernetes/admin.conf`
- `docker login`: re-run `install-build-host.sh`
- `git`: re-clone with `git clone https://<user>:<pat>@github.com/...`

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `kubectl get nodes` shows new node `NotReady` | containerd not configured | re-run `bootstrap-node.sh` on that host |
| Pods stuck `ImagePullBackOff` after deploy | image not in registry yet | run `build-and-push.sh` again or `preload-images.sh` |
| Helm upgrade leaves old `command:` override on Deployment | manual `kubectl edit` from prior session | `kubectl patch deploy/etri-llm-backend -n llm-evaluation --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'` |
| `gpu-sweep` endpoint 404s | controller path bug (pre-v12) | rebuild + redeploy with `build-and-push.sh v12` or later |
| Operator-race failures spike | scheduler race in operator v1.0.1 | confirm `GPU_SWEEP_MIN_STAGGER_SECONDS=60` in env (default in chart) |

See also: `docs/INSTALL_AND_DEPLOY_GUIDE.md` (deeper background), `docs/USER_GUIDE.md` (user-facing operations).
