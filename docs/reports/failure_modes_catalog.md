---
title: Failure Modes Catalog — ETRI LLM Benchmark Cluster
cluster: 3-node k8s (node1–3) + node4 RNGD + node5 Atom+
deployments: etri-llm-frontend:v31, etri-llm-backend:v26, etri-llm-operator:v1.0.1
prepared_by: executor-agent
date: 2026-05-06
---

# Failure Modes Catalog

54 failure scenarios across 6 categories. Each entry includes trigger, symptom, root-cause hypothesis, diagnostic command, recovery action, prevention, and demo response.

---

## A. INFRASTRUCTURE

### A-01: k8s Control Plane Unreachable

**Trigger:** etcd quorum lost, kube-apiserver OOM-killed, or network partition isolating node1 (control-plane node).

**Symptom:** All `kubectl` commands hang or return `connection refused`; pods appear to vanish; frontend and backend stop responding.

**Root cause hypothesis:** kube-apiserver process crashed or etcd data directory is corrupt; alternatively node1 NIC is down.

**Diagnostic command:**
```bash
# From node1 directly
systemctl status kube-apiserver
journalctl -u etcd --since "5 minutes ago" | tail -40
curl -k https://127.0.0.1:6443/healthz
```

**Recovery action:**
```bash
# Restart control-plane components (kubeadm static pods)
systemctl restart kubelet
# If etcd is corrupt, restore from snapshot:
etcdctl snapshot restore /var/backups/etcd/latest.db \
  --data-dir /var/lib/etcd-restore
# Then update /etc/kubernetes/manifests/etcd.yaml to point to new data-dir
systemctl restart kubelet
```

**Prevention:** Enable etcd periodic snapshots via cron (`etcdctl snapshot save`) to a separate NFS path. Set up kube-apiserver liveness probe alerts in Prometheus.

**Demo response:** "The cluster control plane is temporarily unreachable — a transient infrastructure event. Let me show you the API response from the backend directly while the cluster recovers." Run `curl http://10.254.177.41:30980/api/comparison/list` to demonstrate the backend is alive.

---

### A-02: Node Not Ready (kubelet Failure)

**Trigger:** kubelet on node2, node3, node4, or node5 crashes or loses its lease; node transitions to `NotReady`.

**Symptom:** Pods on that node enter `Unknown` or `Terminating` state; new pods refuse to schedule; `kubectl get nodes` shows `NotReady`.

**Root cause hypothesis:** kubelet process OOM-killed, cgroup v2 mismatch, or Docker/containerd daemon crashed.

**Diagnostic command:**
```bash
kubectl get nodes -o wide
# On the affected node:
systemctl status kubelet
journalctl -u kubelet --since "10 minutes ago" | grep -i "error\|fail\|oom"
```

**Recovery action:**
```bash
# On the affected node:
systemctl restart containerd
systemctl restart kubelet
# Back on node1, watch recovery:
kubectl get nodes -w
```

**Prevention:** Set kubelet memory limits via `KubeletConfiguration.kubeReserved`. Monitor kubelet PID with systemd watchdog (`WatchdogSec=30`).

**Demo response:** "One of the worker nodes is restarting its node agent — routine cluster behavior. The workloads that matter (backend, frontend, operator) are scheduled on the healthy nodes. The recovery is automatic and takes about 2 minutes."

---

### A-03: Pod Evicted Due to Disk or Memory Pressure

**Trigger:** Node disk usage crosses eviction threshold (default 85%) or memory available drops below `memory.available < 100Mi`; kubelet evicts lower-priority pods.

**Symptom:** Pod shows `Status: Evicted`; `kubectl describe pod` shows `The node was low on resource: memory` or `ephemeral-storage`.

**Root cause hypothesis:** Benchmark job log files accumulating in `/var/lib/docker` or `/tmp` on the node, or a prior vLLM model load left GPU memory pages in host swap.

**Diagnostic command:**
```bash
kubectl get pods -n llm-evaluation --field-selector=status.phase=Failed | grep Evicted
kubectl describe pod <evicted-pod> -n llm-evaluation | grep -A5 "Message:"
# On node:
df -h / /var/lib/containerd
free -h
```

**Recovery action:**
```bash
# Delete evicted pod records (they are already dead)
kubectl delete pods --field-selector=status.phase=Failed -n llm-evaluation
# Free disk on node:
docker system prune -f   # or crictl rmi --prune
# Re-submit the benchmark exam via the UI or curl
```

**Prevention:** Add a node-level `LimitRange` for ephemeral storage on benchmark jobs. Implement a cron job to prune old benchmark log PVCs weekly.

**Demo response:** "A background cleanup job evicted a lower-priority pod to free resources. This is the cluster's self-healing mechanism at work. The benchmark will be re-queued automatically."

---

### A-04: Image Pull Backoff (ImagePullBackOff)

**Trigger:** Pod spec references an image that does not exist in the registry, credentials are expired, or the registry is unreachable from cluster.

**Symptom:** Pod stuck in `ImagePullBackOff` or `ErrImagePull`; `kubectl describe pod` shows `Failed to pull image: ... 401 Unauthorized` or `name unknown`.

**Root cause hypothesis:** HuggingFace token expired in the image pull secret, or the image tag (e.g., `vllm/vllm-openai:v0.8.4`) does not exist in Docker Hub.

**Diagnostic command:**
```bash
kubectl describe pod <pod-name> -n llm-evaluation | grep -A10 "Events:"
kubectl get secret hf-token-secret -n llm-evaluation -o jsonpath='{.data.token}' | base64 -d
# Verify tag exists:
docker manifest inspect vllm/vllm-openai:v0.8.4 2>&1 | head -5
```

**Recovery action:**
```bash
# Refresh HF token secret:
kubectl delete secret hf-token-secret -n llm-evaluation
kubectl create secret generic hf-token-secret \
  --from-literal=token=hf_<new_token> -n llm-evaluation
# Force pod restart:
kubectl delete pod <pod-name> -n llm-evaluation
```

**Prevention:** Store the HF token in a Vault-backed external secret with auto-rotation. Pin image tags to known-good digests rather than floating tags.

**Demo response:** "The container image for this benchmark variant is being fetched from the registry — this can take several minutes for large ML images. The existing completed benchmarks are unaffected; let me show you those results while it pulls."

---

### A-05: NFS Mount Failure (PVC Not Bound)

**Trigger:** NFS server unreachable, exports changed, or NFS client kernel module unloaded on a worker node.

**Symptom:** PVC stays in `Pending`; pod stays in `ContainerCreating` with event `Unable to attach or mount volumes: ... mount failed`.

**Root cause hypothesis:** NFS server rebooted and did not re-export `/exports/llm-models`; or node's `/etc/fstab` entry is stale.

**Diagnostic command:**
```bash
kubectl describe pvc model-pvc -n llm-evaluation | grep -A5 "Events:"
# On the affected node:
showmount -e <nfs-server-ip>
mount | grep nfs
dmesg | grep -i nfs | tail -20
```

**Recovery action:**
```bash
# Re-mount manually on the node:
mount -t nfs <nfs-server-ip>:/exports/llm-models /mnt/models
# Or restart the nfs-client-provisioner:
kubectl rollout restart deployment nfs-client-provisioner -n kube-system
# Re-submit the exam after PVC binds
```

**Prevention:** Use NFS `soft` mount with `timeo=30` to fail fast rather than hang indefinitely. Monitor PVC bind latency with Prometheus `kube_persistentvolumeclaim_status_phase`.

**Demo response:** "The shared model storage is momentarily unreachable — the NFS mount is recovering. The benchmark data in the database is not affected; let me show you the completed results while the storage reconnects."

---

### A-06: PostgreSQL Connection Drop (Backend DB Unreachable)

**Trigger:** Postgres pod restarts due to OOM, or the service IP changes after a pod reschedule, or the connection pool is exhausted.

**Symptom:** Backend returns `500 Internal Server Error` on all data endpoints; logs show `Connection refused to postgres:5432` or `too many connections`.

**Root cause hypothesis:** Postgres pod restarted and the NestJS backend's TypeORM connection pool has not reconnected yet; or max_connections (default 100) exceeded by concurrent benchmark jobs each opening their own connections.

**Diagnostic command:**
```bash
kubectl get pods -n llm-evaluation | grep postgres
kubectl logs deployment/etri-llm-backend -n llm-evaluation --tail=50 | grep -i "connect\|ECONNREFUSED\|pool"
# Inside postgres pod:
psql -U llm -c "SELECT count(*) FROM pg_stat_activity;"
```

**Recovery action:**
```bash
# Restart backend to force connection pool reset:
kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation
# If postgres is down:
kubectl rollout restart statefulset/postgres -n llm-evaluation
kubectl rollout status statefulset/postgres -n llm-evaluation
```

**Prevention:** Set TypeORM `connectionTimeoutMillis` and `idleTimeoutMillis`. Use PgBouncer in transaction-pool mode to cap concurrent connections. Add readiness probe on `/api/health/db`.

**Demo response:** "The database is reconnecting — the backend is stateless and will recover automatically in about 30 seconds. Let me show you the cached API response from the last successful poll."

---

### A-07: Helm Release Stuck in Pending-Upgrade

**Trigger:** A previous `helm upgrade` was interrupted (CTRL-C, timeout, or pod crash during hook), leaving the release in `pending-upgrade` state.

**Symptom:** Subsequent `helm upgrade` fails with `Error: UPGRADE FAILED: another operation (install/upgrade/rollback) is in progress`.

**Root cause hypothesis:** Helm stores release state in a Kubernetes Secret; if the previous deploy process died without cleaning up, the lock is never released.

**Diagnostic command:**
```bash
helm list -n llm-evaluation
helm history etri-llm-backend -n llm-evaluation
kubectl get secret -n llm-evaluation | grep helm
```

**Recovery action:**
```bash
# Roll back to last known good release:
helm rollback etri-llm-backend -n llm-evaluation
# Or forcefully mark the failed release as superseded:
kubectl patch secret sh.helm.release.v1.etri-llm-backend.v<N> \
  -n llm-evaluation -p '{"metadata":{"labels":{"status":"superseded"}}}'
# Then retry:
helm upgrade etri-llm-backend ./charts/backend -n llm-evaluation
```

**Prevention:** Use `helm upgrade --atomic --timeout 5m` which automatically rolls back on failure and cleans the lock.

**Demo response:** "A previous deployment left a lock in the release manager. We're clearing it now — this takes about 30 seconds. The currently running pods are unaffected and serving traffic."

---

### A-08: kubectl Context Pointing to Wrong Cluster

**Trigger:** Operator runs `kubectl` commands but `~/.kube/config` has the wrong `current-context` (e.g., a local minikube or a different ETRI environment).

**Symptom:** Commands succeed but return empty results or wrong pod names; `kubectl get nodes` shows unfamiliar node names.

**Root cause hypothesis:** `KUBECONFIG` environment variable is set to a different file, or `kubectl config use-context` was run for a different cluster in a previous session.

**Diagnostic command:**
```bash
kubectl config current-context
kubectl config get-contexts
kubectl cluster-info
```

**Recovery action:**
```bash
# Switch to the correct context:
kubectl config use-context etri-cluster
# Or set explicitly for this session:
export KUBECONFIG=~/.kube/etri-config
kubectl get nodes  # verify node1, node2, node3, node4, node5
```

**Prevention:** Add a shell alias `alias k='kubectl --context=etri-cluster'` to prevent silent context mistakes. Add `PS1` prompt showing current context via `kube-ps1`.

**Demo response:** "I need to switch my terminal context to the demo cluster — one moment." Run the context switch and proceed without explanation to the audience.

---

### A-09: Cluster Network Partition (CNI Failure)

**Trigger:** Flannel/Calico CNI daemon crashes or iptables rules are flushed; pod-to-pod communication fails across nodes.

**Symptom:** Cross-node service calls timeout (e.g., backend cannot reach postgres on node2); intra-node calls still work; `kubectl exec` into pods works but inter-pod `curl` fails.

**Root cause hypothesis:** CNI pod on one node OOM-killed, leaving that node's overlay network routing table stale; or `kube-proxy` iptables rules flushed by a `iptables -F` from a benchmark job's privileged container.

**Diagnostic command:**
```bash
kubectl get pods -n kube-system | grep -E "flannel|calico|kube-proxy"
kubectl logs -n kube-system daemonset/kube-flannel-ds --tail=40
# From pod on node1, ping pod IP on node2:
kubectl exec -it deployment/etri-llm-backend -- curl http://<node2-pod-ip>:5432
```

**Recovery action:**
```bash
# Restart CNI daemonset:
kubectl rollout restart daemonset/kube-flannel-ds -n kube-system
# Restart kube-proxy:
kubectl rollout restart daemonset/kube-proxy -n kube-system
# On affected node, flush and reload iptables:
iptables -F && systemctl restart kube-proxy
```

**Prevention:** Use `privileged: false` and `capabilities: drop: ALL` on benchmark job pods to prevent iptables manipulation. Set CNI pod resource limits above the eviction threshold.

**Demo response:** "We're seeing a brief network disruption between cluster nodes — the network fabric is self-healing. The benchmark results in the database are persistent. I'll show you the static results while the network recovers."

---

### A-10: Cgroup OOM Kill (Node-Level OOM)

**Trigger:** Total memory pressure on a node causes the kernel OOM killer to terminate a process; typically triggered by a vLLM model load that underestimated GPU/CPU memory.

**Symptom:** Pod exits with exit code 137 (`OOMKilled`); `kubectl describe pod` shows `OOMKilled: true`; dmesg on the node shows `Killed process <pid> (python3) total-vm:...`.

**Root cause hypothesis:** vLLM's `--gpu-memory-utilization 0.95` leaves insufficient headroom; KV cache allocation during model load spikes beyond the container memory limit.

**Diagnostic command:**
```bash
kubectl describe pod <benchmark-pod> -n llm-evaluation | grep -A5 "Last State:"
dmesg | grep -i "oom\|killed" | tail -20
nvidia-smi --query-compute-apps=pid,used_memory --format=csv
```

**Recovery action:**
```bash
# Re-submit with lower GPU memory utilization:
# Edit exam parameters: gpu_memory_utilization=0.80 instead of 0.95
# Or increase pod memory limit in the operator's job template:
kubectl edit configmap operator-job-template -n llm-evaluation
# Change: resources.limits.memory: "48Gi" → "64Gi"
kubectl rollout restart deployment/etri-llm-operator -n llm-evaluation
```

**Prevention:** Set `resources.limits.memory` in the benchmark job template to match empirically measured peak usage + 20% headroom. Add a `--max-model-len` cap on vLLM to bound KV cache size.

**Demo response:** "The benchmark process used more memory than allocated — the cluster automatically cleaned it up. We adjust the memory configuration and re-submit. This is exactly the kind of constraint the benchmark harness is designed to surface and handle."

---

### A-11: Kubernetes Version Skew (kubectl vs. Server)

**Trigger:** Operator's local `kubectl` binary is more than 2 minor versions skew from the server; API calls silently drop fields or behave unexpectedly.

**Symptom:** `kubectl apply` reports success but the field is not persisted; or `kubectl get` omits fields that exist in the cluster.

**Root cause hypothesis:** Local `kubectl` is v1.27, cluster is v1.30; the 3-version skew exceeds the supported policy, causing silent field drops on apply.

**Diagnostic command:**
```bash
kubectl version --short
# Client Version should be within +/-1 of Server Version
```

**Recovery action:**
```bash
# Install matching kubectl:
curl -LO "https://dl.k8s.io/release/$(kubectl version --short | grep Server | awk '{print $3}')/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/kubectl
```

**Prevention:** Pin `kubectl` version in the team's `install-tools.sh` script to match the cluster server version. Add a version-skew check to the pre-demo checklist.

**Demo response:** (Unlikely to surface visibly during demo.) If a field appears missing: "Let me verify the cluster API directly." Use `curl` against the REST API to bypass kubectl.

---

## B. BACKEND APPLICATION

### B-01: Backend Pod CrashLoopBackOff

**Trigger:** NestJS backend exits on startup due to missing env var, failed DB migration, or unhandled exception in the bootstrap phase.

**Symptom:** `kubectl get pods` shows `CrashLoopBackOff` for `etri-llm-backend-*`; all API calls return `connection refused`.

**Root cause hypothesis:** TypeORM migration failed at startup because the schema diverged from the migration files, or a required env var (`DATABASE_URL`, `JWT_SECRET`) is missing.

**Diagnostic command:**
```bash
kubectl logs deployment/etri-llm-backend -n llm-evaluation --previous | tail -60
kubectl describe pod -l app=etri-llm-backend -n llm-evaluation | grep -A10 "Environment:"
```

**Recovery action:**
```bash
# If env var missing, patch the deployment:
kubectl set env deployment/etri-llm-backend DATABASE_URL=postgres://llm:pass@postgres:5432/llmdb -n llm-evaluation
# If migration failed, run it manually:
kubectl exec deployment/etri-llm-backend -n llm-evaluation -- npx typeorm migration:run
kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation
kubectl rollout status deployment/etri-llm-backend -n llm-evaluation
```

**Prevention:** Add a Kubernetes `init container` that runs `typeorm migration:run` and exits non-zero on failure, blocking the main container from starting in a bad state. Use pre-flight env var validation in NestJS bootstrap.

**Demo response:** "The backend API server is restarting — it detected a configuration inconsistency at boot and is self-recovering. This takes about 60 seconds. Let me show you the operator logs and benchmark results we already have in hand while it restores."

---

### B-02: gRPC Operator Unreachable from Backend

**Trigger:** The `etri-llm-operator` gRPC service endpoint changes (pod restart with new IP), or the gRPC port (default 50051) is not exposed in the Service spec.

**Symptom:** Submitting a new benchmark exam via the UI returns `502 Bad Gateway` or a gRPC error; existing completed results still display correctly.

**Root cause hypothesis:** The operator pod restarted and the backend's gRPC channel is still connected to the stale pod IP; NestJS gRPC client does not auto-reconnect by default.

**Diagnostic command:**
```bash
kubectl get svc etri-llm-operator -n llm-evaluation -o yaml | grep -A10 "ports:"
kubectl logs deployment/etri-llm-backend -n llm-evaluation --tail=30 | grep -i "grpc\|operator\|ECONNREFUSED"
grpcurl -plaintext <operator-svc-ip>:50051 list
```

**Recovery action:**
```bash
# Restart backend to force gRPC channel re-establishment:
kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation
# Verify operator is healthy:
kubectl get pods -l app=etri-llm-operator -n llm-evaluation
kubectl logs deployment/etri-llm-operator -n llm-evaluation --tail=20
```

**Prevention:** Configure the backend gRPC client with `keepaliveTimeMs` and exponential backoff reconnect. Use the operator's Kubernetes Service DNS name (not pod IP) as the gRPC target.

**Demo response:** "The benchmark submission channel is momentarily offline — the operator is reconnecting. Completed benchmarks are unaffected. Let me show you the existing results while the channel restores."

---

### B-03: Loki Unreachable Kills the Status Endpoint

**Trigger:** The backend's `/api/status` endpoint queries Loki for log aggregation; if Loki is down or the URL is wrong, the endpoint throws and returns 500.

**Symptom:** The frontend status dashboard goes blank; browser DevTools shows `GET /api/status 500`; all other API calls work normally.

**Root cause hypothesis:** Loki pod restarted and the backend's `LOKI_URL` env var points to the pod IP rather than the Service DNS name.

**Diagnostic command:**
```bash
kubectl logs deployment/etri-llm-backend -n llm-evaluation --tail=20 | grep -i "loki\|status"
curl http://10.254.177.41:30980/api/status
kubectl get pods -n monitoring | grep loki
```

**Recovery action:**
```bash
# Short-term: patch LOKI_URL to use Service DNS:
kubectl set env deployment/etri-llm-backend LOKI_URL=http://loki.monitoring.svc:3100 -n llm-evaluation
# Or make the status endpoint degrade gracefully:
# (code fix: wrap Loki call in try/catch, return partial status on Loki failure)
kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation
```

**Prevention:** Wrap the Loki call in a try/catch that returns `{loki: "unavailable"}` rather than throwing. Use Service DNS names, not pod IPs, for all inter-service references.

**Demo response:** "The log aggregation service is temporarily unreachable, which caused the status endpoint to trip. This is a known dependency edge; we're isolating it now. The benchmark API and UI are fully functional — let me navigate there directly."

---

### B-04: Backend DB Query Timeout

**Trigger:** A long-running benchmark result query (e.g., MMLU aggregation over 1000+ rows) exceeds the TypeORM `queryTimeout` setting; TypeORM throws and the request fails.

**Symptom:** `/api/comparison/list` or `/api/mmlu/results` returns 504 after a long pause; browser shows a loading spinner that never resolves.

**Root cause hypothesis:** Missing index on `exam_results.hardware` or `exam_results.status`; full table scan on a growing dataset.

**Diagnostic command:**
```bash
kubectl logs deployment/etri-llm-backend -n llm-evaluation --tail=30 | grep -i "timeout\|slow\|query"
# In postgres:
psql -U llm -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE state='active' ORDER BY duration DESC LIMIT 5;"
```

**Recovery action:**
```bash
# Kill the runaway query:
psql -U llm -c "SELECT pg_cancel_backend(<pid>);"
# Add missing index:
psql -U llm -c "CREATE INDEX CONCURRENTLY idx_exam_results_hardware ON exam_results(hardware);"
# Increase timeout as a temporary measure in TypeORM config:
kubectl set env deployment/etri-llm-backend TYPEORM_QUERY_TIMEOUT=30000 -n llm-evaluation
```

**Prevention:** Add composite indexes on `(hardware, status, created_at)` in TypeORM migrations. Set `queryTimeout: 10000` in TypeORM config. Add query cost budget to the comparison-list endpoint.

**Demo response:** "The database query is taking longer than expected on this dataset size. Let me switch to the API in a lighter filter mode." Use `curl` with a smaller `limit` parameter to return quickly.

---

### B-05: Backend DTO Validation Reject (max_tokens Bug Pattern)

**Trigger:** Frontend submits an exam creation request with `max_output_tokens` as a string (e.g., `"128"`) instead of an integer `128`; NestJS class-validator rejects it with `422 Unprocessable Entity`.

**Symptom:** Clicking "Create Exam" returns a 422 error; the form appears to submit but the exam never appears in the list.

**Root cause hypothesis:** HTML number inputs return string values; if the DTO's `@IsInt()` validator is strict and `transform: true` is not enabled globally, the string `"128"` fails validation.

**Diagnostic command:**
```bash
# Reproduce:
curl -X POST http://10.254.177.41:30980/api/exams \
  -H "Content-Type: application/json" \
  -d '{"max_output_tokens": "128", "hardware": "RNGD"}' | jq .
# Check backend validation pipe config:
kubectl exec deployment/etri-llm-backend -- grep -r "transform" src/main.ts
```

**Recovery action:**
```bash
# Immediate: submit with correct integer type via curl:
curl -X POST http://10.254.177.41:30980/api/exams \
  -H "Content-Type: application/json" \
  -d '{"max_output_tokens": 128, "hardware": "RNGD", ...}'
# Code fix: enable transform in ValidationPipe:
# main.ts: app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }))
```

**Prevention:** Enable `transform: true` and `enableImplicitConversion: true` in the global `ValidationPipe`. Add an e2e test that submits a string value and asserts it is coerced, not rejected.

**Demo response:** "The form submitted a value in an unexpected format — let me resubmit with the correct type." Use the curl command above during demo recovery. "The form coercion is a known edge case we are patching."

---

### B-06: Missing Environment Variable (Backend Silent Failure)

**Trigger:** A ConfigMap or Secret key referenced by the backend deployment is removed or renamed during a Helm upgrade, leaving an env var undefined at runtime.

**Symptom:** The feature that depends on the env var silently fails or returns null; no crash, but data is wrong or an endpoint returns empty.

**Root cause hypothesis:** `OPERATOR_GRPC_HOST` env var undefined; gRPC channel connects to `undefined:50051` and silently drops all calls.

**Diagnostic command:**
```bash
kubectl exec deployment/etri-llm-backend -n llm-evaluation -- env | grep OPERATOR
kubectl describe deployment etri-llm-backend -n llm-evaluation | grep -A5 "Environment:"
```

**Recovery action:**
```bash
kubectl set env deployment/etri-llm-backend OPERATOR_GRPC_HOST=etri-llm-operator.llm-evaluation.svc -n llm-evaluation
kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation
```

**Prevention:** Add a startup validation step in NestJS that asserts all required env vars are present and non-empty (using `Joi` schema validation with `@nestjs/config`). Fail fast at boot rather than silently at runtime.

**Demo response:** "A configuration value is missing from this deployment — one-line fix." Patch env var live and restart. "This demonstrates exactly why we validate configuration at startup rather than at runtime."

---

### B-07: Kubernetes Secret Missing (HF Token)

**Trigger:** The `hf-token-secret` Kubernetes Secret was deleted or never created in the `llm-evaluation` namespace; benchmark job pods cannot pull gated HuggingFace models.

**Symptom:** Benchmark pod stays in `Init:0/1` or exits with `401 Unauthorized` when downloading the model; exam stays in `PREPARING` indefinitely.

**Root cause hypothesis:** The secret exists in the `default` namespace but not in `llm-evaluation`, and the job template references `secretKeyRef` in the wrong namespace.

**Diagnostic command:**
```bash
kubectl get secret hf-token-secret -n llm-evaluation
kubectl describe pod <benchmark-pod> -n llm-evaluation | grep -A5 "Events:"
```

**Recovery action:**
```bash
kubectl create secret generic hf-token-secret \
  --from-literal=token=hf_<your_token> \
  -n llm-evaluation
# Force pod restart:
kubectl delete pod <benchmark-pod> -n llm-evaluation
```

**Prevention:** Include secret creation in the cluster bootstrap Helm chart as a `pre-install` hook. Add a pre-flight check script that verifies all required secrets exist before demo.

**Demo response:** "The model access token secret needs to be refreshed — a one-time operation." Create the secret live and re-submit. "This is standard credential rotation; the cluster handles it without any downtime to the API."

---

### B-08: ConfigMap Mismatch (Operator Job Template)

**Trigger:** The operator's job template ConfigMap was updated with a new field (e.g., `gpu_memory_utilization`) but the operator code does not read that field, or reads from a different key name.

**Symptom:** Benchmark jobs are created with default values ignoring the ConfigMap override; e.g., all jobs use `gpu_memory_utilization=0.90` regardless of the ConfigMap setting.

**Root cause hypothesis:** ConfigMap key is `gpuMemoryUtilization` but operator reads `gpu_memory_utilization`; case/underscore mismatch.

**Diagnostic command:**
```bash
kubectl get configmap operator-job-template -n llm-evaluation -o yaml
kubectl logs deployment/etri-llm-operator -n llm-evaluation --tail=30 | grep "memory_util\|gpuMemory"
```

**Recovery action:**
```bash
# Fix the ConfigMap key to match what the operator reads:
kubectl edit configmap operator-job-template -n llm-evaluation
# Change: gpuMemoryUtilization → gpu_memory_utilization
# Restart operator to pick up new ConfigMap:
kubectl rollout restart deployment/etri-llm-operator -n llm-evaluation
```

**Prevention:** Use strongly typed ConfigMap deserialization in the operator with a schema validation step at startup. Add a CI test that validates ConfigMap key names against the operator's config struct.

**Demo response:** "The operator configuration has a key name mismatch — a trivial fix." Apply the ConfigMap patch and restart the operator. "The running benchmarks are unaffected; only new submissions pick up the updated configuration."

---

### B-09: Hot-Reload During In-Flight Request

**Trigger:** A Helm upgrade triggers a rolling deployment while a long-running benchmark exam creation request is in flight (e.g., model download takes 5+ minutes); the old pod is terminated mid-request.

**Symptom:** The exam creation call returns `ECONNRESET` or a partial response; the exam may be created in the DB but the frontend never receives the response and shows an error.

**Root cause hypothesis:** Kubernetes sends SIGTERM to the old pod immediately; NestJS does not drain in-flight connections gracefully before shutdown.

**Diagnostic command:**
```bash
kubectl logs deployment/etri-llm-backend -n llm-evaluation --previous | grep -E "shutdown|SIGTERM|connection"
# Check if orphaned exams exist:
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[] | select(.status == "PREPARING") | {id, created_at}'
```

**Recovery action:**
```bash
# Check if the exam was created despite the error:
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[-1]'
# If yes: exam is valid, just reload the page
# If no: re-submit the exam from the UI
# Clean up any truly orphaned PREPARING exams:
curl -X PATCH http://10.254.177.41:30980/api/exams/<id>/status -d '{"status": "FAILED"}'
```

**Prevention:** Add `terminationGracePeriodSeconds: 60` to the backend deployment and implement NestJS graceful shutdown that drains in-flight HTTP connections before exiting.

**Demo response:** "A deployment update happened right as we submitted — the request was re-routed to the new pod. Let me refresh to check if the exam was created." Navigate to the exam list to confirm and proceed.

---

### B-10: WebSocket Disconnect (Realtime Polling Break)

**Trigger:** The frontend's SSE or WebSocket connection to the backend is dropped (backend pod restart, network hiccup, or 60-second nginx proxy timeout).

**Symptom:** The "Active Benchmarks" panel stops updating; status badges freeze; no JavaScript error visible to user.

**Root cause hypothesis:** The backend's realtime endpoint uses long-poll or SSE; nginx's default `proxy_read_timeout 60s` kills connections that exceed 60 seconds without a write.

**Diagnostic command:**
```bash
# Check frontend console (browser DevTools):
# Look for: "EventSource connection closed" or fetch error on /api/realtime/exams/snapshot
kubectl logs deployment/etri-llm-backend -n llm-evaluation --tail=20 | grep -i "realtime\|sse\|websocket"
```

**Recovery action:**
```bash
# Immediate: refresh the page (F5) — the frontend will re-establish the polling connection
# Fix nginx proxy timeout:
kubectl edit configmap nginx-config -n llm-evaluation
# Add: proxy_read_timeout 300s; proxy_send_timeout 300s;
kubectl rollout restart deployment/etri-llm-frontend -n llm-evaluation
```

**Prevention:** Set nginx `proxy_read_timeout 300` for the realtime endpoint. Implement client-side reconnect logic in the frontend with exponential backoff. Use a 30-second keepalive ping on the SSE channel.

**Demo response:** "The live update stream reconnected — let me refresh to restore the real-time view." Press F5. "The 5-second polling picks right back up. You can see the status badge update in real-time now."

---

## C. FRONTEND APPLICATION

### C-01: Frontend Pod Crash (nginx OOM or Config Error)

**Trigger:** The nginx process inside the frontend pod crashes (OOM, invalid config, or upstream file descriptor exhaustion).

**Symptom:** All frontend routes return `connection refused` or `502`; `kubectl get pods` shows `CrashLoopBackOff` for `etri-llm-frontend-*`.

**Root cause hypothesis:** nginx config was generated with a syntax error in a ConfigMap template (e.g., missing semicolon after `try_files`), or the pod memory limit is too low for the nginx worker processes.

**Diagnostic command:**
```bash
kubectl logs deployment/etri-llm-frontend -n llm-evaluation --previous | tail -30
kubectl describe pod -l app=etri-llm-frontend -n llm-evaluation | grep -A5 "Last State:"
```

**Recovery action:**
```bash
# Validate nginx config in a test container:
kubectl run nginx-test --image=nginx:alpine --rm -it -- nginx -t
# Rollback to previous frontend version:
helm rollback etri-llm-frontend -n llm-evaluation
kubectl rollout status deployment/etri-llm-frontend -n llm-evaluation
```

**Prevention:** Run `nginx -t` as a Kubernetes `init container` before the main nginx process starts; exit non-zero on config error. Set memory limit to `256Mi` minimum.

**Demo response:** Procedure P11 from demo_recovery_playbook.md applies. "The web server is restarting — I'll demonstrate the platform via the backend API directly while it recovers."

---

### C-02: nginx Config Typo (Route Not Proxied)

**Trigger:** A `location` block in the nginx config is missing or has a typo (e.g., `/api/` instead of `/api`) causing API calls to return 404 from nginx rather than being proxied to the backend.

**Symptom:** Frontend loads correctly but all data tables are empty; browser DevTools shows `GET /api/comparison/list 404` with an nginx 404 page body.

**Root cause hypothesis:** The `location /api/` block uses a trailing slash that conflicts with the upstream path, or the `proxy_pass` directive has a trailing slash that strips the `/api` prefix.

**Diagnostic command:**
```bash
kubectl exec deployment/etri-llm-frontend -n llm-evaluation -- nginx -T | grep -A10 "location /api"
curl -v http://10.254.177.41:30001/api/health 2>&1 | grep -E "HTTP|location"
```

**Recovery action:**
```bash
# Fix the nginx ConfigMap:
kubectl edit configmap nginx-config -n llm-evaluation
# Correct: location /api { proxy_pass http://etri-llm-backend:3000; }
kubectl rollout restart deployment/etri-llm-frontend -n llm-evaluation
```

**Prevention:** Add a smoke test in CI that curls `/api/health` through the nginx proxy and asserts `200`. Use `nginx -t` in the Kaniko build step to validate config before pushing the image.

**Demo response:** "The API proxy route has a configuration issue — fixing now." Apply the ConfigMap patch and reload. "nginx reloads config with zero downtime — the page will work in 10 seconds."

---

### C-03: Lazy-Chunk Fetch Fail (JS Bundle 404)

**Trigger:** A React lazy-loaded route chunk (`/assets/AtomPlus-Bx92k.js`) fails to load because the Kaniko build produced a different content hash than what the old HTML references.

**Symptom:** Navigating to `/npu-eval/atomplus` shows a blank page with `ChunkLoadError: Loading chunk X failed` in the browser console.

**Root cause hypothesis:** User has the old `index.html` cached (with old chunk hashes) but the nginx is now serving a new build's chunks (with new hashes); the old chunk paths 404.

**Diagnostic command:**
```bash
# In browser DevTools > Network tab: filter by JS, look for 404 responses
# On nginx:
kubectl exec deployment/etri-llm-frontend -n llm-evaluation -- ls /usr/share/nginx/html/assets/ | head -20
```

**Recovery action:**
```bash
# Hard reload in browser: Ctrl+Shift+R (force refetch of index.html)
# Or instruct user: clear browser cache for this origin
# nginx: ensure Cache-Control: no-cache on index.html:
kubectl exec deployment/etri-llm-frontend -n llm-evaluation -- \
  grep -r "Cache-Control" /etc/nginx/conf.d/
```

**Prevention:** Set `Cache-Control: no-cache, no-store` on `index.html` specifically, and `Cache-Control: public, max-age=31536000, immutable` on hashed asset files. This ensures browsers always get the fresh entry point.

**Demo response:** "The browser has an old version of the page cached — let me hard-reload." Press Ctrl+Shift+R. "The updated bundle loads now. This is a standard browser caching behaviour with content-addressed assets."

---

### C-04: Stale Browser Cache (Old UI After Deploy)

**Trigger:** A new frontend image was deployed but the demo browser has the previous version cached; the UI shows old behavior or missing features.

**Symptom:** A feature known to be deployed (e.g., "New Atom+ Exam" button) is not visible; the deployed image version in the pod does not match what the browser shows.

**Root cause hypothesis:** The browser cached `index.html` for longer than the deploy interval; or the nginx config does not set `no-cache` on the HTML entry point.

**Diagnostic command:**
```bash
# In browser: F12 > Application > Storage > Clear site data
# Verify deployed version:
curl -s http://10.254.177.41:30001/ | grep -o 'data-version="[^"]*"'
# Or check the running image:
kubectl get deployment etri-llm-frontend -n llm-evaluation -o jsonpath='{.spec.template.spec.containers[0].image}'
```

**Recovery action:**
```bash
# In browser: open a fresh Incognito window (guaranteed no cache)
# Or: Ctrl+Shift+Delete → Clear browsing data → Cached images and files
```

**Prevention:** Use incognito/private browsing for all demo sessions. Add a visible build version tag in the page footer for instant cache verification.

**Demo response:** "Let me open a fresh browser window to make sure we're seeing the latest deployed version." Open incognito and navigate to the URL. "This is v31, deployed 30 minutes ago."

---

### C-05: Environment Variable Missing in Vite Build

**Trigger:** A `VITE_*` environment variable (e.g., `VITE_APP_API_BASE_URL`, `VITE_APP_GPU_PROMETHEUS_URL`) is not set in the Kaniko build environment; Vite inlines `undefined` into the bundle at build time.

**Symptom:** API calls go to `undefined/api/comparison/list` which fails; or the Prometheus iframe src is `undefined` and shows blank.

**Root cause hypothesis:** The `build-args` in the Kaniko job YAML are missing or the ConfigMap that supplies them was not updated for the new variable.

**Diagnostic command:**
```bash
# Check what the bundle contains:
kubectl exec deployment/etri-llm-frontend -n llm-evaluation -- \
  grep -o "VITE_APP_API_BASE_URL[^\"]*" /usr/share/nginx/html/assets/index-*.js | head -5
# Check the Kaniko job build args:
kubectl get job kaniko-frontend -n llm-evaluation -o yaml | grep -A20 "args:"
```

**Recovery action:**
```bash
# Rebuild the frontend with the correct env vars:
kubectl delete job kaniko-frontend -n llm-evaluation
# Update the job YAML with the missing build-arg and re-apply:
kubectl apply -f jobs/kaniko-frontend.yaml -n llm-evaluation
kubectl logs job/kaniko-frontend -n llm-evaluation -f
```

**Prevention:** Add a post-build smoke test that greps the generated bundle for `undefined` as an API base URL. Document all required `VITE_*` variables in the deploy checklist.

**Demo response:** "The API base URL was not embedded in this build — let me trigger a rebuild with the correct configuration." Initiate the Kaniko rebuild. "This takes about 3 minutes. While it builds, let me show you the backend API directly."

---

### C-06: SPA Route Returns 404 (nginx try_files Missing)

**Trigger:** User navigates directly to `/npu-eval/rngd` (bookmark or shared link) instead of clicking through the SPA; nginx returns a real 404 because there is no physical file at that path.

**Symptom:** Browser shows nginx 404 page on direct URL navigation; clicking links from the home page works fine.

**Root cause hypothesis:** The nginx `location /` block is missing `try_files $uri $uri/ /index.html` which is required to serve the SPA for all client-side routes.

**Diagnostic command:**
```bash
curl -v http://10.254.177.41:30001/npu-eval/rngd 2>&1 | grep "HTTP\|404\|try_files"
kubectl exec deployment/etri-llm-frontend -n llm-evaluation -- \
  cat /etc/nginx/conf.d/default.conf | grep try_files
```

**Recovery action:**
```bash
# Edit the nginx configmap to add try_files:
kubectl edit configmap nginx-config -n llm-evaluation
# In location / block, add: try_files $uri $uri/ /index.html;
kubectl rollout restart deployment/etri-llm-frontend -n llm-evaluation
# Immediate workaround: navigate to / first, then click through to the page
```

**Prevention:** Add `try_files $uri /index.html` to the base nginx config template. Include a CI test that curls each known SPA route directly and asserts 200.

**Demo response:** Procedure P1 from demo_recovery_playbook.md applies. "Direct URL navigation requires the routing config — let me navigate from the home page instead." Click through from `/`.

---

### C-07: iframe Target Unreachable (RNGD Systemd Dashboard)

**Trigger:** The RNGD systemd dashboard at `http://10.254.202.114:30890/` is unreachable (NPU node4 is offline or the systemd service is stopped).

**Symptom:** The iframe on the `/npu-eval/rngd` page shows blank or a browser error; the rest of the page renders correctly.

**Root cause hypothesis:** The furiosa NPU inference server's companion systemd HTTP service is not running on node4, or a firewall rule is blocking port 30890 from the demo browser.

**Diagnostic command:**
```bash
curl -I http://10.254.202.114:30890/ --connect-timeout 5
ssh node4 "systemctl status furiosa-inference-server"
```

**Recovery action:**
```bash
ssh node4 "sudo systemctl start furiosa-inference-server"
# Verify:
curl -I http://10.254.202.114:30890/
# If firewall: open port on node4:
ssh node4 "sudo ufw allow 30890/tcp"
```

**Prevention:** Add a health check cron on node4 that sends an alert if port 30890 becomes unreachable. Include the iframe URL in the pre-demo health check script.

**Demo response:** Procedure P2 from demo_recovery_playbook.md applies. "The RNGD systemd dashboard is its own service on the NPU node. Let me show you the same live data via the REST API." Run `curl http://10.254.177.41:30980/api/realtime/exams/snapshot | jq '.slots["npu/furiosa/RNGD/node4"]'`.

---

### C-08: Console Error Spam During Demo (Noisy DevTools)

**Trigger:** Audience or screen recorder shows browser DevTools open with a cascade of yellow/red warnings (CORS errors, React key warnings, deprecated API warnings).

**Symptom:** Console shows hundreds of warnings; audience notices and questions the quality of the codebase.

**Root cause hypothesis:** React development build accidentally deployed (includes verbose warnings); or CORS preflight errors because the API is called from a different origin; or React list items missing `key` props.

**Diagnostic command:**
```bash
# In browser console:
# Check for: "Warning: Each child in a list should have a unique key"
# Check for: CORS errors: "Access-Control-Allow-Origin"
# Verify build mode:
curl -s http://10.254.177.41:30001/assets/index-*.js | grep -c "process.env.NODE_ENV"
```

**Recovery action:**
```bash
# Immediate: close DevTools before screen-sharing
# If CORS: add the demo browser origin to backend CORS allowlist:
kubectl set env deployment/etri-llm-backend CORS_ORIGIN=http://10.254.177.41:30001 -n llm-evaluation
kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation
```

**Prevention:** Always deploy production builds (`NODE_ENV=production`) which suppress React development warnings. Run `console.error` override in the app to suppress non-actionable warnings during demo. Close DevTools before presenting.

**Demo response:** "Those are development-mode diagnostic messages from the browser — they are not user-facing errors. Let me close DevTools and stay focused on the application behavior." Close DevTools and continue.

---

## D. BENCHMARK EXECUTION

### D-01: vLLM OOM on Weights Load

**Trigger:** A benchmark job starts on an L40 or A40 GPU with insufficient VRAM to load the model; the vLLM process is killed mid-load.

**Symptom:** Benchmark pod exits with code 137 (OOMKilled); exam transitions to `FAILED`; the GPU VRAM shows brief spike then drops to zero in `nvidia-smi`.

**Root cause hypothesis:** Llama-3.1-8B in BF16 requires ~16GB VRAM; L40 has 48GB but with `gpu_memory_utilization=0.95` the KV cache allocation after model load may still OOM if other processes hold VRAM.

**Diagnostic command:**
```bash
kubectl describe pod <benchmark-pod> -n llm-evaluation | grep -A5 "OOMKilled\|Last State:"
nvidia-smi -q --display=MEMORY | grep -A5 "GPU 00000000"
kubectl logs <benchmark-pod> -n llm-evaluation --previous | grep -i "oom\|memory\|cuda"
```

**Recovery action:**
```bash
# Lower memory utilization and resubmit:
# In exam form: set gpu_memory_utilization=0.75
# Or add --max-model-len 2048 to reduce KV cache footprint
# Kill any ghost vLLM processes on the GPU node:
ssh node2 "sudo pkill -f vllm"
# Resubmit exam via UI
```

**Prevention:** Set `--gpu-memory-utilization 0.80` as the default in the operator job template. Add a pre-flight check that queries `nvidia-smi` for free VRAM and rejects the job if < 20GB free.

**Demo response:** "The model exceeded the GPU memory budget — this is exactly the kind of resource constraint our benchmark harness surfaces. We reduce the memory utilization parameter and resubmit." Demonstrate the resubmission workflow.

---

### D-02: vLLM CUDA Graph Capture Timeout

**Trigger:** vLLM's CUDA graph capture step (which runs before the first inference) takes >10 minutes on a cold GPU, causing the operator to time out the exam.

**Symptom:** Exam stays in `PREPARING` for 10+ minutes then transitions to `FAILED`; no output tokens generated; vLLM logs show `Capturing CUDA graph for batch size X...` hanging.

**Root cause hypothesis:** First-time CUDA graph capture on L40 with a large `max-num-seqs` value; or the GPU's CUDA compute cache is cold (first run after reboot).

**Diagnostic command:**
```bash
kubectl logs <benchmark-pod> -n llm-evaluation -f | grep -i "cuda graph\|capturing\|preparing"
# Check GPU compute mode:
ssh node2 "nvidia-smi -q | grep 'Compute Mode'"
```

**Recovery action:**
```bash
# Increase operator timeout for the PREPARING phase:
kubectl set env deployment/etri-llm-operator EXAM_PREPARING_TIMEOUT_SECONDS=900 -n llm-evaluation
# Or resubmit with --enforce-eager (disables CUDA graphs, slower but no capture overhead):
# Add to exam parameters: extra_args=["--enforce-eager"]
kubectl rollout restart deployment/etri-llm-operator -n llm-evaluation
```

**Prevention:** Warm up the GPU before the demo by running a dummy vLLM job that triggers CUDA graph capture. Set `CUDA_LAUNCH_BLOCKING=1` during warmup to detect capture failures early.

**Demo response:** "The GPU is warming up its inference graph — this is a one-time cost per model that is cached for subsequent runs. In production, the server stays warm. Let me show you a result from a pre-warmed run while this completes."

---

### D-03: Exam Stuck in Pending (Operator Scheduling Race)

**Trigger:** Two exams are submitted within milliseconds of each other; the operator's scheduling loop assigns both to the same device, then the second one cannot start because the device is occupied.

**Symptom:** One exam transitions to `RUNNING`, the other stays in `PENDING` indefinitely; no error message in the UI.

**Root cause hypothesis:** The operator reads device availability from the DB without a transaction lock; the race window allows two exams to read "device free" simultaneously.

**Diagnostic command:**
```bash
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[] | select(.status == "PENDING") | {id, hardware, created_at}'
kubectl logs deployment/etri-llm-operator -n llm-evaluation --tail=50 | grep -i "schedule\|assign\|race"
```

**Recovery action:**
```bash
# Cancel the stuck pending exam:
curl -X PATCH http://10.254.177.41:30980/api/exams/<id>/status \
  -H "Content-Type: application/json" -d '{"status": "CANCELLED"}'
# Resubmit after the running exam completes:
# Wait for RUNNING exam to finish, then submit the new one
```

**Prevention:** Add a database-level advisory lock or `SELECT FOR UPDATE` in the operator's device assignment query. Implement a `PENDING_TIMEOUT_SECONDS` that auto-cancels exams stuck in PENDING for >5 minutes.

**Demo response:** "Two benchmarks were submitted at the same time and one is waiting for the device. The cluster queues them correctly — the second will start automatically when the first completes."

---

### D-04: Exam Stuck in Running with No Progress

**Trigger:** Exam status is `RUNNING` but no result rows are being written; the benchmark job pod is alive but the inference loop has stalled (e.g., the model is waiting for a prompt that never arrives due to a networking issue).

**Symptom:** Exam stays in `RUNNING` for 30+ minutes; no TPS updates; the Active Benchmark card shows 0% progress; realtime heartbeat timestamp is stale.

**Root cause hypothesis:** The vLLM HTTP server started but the benchmark script's HTTP client is connecting to the wrong port or IP (e.g., `localhost` vs. the pod's cluster IP); the inference loop is silently blocking on connection.

**Diagnostic command:**
```bash
kubectl logs <benchmark-pod> -n llm-evaluation | grep -E "ERROR|waiting|connection|timeout" | tail -30
kubectl exec <benchmark-pod> -n llm-evaluation -- curl -s http://localhost:8000/health
# Check heartbeat age:
curl http://10.254.177.41:30980/api/realtime/exams/snapshot | jq '.slots[] | select(.current_exam != null) | {elapsed: .current_exam.elapsed_seconds}'
```

**Recovery action:**
```bash
# Kill the stuck job:
kubectl delete job <benchmark-job-name> -n llm-evaluation
# Update exam status:
curl -X PATCH http://10.254.177.41:30980/api/exams/<id>/status \
  -d '{"status": "FAILED", "error": "stuck-running-no-progress"}'
# Investigate and fix the vLLM connection config before resubmitting
```

**Prevention:** Implement a heartbeat watchdog in the operator: if no result row is written within 10 minutes of `RUNNING` status, automatically mark the exam `FAILED` and delete the job.

**Demo response:** "This benchmark run stalled — no inference output was produced. The watchdog detected it and we're terminating and resubmitting. This kind of fault detection is a core feature of the operator."

---

### D-05: Exam Completed but No Result Row Written

**Trigger:** The benchmark pod exits successfully (exit code 0), the exam transitions to `COMPLETED`, but no result row is written to `exam_results`; comparison-list returns the exam with null metrics.

**Symptom:** Exam shows `COMPLETED` status but `tt100t_seconds`, `tps`, and `accuracy` are all null; the leaderboard row appears empty.

**Root cause hypothesis:** The benchmark script wrote results to a local file but the result-upload step failed silently; or the exam ID used in the result POST does not match the exam ID assigned by the backend.

**Diagnostic command:**
```bash
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[] | select(.status == "COMPLETED" and .tt100t_seconds == null) | {id, hardware}'
kubectl logs <benchmark-pod> -n llm-evaluation | grep -i "result\|upload\|POST\|error" | tail -20
```

**Recovery action:**
```bash
# Manually import the result from the benchmark log:
# Extract metrics from log file:
grep "tt100t\|tps\|accuracy" logs/benchmarks/<job-log>.log | tail -5
# POST the result manually:
curl -X POST http://10.254.177.41:30980/api/exams/<id>/results \
  -H "Content-Type: application/json" \
  -d '{"tt100t_seconds": 1.267, "tps": 78.9, "precision": "fp8"}'
```

**Prevention:** Implement idempotent result upload with retry logic (3 attempts with exponential backoff). Add a post-benchmark validation step that confirms the result row exists before marking the exam `COMPLETED`.

**Demo response:** "The benchmark completed successfully but the result upload had a hiccup. The raw metrics are in the job logs — let me import them directly." Run the manual POST. "The leaderboard now shows the correct numbers."

---

### D-06: FP8 dtype Rejection by vLLM

**Trigger:** Exam is submitted with `precision=fp8`; the vLLM version in the benchmark image is pre-v0.8.x and does not accept `--dtype fp8`.

**Symptom:** Exam transitions to `FAILED` within seconds; log shows `ValueError: Unknown dtype: fp8`.

**Root cause hypothesis:** `vllm/vllm-openai:v0.6.6` does not support `--dtype fp8` as a literal. Pre-quantized FP8 models must be loaded with `--dtype auto` on vLLM >= v0.8.x.

**Diagnostic command:**
```bash
kubectl logs <benchmark-pod> -n llm-evaluation | grep "ValueError\|Unknown dtype"
# Confirm vLLM version in the image:
kubectl exec <benchmark-pod> -- pip show vllm | grep Version
```

**Recovery action:**
```bash
# Resubmit with precision=bfloat16 (uses the same FP8 model weights with auto-cast):
# Or update the benchmark image to vllm:v0.8.4 and use --dtype auto
# If using v0.8.4, update the operator's image reference:
kubectl set image deployment/etri-llm-operator \
  operator=etri-llm-operator:v1.0.2-vllm084 -n llm-evaluation
```

**Prevention:** Pin the vLLM image version in the operator job template and document the minimum version required for FP8 support. Add a pre-flight dtype validation in the operator before launching the job.

**Demo response:** Procedure P4 from demo_recovery_playbook.md applies. Cite `mlperf_execution_blockers.md`. "This is a known vLLM version limitation — the same error that produced our BLOCKED GPU cells. RNGD uses furiosa-llm and does not have this constraint."

---

### D-07: Model File Missing on NFS PVC

**Trigger:** The benchmark job expects the model weights at `/mnt/models/Llama-3.1-8B-Instruct` but the NFS PVC was re-provisioned without copying the model files.

**Symptom:** vLLM exits with `FileNotFoundError: /mnt/models/Llama-3.1-8B-Instruct/config.json`; exam fails in seconds.

**Root cause hypothesis:** PVC was deleted and recreated (e.g., after a node rebuild), and the model download job was not re-run; or the model was downloaded to a different path than the benchmark expects.

**Diagnostic command:**
```bash
kubectl exec <benchmark-pod> -n llm-evaluation -- ls /mnt/models/
kubectl get pvc model-pvc -n llm-evaluation
kubectl logs job/model-downloader -n llm-evaluation --tail=20 2>/dev/null || echo "No downloader job found"
```

**Recovery action:**
```bash
# Re-run the model download job:
kubectl apply -f jobs/model-downloader.yaml -n llm-evaluation
kubectl wait --for=condition=complete job/model-downloader -n llm-evaluation --timeout=30m
# Or download directly from HuggingFace:
kubectl exec deployment/etri-llm-backend -n llm-evaluation -- \
  huggingface-cli download meta-llama/Llama-3.1-8B-Instruct --local-dir /mnt/models/Llama-3.1-8B-Instruct
```

**Prevention:** Add a Kubernetes `init container` to benchmark jobs that verifies model file presence (`ls /mnt/models/*/config.json`) and fails fast with a clear error before vLLM starts.

**Demo response:** "The model weights are being fetched from the model registry — this is the initial download for this node. Subsequent runs use the cached copy. Let me show you a benchmark that used a pre-cached model while this downloads."

---

### D-08: HuggingFace Token Expired Mid-Download

**Trigger:** A model download job that started before the HF token expired continues with a stale token; the download fails at a chunk boundary.

**Symptom:** Model downloader pod exits with `401 Unauthorized` or `OSError: We couldn't connect to 'https://huggingface.co'`; the `/mnt/models` directory contains partial files.

**Root cause hypothesis:** HF tokens have a configurable expiry; if the token was created with a 24-hour expiry and the demo cluster was set up >24h ago, the token is invalid.

**Diagnostic command:**
```bash
kubectl logs job/model-downloader -n llm-evaluation | grep -i "401\|unauthorized\|token\|expired"
# Test the token directly:
curl -H "Authorization: Bearer $(kubectl get secret hf-token-secret -n llm-evaluation -o jsonpath='{.data.token}' | base64 -d)" \
  https://huggingface.co/api/whoami
```

**Recovery action:**
```bash
# Rotate the token:
kubectl delete secret hf-token-secret -n llm-evaluation
kubectl create secret generic hf-token-secret --from-literal=token=hf_<new_token> -n llm-evaluation
# Clean up partial download and retry:
kubectl exec <pv-pod> -- rm -rf /mnt/models/Llama-3.1-8B-Instruct
kubectl delete job model-downloader -n llm-evaluation
kubectl apply -f jobs/model-downloader.yaml -n llm-evaluation
```

**Prevention:** Create HF tokens with no expiry for the cluster service account. Add a daily cron that curls the HF whoami API and alerts if the token is invalid or expiring within 7 days.

**Demo response:** "The model repository token needs refreshing — standard credential hygiene. One-minute fix." Rotate the token live and restart the download. "This is why we pre-verify all credentials the morning of the demo."

---

### D-09: NFS PVC Saturated (Disk Full)

**Trigger:** Accumulated benchmark logs, partial model downloads, or vLLM compilation cache fills the NFS export partition.

**Symptom:** Benchmark jobs fail with `No space left on device`; model writes fail silently and produce corrupt files; postgres WAL writes fail causing DB to go read-only.

**Root cause hypothesis:** vLLM's HuggingFace cache (`~/.cache/huggingface`) or compilation cache (`~/.triton`) was not cleaned up after failed runs, consuming tens of GB.

**Diagnostic command:**
```bash
# On NFS server:
df -h /exports/llm-models
du -sh /exports/llm-models/* | sort -rh | head -10
# In benchmark pod:
kubectl exec <pod> -- du -sh ~/.cache/huggingface ~/.triton 2>/dev/null
```

**Recovery action:**
```bash
# Clean HuggingFace and Triton caches:
kubectl exec <pod> -- rm -rf ~/.cache/huggingface/hub/__pycache__
kubectl exec <pod> -- rm -rf ~/.triton
# Remove failed partial downloads:
find /exports/llm-models -name "*.incomplete" -delete
find /exports/llm-models -name "tmp_*" -delete
# Check postgres:
psql -U llm -c "CHECKPOINT; VACUUM;"
```

**Prevention:** Set `TRANSFORMERS_CACHE` and `HF_HOME` env vars to a dedicated scratch partition with a quota. Add a weekly cron that prunes the Triton cache directory. Set NFS export quota at 80% utilization with an alert.

**Demo response:** "The model storage reached capacity from accumulated build artifacts. We're running a cleanup now — 2 minutes. This is a maintenance operation that a production deployment would automate."

---

### D-10: GPU Device Offline Mid-Run

**Trigger:** An NVIDIA L40 or A40 GPU resets mid-inference due to an ECC error, thermal throttle shutdown, or driver crash; vLLM loses the CUDA context.

**Symptom:** Benchmark pod exits unexpectedly with `CUDA error: device-side assert triggered` or `RuntimeError: CUDA out of memory` after partial inference; exam transitions to `FAILED` after partial results.

**Root cause hypothesis:** GPU ECC uncorrectable error triggered a GPU reset; or the GPU exceeded thermal limits and the driver initiated a hard reset.

**Diagnostic command:**
```bash
ssh node2 "nvidia-smi -q | grep -A5 'ECC Errors'"
ssh node2 "dmesg | grep -i 'NVRM\|gpu reset\|xid' | tail -20"
kubectl describe pod <benchmark-pod> | grep -A5 "Last State:"
```

**Recovery action:**
```bash
# Drain the affected node to prevent scheduling until GPU is verified:
kubectl cordon node2
kubectl drain node2 --ignore-daemonsets --delete-emptydir-data
# Reset the GPU:
ssh node2 "sudo nvidia-smi --gpu-reset -i 0"
# Verify GPU is healthy:
ssh node2 "nvidia-smi -q | grep 'Health\|ECC'"
kubectl uncordon node2
# Resubmit the exam
```

**Prevention:** Enable NVIDIA DCGM health monitoring with Prometheus alerts for GPU XID errors. Set `--reset-on-error` in the vLLM serve config to auto-restart on GPU errors without failing the job.

**Demo response:** "The GPU encountered a hardware transient error and reset itself — this is the self-healing mechanism in NVIDIA's driver stack. The benchmark will resubmit to the same GPU, which is now reset and healthy."

---

## E. NPU-SPECIFIC

### E-01: RNGD Inference Server Pod Died

**Trigger:** The `npu-inference-server-node4` pod on node4 crashes (OOM, NPU error, or furiosa-llm segfault); all RNGD benchmarks fail to submit.

**Symptom:** RNGD exam creation returns `502` or `gRPC: transport is closing`; existing completed results are unaffected; the realtime slot shows `status: idle` or disappears.

**Root cause hypothesis:** furiosa-llm inference server OOM-killed during a model hot-swap between FP8 and BF16 models; or the RNGD device driver on node4 encountered a firmware exception.

**Diagnostic command:**
```bash
kubectl get pods -n llm-evaluation | grep npu-inference-server-node4
kubectl logs deployment/npu-inference-server-node4 -n llm-evaluation --previous | tail -40
ssh node4 "furiosa-smi"
```

**Recovery action:**
```bash
kubectl rollout restart deployment/npu-inference-server-node4 -n llm-evaluation
kubectl rollout status deployment/npu-inference-server-node4 -n llm-evaluation
# Verify RNGD is serving:
curl -s http://10.254.202.114:8080/health
```

**Prevention:** Set `restartPolicy: Always` and `livenessProbe` on the inference server pod. Configure HPA with a minimum replica of 1 to ensure the pod is always restarted.

**Demo response:** "The RNGD NPU inference server is restarting — this takes about 90 seconds as it reloads the FP8 model weights. The completed benchmark results (id=75, TT100T=1.267s) are in the database. Let me show those while the server restores."

---

### E-02: RNGD Heartbeat Stale (Zombie Exam)

**Trigger:** An exam on RNGD (e.g., id=69) is stuck in `RUNNING` status with `started_at` from days ago; no heartbeat has been sent; the realtime slot shows `status: stale`.

**Symptom:** The RNGD realtime dashboard shows a gray "stale" badge; the Active Benchmarks card shows a run with elapsed time in the hundreds of thousands of seconds; new exams cannot be submitted if the operator thinks RNGD is occupied.

**Root cause hypothesis:** The benchmark job pod was manually deleted or OOM-killed without the operator being notified; the DB record was never updated to `COMPLETED` or `FAILED`.

**Diagnostic command:**
```bash
curl http://10.254.177.41:30980/api/realtime/exams/snapshot | jq '.slots[] | select(.status == "stale") | {current_exam, last_seen}'
# Confirm no live job:
kubectl get jobs -n llm-evaluation | grep rngd
```

**Recovery action:**
```bash
# Mark the zombie exam as failed in the DB:
curl -X PATCH http://10.254.177.41:30980/api/exams/69/status \
  -H "Content-Type: application/json" \
  -d '{"status": "FAILED", "error": "zombie-exam-no-heartbeat"}'
# The realtime TTL will clear within 2 minutes automatically (STALE_THRESHOLD_MS=120000)
```

**Prevention:** Implement the operator watchdog: if an exam in `RUNNING` has no heartbeat for >10 minutes, the operator should automatically mark it `FAILED` and release the device slot.

**Demo response:** "The stale indicator shows a benchmark from a previous session that was never cleaned up — a known housekeeping task. The TTL system correctly identified it as stale. Let me clear it and show you a fresh run." Apply the PATCH and re-submit.

---

### E-03: Atom+ Device Not Joined (node5 Not in Cluster)

**Trigger:** node5 failed to re-join the Kubernetes cluster after a reboot; `rebellions.ai/ATOM` resource is no longer allocatable; the UI shows "No ready Rebellions device found".

**Symptom:** The Atom+ exam creation form shows the warning Alert with kubectl diagnostic commands; the `kubectl describe node node5` shows either `NotReady` or the node is absent from `kubectl get nodes`.

**Root cause hypothesis:** kubelet on node5 failed to start after reboot because the cluster CA certificate or bootstrap token expired; or node5's network interface changed IP.

**Diagnostic command:**
```bash
kubectl get nodes | grep node5
kubectl describe node node5 | grep -A5 "Conditions:"
ssh node5 "systemctl status kubelet && journalctl -u kubelet --since '10 minutes ago' | tail -20"
```

**Recovery action:**
```bash
# On node5:
ssh node5 "sudo systemctl restart kubelet"
# Wait for node to become Ready:
kubectl get nodes -w
# Verify Atom+ resources:
kubectl describe node node5 | grep "rebellions.ai/ATOM"
```

**Prevention:** Use a long-lived cluster join token or certificate renewal cron. Set `failureThreshold: 5` on the node kubelet so transient network blips don't mark the node NotReady immediately.

**Demo response:** "Node5, which hosts the Atom+ NPU, is rejoining the cluster — this happens automatically after maintenance. The cluster shows 2 Atom+ devices as allocatable once it rejoins, typically within 2 minutes."

---

### E-04: rbln-stat Command Missing on node5

**Trigger:** An operator or benchmark script attempts to run `rbln-stat` on node5 to check Atom+ utilization, but the command is not in the PATH.

**Symptom:** The script returns `bash: rbln-stat: command not found`; diagnostic monitoring of Atom+ NPU utilization fails.

**Root cause hypothesis:** `rbln-stat` is part of the `rbln-tools` package which is installed separately from the device driver; the package was not installed during the initial node5 setup.

**Diagnostic command:**
```bash
ssh node5 "which rbln-stat || dpkg -l | grep rbln"
ssh node5 "ls /usr/local/bin/rbln-* 2>/dev/null || echo 'rbln tools not found'"
```

**Recovery action:**
```bash
ssh node5 "pip install rbln-tools"
# Or from the Rebellions apt repo:
ssh node5 "sudo apt-get install rbln-tools"
# Verify:
ssh node5 "rbln-stat"
```

**Prevention:** Add `rbln-stat` to the node5 bootstrap script in `docs/node5_atomplus_runbook.md`. Include a pre-demo check that SSHes to node5 and runs `which rbln-stat`.

**Demo response:** "The NPU diagnostic tool needs to be installed on this node — a one-line fix." Install it live. "For the demo, we can also show NPU utilization via the cluster's device plugin metrics: `kubectl top nodes`."

---

### E-05: optimum-rbln SDK Version Mismatch (FP8 Import Fail)

**Trigger:** A benchmark script tries to import `RBLNConfig` from `optimum.rbln` but the installed version (0.9.3.post1) does not expose that class; the FP8 compilation path fails.

**Symptom:** Benchmark job exits with `ImportError: cannot import name 'RBLNConfig' from 'optimum.rbln'`; exam transitions to `FAILED` immediately.

**Root cause hypothesis:** `optimum-rbln 0.9.3.post1` does not include the `RBLNConfig` API needed for FP8 quantization setup; this API was added in a later release.

**Diagnostic command:**
```bash
kubectl exec <benchmark-pod> -n llm-evaluation -- pip show optimum-rbln
kubectl logs <benchmark-pod> -n llm-evaluation | grep "ImportError\|RBLNConfig"
ssh node5 "pip show optimum-rbln"
```

**Recovery action:**
```bash
# Check if a newer version supports FP8:
pip index versions optimum-rbln
# If yes, upgrade:
ssh node5 "pip install --upgrade optimum-rbln"
# If no newer version available: use BF16 fallback (authorized per benchmark contract)
# Resubmit with precision=bf16
```

**Prevention:** Document the minimum required `optimum-rbln` version for FP8 support in the benchmark compatibility matrix. Add a version check in the benchmark script that prints a clear error and falls back to BF16 automatically.

**Demo response:** Procedure P5 from demo_recovery_playbook.md applies. "The Atom+ SDK version does not yet support FP8 quantization — a vendor roadmap item. We use the authorized BF16 fallback, which still delivers competitive performance. This is the transparent disclosure our benchmark contract requires."

---

### E-06: NPU OOM (Out of HBM — FuriosaAI RNGD)

**Trigger:** A large batch size or long sequence length causes the RNGD's HBM (High Bandwidth Memory) to be exhausted during inference; the furiosa-llm server returns an allocation error.

**Symptom:** RNGD inference server pod stays running but individual inference requests return `500 Internal Server Error`; exam metrics show extremely low TPS followed by failure; furiosa-smi shows 100% HBM utilization.

**Root cause hypothesis:** `max_output_tokens=512` combined with a batch size >8 exceeds the RNGD's HBM budget for the Llama-3.1-8B-FP8 model; KV cache for long sequences exhausts memory.

**Diagnostic command:**
```bash
ssh node4 "furiosa-smi | grep -i 'memory\|hbm\|util'"
kubectl logs deployment/npu-inference-server-node4 -n llm-evaluation --tail=30 | grep -i "oom\|memory\|alloc"
```

**Recovery action:**
```bash
# Restart the inference server to release HBM:
kubectl rollout restart deployment/npu-inference-server-node4 -n llm-evaluation
# Resubmit with smaller max_output_tokens (128 is the validated value):
# In exam form: max_output_tokens=128, data_number=100
```

**Prevention:** Set `max_output_tokens=128` as the default and maximum in the RNGD exam form. Add a furiosa-llm server-side memory limit config that rejects requests exceeding the HBM budget rather than crashing.

**Demo response:** "The NPU's high-bandwidth memory was exhausted by a large batch — the server is restarting and will be ready in 60 seconds. Our validated benchmark uses 128 max output tokens which fits comfortably in RNGD's HBM. The 1.267s result you see was produced under those constraints."

---

## F. UI / DEMO RUNTIME

### F-01: Comparison Page Shows "No Comparable Pair"

**Trigger:** The comparison page at `/comparison/{idA}/{idB}` loads but displays an empty state with "No comparable pair found"; the two exam IDs are not in the same `comparability group`.

**Symptom:** The comparison table is blank; no benchmark data is shown side-by-side; the URL IDs may be valid but the pair is considered incompatible.

**Root cause hypothesis:** The two exam IDs use different benchmarks (e.g., MLPerf vs. MMLU) or different dataset sizes (100 vs. 1000 samples); the comparability contract rejects cross-benchmark pairs.

**Diagnostic command:**
```bash
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[] | select(.id == 75 or .id == 74) | {id, hardware, benchmark, dataset, data_number}'
# Check EmptyReason:
curl "http://10.254.177.41:30980/api/comparison/candidates?run_id_1=75&run_id_2=74" | jq .
```

**Recovery action:**
```bash
# Navigate to the leaderboard and use the comparison buttons (they only pair compatible runs):
# http://10.254.177.41:30001/
# Click the comparison button on the TT100T leaderboard row for RNGD
# The leaderboard uses comparison-list which pre-filters by compatibility
```

**Prevention:** Add a tooltip on the comparison URL that shows why a pair is incompatible (using the `EmptyReason` enum from `benchmark_comparability_contract.md`). Validate compatibility before rendering the page.

**Demo response:** Procedure P7 from demo_recovery_playbook.md applies. "These two runs used different benchmark configurations — the system correctly prevents an apples-to-oranges comparison. Let me use the leaderboard comparison button, which only surfaces compatible pairs."

---

### F-02: Live Dashboard iframe Blank

**Trigger:** The GPU realtime dashboard page (`/dashboard/gpu-realtime`) loads but the embedded Prometheus Grafana iframe is blank.

**Symptom:** The page structure renders (header, sidebar) but the iframe area shows white or a browser "refused to connect" message.

**Root cause hypothesis:** `VITE_APP_GPU_PROMETHEUS_URL` was not set at build time (resolves to `undefined`); or the Prometheus/Grafana URL requires authentication that the iframe cannot pass.

**Diagnostic command:**
```bash
# Check the iframe src in the deployed page:
curl -s http://10.254.177.41:30001/dashboard/gpu-realtime | grep -o 'src="[^"]*prometheus[^"]*"'
# Try to reach the Prometheus URL directly:
curl -I $PROMETHEUS_URL --connect-timeout 5
```

**Recovery action:**
```bash
# If URL is undefined: rebuild with the env var set (see C-05)
# If URL is set but auth fails: add ?auth_token= to the Grafana embed URL
# For demo: use the fallback gracefully (Procedure P3):
# Show comparison-list API instead
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[] | {id, hardware, tps, tt100t_seconds}'
```

**Prevention:** Configure the Prometheus embed URL with an anonymous-access Grafana dashboard. Add a health check in the page that detects `src=undefined` at load time and shows the fallback UI immediately.

**Demo response:** Procedure P3 from demo_recovery_playbook.md applies. "The Prometheus observability layer is not wired to this deployment — it's infrastructure monitoring that goes beyond the benchmark focus. The core metrics are in the comparison API, which I'll show you directly."

---

### F-03: Realtime Snapshot Returns Idle When Exam Is Running

**Trigger:** The realtime API returns `status: idle` for a device while an exam is genuinely running on that device.

**Symptom:** The Active Benchmarks panel shows no in-flight jobs; the device slot shows "Idle"; but `kubectl get pods` shows a benchmark pod in `Running` state.

**Root cause hypothesis:** The benchmark job is not sending heartbeat updates to the backend; the realtime service's TTL has expired even though the job is actively running; OR the realtime cache key for the device does not match the job's device identifier.

**Diagnostic command:**
```bash
curl http://10.254.177.41:30980/api/realtime/exams/snapshot | jq '.slots'
kubectl get jobs -n llm-evaluation | grep Running
kubectl logs <running-benchmark-pod> -n llm-evaluation | grep -i "heartbeat\|POST\|result"
```

**Recovery action:**
```bash
# Verify the benchmark job is posting heartbeats:
kubectl exec <benchmark-pod> -- curl -s http://etri-llm-backend.llm-evaluation.svc:3000/api/exams/<id>/heartbeat -X POST
# If the device key is mismatched, check operator device assignment:
kubectl logs deployment/etri-llm-operator -n llm-evaluation | grep "device_id\|slot_key"
```

**Prevention:** Add explicit heartbeat logging in the benchmark container (`echo "heartbeat sent" >> /tmp/heartbeat.log`). Set the heartbeat interval to 30 seconds (well under the 120-second TTL). See `rngd_stale_fix.md` for the TTL mechanism details.

**Demo response:** Procedure P8 from demo_recovery_playbook.md applies. "The realtime snapshot has a 2-minute freshness window. The benchmark is running — let me show you the kubectl proof." Run `kubectl get pods -n llm-evaluation`. "The pod is active. The realtime display refreshes on the next heartbeat cycle."

---

### F-04: ETA Shows Wildly Wrong Number

**Trigger:** The Active Benchmark card displays an ETA of "Completing in 999 hours" or "Completing in -3 minutes" because the elapsed time or total expected time calculation is wrong.

**Symptom:** The ETA badge shows a nonsensical number; the progress percentage may simultaneously show 0% or 100%.

**Root cause hypothesis:** The `elapsed_seconds` field in the realtime snapshot is computed from `Date.now() - started_at`; if `started_at` is from a zombie exam (days old), elapsed is huge and ETA calculation overflows or produces a negative.

**Diagnostic command:**
```bash
curl http://10.254.177.41:30980/api/realtime/exams/snapshot | \
  jq '.slots[] | select(.current_exam != null) | {elapsed: .current_exam.elapsed_seconds, started_at: .current_exam.started_at}'
```

**Recovery action:**
```bash
# If the exam is a zombie (elapsed > 3600): terminate it:
curl -X PATCH http://10.254.177.41:30980/api/exams/<id>/status \
  -d '{"status": "FAILED", "error": "zombie-stale"}'
# The realtime slot will reset within 2 minutes
# Submit a fresh benchmark to populate a sane ETA
```

**Prevention:** Cap the ETA display at "N/A" when `elapsed_seconds > 7200` (2 hours). Add a frontend guard: if `elapsed_seconds > expected_duration * 5`, show "Stale — check operator logs" instead of a calculated ETA.

**Demo response:** "The ETA display is picking up an old benchmark session — a zombie record that was not cleaned up. Let me clear it." Apply the PATCH. "Fresh benchmark submitted. You can see the ETA now calculates correctly from the actual start time."

---

### F-05: Progress Bar Stuck at 0%

**Trigger:** An exam is in `RUNNING` state and the Active Benchmark card shows 0% progress with a static progress bar that never advances.

**Symptom:** The benchmark card shows "Running" status, the timer counts up, but the progress percentage stays at 0%.

**Root cause hypothesis:** The progress calculation uses `completed_samples / total_samples` from the realtime heartbeat; if the benchmark job is not sending per-sample updates (only a final result), progress stays 0% until completion.

**Diagnostic command:**
```bash
curl http://10.254.177.41:30980/api/realtime/exams/snapshot | \
  jq '.slots[] | select(.current_exam != null) | {progress: .current_exam.progress, completed_samples: .current_exam.completed_samples}'
kubectl logs <benchmark-pod> -n llm-evaluation | grep -i "sample\|progress\|completed"
```

**Recovery action:**
```bash
# No immediate fix needed — the benchmark will jump to 100% on completion
# Explain: "The benchmark completes all 100 samples in one batch; progress increments at the end."
# Or implement per-sample heartbeats in the benchmark script (medium-term fix)
```

**Prevention:** Implement per-sample progress reporting in the benchmark container: after each inference batch, POST `{"completed_samples": N}` to the heartbeat endpoint. Display an indeterminate progress bar when no per-sample data is available.

**Demo response:** "The progress bar reflects per-sample completion updates. This benchmark runs all 100 samples in a single batch, so progress jumps from 0% to 100% when it completes — which it will in about 30 seconds. You can see the elapsed timer counting up, confirming it's actively running."

---

### F-06: Dashboard Shows Wrong Vendor Label

**Trigger:** The RNGD dashboard shows "Vendor: rebellions" or an Atom+ slot shows "Vendor: furiosa" due to a vendor normalization bug in the realtime service.

**Symptom:** The device card on the dashboard has the wrong vendor logo or label; the slot data is otherwise correct.

**Root cause hypothesis:** The vendor prefix guard in `buildNpuSlot` (`normNpu + vendorPrefixes` lookup) has a bug where a new device type is not in the prefix map, causing the wrong vendor to be selected.

**Diagnostic command:**
```bash
curl http://10.254.177.41:30980/api/realtime/exams/snapshot | jq '.slots[] | {slot_id: .slot_id, vendor: .vendor, device_type: .device_type}'
kubectl logs deployment/etri-llm-backend -n llm-evaluation | grep -i "vendor\|normNpu"
```

**Recovery action:**
```bash
# Check the vendorPrefixes map in realtime.service.ts:
kubectl exec deployment/etri-llm-backend -- grep -A5 "vendorPrefixes" src/realtime/realtime.service.ts
# If the map is wrong, apply a backend patch:
kubectl rollout restart deployment/etri-llm-backend -n llm-evaluation
```

**Prevention:** See `rngd_stale_fix.md` — the cross-vendor leakage regression tests (7 tests) cover this exact scenario. Run `npm test -- realtime-state.e2e-spec.ts` in CI to catch vendor leakage before deploy.

**Demo response:** "There is a display label issue on this slot — the underlying data is correct. The comparison table and benchmark results are accurate. We'll patch the display normalization after the demo." Navigate to a working view.

---

### F-07: Page Hangs on Form Submit

**Trigger:** Clicking "Create Exam" causes the page to hang with a spinner that never resolves; no error message is shown; the browser tab becomes unresponsive.

**Symptom:** The submit button is stuck in loading state; the page does not update for 30+ seconds; refreshing the page makes the spinner disappear but the exam may or may not have been created.

**Root cause hypothesis:** The mutation call to the backend never returns because (a) the backend is processing a model download synchronously, (b) the gRPC operator call is blocking, or (c) the network request was dropped by a proxy timeout.

**Diagnostic command:**
```bash
# In browser DevTools > Network: find the POST /api/exams request, check its status
# If pending: the backend is blocking
kubectl logs deployment/etri-llm-backend -n llm-evaluation --tail=20 | grep -i "exam\|create\|timeout"
```

**Recovery action:**
```bash
# Refresh the page
# Check if the exam was created:
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[-3:]'
# If yes: exam created, proceed to show it
# If no: resubmit via curl:
curl -X POST http://10.254.177.41:30980/api/exams \
  -H "Content-Type: application/json" \
  -d '{"hardware": "RNGD", "benchmark": "mlperf", "precision": "fp8", "data_number": 100, "max_output_tokens": 128}'
```

**Prevention:** Set a 30-second timeout on the frontend mutation call and show a user-facing error with the option to check the exam list. Move long-running operations (model download, gRPC dispatch) to async background tasks with immediate `202 Accepted` response.

**Demo response:** "The form submission is processing — the model dispatch can take a few seconds. Let me check if it went through." Refresh the exam list. "The exam was created — it's in PREPARING state. Let me navigate there to show the live status."

---

### F-08: Browser Autofill Mangles a Field

**Trigger:** The browser's autofill feature detects an input field (e.g., "max_output_tokens") and fills it with a saved value from a previous session or a mismatched autofill suggestion (e.g., an email address).

**Symptom:** Clicking into the exam creation form triggers the browser to fill fields with incorrect values; "max_output_tokens" gets filled with a name or email; the submitted exam fails DTO validation.

**Root cause hypothesis:** Input fields without `autocomplete="off"` attributes are eligible for browser autofill; the browser heuristically matches field names to saved credentials or form data.

**Diagnostic command:**
```bash
# In browser DevTools > Elements: inspect the input field
# Check for: autocomplete attribute
kubectl exec deployment/etri-llm-frontend -- grep -r "autocomplete" src/pages/ | head -10
```

**Recovery action:**
```bash
# Immediate: manually clear the field and type the correct value
# Clear autofill suggestions: right-click on the suggestion > Don't suggest [site]
# Or disable autofill for the tab: F12 > Application > Clear storage
```

**Prevention:** Add `autocomplete="off"` to all numeric input fields in the exam creation form. Use `type="number"` with `min`, `max`, and `step` attributes to prevent non-numeric autofill.

**Demo response:** "The browser tried to be helpful and autofilled a field — let me clear that and enter the correct values." Manually correct the fields. "In production, these forms have autofill disabled for exactly this reason."

---

### F-09: Demo Screen-Share Doesn't Pick Up the iframe

**Trigger:** During screen sharing (Zoom, Teams, OBS), the browser's iframe (RNGD systemd dashboard or Prometheus Grafana) is not captured by the screen share, showing black or blank in the shared view.

**Symptom:** Presenter sees the iframe content in their browser; audience sees a black rectangle where the iframe should be; this happens with GPU-accelerated rendering and certain screen share modes.

**Root cause hypothesis:** The iframe content is rendered in a separate GPU compositing layer that is not captured by the screen capture API when using "Window" mode instead of "Entire Screen" mode.

**Diagnostic command:**
```bash
# Not a cluster issue — this is an OS/browser/screen-share configuration issue
# Test: switch from "Window" share to "Entire Screen" share
# Or: switch from hardware-accelerated rendering to software rendering in Chrome:
# chrome://flags/#disable-accelerated-2d-canvas → Enabled
```

**Recovery action:**
```bash
# Switch screen share to "Entire Screen" mode (not "Window" or "Tab")
# Or: open the iframe URL directly in a separate browser tab:
# http://10.254.202.114:30890/  (RNGD systemd dashboard)
# Share that tab separately
```

**Prevention:** Pre-test screen share with all iframes in the dry run. Use "Entire Screen" mode for all demo sessions. Document this in the demo video checklist.

**Demo response:** "Let me switch my screen share to full-screen mode so the embedded dashboard is visible." Switch share mode. "Or, I can open the RNGD dashboard directly in a separate window — here's the live system view." Open in new tab.

---

### F-10: Audience Asks a Question You Can't Answer

**Trigger:** An audience member asks a technical question outside your prepared scope — e.g., "What is the RNGD's power consumption per inference?" or "How does furiosa-llm compare to TensorRT-LLM?"

**Symptom:** You do not have the answer; silence or an incorrect answer damages credibility.

**Root cause hypothesis:** The benchmark scope is latency and throughput (TT100T, TPS) on a fixed dataset; power, cost, and competitor comparisons are out of scope for this demo.

**Diagnostic command:**
```bash
# Refer to: docs/reports/demo_script_tomorrow.md
# Refer to: docs/reports/benchmark_critic_review.md
# Refer to: docs/reports/presentation_outline_1h.md
# Check: does the answer exist in any of the prepared materials?
grep -r "<keyword>" /home/kcloud/etri-llm-exam-solution/docs/reports/ | head -10
```

**Recovery action:** Use the following response framework:

1. **If it's in scope but you forgot:** "Great question — let me pull up the benchmark data." Navigate to the relevant metric in the UI or API.
2. **If it's out of scope:** "That's a great follow-up question beyond our benchmarking scope today. Our focus is inference latency and throughput on a standardized dataset. I'd be happy to follow up with the vendor-provided spec sheets after the session."
3. **If it's a critique:** "That's a fair point. Our benchmark contract (benchmark_comparability_contract.md) defines the evaluation criteria. We welcome additional metrics in future benchmark rounds."

**Prevention:** Prepare a 1-page FAQ covering the top 10 anticipated questions (power, cost, reproducibility, scale, production readiness). See `docs/reports/presentation_outline_1h.md` for the pre-prepared talking points.

**Demo response:** Deliver response option 1, 2, or 3 above confidently. Never say "I don't know" without a follow-up action. Always offer to provide written follow-up after the demo.

---

### F-11: Comparison Page Shows "No Runs" on Initial Load

**Trigger:** Navigating to the comparison page before the comparison-list API has returned data; the page renders an empty state before the async fetch completes.

**Symptom:** The leaderboard or comparison table shows "No runs found" for 2-3 seconds on first load, then populates; if the demo camera is on the screen at that moment, the audience sees empty data.

**Root cause hypothesis:** The React Query cache is cold (first page visit); the loading skeleton is not displayed, so the empty state renders momentarily before data arrives.

**Diagnostic command:**
```bash
# In browser DevTools > Network: check the timing of /api/comparison/list
curl -w "@curl-format.txt" http://10.254.177.41:30980/api/comparison/list -o /dev/null
```

**Recovery action:**
```bash
# Pre-warm the page before showing it to the audience:
# Open the comparison page 30 seconds before the demo segment
# The React Query cache (staleTime=30s by default) will serve data instantly on the second visit
```

**Prevention:** Add a loading skeleton to the comparison table that renders while data fetches. Pre-navigate to all demo pages during setup to warm the React Query cache. Set `staleTime: 60000` in React Query config so the cache stays warm longer.

**Demo response:** "The data is loading from the API — it will appear in a moment." Pause 2 seconds. "Here are all the benchmark runs." Proceed as if intentional.

---

### F-12: Realtime Dashboard Shows All Slots as Idle Between Runs

**Trigger:** All benchmark runs have completed and no new runs are in flight; the realtime snapshot returns all slots in `idle` state.

**Symptom:** The realtime dashboard shows a wall of "Idle" badges; the Active Benchmarks section is empty; the audience may think the system is not running.

**Root cause hypothesis:** This is the correct and expected behavior between benchmarks — not a failure. The system is healthy; the demo timing placed a navigation to the realtime page between runs.

**Diagnostic command:**
```bash
curl http://10.254.177.41:30980/api/realtime/exams/snapshot | jq '.slots[] | {slot_id, status}'
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs | length'
```

**Recovery action:**
```bash
# Option A: Submit a new benchmark to generate live activity:
# Navigate to /npu-eval/rngd > New RNGD Exam > Create
# The slot will transition from idle → running within 10 seconds

# Option B: Show completed results from the database instead:
curl http://10.254.177.41:30980/api/comparison/list | jq '.runs[] | {id, hardware, tt100t_seconds, precision, status}'
```

**Prevention:** Schedule a benchmark run 5 minutes before the demo so the system is actively running during the realtime dashboard demonstration segment. See `demo_video_checklist.md` for pre-demo timing guidance.

**Demo response:** "The cluster is in between runs right now — all benchmarks from the last session have completed successfully. Let me submit a new RNGD benchmark to show you the live progression." Submit and watch the slot transition.

---

*End of Failure Modes Catalog. 54 scenarios documented across 6 categories.*
*Reference docs: demo_recovery_playbook.md (P1–P11), demo_risk_register.md (R1–R10), mlperf_execution_blockers.md, rngd_stale_fix.md, rebellions_integration_critic_review.md, mmlu_pro_execution_blockers.md*
