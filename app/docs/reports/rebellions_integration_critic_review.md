---
title: Rebellions / Atom+ Integration Critic Review
worker: R-3 (worker-3, critic)
revision: final
mission: benchsuite-resume
date: 2026-05-06
---

# Rebellions Integration Critic Review

Scope: Rebellions Atom+ end-to-end integration into the cluster + UI + benchmark stack. This is the most-at-risk vendor (newest hardware on the cluster, joined 7d ago) so it gets a dedicated critic axis.

Endpoint baseline: `kubectl --kubeconfig ~/.kube/config get …` against the live cluster at 2026-05-06T05:50Z.

---

## Per-criterion verdicts

### 1. rbln-device-plugin Running on node5

```
$ kubectl get pods -n rbln-system -o wide | grep -E "rbln-device-plugin|rbln-daemon"
rbln-container-toolkit-qmm7d                          1/1     Running        0   6d22h
rbln-daemon-n225x                                     0/1     ErrImagePull   0   6d22h
rbln-device-plugin-6rkfj                              1/1     Running        0   6d22h
rbln-npu-feature-discovery-d9zv9                      1/1     Running        0   6d22h
rbln-npu-operator-controller-manager-…                1/1     Running        9   6d22h
rbln-operator-validator-spd8d                         1/1     Running        0   6d22h
```

| Criterion | Evidence | Verdict |
|---|---|---|
| rbln-device-plugin pod Running | `rbln-device-plugin-6rkfj` 1/1 Running 6d22h | PASS |
| rbln-daemon Running | `rbln-daemon-n225x` 0/1 ErrImagePull 6d22h | NON-CRITICAL FAIL — but driver is installed on host (rebellions.ai/npu.driver.status=installed v2.0.1), so the daemon's image-pull failure does not block device discovery. Acceptable per Task #2 description. |

### 2. rebellions.ai/ATOM allocatable=2 on node5

```
$ kubectl describe node node5 | grep -A1 "rebellions.ai/ATOM"
Capacity:
  rebellions.ai/ATOM:  2
Allocatable:
  rebellions.ai/ATOM:  2
```

| Criterion | Evidence | Verdict |
|---|---|---|
| Capacity rebellions.ai/ATOM=2 | confirmed | PASS |
| Allocatable rebellions.ai/ATOM=2 | confirmed | PASS |
| K8s resource name correct | `rebellions.ai/ATOM` (NOT `rebellions.ai/npu`) per Task #2 description; matches actual cluster | PASS |

### 3. NFD labels for rebellions on node5

```
rebellions.ai/driver-version.full: 2.0.1
rebellions.ai/npu.count: "2"
rebellions.ai/npu.family: ATOM
rebellions.ai/npu.present: "true"
rebellions.ai/npu.product: RBLN-CA22
rebellions.ai/npu.driver.status: installed
```

| Criterion | Evidence | Verdict |
|---|---|---|
| NFD discovery labels populated | all rebellions.ai/* labels present including npu.product=RBLN-CA22 | PASS |
| Driver version reported | 2.0.1 | PASS |
| npu.deploy.* labels present | container-toolkit, device-plugin, dra-kubelet-plugin, driver, metrics-exporter, npu-feature-discovery, operator-validator, rbln-daemon all = "true" | PASS |

### 4. Atom+ exam creation enabled in UI

| Criterion | Evidence | Verdict |
|---|---|---|
| Source-axis: "exam creation disabled" Alert removed from atomplus/index.tsx | grep returns 0 occurrences of "exam creation disabled" in the source file. The `<Alert severity="info">…Awaiting device plugin — exam creation disabled…</Alert>` block was replaced. | PASS |
| Source-axis: conditional Create button gated on hasReadyDevice | `index.tsx:222` `{hasReadyDevice ? (<Button …>) : (<Alert severity="warning">No ready Rebellions device found…</Alert>)}` | PASS |
| Source-axis: form mounts NpuEvalApi.create with npu_type=ATOM | `index.tsx:142-148` createMutation; line 160-167 onSubmit → mutate({…, npu_type:'ATOM'}); line 100-114 ATOM_DEFAULT_VALUES with framework=optimum-rbln, precision=fp8, dataset=cnn_dailymail, data_number=100, max_output_tokens=128 | PASS |
| Deploy-axis: kaniko-frontend-v26 rolled out + curl HTML grep "New Atom+ Exam" present | NOT YET RE-VERIFIED in this session. The most recent kaniko-frontend build I can see is v25 from 3h29m ago (creating-frontend-pod time). v26 is in flight (per Task #2 description). | NEEDS-DEPLOY |

### 5. Diagnosis shown when devices unready (synthetic test)

| Criterion | Evidence | Verdict |
|---|---|---|
| When DevicesApi returns no rebellions device → fallback Alert | `index.tsx:228-235` shows `<Alert severity="warning">No ready Rebellions device found in cluster. Run: kubectl get nodes -l kubernetes.io/hostname=node5 …</Alert>` with three diagnostic kubectl commands | PASS |
| Synthetic test (forcing the fallback path) | DevicesApi.list never returns 0 rebellions on the live cluster (allocatable=2) so live verification of the warning Alert requires either (a) cordoning node5 or (b) hitting the page from a non-cluster build target. The branch is unit-testable; e2e_verification_report should run a unit test that mounts AtomPlusNpuEvalPage with a stub returning empty rebellionsDevices. | NEEDS-VERIFY (test coverage) |

### 6. Atom+ MLPerf benchmark integration (data-axis)

| Criterion | Evidence | Verdict |
|---|---|---|
| Atom+ FP8 100-sample MLPerf run completed | row id=74 status=Completed, tt100t=1.37s, tps=73.3, drift_flag=False | PASS |
| Run reproducible | logs/benchmarks/mlperf_atomplus_*.log + scripts/atomplus_mlperf_full.py | PASS |
| Vendor-native quantization used | model=`rebellions/Llama-3.1-8B-Instruct`, framework=`optimum-rbln`, precision=`fp8` | PASS |

---

## Summary

| Aspect | Verdict |
|---|---|
| K8s device plugin layer | PASS (1 non-critical sub-failure: rbln-daemon ImagePull, host driver compensates) |
| NFD discovery | PASS |
| UI exam creation enable | PASS source-axis, NEEDS-DEPLOY deploy-axis (v26 build pending) |
| Diagnosis fallback | PASS source-axis, NEEDS-VERIFY test coverage |
| Benchmark data | PASS (id=74 contract-compliant FP8) |

**Final Rebellions integration verdict: PASS with NEEDS-DEPLOY caveat for the v26 frontend.** The Rebellions side of the cluster is functional end-to-end. Once R-2 confirms v26 frontend rolled out and the e2e verifier curls the deployed HTML for "New Atom+ Exam", this becomes a clean PASS.
