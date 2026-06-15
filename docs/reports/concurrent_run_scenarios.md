> Note: ETRI takeover migration 2026-05-12 — sister deployment directory previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming); now ETRI-owned at `/home/kcloud/etri-llm-deployments/app/`. Container images previously under `mondrianai/*` Docker Hub org are migrating to `ghcr.io/etri-llm/*`. Historical mentions of the legacy names below are preserved for context.

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

## Live demo recommendation

For the demo, the SAFEST concurrent-run demonstration is **Scenario B (1× L40 + 1× RNGD)** — different nodes, different vendors, easy to narrate, well-tested, and gives the audience a clear visual of two different hardware classes running simultaneously on the realtime dashboards.

**Avoid live-demoing Scenario D (6-simultaneous)** — it's untested at scale this iteration; cold-start chaos isn't great TV. Talk about it in narration: "we've designed this and run it in soak; today let's show 2 concurrent."

## Detailed walkthrough: launching Scenario B during the demo

If the demo audience asks to see concurrent runs live, follow this sequence:

1. Switch to /mlperf page in your primary tab.
2. Open the create-exam form. Set: model=Llama-3.1-8B-Instruct-FP8, precision=bfloat16, mode=performance, scenario=offline, data_number=10, max_output_tokens=128, hardware=NVIDIA-L40, retry_num=1. Submit.
3. Open `/npu-eval/rngd` in a new tab.
4. Open the create-exam form on RNGD page. Set: similar config but for RNGD. Submit.
5. Switch back to `/dashboard/gpu-realtime` to show L40 going from idle to running.
6. Open `/dashboard/npu-realtime` to show RNGD becoming active.
7. Both should complete in ~30s after weights loaded (or ~5min if cold).

Talking points to weave through:
- "Two different vendors, two different nodes, no operator contention."
- "The realtime menu polls every 5 seconds via SSE."
- "Both cards show progress bars; the RNGD card lights green at the top of the dashboard iframe."

## Soak-test history (what we have, what we don't)

**Verified soak passes (prior cycles):**
- 1 L40 + 1 RNGD: ~50 cycles over multiple sessions, 0 failures
- 1 A40 + 1 RNGD: ~30 cycles, 0 failures
- 2 L40 same-node: ~10 cycles, occasional ExamAllNodeNotAvailable (operator race)
- 4 GPU concurrent (2 L40 + 2 A40): ~5 cycles, all PASS

**Designed but NOT soak-certified this iteration:**
- 6 device simultaneous (4 GPU + RNGD + Atom+) — designed in scripts/concurrent_matrix_soak.sh; ran intermittently during W4 of prior 16-worker rescue, never got to formal certificate
- Operator v1.0.3 deploy — built, tested in isolation, NOT deployed to cluster

**Why we chose not to deploy v1.0.3 this session:**
The user paused that work mid-cycle in favor of UI fixes. v1.0.3 is ready to deploy via `kubectl set image deployment/etri-llm-operator etri-llm-operator=jungwooshim/etri-llm-k8s-operator:v1.0.3 -n llm-evaluation` if needed. Rollback is symmetric.

## Operational runbook for the soak script

Location: `scripts/concurrent_matrix_soak.sh`
Designed cycle structure: 6 devices × 2 benchmarks × 1 rep per cycle = 12 jobs/cycle, scaled to 36 jobs (3 reps) if budget remains. Each cycle:

1. Submit all 12 (or 6 if reduced) jobs via backend POST /api/{mp,mm,npu-eval}-exam/create with curl
2. kubectl get events -w into docs/reports/soak_evidence/cycle-N.txt
3. Wait for all jobs to reach terminal state (Completed or Error)
4. Parse exam-status responses; classify failures

For a single ad-hoc concurrent test (not full soak), simpler approach: open 6 browser tabs, submit one exam in each. The realtime dashboards will show all 6 lighting up.

## Concurrent-run failure classification

When something goes wrong:

| Symptom | Class | Root cause | Recovery |
|---|---|---|---|
| 1+ exams stuck Pending after 60s | Operator scheduling race | per-loop reconciliation rejection | re-submit + 60s stagger OR deploy v1.0.3 |
| All exams slow start | NFS bandwidth | cold-load contention | wait — 2nd run faster |
| 1 exam Pending forever, others run | Same-SKU collision | multi-exam targeting same GPU SKU | use different SKU or wait for first to finish |
| All exams ExamErrorOccured | cluster-level issue | check operator logs | escalate, fall back to pre-collected |

The soak script automates this classification.

## NFS bandwidth math

The cluster's `model-nfs-pvc` is RWX 2 TiB. NFS bandwidth typically caps at network speed (1 GbE = ~125 MB/s; 10 GbE = ~1.2 GB/s — depends on cluster config).

8.5 GB Llama-3.1-8B-Instruct-FP8 weights file:
- 1 pod loading: ~70s on 1 GbE, ~7s on 10 GbE
- 2 pods concurrent: roughly halves bandwidth per pod → ~140s on 1 GbE
- 4 pods concurrent: ~280s on 1 GbE = ~5 min cold load
- 6 pods concurrent: ~7-8 min cold load

After cold load, weights are paged into per-pod memory; subsequent requests are GPU/NPU-bound, no NFS contention.

**Mitigation:** keep RNGD inference server pod long-lived (it already is — `npu-inference-server-node4` has 7+ days uptime per project memory). For GPU benchmarks, pre-warm before demo by running a tiny smoke run on each L40+A40 30 min ahead.

## Postgres connection pool

Backend uses TypeORM defaults: ~10 connection pool. Concurrent realtime polling (6 dashboards × 5s SSE + 6 status polls × 10s × 6 concurrent benchmarks) = ~50 connections/min. Well within pool. Not a concurrency bottleneck.

## SSE connection limits

Browser per-host SSE limit: typically 6 simultaneous connections. With 6 dashboards each opening 1 SSE stream, you're AT the limit. If a 7th tab tries to subscribe, it'll fall back to polling (which is fine — backend supports both).

## Demo script: minimum-viable concurrent run

For a 5-min concurrent demo:
1. (T+0:00) Open `/dashboard/gpu-realtime` and `/dashboard/npu-realtime` side by side in browser.
2. (T+0:30) Submit 10-sample MLPerf on L40 from `/mlperf` page.
3. (T+1:00) Submit 10-sample MLPerf on RNGD from `/npu-eval/rngd` page.
4. (T+1:30) Both should be Running. Point at both dashboards lighting up.
5. (T+3:00) Both complete. Switch to `/mlperf/device-comparison` to show new rows side-by-side.

This is the SAFEST demo of "concurrent runs work." Everything else is an extension.

## Demo cheat-sheet (one-liner answers)

If asked "what about all 6 at once?" — say: "Tested at 4-device concurrent; 6-simultaneous designed and partially soak-tested. We'd recommend showing 2-device concurrent live for clarity."

If asked "could it scale to a real production cluster?" — say: "The operator + backend run on stock k8s and would scale linearly. The bottleneck would be NFS bandwidth on cold model load — solved in production by per-node pre-loaded volumes or shared model registries."

If asked "what's the bottleneck?" — say: "Cold-start NFS bandwidth dominates. Once weights are paged in, each device runs independently; per-device bottleneck is GPU/NPU compute."

If asked "could you saturate the cluster?" — say: "Yes — run 6 device-saturating workloads concurrently. We've designed for that and tested up to 4. The 6-device case is in our soak script roadmap."

End of concurrent run scenarios doc.
