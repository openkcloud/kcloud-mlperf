# Rebellions Device Plugin Integration — Deployment State

## Summary

The rbln-device-plugin is running on node5 and reports 2 allocatable Rebellions ATOM NPUs.
The cluster uses the legacy resource name `rebellions.ai/ATOM` (not the newer `rebellions.ai/npu`).

## Component Status

| Component | State | Notes |
|---|---|---|
| rbln-device-plugin DaemonSet | Running (node5) | Namespace: rbln-system |
| rbln-daemon | ImagePullBackOff | Missing drivercred secret — non-critical; host kernel module already loaded |
| Host driver | Loaded (rebellions 2.0.1) | Kernel module present on node5 host |
| Allocatable resource | `rebellions.ai/ATOM` | count=2 on node5 |

## rbln-daemon ImagePullBackOff — Why Non-Critical

The rbln-daemon pod fails to pull its image due to a missing image-pull credential (`drivercred` secret).
However, the Rebellions driver is already loaded as a host kernel module (version 2.0.1), so NPU access
functions correctly. The rbln-daemon is a supplementary monitoring/management daemon, not the device
plugin itself. Benchmark workloads can proceed.

## Commands to Verify State

```bash
# Check node5 allocatable resources
kubectl describe node node5 | grep -A5 "Allocatable"

# Check device plugin pods
kubectl get pods -n rbln-system -o wide

# Check rbln-daemon image pull error
kubectl describe pod -n rbln-system -l app=rbln-daemon | grep -A10 "Events"

# Verify resource is schedulable
kubectl get node node5 -o json | jq '.status.allocatable | to_entries[] | select(.key | contains("rebellions"))'
```

## Expected K8s Resources

When scheduling a benchmark job against Atom+ NPU, use:

```yaml
resources:
  limits:
    rebellions.ai/ATOM: "1"
```

Do NOT use `rebellions.ai/npu` — that is the new RBLN convention but this cluster registers under the
legacy `ATOM` resource name as reported by the device plugin.

## /api/devices Response (verified 2026-05-06)

```json
[
  {
    "node": "node5",
    "type": "npu",
    "vendor": "rebellions",
    "model": "ATOM",
    "state": "ready",
    "allocatable_resource_name": "rebellions.ai/ATOM",
    "allocatable_count": 2
  }
]
```

## UI Integration

The Atom+ evaluation page (`/npu-eval/atomplus`) now queries `/api/devices` on load.
If any device with `vendor='rebellions'` and `state='ready'` is found, the full exam
creation form is shown. Otherwise a diagnostic Alert with kubectl commands is displayed.
