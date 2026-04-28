# App Feature Inventory

Generated: 2026-04-28 | RUN_ID: 20260428-075351-71c9c77

---

## Pages / Routes

| ID | Type | Path | Description | Maturity |
|----|------|------|-------------|----------|
| P01 | page | `/` | Redirects to `/ml-perf` | working |
| P02 | page | `/ml-perf` | MLPerf main: exam table + collapsible create form | working |
| P03 | page | `/ml-perf/test-result/:id` | MLPerf result: TestResultInfo card + per-rep accuracy/perf graphs + download buttons | working |
| P04 | page | `/ml-perf/test-comparison/:firstId/:secondId` | Side-by-side accuracy/perf graph for two MLPerf runs | working |
| P05 | page | `/ml-perf/device-comparison` | Wraps `DeviceRealtimeDashboard` filtered to `mlperf`; shows realtime GPU feed, NOT a true GPU-vs-NPU diff view | partial |
| P06 | page | `/mmlu` | MMLU-Pro main: exam table + collapsible create form | working |
| P07 | page | `/mmlu/test-result/:id` | MMLU result: TestResultInfo + subject bar graphs (14 subjects + All) + xlsx export | working |
| P08 | page | `/mmlu/test-comparison/:firstId/:secondId` | Side-by-side MMLU subject accuracy comparison | working |
| P09 | page | `/mmlu/device-comparison` | Wraps `DeviceRealtimeDashboard` filtered to `mmlu`; same caveat as P05 | partial |
| P10 | page | `/npu-eval` | NPU Eval main: exam table + inline create form + Active Benchmark card + node4 iframe | working |
| P11 | page | `/npu-eval/test-result/:id` | NPU result: config card, KPI alert (TT100T<1.1s), 5 bar charts, summary stats, detail table | working |
| P12 | page | `/npu-eval/test-comparison/:firstId/:secondId` | NPU vs NPU comparison bar charts | working |
| P13 | page | `/npu-eval/device-comparison` | NPU vs GPU comparison: select NPU exam → modal pick GPU exam → side-by-side TPS/TT100T/latency charts + summary table | working |
| P14 | page | `/dashboard/gpu-realtime` | Live GPU feed: `DeviceRealtimeDashboard` (unfiltered), sweep progress bar, device cards, TPS bar chart, slots table | working |
| P15 | page | `/dashboard/sweep-control` | GPU sweep config: checkbox matrix (precision × batch × samples × scenario × TP), cell count estimator, start/calibration/pause/drain buttons; gated on `VITE__GPU_SWEEP_ENABLED` and `/auth/me` admin check | working |
| P16 | page | `*` → `/404` | 404 Not Found with home button | working |

---

## API Endpoints (backend global prefix: `/api`)

| ID | Type | Method + Path | Description | Maturity |
|----|------|--------------|-------------|----------|
| A01 | api | `GET /api/mp-exam/gpu-list` | Available GPU nodes for MLPerf | working |
| A02 | api | `GET /api/mp-exam/list?page&limit` | Paginated MLPerf exam list | working |
| A03 | api | `GET /api/mp-exam/status/:id` | Exam status by id | working |
| A04 | api | `GET /api/mp-exam/details/:id` | Full exam details with results | working |
| A05 | api | `POST /api/mp-exam/create` | Create MLPerf exam | working |
| A06 | api | `PATCH /api/mp-exam/start-time/:id` | Set exam start timestamp | working |
| A07 | api | `PATCH /api/mp-exam/stop/:id` | Stop running exam | working |
| A08 | api | `PATCH /api/mp-exam/update/:id` | Update exam fields | working |
| A09 | api | `DELETE /api/mp-exam/delete/:id` | Delete exam | working |
| A10 | api | `GET /api/mp-exam-result/list?page&limit` | Paginated result list | working |
| A11 | api | `GET /api/mp-exam-result/details/:id` | Result details | working |
| A12 | api | `POST /api/mp-exam-result/create` | Create result record | working |
| A13 | api | `GET /api/mp-exam-result/exam-result/:id/:repeatCount/download` | Download exam result ZIP | working |
| A14 | api | `GET /api/mp-exam-result/exam-submission/:id/:repeatCount/download` | Download submission report ZIP | working |
| A15 | api | `GET /api/mm-exam/gpu-list` | Available GPU nodes for MMLU | working |
| A16 | api | `GET /api/mm-exam/list?page&limit` | Paginated MMLU exam list | working |
| A17 | api | `GET /api/mm-exam/status/:id` | MMLU exam status | working |
| A18 | api | `GET /api/mm-exam/details/:id` | MMLU exam details | working |
| A19 | api | `POST /api/mm-exam/create` | Create MMLU exam | working |
| A20 | api | `PATCH /api/mm-exam/start-time/:id` | Set start time | working |
| A21 | api | `PATCH /api/mm-exam/stop/:id` | Stop exam | working |
| A22 | api | `PATCH /api/mm-exam/update/:id` | Update exam | working |
| A23 | api | `DELETE /api/mm-exam/delete/:id` | Delete exam | working |
| A24 | api | `GET /api/mm-exam-result/list?page&limit` | Paginated MMLU result list | working |
| A25 | api | `GET /api/mm-exam-result/details/:id` | MMLU result details | working |
| A26 | api | `POST /api/mm-exam-result/create/:examId/:repeat` | Create MMLU result | working |
| A27 | api | `PATCH /api/mm-exam-result/update/:id` | Update MMLU result | working |
| A28 | api | `DELETE /api/mm-exam-result/delete/:id` | Delete MMLU result | working |
| A29 | api | `GET /api/npu-eval/npu-list` | Available NPU nodes | working |
| A30 | api | `GET /api/npu-eval/list?page&limit` | Paginated NPU exam list | working |
| A31 | api | `GET /api/npu-eval/status/:id` | NPU exam status | working |
| A32 | api | `GET /api/npu-eval/details/:id` | NPU exam details with results | working |
| A33 | api | `POST /api/npu-eval/create` | Create NPU exam | working |
| A34 | api | `PATCH /api/npu-eval/start-time/:id` | Set start time | working |
| A35 | api | `PATCH /api/npu-eval/stop/:id` | Stop NPU exam | working |
| A36 | api | `PATCH /api/npu-eval/update/:id` | Update NPU exam | working |
| A37 | api | `DELETE /api/npu-eval/delete/:id` | Delete NPU exam | working |
| A38 | api | `GET /api/npu-eval/results/:examId` | All results for NPU exam | working |
| A39 | api | `POST /api/npu-eval/results/create` | Create NPU result row | working |
| A40 | api | `GET /api/npu-eval/compare/:npuExamId/:gpuExamId?gpuBenchmark=` | NPU vs GPU comparison data | working |
| A41 | api | `GET /api/gpu-sweep/preview?config=` | Sweep matrix preview (always enabled) | working |
| A42 | api | `GET /api/gpu-sweep/status` | Active sweep status | working |
| A43 | api | `GET /api/gpu-sweep/cells/:sweepId` | Cell list for a sweep | working |
| A44 | api | `POST /api/gpu-sweep/start` | Start sweep or calibration; requires `GPU_SWEEP_ENABLED` | working |
| A45 | api | `PATCH /api/gpu-sweep/pause` | Pause active sweep | working |
| A46 | api | `PATCH /api/gpu-sweep/drain` | Drain active sweep | working |
| A47 | api | `PATCH /api/gpu-sweep/pause/:id` | Pause sweep by id | working |
| A48 | api | `PATCH /api/gpu-sweep/drain/:id` | Drain sweep by id | working |
| A49 | api | `GET /api/realtime/exams/snapshot` | One-shot SSE snapshot JSON | working |
| A50 | api | `GET /api/realtime/exams/health` | SSE health + subscriber count | working |
| A51 | api | `SSE /api/realtime/exams` | Server-sent events; 2s cadence; max 20 subscribers, falls back 503 | working |
| A52 | api | `GET /api/loki/instant/:benchmark/:id` | Loki instant log query for exam | working |
| A53 | api | `GET /api/files/datasets` | List available dataset files from NFS | working |
| A54 | api | `GET /api/files/models` | List available model files from NFS | working |
| A55 | api | `GET /api/files/settings` | Read settings.json from NFS | working |
| A56 | api | `GET /api` | Health/hello root | working |

---

## CLI Scripts

| ID | Type | Path | Description | Maturity |
|----|------|------|-------------|----------|
| S01 | script | `gpu-benchmark-loop.sh` | Polling loop that dispatches GPU benchmark jobs | working |
| S02 | script | `gpu-runner-v2.sh` | v2 GPU runner with extended logic | working |
| S03 | script | `gpu-sequential-runner.sh` | Sequential (non-parallel) GPU runner | working |
| S04 | script | `docker-push-simple.sh` | Docker image push helper | working |

---

## Kubernetes Jobs / Device Plugins / Services

| ID | Type | Path | Description | Maturity |
|----|------|------|-------------|----------|
| K01 | workflow | `k8s/benchmark-jobs/mlperf-acc-job.yaml.template` | K8s Job template for MLPerf accuracy mode | working |
| K02 | workflow | `k8s/benchmark-jobs/mlperf-perf-job.yaml.template` | K8s Job template for MLPerf performance mode | working |
| K03 | workflow | `k8s/benchmark-jobs/mmlu-pro-job.yaml.template` | K8s Job template for MMLU-Pro | working |
| K04 | workflow | `k8s/benchmark-jobs/tt100-npu-job.yaml.template` | K8s Job template for TT100T NPU (FuriosaAI RNGD) | working |
| K05 | service | `k8s/device-plugins/furiosa-atomplus-device-plugin.yaml.template` | Furiosa AtomPlus device plugin DaemonSet | working |
| K06 | service | `k8s/device-plugins/furiosa-rngd-device-plugin.yaml` | Furiosa RNGD device plugin DaemonSet | working |
| K07 | service | `k8s/device-plugins/nvidia-gpu-operator-values.yaml` | NVIDIA GPU operator Helm values | working |
| K08 | service | `k8s/services/mp-exam-stream-svc.yaml.template` | K8s Service for MLPerf exam streaming | working |
| K09 | service | `k8s/storage/nfs-pvc-template.yaml` | NFS PersistentVolumeClaim template | working |

---

## Config Files

| ID | Type | Path | Description | Maturity |
|----|------|------|-------------|----------|
| C01 | config | `web/.env` | `VITE__APP_API_BASE_URL` (backend URL); `VITE__GPU_SWEEP_ENABLED` (gates sweep UI) | working |
| C02 | config | `web/vite.config.ts` | Vite build: react-swc, tsconfigPaths, svgr; dev port 5173 | working |
| C03 | config | `server/.env` | `DATABASE_HOST/PORT/USER/PASSWORD/NAME`, `NODE_ENV`, `PORT`, Loki URL, `GPU_SWEEP_ENABLED` | working |
| C04 | config | `server/nest-cli.json` | NestJS CLI config | working |
| C05 | config | `server/ormconfig.ts` | TypeORM config for migrations | working |
| C06 | config | `server/mnt/datasets/settings.json` | Runtime settings served via `/api/files/settings` | working |
| C07 | config | `docker-compose.dev.yml` | Dev compose: backend + postgres + loki | working |
| C08 | config | `docker-compose.prod.yml` | Prod compose | working |
| C09 | config | `web/nginx.conf` | Nginx config for prod web container | working |
| C10 | config | `web/playwright.config.ts` | Playwright e2e config (3 test files) | working |
