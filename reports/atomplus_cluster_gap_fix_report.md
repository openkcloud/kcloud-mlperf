# Atom+ Cluster Gap Fix — Lane A Report

**RUN_ID**: 20260429-071649-46d82f8
**Operator**: agent driving from node1 via key-auth SSH `kcloud@node5` (key fingerprint `SHA256:T2cdY1VEsvkUHQnGbYnLpEMyTSkZLM7MiljIIGneShY`)
**Pre-state checkpoint**: `/home/kcloud/etri-llm-exam-solution/.omc/checkpoints/20260429-071649-46d82f8/`

## Outcome — what changed

| # | Step | Cluster state before | Cluster state after | Evidence |
|---|---|---|---|---|
| 1 | Backup `/etc/containerd/config.toml` on node5 | unmodified | `/etc/containerd/config.toml.bak.20260429-071649` (also `.bak2` from `sed -i.bak2`) | `ls -la /etc/containerd/config.toml*` |
| 2 | `enable_cdi = false` → `true` on node5 (line 54) | gap A | `crictl info` shows `enableCDI: true` | `sudo crictl info` |
| 3 | `systemctl restart containerd` on node5 | running | running, kubelet still active, ~7 system pods auto-restarted | `systemctl is-active` |
| 4 | `mkdir -p /etc/cdi` | absent | exists, populated at runtime | `ls /etc/cdi` |
| 5 | `helm repo add rebellions https://rbln-sw.github.io/rbln-npu-operator` | not present | added; chart `rbln-npu-operator v0.3.3` available | `helm search repo rebellions` |
| 6 | `helm install rbln-npu-operator -n rbln-system --create-namespace` | gap B | rev 1 deployed | `helm status` |
| 7 | `helm upgrade --reuse-values --set driver.enabled=false` | rev 1 (driver pod CrashLoopBackOff) | rev 2 (driver DaemonSet not deployed; host kernel module `rebellions 2.0.1` already loaded) | `helm history rbln-npu-operator -n rbln-system` |
| 8 | `kubectl uncordon node5` | `Ready,SchedulingDisabled` | `Ready` | `kubectl get node node5` |
| 9 | Smoke pod `rbln-smoke` with `requests.rebellions.ai/ATOM: 1` | n/a | scheduled in 5s, Running, `/dev/rbln1` injected via CDI, env `PCI_RESOURCE_REBELLIONS_AI_ATOM=0000:c4:00.0` | `kubectl logs rbln-smoke` |

## Gates closed by Lane A

| Gate | Status | Evidence |
|---|---|---|
| **G1** Readiness report imported | ✅ PASS | SCP succeeded after key install; saved at `/home/kcloud/rbln-node5-cluster-readiness.md` (9701 bytes); summary at `reports/node5_atomplus_readiness_report_imported.md` |
| **G2** node5 readiness revalidated | ✅ PASS | Live-verified: `rbln-smi` shows 2× RBLN-CA22, KMD 2.0.1, both idle (P14, ~18-19W, 34-37°C); Python `import rebel; rebel.device_count()` → 2; kernel module `rebellions` loaded (548864 bytes); PCI BDFs `0000:c3:00.0`, `0000:c4:00.0` |
| **G3** Atom+ runtime status | ✅ READY_K8S_DEVICE_PLUGIN | Real plugin running, allocatable advertised, end-to-end schedule proven |
| **G4** containerd CDI fixed | ✅ PASS | `crictl info` reports `enableCDI: True` |
| **G5** rbln-npu-operator installed | ✅ PASS (5 of 6 enabled DaemonSets healthy) | `helm status` deployed; rbln-container-toolkit + rbln-device-plugin + rbln-metrics-exporter + rbln-npu-feature-discovery + rbln-operator-validator + controller-manager all Running |
| **G6** node5 uncordoned after verification | ✅ PASS | `kubectl get node node5` → `Ready` (no `SchedulingDisabled`) |
| **G7** Allocatable Rebellions resource visible | ✅ PASS | `kubectl get node node5 -o jsonpath='{.status.allocatable.rebellions\.ai/ATOM}'` → `2` |
| **G9** Atom+ Kubernetes execution path | ✅ PARTIAL — scheduling+CDI proven; vllm-rbln image still TBD | Smoke pod logs prove device injection works |

## Outstanding non-blocking issues from Lane A

| Issue | Severity | Why it doesn't block benchmarks | Next step |
|---|---|---|---|
| `rbln-daemon` DaemonSet `ImagePullBackOff` (image `repo.rebellions.ai/rebellions/rbln-daemon`, needs `drivercred` secret) | medium | rbln-daemon is the user-space management daemon for telemetry/control; benchmarks via `rebellions.ai/ATOM` resource don't depend on it being in-cluster (host has it via apt pkg `rbln-sdk 0.10.1`) | Create `drivercred` Docker pull secret with credentials from Rebellions, OR set `rbln-daemon.enabled=false` |
| `rbln-driver` DaemonSet disabled | low (intended) | Host already has driver `2.0.1` from apt + kernel module loaded | Keep `driver.enabled=false` for the lifetime of this manual install |
| `rbln-metrics-exporter` was CrashLoopBackOff initially, now Running | resolved | needed time to settle | none |
| Resource name in app code is `rebellions.ai/atomplus` but real name is `rebellions.ai/ATOM` | high (code-level) | Doesn't block infra; blocks `/api/devices` from showing live Atom+ device | Lane B fix in `server/src/device-registry/` |

## Critical new finding for Lane C (benchmark execution)

```
ssh node5 'sudo crictl pull rbln/vllm-rbln:0.9.3.post2'
→ docker.io/rbln/vllm-rbln:0.9.3.post2
→ pull access denied, repository does not exist or may require authorization
```

The image cited in §5 of the readiness report **does not exist on public Docker Hub**. Three plausible paths:

1. **Build from source**: clone `https://github.com/rebellions-sw/vllm-rbln`, build a container layered on `python:3.11-slim` with `pip install vllm-rbln==0.9.3.post2 vllm==0.10.2 optimum-rbln==0.9.3.post1 transformers==4.57.1 torch==2.8.0`. ~10–20 min build.
2. **Use Rebellions' private registry**: image likely lives at `repo.rebellions.ai/rebellions/vllm-rbln:<tag>` and needs credentials. Requires user to provide a Docker pull secret.
3. **Run vllm-rbln directly on node5 host** (not in a container) for the smoke benchmark — the host already has all wheels pip-installed. This bypasses the K8s scheduling path but lets us measure TT100T immediately. Less production-like; useful as a calibration baseline.

**Recommended**: option 1 (build a custom image) for repeatable benchmarking. Option 3 first to get a TT100T number quickly. The Job template in `infra/k8s/benchmark-jobs/` will parameterize the image so swapping later is trivial.

## Rerun + rollback

**Rerun this lane (idempotent)**:

```bash
# CDI is already enabled — no-op if rerun
ssh node5 'sudo grep -E "enable_cdi" /etc/containerd/config.toml'

# helm install (idempotent via upgrade)
helm repo add rebellions https://rbln-sw.github.io/rbln-npu-operator
helm repo update
helm upgrade --install rbln-npu-operator rebellions/rbln-npu-operator \
  -n rbln-system --create-namespace \
  --set driver.enabled=false \
  --wait

# Uncordon (idempotent)
kubectl uncordon node5

# Verify
kubectl get node node5 -o jsonpath='{.status.allocatable.rebellions\.ai/ATOM}'
# Expect: 2
```

**Rollback**:

```bash
# Cordon node5
kubectl cordon node5

# Uninstall operator
helm uninstall rbln-npu-operator -n rbln-system
kubectl delete namespace rbln-system

# Disable CDI on node5 + restart containerd
ssh node5 'sudo cp /etc/containerd/config.toml.bak.20260429-071649 /etc/containerd/config.toml && sudo systemctl restart containerd'

# Verify
kubectl get node node5 -o jsonpath='{.status.allocatable}'
# Expect: no rebellions.ai/ATOM key
```

## Next steps (Lane B/C)

1. Resolve vllm-rbln image (option 1 or 2 from above) — this is now the gating blocker for actual TT100T measurement.
2. Update app code to use `rebellions.ai/ATOM` (not `atomplus`) — `server/src/device-registry/`, `server/src/comparison/`, `web/src/pages/npu-eval/atomplus/`.
3. Drop in `infra/k8s/benchmark-jobs/atomplus-vllm-bench-job.yaml.template` based on §5 of the readiness report.
4. Run smoke benchmark, ingest, verify on `/npu-eval/atomplus`, populate comparison.
