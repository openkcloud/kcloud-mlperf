# Repo Architecture Audit — RUN_ID 20260428-072038-a612a54

## Inventory

### Repositories
- **etri-llm-exam-solution** — monorepo: `server/` (NestJS), `web/` (React/Vite), shell runners, `.omc/` planning artifacts
- **mondrianai-etri-llm-deployments-a9c4c59c4869** — Helm chart (`kubernetes/app-chart/`), Kubespray inventory, Loki/Prometheus/Alloy/GPU-operator Helm bundles, cluster.yaml

### Key images (cluster.yaml + app-chart/values.yaml)
| Component | Image | Tag |
|-----------|-------|-----|
| Backend | jungwooshim/etri-llm-backend | v12 |
| Frontend | jungwooshim/etri-llm-frontend | v12 |
| K8s API | mondrianai/etri-llm-k8s-api | v1.0.0 |
| Operator | mondrianai/etri-llm-k8s-operator | v1.0.1 |

---

## Integration Map

### MLPerf Integration
- `mp-exam.service.ts:53` — `examBenchmark = 'mlperf'`; dispatches exams to the operator via gRPC (`proto/exam.proto`)
- `mp-exam-result.service.ts:155–157` — reads `mnt/result/mlperf-{id}/{n}/mlperf_log_summary.txt` and `added-result.txt` to parse ROUGE scores, SPS, TPS, latency, TTFT, TPOT
- Parsed log fields: `Samples per second`, `Tokens per second`, `Result is`, `Mean First Token latency`, ROUGE dict
- The operator (`mondrianai/etri-llm-k8s-operator:v1.0.1`) translates the `Exam` CRD into a Kubernetes Job; job artifacts land on NFS at the above path
- Frontend: `web/src/pages/mlperf/` contains `MLPerfPage`, `TestResultPage`, `ComparisonPage`, `AccuracyExamGraph`, `AverageAccuracyExamGraph`, `AccuracyComparisonGraph` — all consume `mp-exam` and `mp-exam-result` REST endpoints

### MMLU-Pro Integration
- `mm-exam.service.ts:52` — `examBenchmark = 'mmlu'`; same gRPC path as MLPerf
- `server/mnt/datasets/settings.json` — maps model name to dataset files: `"Llama-3.1-8B-instruct": ["mmlu-pro"]`
- Dataset pinned to directory path `/mnt/datasets/mmlu-pro`; no dataset version hash or TIGER-Lab commit pinned (`cluster.yaml:mmlu_pro.repo` references `TIGER-Lab/MMLU-Pro` but no tag)
- Frontend: `web/src/pages/mmlu/` mirrors mlperf structure with `MMLUPage`, `TestResultPage`, `TestComparisonPage`

### Llama-3.1-8B Model Consistency
- `cluster.yaml:91` — `model: meta-llama/Llama-3.1-8B-Instruct` (canonical)
- `settings.json:3` — `"Llama-3.1-8B-instruct"` (lowercase 'i' — minor casing inconsistency vs. HF canonical `Instruct`)
- NPU path uses `furiosa-ai/Llama-3.1-8B-Instruct` (HF org prefix differs from `meta-llama/`); GPU path uses bare `Llama-3.1-8B-Instruct` in runner scripts
- All planning docs confirm single-model rule consistently

### FP8 / BF16 Precision Path
- `server/src/gpu-sweep/matrix.ts:25` — `PRECISIONS = ['bf16', 'fp8']`
- FP8 rule: `matrix.ts:151–154` — fp8+bs4 dropped on A40/Ampere SKUs (no FP8 tensor cores)
- Canonical calibration cell: `gpu-sweep.service.ts:229` — `mlperf|L40|fp8|bs1|n500|tp1|offline`
- NPU: `npu-exam.entity.ts:33` — precision field supports FP8/BF16/INT8/INT4; NPU benchmark job uses `--dtype fp8` via furiosa-llm
- `create-mp-exam.dto.ts:32` and `create-mm-exam.dto.ts:31` expose `precision: string` (no enum enforcement)

### NPU Integration (server/src/npu-eval/)
- `npu-eval.service.ts:94` — hardcoded `npu_model: 'RNGD'`, `npu_count: 1`
- `npu-benchmark-job.yaml` — benchmark runner uses `furiosaai/furiosa-llm:latest`; contacts inference server at `http://npu-inference-{EXAM_ID}.llm-evaluation.svc.cluster.local:8000`
- `npu-inference-pod.yaml:41` — `HF_TOKEN` injected from secret; model cache at `/root/.cache/huggingface`
- `cluster.yaml:54–57` — node5 (Atom+, 2 NPUs) marked `state: pending_join`; Atom+ not present in any service code or entity
- No RNGD device plugin Helm chart found in `kubernetes/`; GPU operator present at `kubernetes/gpu-operator-25.10.0/`

### Kubernetes Job Templating
- `mp-exam.service.ts` and `mm-exam.service.ts` both use gRPC (`ExamServiceClient`) to call `mondrianai/etri-llm-k8s-api:v1.0.0`, which relays to the operator
- Operator (`mondrianai/etri-llm-k8s-operator:v1.0.1`) creates Kubernetes Jobs from the `Exam` CRD
- NPU path bypasses the operator: `npu-eval.service.ts` directly applies YAML templates via `kubectl apply` calls using substituted template strings (`npu-benchmark-job.yaml`, `npu-inference-pod.yaml`, `npu-inference-service.yaml`)

### Secrets Handling
- `kubernetes/app-chart/values.yaml:6` — `dockerConfigJson` field contains a base64-encoded Docker Hub credential committed in plaintext; **flagged as High risk** (credential in VCS)
- `kubespray/inventory/etri/hosts.yml:7–29` — `ansible_password: "<SUDO_PASS>"` and `ansible_become_password: "<SUDO_PASS>"` committed in plaintext for all four nodes; **flagged as Critical**
- `cluster.yaml:15` — correctly defers password to `SUDO_PASS` env var
- `npu-inference-pod.yaml:41` — `HF_TOKEN` sourced from K8s secret (correct pattern)

### DockerHub
- Backend: `jungwooshim/etri-llm-backend:v12` confirmed in values.yaml
- Frontend: `jungwooshim/etri-llm-frontend:v12` confirmed in values.yaml

### HuggingFace References
- `HF_TOKEN` referenced in `npu-inference-pod.yaml:41` (secret-injected — correct)
- Model download via `huggingface_hub.snapshot_download` documented in `.omc/plans/`
- NFS model path: `/mnt/models/Llama-3.1-8B-Instruct/`; HF cache: `/root/.cache/huggingface/hub/models--furiosa-ai--Llama-3.1-8B-Instruct/`

### Realtime UI
- `server/src/realtime/realtime.service.ts` — `buildSnapshot()` queries DB for active exams on 4 GPU slots (node2: L40+A40, node3: L40-44GiB+A40-44GiB); exposes SSE at `/realtime/exams`
- `web/src/hooks/useRealtimeExams.ts:39` — SSE_URL = `/realtime/exams` with polling fallback
- `web/src/components/DeviceRealtimeDashboard/DeviceRealtimeDashboard.tsx` — renders per-slot status cards with TPS and TT100T metrics
- `web/src/pages/npu/main/index.tsx:468` — one `<iframe>` usage found (MUI Box component="iframe") but Grafana/bottom-iframe embedding not implemented
- No `<iframe src="...grafana...">` or `<iframe src="...loki...">` found in web source

### Observability Stack
- Loki deployed at `kubernetes/loki-2.2.1/`, configured in `app-chart/values.yaml:24` (`loki.loki.svc.cluster.local:3100`)
- Prometheus at `kubernetes/kube-prometheus-stack-79.1.1/`
- Grafana at `kubernetes/grafana-6.11.0/`
- Alloy at `kubernetes/alloy-1.4.0/` (log collector)
- `server/src/loki/loki.service.ts` and `loki.controller.ts` provide proxy endpoints for log queries by benchmark type (`mmlu` | `mlperf`)

---

## Strengths

- Clean domain separation: mp-exam (MLPerf GPU), mm-exam (MMLU GPU), npu-eval (NPU) each have dedicated service/entity/controller/DTO stacks
- Precision enforcement at matrix level: FP8 correctly excluded from Ampere SKUs via `matrix.ts` rule
- Realtime SSE feed is implemented end-to-end (backend service + React hook + dashboard component)
- Full observability stack (Loki + Prometheus + Grafana + Alloy) deployed and wired
- cluster.yaml is a genuine single source of truth; scripts reference it rather than hard-coding

---

## Gaps

| Severity | Gap | Evidence |
|----------|-----|----------|
| **High** | `dockerConfigJson` base64 credential committed in VCS | `kubernetes/app-chart/values.yaml:6` |
| **High** | Plaintext `<SUDO_PASS>` password committed for all nodes | `kubespray/inventory/etri/hosts.yml:7–29` |
| **High** | No RNGD device plugin Helm chart; NPU scheduling relies on manual node labeling only | `kubernetes/` directory scan |
| **High** | Atom+ (node5) not joined; no code support for `npu_model = 'Atom+'` | `cluster.yaml:52–58`, `npu-eval.service.ts:94` |
| **Med** | MMLU-Pro dataset not version-pinned (no commit hash or release tag) | `cluster.yaml:115`, `settings.json` |
| **Med** | Model name casing inconsistency: `Llama-3.1-8B-instruct` vs `Llama-3.1-8B-Instruct` across settings.json, runners, HF org prefix | `settings.json:3`, `gpu-sequential-runner.sh:47` |
| **Med** | Grafana/Loki bottom-iframe UI not implemented despite being a stated requirement | `web/src/pages/npu/main/index.tsx:468` (only MUI iframe stub) |
| **Med** | `create-mp-exam.dto.ts:32` `precision` is untyped `string`; no enum validation preventing invalid values | `mp-exam.service.ts:160` |
| **Low** | NPU benchmark job uses `furiosaai/furiosa-llm:latest` (no pinned digest) | `npu-benchmark-job.yaml:26` |
| **Low** | `npu-eval.service.ts` bypasses operator and applies YAML directly; creates two job-launch paths | `npu-eval.service.ts` vs `mp-exam.service.ts` |

---

## Recommended Follow-ups

1. **Secrets rotation** — rotate `dockerConfigJson` and `<SUDO_PASS>` credential immediately; move both to an external secret manager (e.g., Vault, Sealed Secrets) and remove from VCS history
2. **RNGD device plugin** — deploy FuriosaAI device plugin DaemonSet and add resource request `furiosa.ai/rngd: 1` to the NPU benchmark job template
3. **Pin MMLU-Pro dataset** — lock to a specific HuggingFace dataset revision or commit hash in `settings.json` and `cluster.yaml`
4. **Enum-gate precision** — change `precision: string` in DTOs to `precision: 'bf16' | 'fp8'` to prevent silent misconfiguration
5. **Bottom-iframe observability** — implement Grafana iframe embed in the NPU page; Grafana is already deployed and accessible
