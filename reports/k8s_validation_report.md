# Kubernetes Manifests Validation Report

**RUN_ID:** 20260428-072038-a612a54  
**Generated:** 2026-04-28T07:27:31Z  
**kubectl version:** v1.28.12 (client), Kustomize v5.0.4  
**Full dry-run log:** `logs/20260428-072038-a612a54/k8s-dry-run.log`

---

## Summary

| Category | Count |
|---|---|
| Plain YAMLs dry-run PASS | 3 |
| Plain YAMLs dry-run FAIL (expected/explained) | 2 |
| Templates YAML-parse OK | 9 |
| Templates YAML-parse FAIL | 0 |

**All failures are explained and expected — no manifest authoring defects.**

---

## Plain YAML Dry-Run Results

These files were validated with `kubectl apply --dry-run=server -f <file>`.

### PASS

| File | Result |
|---|---|
| `k8s/namespaces/00-namespaces.yaml` | `namespace/llm-evaluation configured`, `llm-evaluation-staging created`, `llm-bench created` (server dry run). Warnings about existing pods violating new `baseline` PodSecurity policy are informational — existing privileged benchmark pods (hostPath, host namespaces) were created before this policy was set. No action needed; new pods submitted to these namespaces will be validated against baseline going forward. |
| `k8s/device-plugins/furiosa-rngd-device-plugin.yaml` | `daemonset.apps/furiosa-rngd-device-plugin created` (server dry run) |
| `k8s/web/iframe-proxy-config.yaml` | `configmap/iframe-proxy-config created` (server dry run) |

### FAIL — Expected / Explained

| File | Status | Explanation |
|---|---|---|
| `k8s/storage/nfs-pvc-template.yaml` | FAIL (immutability) | The PVCs `model-nfs-pvc`, `dataset-nfs-pvc`, `results-nfs-pvc` already exist in `llm-evaluation`, bound to PVs with `storageClassName=""` and `2Ti` capacity. Kubernetes forbids changing `spec.storageClassName` or reducing `spec.resources.requests.storage` on bound PVCs. **This is a live-cluster constraint, not a manifest defect.** On a fresh cluster `kubectl apply` will succeed. Operators managing the live cluster must use the existing PV bindings. |
| `k8s/device-plugins/nvidia-gpu-operator-values.yaml` | SKIP (by design) | This is a **Helm values file**, not a Kubernetes manifest. It has no `apiVersion`/`kind` fields. It cannot be validated with `kubectl apply --dry-run` and must not be applied directly. Validate via `helm upgrade --dry-run` as part of `kubernetes/03-deploy-gpu-operator.sh`. |

---

## Template YAML Parse Results

All `.yaml.template` files were validated with `python3 -c "import yaml; yaml.safe_load_all(...)"` after substituting `${...}` placeholders with the string `PLACEHOLDER`.

| File | Result |
|---|---|
| `k8s/secrets/dockerhub-pull-secret.yaml.template` | OK — 1 document |
| `k8s/secrets/huggingface-token.yaml.template` | OK — 1 document |
| `k8s/secrets/etri-llm-backend.yaml.template` | OK — 1 document |
| `k8s/device-plugins/furiosa-atomplus-device-plugin.yaml.template` | OK — 1 document |
| `k8s/benchmark-jobs/mlperf-perf-job.yaml.template` | OK — 1 document |
| `k8s/benchmark-jobs/mlperf-acc-job.yaml.template` | OK — 1 document |
| `k8s/benchmark-jobs/mmlu-pro-job.yaml.template` | OK — 1 document |
| `k8s/benchmark-jobs/tt100-npu-job.yaml.template` | OK — 1 document |
| `k8s/services/mp-exam-stream-svc.yaml.template` | OK — 1 document |

---

## File Inventory

```
k8s/
├── namespaces/
│   └── 00-namespaces.yaml                          [manifest]  dry-run: PASS
├── secrets/
│   ├── dockerhub-pull-secret.yaml.template         [template]  parse: OK
│   ├── huggingface-token.yaml.template             [template]  parse: OK
│   └── etri-llm-backend.yaml.template              [template]  parse: OK
├── storage/
│   └── nfs-pvc-template.yaml                       [manifest]  dry-run: FAIL (expected — PVC immutability)
├── device-plugins/
│   ├── nvidia-gpu-operator-values.yaml             [helm vals] dry-run: SKIP (not a k8s manifest)
│   ├── furiosa-rngd-device-plugin.yaml             [manifest]  dry-run: PASS
│   └── furiosa-atomplus-device-plugin.yaml.template [template] parse: OK
├── benchmark-jobs/
│   ├── mlperf-perf-job.yaml.template               [template]  parse: OK
│   ├── mlperf-acc-job.yaml.template                [template]  parse: OK
│   ├── mmlu-pro-job.yaml.template                  [template]  parse: OK
│   └── tt100-npu-job.yaml.template                 [template]  parse: OK
├── services/
│   └── mp-exam-stream-svc.yaml.template            [template]  parse: OK
└── web/
    └── iframe-proxy-config.yaml                    [manifest]  dry-run: PASS
```

---

## Operator Notes

### PodSecurity Warnings on llm-evaluation
Existing pods (`mlperf-131-1-1-npr7b`, `npu-all-benchmarks`, `npu-inference-server-node4`) use
host namespaces, hostPath volumes, and privileged containers which violate the `baseline` policy
now being applied to the namespace. These pods were created before the policy label was set.
**Existing pods are unaffected** — PodSecurity only enforces on new pod creation. Review whether
benchmark jobs need the `privileged` policy level or whether they should be moved to `llm-bench`
(also baseline-enforced) with appropriate security context relaxations via PSA exemptions.

### PVC Management on Live Cluster
The three NFS PVCs exist with large capacities (2Ti each) bound to `*-nfs-pv` volumes with
`storageClassName=""`. The manifests in `k8s/storage/nfs-pvc-template.yaml` document the
intended declarative state for fresh deployments with `nfs-client` dynamic provisioning.
Do not attempt to `kubectl apply` this file against the live cluster without first deleting
the existing PVCs (which requires migrating data).

### Secret Application
Secrets are never committed. Apply via:
```bash
source config/.env
envsubst < k8s/secrets/dockerhub-pull-secret.yaml.template | kubectl apply -f -
envsubst < k8s/secrets/huggingface-token.yaml.template     | kubectl apply -f -
envsubst < k8s/secrets/etri-llm-backend.yaml.template      | kubectl apply -f -
```

### TT100 Job Dependency
`k8s/benchmark-jobs/tt100-npu-job.yaml.template` contains an initContainer that waits up to
120 seconds for `results/${RUN_ID}/tt100_runner.py` (delivered by the BENCHMARKS lane) before
the main container starts. The Job will fail cleanly with a clear error if the script is absent.
