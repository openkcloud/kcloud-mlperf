# ETRI LLM Admission Webhook (env injection)

WS-D01a-ALT deliverable. Mutates Pods in the `llm-evaluation` namespace
that carry the label `etri.llm/role=benchmark` so every container
receives the env vars the benchmark / reproducibility pipeline needs:

| Env var              | Source                                              |
|----------------------|-----------------------------------------------------|
| `POD_NAME`           | Downward API (`metadata.name`)                      |
| `POD_NAMESPACE`      | Downward API (`metadata.namespace`)                 |
| `POD_UID`            | Downward API (`metadata.uid`)                       |
| `NODE_NAME`          | Downward API (`spec.nodeName`)                      |
| `IMAGE_DIGEST`       | `etri-llm-build-info` ConfigMap                     |
| `GIT_COMMIT_SHA`     | `etri-llm-build-info` ConfigMap                     |
| `HELM_RELEASE_NAME`  | `etri-llm-build-info` ConfigMap (optional)          |
| `HELM_CHART_VERSION` | `etri-llm-build-info` ConfigMap (optional)          |

The mutation also stamps an annotation on the Pod
(`etri.llm/env-injected=true`) so WS-C01 / WS-D02 reproducibility checks
can verify the webhook actually fired without inspecting container env.

## Implementation choice

**Kyverno** (CNCF-incubating policy engine).

Why Kyverno over a custom Go webhook:

* Policy is declarative YAML — see `kyverno-policy.yaml`.
* No Go code to build, sign, scan, or rotate.
* Kyverno already ships in production by hundreds of orgs and integrates
  with cert-manager (which we use for TLS).
* `failurePolicy: Ignore` is a per-policy field, matching the WS-D01a-ALT
  acceptance criterion that webhook outages must not block benchmark
  pod creation.

Files in this directory:

| File                            | Purpose                                       |
|---------------------------------|-----------------------------------------------|
| `cert-issuer.yaml`              | cert-manager Issuer + Certificate for Kyverno |
| `rbac.yaml`                     | SA + Role + ClusterRole for build-info access |
| `service.yaml`                  | Reference Service definition (Helm owns runtime) |
| `deployment.yaml`               | Helm values + reference Deployment            |
| `mutating-webhook-config.yaml`  | Reference MWC documenting the contract        |
| `kyverno-policy.yaml`           | The actual env-injection ClusterPolicies      |
| `build-info-configmap.yaml`     | ConfigMap consumed by the policy              |
| `README.md`                     | This file                                     |

## Prerequisites

1. **cert-manager v1.13+** installed cluster-wide. Verify with:
   ```bash
   kubectl get pods -n cert-manager
   kubectl get crd | grep cert-manager.io
   ```
   If missing, install:
   ```bash
   helm repo add jetstack https://charts.jetstack.io
   helm repo update
   helm upgrade --install cert-manager jetstack/cert-manager \
     --namespace cert-manager --create-namespace \
     --version v1.14.4 \
     --set installCRDs=true
   ```

2. **Helm 3.10+** on the workstation that applies these manifests.

3. **`llm-evaluation` namespace** already exists (created by
   `kubernetes/01-create-ns.sh`).

## Apply procedure (manual — DO NOT run without authorization)

> **NOT YET APPLIED.** Per WS-D01a-ALT, manifests live on disk only.
> Run these steps once cert-manager is verified and you have explicit
> approval.

```bash
cd /home/kcloud/etri-llm-deployments/app/kubernetes/admission-webhook

# 1. Create the kyverno namespace + cert-manager Issuer/Certificate.
kubectl apply -f cert-issuer.yaml

# 2. Wait for the leaf cert to be Ready before installing Kyverno
#    (Kyverno's pods will CrashLoop if the Secret does not exist yet).
kubectl wait --for=condition=Ready -n kyverno certificate/kyverno-svc-tls --timeout=120s

# 3. Install Kyverno via Helm with the values shipped in deployment.yaml.
#    Extract the values from the embedded ConfigMap:
kubectl apply -f deployment.yaml   # creates the etri-kyverno-helm-values ConfigMap
kubectl get configmap etri-kyverno-helm-values -n kyverno \
  -o jsonpath='{.data.kyverno-values\.yaml}' > /tmp/kyverno-values.yaml

helm repo add kyverno https://kyverno.github.io/kyverno/
helm repo update
helm upgrade --install kyverno kyverno/kyverno \
  --namespace kyverno --create-namespace \
  --version 3.2.6 \
  -f /tmp/kyverno-values.yaml

# 4. Wait for Kyverno to become Ready.
kubectl rollout status deployment/kyverno-admission-controller -n kyverno --timeout=180s

# 5. Apply RBAC for build-info ConfigMap reads.
kubectl apply -f rbac.yaml

# 6. Apply the build-info ConfigMap (placeholder values — your CI/CD
#    pipeline should overwrite this on every release; see
#    "How IMAGE_DIGEST and GIT_COMMIT_SHA flow" below).
kubectl apply -f build-info-configmap.yaml

# 7. Apply the actual mutation ClusterPolicies.
kubectl apply -f kyverno-policy.yaml

# 8. Confirm Kyverno reconciled the policy into a MutatingWebhookConfiguration.
kubectl get mutatingwebhookconfiguration | grep kyverno
kubectl get clusterpolicy etri-llm-env-injector -o yaml | grep -A2 -E '^\s*ready:'
```

## How `IMAGE_DIGEST` and `GIT_COMMIT_SHA` flow

The values come from the `etri-llm-build-info` ConfigMap in the
`llm-evaluation` namespace. The CI/CD pipeline that publishes a new
backend / API / operator image should populate it like this:

```bash
IMAGE_DIGEST="$(skopeo inspect docker://jungwooshim/etri-llm-backend:vXX \
  | jq -r .Digest)"
GIT_COMMIT_SHA="$(git -C /path/to/etri-llm-exam-solution rev-parse HEAD)"

kubectl -n llm-evaluation create configmap etri-llm-build-info \
  --from-literal=IMAGE_DIGEST="$IMAGE_DIGEST" \
  --from-literal=GIT_COMMIT_SHA="$GIT_COMMIT_SHA" \
  --from-literal=HELM_RELEASE_NAME="etri-llm-app" \
  --from-literal=HELM_CHART_VERSION="$(helm show chart kubernetes/app-chart | yq .version)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

## How to verify env injection works

After applying the manifests, create a throwaway pod with the trigger
label and check its env:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: env-injector-test
  namespace: llm-evaluation
  labels:
    etri.llm/role: benchmark
spec:
  restartPolicy: Never
  containers:
    - name: probe
      image: busybox:1.36
      command: ["sh", "-c", "env | grep -E '^(POD_|NODE_|IMAGE_DIGEST|GIT_COMMIT_SHA)' | sort && sleep 5"]
EOF

# Wait for completion, then read logs:
kubectl wait --for=condition=PodReadyToStartContainers \
  pod/env-injector-test -n llm-evaluation --timeout=60s
kubectl logs -n llm-evaluation env-injector-test
```

Expected output (values vary):

```
GIT_COMMIT_SHA=<sha or "unknown">
IMAGE_DIGEST=<sha256:... or "unknown">
NODE_NAME=<your node>
POD_NAME=env-injector-test
POD_NAMESPACE=llm-evaluation
POD_UID=<uuid>
```

Also confirm the mutation annotation is present:

```bash
kubectl get pod env-injector-test -n llm-evaluation \
  -o jsonpath='{.metadata.annotations.etri\.llm/env-injected}'
# -> true
```

Cleanup the probe:

```bash
kubectl delete pod env-injector-test -n llm-evaluation
```

### Negative test (label absent)

A pod WITHOUT the `etri.llm/role=benchmark` label MUST NOT be mutated:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: env-injector-negative
  namespace: llm-evaluation
spec:
  restartPolicy: Never
  containers:
    - name: probe
      image: busybox:1.36
      command: ["sh", "-c", "env | grep -E '^(POD_|NODE_|IMAGE_DIGEST)' || echo 'no injection (expected)'"]
EOF

kubectl logs -n llm-evaluation env-injector-negative
# Expected: "no injection (expected)"
kubectl delete pod env-injector-negative -n llm-evaluation
```

## How to disable / uninstall

```bash
# 1. Delete the ClusterPolicies. Kyverno will auto-prune the
#    MutatingWebhookConfiguration it generated for them.
kubectl delete -f kyverno-policy.yaml

# 2. (Optional) Remove the build-info ConfigMap + RBAC.
kubectl delete -f build-info-configmap.yaml
kubectl delete -f rbac.yaml

# 3. (Optional) Uninstall Kyverno entirely if no other policies depend on it.
helm uninstall kyverno -n kyverno
kubectl delete -f deployment.yaml         # removes the Helm-values ConfigMap
kubectl delete -f service.yaml || true    # noop after Helm uninstall
kubectl delete -f cert-issuer.yaml        # removes cert-manager Issuer + Certs

# 4. Belt-and-braces: delete any lingering MutatingWebhookConfigurations
#    that mention env-injector (in case Kyverno was force-removed).
kubectl get mutatingwebhookconfiguration -o name \
  | grep -E '(kyverno|env-injector)' \
  | xargs -r kubectl delete

# 5. Drop the kyverno namespace.
kubectl delete namespace kyverno
```

## Operational notes / known gaps

* **Background reconciliation is OFF.** Env vars on already-running pods
  cannot be mutated -- the policy only fires at admission time. To
  refresh `IMAGE_DIGEST` on existing benchmark pods, delete them and
  let the controller (WS-C01) recreate them.
* **`failurePolicy: Ignore`** is a deliberate WS-D01a-ALT requirement.
  If the webhook is unavailable, benchmark pods will start WITHOUT the
  injected env vars. WS-C01's reproducibility check should treat absence
  of the `etri.llm/env-injected=true` annotation as a soft warning and
  surface it in the run report.
* **Kyverno owns the live `MutatingWebhookConfiguration`.** The
  `mutating-webhook-config.yaml` in this directory is for
  audit / disaster-recovery only. Do not `kubectl apply` it while
  Kyverno is the active engine.
* **Manifests are NOT applied yet.** Per task scope, files are on disk
  only. Apply requires (a) cert-manager installed, (b) explicit user
  authorization, (c) the procedure above followed in order.
* **CI/CD population of `etri-llm-build-info` is NOT yet wired up.**
  Until the release pipeline is updated to run the `kubectl create
  configmap ... --dry-run | kubectl apply` command shown above, the
  injected env vars `IMAGE_DIGEST` and `GIT_COMMIT_SHA` will resolve to
  the literal string `unknown`. This is acceptable for initial rollout
  -- the schema is in place for downstream pipelines to populate later.

## References

* WS-D01a-ALT acceptance criteria: see mega-plan v2.2, AG-9b.
* Kyverno docs: <https://kyverno.io/docs/>
* cert-manager docs: <https://cert-manager.io/docs/>
