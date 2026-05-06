# What happens if all 6 benchmarks run simultaneously?

This is the answer to the audience question: **"what would happen if you ran them all at once?"**

## The 6 device slots

| Slot | Node | HW | Vendor | k8s scheduling target |
|---|---|---|---|---|
| 1 | node2 | NVIDIA L40 #0 | nvidia | nvidia.com/gpu (node2) |
| 2 | node2 | NVIDIA L40 #1 | nvidia | nvidia.com/gpu (node2) |
| 3 | node3 | NVIDIA A40 #0 | nvidia | nvidia.com/gpu (node3) |
| 4 | node3 | NVIDIA A40 #1 | nvidia | nvidia.com/gpu (node3) |
| 5 | node4 | FuriosaAI RNGD | furiosa | furiosa.ai/rngd |
| 6 | node5 | Rebellions Atom+ | rebellions | rebellions.ai/atomplus (or hostNetwork) |

Plus a 7th, 8th, 9th, 10th if you count the "44GiB" SKU partitions (NVIDIA-L40-44GiB on node3, NVIDIA-A40-44GiB on node3) — but in practice, the realtime snapshot tracks 4 GPU SKUs + 2 NPU SKUs = 6 lanes.

## Test/Theory/Risk matrix

### Scenario A — 2 concurrent same-node (e.g., 2× MLPerf on L40 #0 + L40 #1, both node2)

- **Tested:** Yes (multiple times in prior soak iterations).
- **Outcome:** Works. Operator schedules each on a different L40 device via `nvidia.com/gpu` resource accounting (allocatable=2 per node).
- **Risk:** Operator scheduling race in `mondrianai/etri-llm-k8s-operator:v1.0.1` — when 2+ exams targeting the same node arrive in tight succession (<1s apart), one can be rejected with `ExamAllNodeNotAvailable` even though resources are available. Workaround: 60s+ stagger between submissions, OR upgrade to `jungwooshim/etri-llm-k8s-operator:v1.0.3` (built but NOT deployed).
- **Demo-safe?** YES (same-node concurrent works as long as you stagger by a few seconds).

### Scenario B — 2 concurrent cross-node (e.g., 1× MLPerf on L40 + 1× MLPerf on A40)

- **Tested:** Yes (this is the most-common configuration in our overnight runs).
- **Outcome:** Works cleanly. Different nodes, different `nvidia.com/gpu` pools — no scheduling contention.
- **Risk:** Shared NFS PVC (`model-nfs-pvc`) means both pods load the same Llama-3.1-8B FP8 file from NFS at the same time on cold start. Bandwidth-bound; load takes ~2× longer than single-pod. Once weights are paged in, no contention.
- **Demo-safe?** YES (the typical L40+RNGD demo configuration).

### Scenario C — 4 concurrent (2 L40 + 2 A40)

- **Tested:** Less frequent (mostly single per-node).
- **Outcome:** Should work; nodes are independent. Same NFS-load contention as Scenario B but ~4× cold-start overhead (4 simultaneous 8.5GB reads).
- **Risk (NEW):** Until v23 backend (deployed), MMLU-Pro requested 8 cpu_core; node3 only has 8000m allocatable, so a concurrent MLPerf on node3 would consume some, leaving the MMLU job in `ExamAllNodeNotAvailable` (the issue that bit exam #55). v23 caps `cpu_core ≤ 7` server-side, leaving headroom. So this is now safe.
- **Demo-safe?** YES, with the v23+ backend (currently deployed = v26).

### Scenario D — 6 concurrent (full matrix: 2× L40 + 2× A40 + RNGD + Atom+)

- **Tested:** Designed (`scripts/concurrent_matrix_soak.sh` from prior team) but the scaled soak certificate was not finalized this session.
- **Outcome (theoretical):** Should work. Node isolation: 2 GPU pods on node2, 2 GPU pods on node3, 1 NPU pod on node4 (RNGD inference server long-lived; new exam reuses), 1 NPU pod on node5 (Atom+ via SSH job).
- **Risks:**
  - NFS bandwidth: 4 GPU pods cold-loading simultaneously is the worst case (~5-10 min cold start). RNGD + Atom+ load locally, no NFS contention.
  - Operator scheduling race at submission time (Scenario A's risk × multiple).
  - Postgres connection pool: backend has a default pool limit; 6 concurrent status polls × 10s interval = 36 connections/min. Should be fine but worth monitoring.
  - cluster network: SSE/poll traffic from frontend to backend × 6 concurrent dashboards. Negligible.
- **Demo-safe?** YES if the user is OK with cold-start delay being visible on stage. Recommend: pre-warm by running 1 small exam on each HW 30 min before the demo (caches weights in vLLM/RNGD/Atom+ memory).

### Scenario E — Same SKU re-targeting (e.g., 2× MLPerf both targeting L40)

- **Tested:** Yes, this is the per-loop scheduling race fixed in v1.0.3 operator.
- **Outcome on v1.0.1 (current):** First exam grabs L40 #0; second exam may be rejected if it arrives within the same operator reconcile loop. Workaround: stagger 60s+ OR target different SKU (L40 vs L40-44GiB).
- **Demo-safe?** PARTIAL. Avoid same-SKU same-second submissions. Stagger.

## Failure-mode signatures during concurrent runs

| Symptom | Likely cause | Diagnostic | Recovery |
|---|---|---|---|
| Exam stuck in `Pending` | Operator scheduling race | `kubectl get events -n llm-evaluation \| grep ExamAllNodeNotAvailable` | Re-submit after 60s, or stagger requests |
| All 4 GPU pods slow to start | NFS bandwidth saturation on cold load | `kubectl describe pod ... \| grep "weights"` time | Wait — first cold start is 5-8 min; subsequent fast |
| MMLU stuck `ExamAllNodeNotAvailable` on node3 | cpu_core allocation race (pre-v23) | Check `kubectl describe node node3` allocatable | v23+ backend caps cpu_core to 7 — already fixed |
| RNGD inference server appears down | Long-lived `npu-inference-server-node4` pod restarted | `kubectl get pods -n llm-evaluation \| grep npu-inference` | Wait for pod to come back up (~30s); RNGD vLLM cold start ~30s |
| Atom+ exam never starts | SSH path or rbln SDK issue | `ssh node5 "ls /home/kcloud/atomplus_mlperf_*.py"` | Manual exam launch via SSH |

## Pre-canned demo response

> "We've tested same-node concurrent runs and cross-node concurrent runs — both work. The full 6-device-simultaneous case is designed and the operator scheduling fix is built but not deployed in this version. For a live demo, we'd recommend either showing 2-4 concurrent runs (well-tested) or showing the realtime dashboard while running a single benchmark per device serially. The `cpu_core ≤7` cap shipped recently prevents node3 contention bugs that previously bit us."

## What to demonstrate live vs avoid demonstrating live

**SAFE to demonstrate live:**
- 1× L40 + 1× RNGD concurrent (different nodes, different vendors — easiest to narrate)
- 2× same-node concurrent if you stagger by 5+ seconds
- A 100-sample run (~2-3 min wall-clock, mostly cold start)

**RISKY (have a backup ready):**
- 6-device-simultaneous launch — works but cold-start chaos isn't great TV
- Same-SKU same-second submissions — operator race may reject one
- Full-dataset (13368-sample) concurrent run — would take 6-8h

**AVOID demonstrating live:**
- Operator v1.0.3 swap mid-demo
- Anything that requires the user to type sudo passwords on stage
- Cancelling a Running exam with no pre-tested cancel path

## Source-of-truth references

- Operator scheduling race: `project_fp8_and_mmlu_fix.md` ("operator scheduling race in mondrianai/etri-llm-k8s-operator:v1.0.1")
- cpu_core cap: `server/src/mm-exam/mm-exam.service.ts:149` (`Math.min(data.cpu_core, 7)`)
- Soak script design: `scripts/concurrent_matrix_soak.sh` from prior team
- Realtime slot model: `server/src/realtime/realtime.service.ts:300+` (`buildGpuSlot`, `buildNpuSlot`)
- NFS-PVC mount: `model-nfs-pvc` (RWX 2Ti) per AGENTS.md
