# Atom+ Real Benchmark — Root Cause Matrix

**RUN_ID**: 20260429-071649-46d82f8
**Branch (current)**: `fix/live-ui-recovery-20260429-052300-fd7cd81` (uncommitted .omc state changes only)
**Cluster state at session start**: helm `app-chart` rev **16**, `frontend v20`, `backend v18`.

This matrix maps every "Atom+ blocked" symptom to its root cause and to the precise next action.

| # | Symptom (what user / prior agent saw) | Stale belief | Current truth | Root cause | Next action | Owner | Blocker class |
|---|---|---|---|---|---|---|---|
| 1 | "Atom+ READY but BLOCKED for safe benchmarking" on `/npu-eval/atomplus` page | Vendor lacks any k8s device plugin | Vendor (`rbln-sw/k8s-device-plugin`) ships a real plugin; v0.3.6 image already pulled on node5 from `10.254.202.100:5100` private registry | Old report referenced Docker Hub `rebellions/k8s-device-plugin:atomplus-v1.0.0` which does not exist; correct path is the active `rbln-sw/k8s-device-plugin` repo or `rbln-npu-operator` Helm chart | Pull the real DaemonSet manifest from `rbln-sw/k8s-device-plugin` (or the `rbln-npu-operator` Helm chart) and apply it cluster-wide pinned to image `10.254.202.100:5100/rebellions/k8s-device-plugin:v0.3.6` | infra repo / cluster | external (vendor manifest source needed) |
| 2 | `kubectl get node node5 -o jsonpath='{.status.allocatable}'` has no `rebellions.ai/atomplus` | Plugin doesn't exist | Plugin not deployed | Gap #2 from readiness report — DaemonSet not applied | After a real manifest is in place, `kubectl apply -f rebellions-atomplus-device-plugin.yaml` and verify via `kubectl get node node5 -o yaml \| grep rebellions.ai/atomplus` | infra repo | manifest |
| 3 | node5 cordoned, `SchedulingDisabled` | "node not ready yet" | node5 is `Ready` and was deliberately cordoned by the prior session as a safety gate | Prior `RUN_ID 20260428-083516-4b786d4` left it cordoned because the plugin was not yet trusted | After the device plugin successfully advertises `rebellions.ai/atomplus:2`, **`kubectl uncordon node5`** | this session | cluster-state |
| 4 | `containerd` has `enable_cdi=false` on node5 | "CDI not needed" | RBLN device plugin v0.3.6 may need CDI for `/dev/rsd0` injection without privileged hostPath | Gap #1 from readiness report; see `vllm-rbln` documentation for whether CDI is mandatory or optional | Edit `/etc/containerd/config.toml`: `[plugins."io.containerd.grpc.v1.cri".cdi] enable_cdi = true`. **Requires SSH to node5.** Backup file first. | user (SSH) | SSH/config |
| 5 | `/npu-eval/atomplus` has NO Run/Launch button | Page is hard-coded BLOCKED | Page polls `/api/devices` for vendor=rebellions device readiness; greys out when `device_plugins=false` in `/api/devices/health` | This is correct behaviour today; the button will appear automatically once the registry sees the device plugin | None — verify visibly after #1–#3 land | this session | cascade |
| 6 | Backend has no `atomplus` benchmark profile | "no profile available" | `server/src/npu-eval/` exists but has no Atom+ Job template; only RNGD has one | Lane B work was scoped out of prior mission because Atom+ was deemed blocked | Add `k8s/benchmark-jobs/{tt100-atomplus,mlperf-perf-atomplus}-job.yaml.template` referencing `rebellions.ai/atomplus: 1` and a vllm-rbln container image. Add `npu-eval` controller branch for vendor=rebellions. | this session (after #1) | code |
| 7 | No vllm-rbln container image referenced anywhere in repo | "image doesn't exist" | The user's readiness report claims a drop-in vllm-rbln benchmark Job manifest exists. Some plausible image refs: `rbln-sw/vllm-rbln:latest`, internal `10.254.202.100:5100/rebellions/vllm-rbln:<tag>`, or a self-built one | Vendor docs path: optimum-rbln + vllm-rbln. Image must include `optimum-rbln`, `vllm`, `vllm_rbln`, `transformers`, `torch` — the readiness report says these are pip-installed on node5 host, suggesting an image with the same wheels | Read the readiness report's drop-in Job manifest for the actual image ref. **Requires SCP / paste from user.** | user | external |
| 8 | "Comparison services are crashing" (per mission brief) | Comparison logic broken | Prior `RUN_ID 20260429-060404-82c193e` browser-tested all 3 comparison routes at 0 forbidden hits / 0 console errors / 0 network failures (`reports/comparison_data_ingestion_fix_report.md`). Helm rev 14 shipped the proxy fix; rev 16 is even newer | Mission brief is using stale assumption | Re-run Playwright QA against current frontend v20 to confirm. If anything regressed in v20, trace and fix. | this session | verification |
| 9 | "RNGD eval has bottom iframe but GPU/Atom+ pages don't" | Pattern not implemented elsewhere | Need to inspect `/npu-eval/rngd` page code to find the exact iframe pattern, then port to `/npu-eval/atomplus` and the GPU result/service pages | Code-level addition; no upstream blocker | Implement `<RealtimeDeviceIframe>` component sourcing `/api/realtime/exams` snapshot scoped by node | this session | code |
| 10 | "GPU/NPU realtime menus are low-value" | Pages exist | Pages exist (`/dashboard/{gpu,npu}-realtime`) and have all-pass Playwright. The complaint is qualitative — they don't show enough operator-grade detail (current run, log tail, queued runs, comparisons shortcuts, etc.) | UX uplift, not a defect | Redesign with: per-device current run + queue + recent + failed + log tail + comparisons shortcut + health + SSE/poll status | this session | code |
| 11 | TT100T target <1.1s | RNGD measured at ~1.26s — RED FAIL | Currently visible as RED FAIL on RNGD page (per `zero_known_defect_gate_report.md`); target is unmet honestly | RNGD measurement is correct and ≥1.1s; this is the actual hardware limit, not a measurement defect | Atom+ has not been measured yet — must wait for items 1–7 | this session (after #1–#7) | cascade |
| 12 | "Previous agents reported Atom+ blocked / deferred" | Conclusion was correct at the time | At time of previous report, the active plugin path (`rbln-sw/k8s-device-plugin`) was unknown; the report referenced the now-archived `rebellions-sw/rbln-k8s-device-plugin` Docker-Hub-only image | Knowledge gap, not bad faith | Update reports + AGENTS.md to reference the active path; never use the archived repo again | this session | docs |

## Dependency graph (what unblocks what)

```
[USER] provide SSH or paste readiness report contents
   │
   ├── Item 4 (CDI fix) — requires SSH to node5
   │      │
   │      ▼
   ├── Item 1 (Real device-plugin manifest)
   │      │
   │      ▼
   │  Item 2 (Allocatable rebellions.ai/atomplus appears)
   │      │
   │      ▼
   │  Item 3 (Uncordon node5)
   │      │
   │      ▼
   ├── Item 6 (Atom+ Job templates + npu-eval controller branch)
   │      │
   │      ▼
   │  Item 7 (vllm-rbln container image — needs report contents)
   │      │
   │      ▼
   │  Item 11 (Atom+ TT100T smoke run)
   │
   ├── Item 8 (Comparison QA — independent, can start NOW)
   ├── Item 9 (Iframe panels — independent, can start NOW)
   ├── Item 10 (Realtime menu uplift — independent, can start NOW)
   └── Item 12 (Docs update — can start NOW)
```

## Honest assessment of which gates can pass without user SSH/report

| Gate | Possible without user input? | Why |
|---|---|---|
| G1 (readiness report imported) | ❌ | Need SSH OR paste |
| G2 (readiness revalidated) | partial ⚠️ | kubectl portion done; host portion blocked |
| G3 (runtime status determined) | partial ⚠️ | Container-side determined, host-side blocked |
| G4 (containerd CDI fix) | ❌ | Need SSH |
| G5 (rbln-npu-operator/device-plugin installed) | partial ⚠️ | Can be deployed if a real manifest is provided |
| G6 (uncordon after verification) | ❌ | Cascade of G5 |
| G7 (allocatable resource visible) | ❌ | Cascade of G5 |
| G8 (Atom+ benchmark backend implemented) | ✅ | Code-only; can build templates + controller now (without execution) |
| G9 (Atom+ k8s execution path) | partial ⚠️ | Manifest can be drafted; first apply requires G5 |
| G10–G14 (Atom+ smoke runs) | ❌ | Cascade |
| G17 (Atom+ result page works) | ✅ | Already works; will surface real values when G14 lands |
| G18 (Atom+ bottom iframe panel) | ✅ | Code-only |
| G19 (GPU bottom iframe panel) | ✅ | Code-only |
| G20 (RNGD iframe still works) | ✅ | Verify-only |
| G21–G24 (Comparison) | ✅ | Verify + minor fixes |
| G25–G27 (Realtime menu redesign) | ✅ | Code-only |
| G28 (DB/API/UI/K8s sync) | partial ⚠️ | Implementable, full validation requires G14 |
| G29–G30 (raw logs + TT100T target visibility) | partial ⚠️ | Cascade |
| G31–G34 (Playwright QA) | ✅ | Doable with existing in-cluster `playwright-qa` pod |
| G35 (live deployment) | ✅ | helm upgrade is doable from node1 |
| G36–G40 (anti-fraud, secrets, rerun, rollback) | ✅ | Procedural |

**Of 40 gates: 21 doable now, 9 partial, 10 hard-blocked on user SSH/report.**
