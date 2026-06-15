# MMLU-Pro Execution Blockers

RUN_ID: 20260506-020458-mmlu
Date: 2026-05-06
Worker: worker-9

## HOLD — 2026-05-06T02:15Z

Team-lead priority shift: MLPerf must complete first. All MMLU-Pro jobs suspended.
Status: DEFERRED pending W8 MLPerf completion (~30 min). If MLPerf exceeds 1h, MMLU-Pro may be skipped for demo.
Restart trigger: W8 sends completion message; team-lead clears hold.
Restart contract: use W7 updated canonical-config.yaml (schema 1.1.0) — FP8 strict per HW, vendor-specific model variants.

## Status Summary

| Hardware | Job Name | Status | Node | Notes |
|----------|----------|--------|------|-------|
| L40 | mmlu-pro-l40-20260506-020458 | Running | node2 | ContainerCreating → Running |
| A40 | mmlu-pro-a40-20260506-020458 | Queued/Pending | node3 | Waiting for W8 MLPerf GPU to free |
| RNGD | mmlu-pro-rngd-20260506-020458 | Running | node4 | Uses existing npu-inference-server-node4 |
| Atom+ | mmlu-pro-atomplus-20260506-020458 | BLOCKED | node5 | SSH auth failure — see below |

---

## Blocker 1: Atom+ SSH Authentication Failure

**Symptom**: `kcloud@10.254.202.111: Permission denied (publickey,password)`

**Root cause**: No passwordless SSH key configured from node1 to node5 for the kcloud user in this session. The `atomplus_self_service_benchmark.md` runbook assumes pre-existing SSH key trust, but it is not present.

**Impact**: Atom+ MMLU-Pro benchmark cannot be launched via the host-mode SSH path.

**Resolution options**:
1. Operator manually runs: `ssh-copy-id kcloud@10.254.202.111` from node1 to establish key trust, then re-run `jobs/mmlu-pro-atomplus-ssh.sh`
2. Operator provides SUDO_PASS and runs the benchmark directly on node5
3. Deploy a k8s Job to node5 with Rebellions device plugin toleration (requires `rebellions.ai/ATOM` resource limit support)

**Workaround result**: Atom+ run imported as `status=failed` with reason `SSH auth failure — no passwordless key to node5`.

---

## Blocker 2: A40 GPU Contention with W8 MLPerf

**Symptom**: A40 MMLU-Pro pod stays Pending because W8's MLPerf job (`mlperf-136-1-1`) holds the only `nvidia.com/gpu` on node3.

**Root cause**: node3 has 2 GPUs total but both may be allocated, or MLPerf holds the last available GPU slot.

**Impact**: A40 MMLU-Pro is queued and will start automatically once the MLPerf job completes.

**Resolution**: No action needed — pod will self-schedule when GPU is freed. Per task instructions, no contention is allowed so queuing is correct behavior.

---

## Jobs Submitted

```
kubectl get jobs -n llm-evaluation -l benchmark=mmlu
```

All job YAMLs at:
- `/home/kcloud/etri-llm-exam-solution/jobs/mmlu-pro-l40.yaml`
- `/home/kcloud/etri-llm-exam-solution/jobs/mmlu-pro-a40.yaml`
- `/home/kcloud/etri-llm-exam-solution/jobs/mmlu-pro-rngd.yaml`
- `/home/kcloud/etri-llm-exam-solution/jobs/mmlu-pro-atomplus-ssh.sh`

Log paths (canonical):
- `logs/benchmarks/mmlu_pro_l40_20260506-020458-mmlu.log`
- `logs/benchmarks/mmlu_pro_a40_20260506-020458-mmlu.log`
- `logs/benchmarks/mmlu_pro_rngd_20260506-020458-mmlu.log`
- `logs/benchmarks/mmlu_pro_atomplus_20260506-020458-mmlu.log`
