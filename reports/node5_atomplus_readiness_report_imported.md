# node5 Atom+ Readiness Report — Import Stub

**RUN_ID**: 20260429-071649-46d82f8
**Source path on node5**: `kcloud@10.254.202.111:/home/kcloud/rbln-node5-cluster-readiness.md`
**Local target path**: `/home/kcloud/rbln-node5-cluster-readiness.md`
**Import status**: ❌ **NOT IMPORTED — SSH BLOCKED**

## What was attempted

```bash
scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
    kcloud@10.254.202.111:/home/kcloud/rbln-node5-cluster-readiness.md ./
# → Permission denied (publickey,password)
ssh -o BatchMode=yes -o ConnectTimeout=5 kcloud@10.254.202.111 "echo OK"
# → Permission denied (publickey,password)
```

SSH to node5 from the agent's session on node1 fails because:

1. `~/.ssh/authorized_keys` on node1 lists only this session's accepted keys, NOT a private key for node5.
2. `BatchMode=yes` rejects password prompts in non-interactive contexts; without `BatchMode`, `scp` would still need a password the agent does not have.
3. Environment variable `SUDO_PASS` (used by the prior mission `RUN_ID 20260428-083516-4b786d4` via `sshpass -p "$SUDO_PASS" ssh kcloud@10.254.202.111 ...`) is **not set in this session**.

`sshpass` is installed at `/usr/bin/sshpass`, so a `SUDO_PASS` value would unblock automation immediately.

## TL;DR taken from the user prompt (authoritative starting context)

The user pasted the report's TL;DR in the mission prompt. The agent treats this as the imported summary until the canonical file is available:

- node5 hardware/software: healthy.
- 2× RBLN-CA22 ATOM+ NPUs, 16 GiB each.
- KMD/firmware version: **2.0.1**.
- `python -c "import rebel; print(rebel.device_count())"` → **2**.
- Already pip-installed on node5: `optimum-rbln`, `vllm`, `vllm_rbln`, `transformers`, `torch`.
- NFD labels (verified live by this session via `kubectl get node node5 -o yaml`):
  - `npu-vendor=rebellions` ✅
  - `npu-model=atomplus` ✅
  - `accelerator-type=npu` ✅
  - `accelerator-count=2` ✅
  - `benchmark.openkcloud.io/role=benchmark-worker` ✅
- **Two cluster-integration gaps remain**:
  1. `containerd` has `enable_cdi=false` on node5.
  2. `rbln-device-plugin` DaemonSet is not deployed cluster-wide.
  3. node5 is currently cordoned (`SchedulingDisabled`, taint `node.kubernetes.io/unschedulable:NoSchedule` — this session confirmed).
- The active device-plugin path is **`rbln-sw/k8s-device-plugin`** + **`rbln-npu-operator` Helm chart**.
- The legacy `rebellions-sw/rbln-k8s-device-plugin` repo was archived **2026-04-21** — must not use.

## Independently verified by this session (no SSH required)

| Claim from report | Verified via | Result |
|---|---|---|
| node5 is Ready | `kubectl get nodes` | ✅ `Ready,SchedulingDisabled` |
| node5 has correct NFD labels | `kubectl get node node5 -o yaml` | ✅ all 5 labels present |
| node5 currently cordoned | `kubectl describe node node5 \| grep Taints` | ✅ `node.kubernetes.io/unschedulable:NoSchedule` |
| `rebellions/k8s-device-plugin` image present on node5 | `kubectl get node node5 -o yaml \| grep -A1 images` | ✅ `10.254.202.100:5100/rebellions/k8s-device-plugin:v0.3.6@sha256:6933e25b…` |
| No Rebellions DaemonSet deployed | `kubectl get daemonset -A \| grep -i rebell` | ✅ nothing — gap #2 confirmed |
| No `rebellions.ai/atomplus` allocatable | `kubectl get node node5 -o jsonpath='{.status.allocatable}'` | ✅ only standard `cpu/memory/ephemeral-storage/pods` |

## What this session CANNOT verify without SSH

- `containerd` `enable_cdi` status on node5 (gap #1) — needs `cat /etc/containerd/config.toml`.
- KMD/firmware version 2.0.1 — needs `rbln-smi` or `dmesg | grep rbln`.
- `rebel.device_count()` — needs `python -c "import rebel; ..."` on node5.
- vllm-rbln drop-in benchmark Job manifest contents — needs the file at `/home/kcloud/rbln-node5-cluster-readiness.md` on node5.

## Action required from user (any one unblocks the mission)

1. **Provide `SUDO_PASS`** for the kcloud user on node5: prepend `SUDO_PASS=… ` to a single command, or paste it once and the agent will export it.
2. **Add an SSH public key** the agent can use: append the agent's `~/.ssh/id_*.pub` (if any) to `kcloud@10.254.202.111:~/.ssh/authorized_keys`.
3. **Paste the readiness report contents** directly into the chat — the agent will write it to `/home/kcloud/rbln-node5-cluster-readiness.md` and the imported markdown above.
4. **Run the cluster-side commands yourself** following the per-step instructions the agent will write into `reports/atomplus_cluster_gap_fix_report.md`. The agent will validate every step from `kubectl` on node1.

## Why this is gating the whole mission

Without SSH OR the report contents OR explicit cluster-side commands run by you:
- Gate **G1** (readiness report copied) cannot pass.
- Gate **G2** (revalidated) is partial — only kubectl-observable state.
- Gate **G4** (containerd CDI fix) cannot be applied.
- The drop-in `vllm-rbln` benchmark Job manifest from the report is unavailable — Lane C cannot use it as a starting point.

The agent will continue with everything that does NOT require SSH (code-level changes for benchmark backend, comparison crash audit, iframe panels, realtime menu redesign, baseline Playwright QA) so progress is not 100% gated, but the Atom+ runtime gate is hard-blocked on this single human handoff.
