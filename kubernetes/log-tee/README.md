# log-tee: Benchmark Pod Sidecar Log Tee

## What This Does

Provides a Loki SPOF mitigation per **WS-A05 / WS-0.2**.

Loki scrapes logs at a fixed interval (default 30 s). Benchmark Pods that crash
within a scrape window can produce log lines that never reach Loki. This
sidecar addresses that gap by writing a persistent on-disk copy of every log
line via `tail -F /proc/1/fd/1 /proc/1/fd/2`.

A **Kyverno ClusterPolicy** (`kyverno-sidecar-policy.yaml`) automatically
mutates any Pod with the label `etri.llm/role=benchmark` at CREATE time,
injecting:

- A `log-tee` sidecar container (busybox:1.36) that tees stdout/stderr to
  `/var/log/benchmark-tee/<pod-name>.log`
- A volume binding the shared PVC (`benchmark-log-tee-pvc`)

`failurePolicy: Ignore` ensures that a Kyverno outage never blocks benchmark
Pod scheduling (architect NEW-2: SPOF mitigation must not itself be SPOFable).
The sidecar tolerates `node.kubernetes.io/disk-pressure` for the same reason.

## Files

| File | Purpose |
|------|---------|
| `pvc.yaml` | 100 Gi ReadWriteMany PVC backed by `nfs-client` storage class |
| `kyverno-sidecar-policy.yaml` | Kyverno ClusterPolicy that injects the sidecar |
| `README.md` | This file |

## Apply Order

```
1. cert-manager          # Kyverno webhook TLS dependency
2. kyverno               # admission-webhook must be running before policy is applied
3. kubectl apply -f kubernetes/log-tee/   # PVC + ClusterPolicy
```

The PVC must exist before any benchmark Pod is scheduled; the ClusterPolicy
mutates the Pod spec to reference `benchmark-log-tee-pvc` by name.

## Verify Sidecar Injection

After a benchmark Pod is running:

```bash
kubectl get pod <benchmark-pod> -n llm-evaluation -o yaml \
  | yq '.spec.containers[].name'
# Expected output includes: log-tee
```

Or list all containers in short form:

```bash
kubectl get pod <benchmark-pod> -n llm-evaluation \
  -o jsonpath='{.spec.containers[*].name}'
```

## Fetch Logs From a Dead Pod

The log file persists on the PVC after Pod termination. Use any running Pod
that mounts the same PVC (or a debug Pod):

```bash
# Inspect available log files
kubectl exec <any-pod-with-pvc-mount> -n llm-evaluation -- \
  ls /var/log/benchmark-tee/

# Read the dead Pod's log
kubectl exec <any-pod-with-pvc-mount> -n llm-evaluation -- \
  cat /var/log/benchmark-tee/<dead-pod-name>.log
```

If no running Pod mounts the PVC, spin up a temporary debug Pod:

```bash
kubectl run log-reader --rm -it --restart=Never \
  -n llm-evaluation \
  --image=busybox:1.36 \
  --overrides='{
    "spec": {
      "volumes": [{"name":"tee","persistentVolumeClaim":{"claimName":"benchmark-log-tee-pvc"}}],
      "containers": [{"name":"log-reader","image":"busybox:1.36",
        "command":["sh"],
        "volumeMounts":[{"name":"tee","mountPath":"/var/log/benchmark-tee"}]}]
    }
  }' -- sh
```

## Log Retention

**TODO (next story):** The PVC has no built-in log rotation. The 100 Gi
volume fills over time. Recommended follow-up:

- Add a CronJob that runs `find /var/log/benchmark-tee -mtime +7 -delete`
  nightly to enforce 7-day retention.
- Or configure logrotate in the sidecar init script.

Until that story ships, monitor PVC usage with:

```bash
kubectl exec <pod> -n llm-evaluation -- \
  df -h /var/log/benchmark-tee
```

## log_source Field (WS-A05)

**Verification result:** `log_source` field is **not present** in current
result entity schemas under `server/src/`. Per WS-A05 the field is required
to distinguish Loki-sourced vs PVC-tee-sourced log retrieval.

**Deferred to next story:** Add `log_source` enum (`loki` | `pvc_tee`) as a
schema migration on result entities. This executor scope (US-NEXT-6) covers
only the sidecar infrastructure manifests.

## Uninstall

```bash
# Remove ClusterPolicy and PVC binding (PVC data is NOT deleted)
kubectl delete -f kubernetes/log-tee/

# To also delete the PVC and all tee'd logs (DESTRUCTIVE):
kubectl delete pvc benchmark-log-tee-pvc -n llm-evaluation
```

> Warning: deleting the PVC permanently destroys all tee'd log files that
> were not already shipped to Loki.
