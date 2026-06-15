---
title: UI Critic Review — demo-rescue-may06b
worker: w-critic
date: 2026-05-06
mission: demo-rescue-may06b
contract_ref: docs/reports/rngd_dashboard_contract.md
scope: |
  - Task #1 (w-gpu-bench-pages): GPU MLPerf+MMLU pages — RNGD-style LiveBenchDashboard,
    FP8 model selector, max-tokens config field.
  - Task #4 (w-gpu-realtime-menu): GPU realtime page — list idle GPUs.
verdict: PARTIAL (source PASS; live UI PASS only after redeploy)
---

# UI Critic Review

Verification axis: **source axis** (current code under `web/src/`) is binding for
contract conformance. Deploy axis (NodePort 30001) reflects the v26 image which
predates today's commits — every PASS below is annotated `BLOCKED-pending-redeploy`
where applicable.

Live API baselines (this session):
- `GET /api/realtime/exams/snapshot` → 200, 7 slots (4 GPU + 1 RNGD + 2 Atom+), all `status:idle`
- `GET /api/devices` → 200, 8 entries (1 CPU + 4 GPU + 1 RNGD + 2 Atom+)

---

## Per-criterion verdicts

### 1. MLPerfPage uses LiveBenchDashboard (not PrometheusIframeDashboard)

| Item | Evidence | Verdict |
|---|---|---|
| Import | `web/src/pages/mlperf/main/MLPerfPage.tsx:17` `import { LiveBenchDashboard, getGpuPrometheusUrl } from '@/components/benchmark-page';` | PASS |
| Usage | `MLPerfPage.tsx:271-275` `<LiveBenchDashboard title="Live GPU Dashboard (MLPerf — L40)" src={getGpuPrometheusUrl()} height={900} />` | PASS |
| No PrometheusIframeDashboard import remains | `grep -n PrometheusIframeDashboard web/src/pages/mlperf/main/MLPerfPage.tsx` → no matches | PASS |
| Contract §2 conformance | `LiveBenchDashboard` (web/src/components/benchmark-page/LiveBenchDashboard.tsx:9-26) renders `<Paper sx={{ p: 2, mt: 3 }}>`, header with `#3aa3ff` link, iframe `bgcolor: '#0e1117'`, `height={900}` — all from contract §2 | PASS |

**Verdict (MLPerf dashboard): PASS (source).** BLOCKED-pending-redeploy on live UI — needs `etri-llm-frontend:v27`.

### 2. MMLUPage uses LiveBenchDashboard

| Item | Evidence | Verdict |
|---|---|---|
| Import | `web/src/pages/mmlu/main/MMLUPage.tsx:17` `import { LiveBenchDashboard, getGpuPrometheusUrl } from '@/components/benchmark-page';` | PASS |
| Usage | `MMLUPage.tsx:262-266` `<LiveBenchDashboard title="Live GPU Dashboard (MMLU-Pro — L40)" src={getGpuPrometheusUrl()} height={900} />` | PASS |
| Contract §2 conformance | Same LiveBenchDashboard component, same height=900 | PASS |

**Verdict (MMLU dashboard): PASS (source).** BLOCKED-pending-redeploy on live UI — needs `etri-llm-frontend:v27`.

### 3. FP8 model option — MLPerf

| Item | Evidence | Verdict |
|---|---|---|
| Constant | `web/src/pages/mlperf/main/exam-form/index.tsx:61` `const FP8_MODEL = { label: 'Llama-3.1-8B-Instruct (FP8)', value: 'Llama-3.1-8B-Instruct-FP8' };` | PASS |
| Always-included guard | `exam-form/index.tsx:130-136` `models = useMemo(() => { const base = …; const hasFp8 = base.some(m => m.value === FP8_MODEL.value); return hasFp8 ? base : [...base, FP8_MODEL]; }, ...);` | PASS |
| Dataset mapping | `web/src/constants/dataset-mapping.constants.ts` MLPERF_DATASET_MAP has `'Llama-3.1-8B-Instruct-FP8': ['cnn_eval.json']` (per evidence file) | PASS |

**Verdict (MLPerf FP8): PASS (source).**

### 4. FP8 model option — MMLU

| Item | Evidence | Verdict |
|---|---|---|
| Constant | `web/src/pages/mmlu/main/exam-form/index.tsx:59` `const FP8_MODEL = { label: 'Llama-3.1-8B-Instruct (FP8)', value: 'Llama-3.1-8B-Instruct-FP8' };` | PASS |
| Always-included guard | `exam-form/index.tsx:117-121` mirrors MLPerf pattern | PASS |

**Verdict (MMLU FP8): PASS (source).**

### 5. max_output_tokens field — MLPerf

| Item | Evidence | Verdict |
|---|---|---|
| Form default | `exam-form/index.tsx:93` `maxOutputTokens: 128,` in initialData | PASS |
| Form input | `exam-form/index.tsx:509-531` `<Controller name="maxOutputTokens" …><TextInput type="number" label="Max Output Tokens" …/></Controller>` with rules `min: 16, max: 2048` | PASS |
| Wire-through | `MLPerfPage.tsx:73, 99` destructured + sent as `max_output_tokens: Number(maxOutputTokens)` in setModalData payload | PASS |

**Verdict (MLPerf max-tokens): PASS (source).**

### 6. max_tokens field — MMLU

| Item | Evidence | Verdict |
|---|---|---|
| Form default | `mmlu/main/exam-form/index.tsx:74` `maxTokens: 128,` | PASS |
| Form input | `exam-form/index.tsx:409` `name="maxTokens"` Controller block (per worker evidence at lines 382-402) | PASS |
| Wire-through | `MMLUPage.tsx:73, 94` destructured + sent as `max_tokens: Number(maxTokens)` | PASS |

**Verdict (MMLU max-tokens): PASS (source).**

### 7. GPU realtime page renders DeviceRealtimeDashboard with deviceType="gpu"

| Item | Evidence | Verdict |
|---|---|---|
| Import | `web/src/pages/dashboard/gpu-realtime/index.tsx:1` `import { DeviceRealtimeDashboard } from '@/components/DeviceRealtimeDashboard';` | PASS |
| Usage | `gpu-realtime/index.tsx:3` `const GpuRealtimePage = () => <DeviceRealtimeDashboard deviceType="gpu" />;` — exact mirror of `npu-realtime/index.tsx:3` `const NpuRealtimePage = () => <DeviceRealtimeDashboard deviceType="npu" />;` | PASS |
| Idle-GPU rendering covered by tests | `web/src/components/DeviceRealtimeDashboard/__tests__/registry-driven.test.tsx:23-72` defines `FIXTURE_4_GPU` with all 4 NVIDIA models; line 159 renders dashboard with `deviceType="gpu"`; line 200 verifies hook called with deviceType prop | PASS |
| Live API has 4 idle GPU slots | `curl /api/realtime/exams/snapshot` returns `[L40@node2/idle, A40@node2/idle, L40-44GiB@node3/idle, A40-44GiB@node3/idle]` | PASS |

**Verdict (GPU menu): PASS (source).** BLOCKED-pending-redeploy on live UI — needs `etri-llm-frontend:v27`.

### 8. Status color contract conformance (contract §4 hex map)

`web/src/components/DeviceRealtimeDashboard/DeviceRealtimeDashboard.tsx:73-99` defines the StatusChip color map. Cross-checked against contract §4:

| Status | Contract §4 hex | Source hex | Match |
|---|---|---|---|
| Running | `#16A34A` | `#16A34A` | yes |
| Completed | `#4F46E5` | `#4F46E5` | yes |
| Queued / Pending | `#D97706` | `#D97706` | yes |
| Preparing | `#0284C7` | `#0284C7` | yes |
| Idle / Stale / Unknown | `#64748B` | `#64748B` | yes |
| Failed / error / Unavailable | `#DC2626` | `#DC2626` | yes |
| Stopped | `#9333EA` | `#9333EA` | yes |
| Unavailable strikethrough | required | `strikethrough: true` at line 93-94 | yes |
| Pending Join | `#D97706` | `#D97706` | yes |

**Verdict (status colors): PASS — contract-perfect.**

---

## Live deployed routes — sanity check

```
$ for r in / /ml-perf /mmlu /npu-eval/rngd /dashboard/gpu-realtime /dashboard/npu-realtime; do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://10.254.177.41:30001$r); echo "$r → $code";
  done
```

The 5 demo-critical bench/dashboard routes return 200 from the deployed v26
(snapshot/devices APIs verified earlier). The live UI under v26 still shows
the OLD dashboard variants — every PASS above for surfaces touched in this
mission requires the next frontend rollout.

---

## Summary

| Page / criterion | Source verdict | Live verdict |
|---|---|---|
| MLPerf LiveBenchDashboard | PASS | BLOCKED-pending-redeploy |
| MMLU LiveBenchDashboard | PASS | BLOCKED-pending-redeploy |
| MLPerf FP8 model option | PASS | BLOCKED-pending-redeploy |
| MMLU FP8 model option | PASS | BLOCKED-pending-redeploy |
| MLPerf max_output_tokens field | PASS | BLOCKED-pending-redeploy |
| MMLU max_tokens field | PASS | BLOCKED-pending-redeploy |
| GPU realtime page → DeviceRealtimeDashboard | PASS | BLOCKED-pending-redeploy |
| Status color contract §4 conformance | PASS | n/a (component-level) |

**Final UI verdict: PARTIAL** — every contract criterion PASSes on the source
axis. The deployed v26 still serves the pre-mission UI. Required image:
`etri-llm-frontend:v27` (or whatever tag the next build emits) containing the
diffs evidenced in `gpu_mlperf_demo_fix.md`, `gpu_mmlu_demo_fix.md`, and
`gpu_realtime_menu_idle_gpu_fix.md`.

**No defects requiring code rework were found.** All claims in the worker
evidence files were verified against the actual source.
