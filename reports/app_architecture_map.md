# App Architecture Map

Generated: 2026-04-28 | RUN_ID: 20260428-075351-71c9c77

---

## Layered Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND  (React 19 + MUI 7 + Vite 5 + React Query v5)     │
│                                                              │
│  MainLayout (sidebar 272px fixed + sticky top-bar)          │
│  ├── /ml-perf        MLPerfPage       (exam table + form)   │
│  ├── /ml-perf/test-result/:id         TestResultPage        │
│  ├── /ml-perf/test-comparison/…       ComparisonPage        │
│  ├── /ml-perf/device-comparison       DeviceRealtimeDash    │
│  ├── /mmlu           MMLUPage                               │
│  ├── /mmlu/test-result/:id            MMLU TestResultPage   │
│  ├── /mmlu/test-comparison/…          MMLU ComparisonPage   │
│  ├── /mmlu/device-comparison          DeviceRealtimeDash    │
│  ├── /npu-eval       NpuEvalPage      (table + form + iframe)│
│  ├── /npu-eval/test-result/:id        NpuTestResultPage     │
│  ├── /npu-eval/test-comparison/…      NpuComparisonPage     │
│  ├── /npu-eval/device-comparison      DeviceComparisonPage  │
│  ├── /dashboard/gpu-realtime          DeviceRealtimeDash    │
│  └── /dashboard/sweep-control        SweepControlPage       │
│                                                              │
│  State:  Redux Toolkit (notification, comparison selection)  │
│  HTTP:   axios (baseURL = VITE__APP_API_BASE_URL)           │
│  SSE:    EventSource → /api/realtime/exams (2s cadence)     │
│  Lazy:   all pages via React.lazy + Suspense<AppLoader>      │
└────────────────────────┬─────────────────────────────────────┘
                         │  HTTP REST / SSE
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  BACKEND  (NestJS 11, global prefix /api, port 3000)         │
│                                                              │
│  Modules: MpExam · MpExamResult · MmExam · MmExamResult     │
│           NpuEval · GpuSweep · Realtime · Loki · Files      │
│           GrpcClient                                         │
│                                                              │
│  Global interceptors: TransformInterceptor (wrap response)   │
│  Global filter:       HttpExceptionFilter                    │
│  Global pipe:         ValidationPipe (whitelist+transform)   │
│  Scheduler:           @nestjs/schedule (cron in GpuSweep)    │
└──────┬──────────────────┬──────────────────┬────────────────┘
       │ TypeORM           │ HTTP (Loki)       │ gRPC (operator)
       ▼                   ▼                   ▼
┌────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ Postgres15 │   │  Loki (log store) │   │  K8s Operator    │
│            │   │  instant query    │   │  (gRPC client)   │
│ Tables:    │   │  /loki/instant/   │   │                  │
│ mp_exam    │   │  benchmark/:id    │   │  Dispatches Jobs │
│ mp_exam_   │   └──────────────────┘   └────────┬─────────┘
│  result    │                                    │ kubectl
│ mm_exam    │                                    ▼
│ mm_exam_   │                          ┌──────────────────────┐
│  result    │                          │  K8s Jobs (namespace │
│ npu_exam   │                          │  llm-evaluation)     │
│ npu_exam_  │                          │                      │
│  result    │                          │  mp-exam image       │
│ gpu_sweep  │                          │  mm-exam image       │
│ gpu_sweep_ │                          │  npu-eval image      │
│  cell      │                          └──────────┬───────────┘
└────────────┘                                     │ mounts
                                                   ▼
                                         ┌──────────────────────┐
                                         │  NFS PVCs            │
                                         │  /mnt/models/        │
                                         │  /mnt/datasets/      │
                                         │  /mnt/results/       │
                                         └──────────────────────┘
```

---

## Data Flow per Benchmark

### MLPerf Run
1. **Create**: Operator fills form on `/ml-perf` → `POST /api/mp-exam/create` → `mp_exam` row (status=IDLE).
2. **Dispatch**: `PATCH /api/mp-exam/start-time/:id` sets `started_at`; operator (or GpuSweep cron) renders `mlperf-acc-job.yaml.template` / `mlperf-perf-job.yaml.template` and applies to cluster.
3. **Execute**: K8s Job (mp-exam container) runs vLLM inference against CNN-DailyMail; posts result rows via `POST /api/mp-exam-result/create`; updates status to Running → Completed.
4. **Monitor**: Frontend polls `GET /api/mp-exam/status/:id` via `useExamStatus` hook (5 s interval on running exams); `ExamStatusBadge` / `ExamStatusProgressBar` reflect current repeat count.
5. **Report**: Click row → `/ml-perf/test-result/:id` → `GET /api/mp-exam-result/details/:id` → per-repetition accuracy bar charts (ROUGE-1/2/L/Lsum) or performance bar charts (TPS, SPS, VRAM, latency, TTFT, TPOT). Download buttons call `/api/mp-exam-result/exam-result/:id/:rep/download` (ZIP) and `/api/mp-exam-result/exam-submission/:id/:rep/download`.

### MMLU-Pro Run
Identical pipeline; uses `mmlu-pro-job.yaml.template`; results stored in `mm_exam` / `mm_exam_result`; result page shows 14-subject bar charts + xlsx download.

### TT100T NPU (FuriosaAI RNGD)
1. **Create**: Operator fills form on `/npu-eval` → `POST /api/npu-eval/create` → `npu_exam` row.
2. **Dispatch**: `PATCH /api/npu-eval/start-time/:id`; `tt100-npu-job.yaml.template` applied with RNGD device plugin resource.
3. **Execute**: furiosa-llm container on node4; posts via `POST /api/npu-eval/results/create`; KPI target = TT100T < 1.1 s.
4. **Monitor**: NPU page polls `GET /api/npu-eval/details/:id` every 5 s; `ActiveBenchmarkCard` shows live progress; node4 iframe at `http://10.254.202.114:30890/` shows raw log tails.
5. **Report**: `/npu-eval/test-result/:id` shows KPI alert, 5 bar charts (TT100T, TPS, TTFT, latency breakdown, all-metrics), summary stats, detailed results table.

### GPU Sweep (automated)
1. Operator configures matrix on `/dashboard/sweep-control`; `POST /api/gpu-sweep/start {mode:"full", matrix}` → `GpuSweepService.startSweep()` → writes `gpu_sweep` + `gpu_sweep_cell` rows.
2. NestJS `@Cron` ticks every N seconds; `GpuSweepService` acquires node mutex (node2 / node3), picks next pending cell, calls `MpExamService.create()` + sets start time.
3. Realtime service (`buildSnapshot`) polls `mp_exam` for active exams on GPU nodes; SSE emits snapshot every 2 s.
4. `/dashboard/gpu-realtime` renders sweep progress bar, per-GPU device cards, live TPS chart.

---

## Real-Time Path

```
NestJS RealtimeController
  @Sse('exams')  interval(2000ms)
       │  switchMap → RealtimeService.buildSnapshot()
       │  → queries mp_exam WHERE status IN (Running, Preparing)
       │  → queries gpu_sweep for sweep_progress
       │  → returns RealtimeSnapshot { slots[], sweep_progress, operator_race_alerts, timestamp }
       │
       ▼  EventSource (text/event-stream)
useRealtimeExams hook  (web/src/hooks/useRealtimeExams.ts)
  ├─ probes /realtime/exams/health first
  ├─ if 503 → falls back to 5-s polling of /realtime/exams/snapshot
  └─ on 'snapshot' event → setSnapshot(data)
       │
       ▼
DeviceRealtimeDashboard  (web/src/components/DeviceRealtimeDashboard/)
  ├─ per-GPU DeviceCard  (status chip, TPS, TT100T, elapsed)
  ├─ LinearProgress sweep bar
  ├─ BarChart current TPS by GPU SKU
  └─ Active Exam Slots table
```

Max 20 SSE subscribers enforced in `RealtimeController`; excess connections get `503 + X-Fallback: poll`.

---

## Module Boundaries

| Module | Controller prefix | Key responsibility |
|--------|------------------|--------------------|
| `mp-exam` | `/api/mp-exam` | MLPerf exam CRUD + GPU list + status |
| `mp-exam-result` | `/api/mp-exam-result` | MLPerf result CRUD + file downloads |
| `mm-exam` | `/api/mm-exam` | MMLU exam CRUD |
| `mm-exam-result` | `/api/mm-exam-result` | MMLU result CRUD |
| `npu-eval` | `/api/npu-eval` | NPU exam CRUD + results + comparison |
| `gpu-sweep` | `/api/gpu-sweep` | Matrix sweep orchestration + cron dispatch |
| `realtime` | `/api/realtime` | SSE snapshot + health |
| `loki` | `/api/loki` | Proxy to Loki log store |
| `files` | `/api/files` | NFS file/dataset/settings listing |
| `grpc-client` | (internal) | gRPC channel to K8s operator |

---

## Storage Map

### Postgres Tables
| Table | Key columns |
|-------|-------------|
| `mp_exam` | id, name, model, precision, mode (accuracy/performance), framework, scenario (offline/server), gpu_type, gpu_num, status, started_at, end_at, error_log |
| `mp_exam_result` | id, exam_id(FK), result_number, result_acc_rg_*, result_perf_tps, result_perf_tps_best, result_tt100t, result_vram_peak, result_gpu_util, result_perf_serv_ttft/tpot, result_perf_latency, result_perf_sps, result_perf_valid |
| `mm_exam` | id, name, model, precision, framework, gpu_type, gpu_num, dataset, data_number, status |
| `mm_exam_result` | id, exam_id(FK), result_number, result_acc_physics/chemistry/law/engineering/economics/health/psychology/business/biology/philosophy/cs/history/math/other/total |
| `npu_exam` | id, name, benchmark, model, precision, framework, batch_size, dataset, data_number, npu_type, npu_num, max_output_tokens, retry_num, status |
| `npu_exam_result` | id, exam_id(FK), result_number, result_tt100t, result_tps, result_tps_best, result_ttft, result_tpot, result_latency, result_sps, result_accuracy, result_npu_mem_peak, result_npu_util, result_npu_power, result_valid |
| `gpu_sweep` | id, status, mode (full/calibration), matrix_json, started_at |
| `gpu_sweep_cell` | id, sweep_id(FK), kind, status, precision, batch_size, sample_size, scenario, tp_size, exam_id(FK nullable) |

### NFS Paths
| Path | Contents |
|------|----------|
| `/mnt/models/` | HuggingFace model weights (served via `GET /api/files/models`) |
| `/mnt/datasets/` | Benchmark datasets; `settings.json` served via `GET /api/files/settings` |
| `/mnt/results/` | Job output ZIPs (exam_result.zip, submission_report.zip) |

### localStorage Keys
| Key | Default | Purpose |
|-----|---------|---------|
| `HIDE_SWEEP_RUNS` | `true` in prod, `false` in dev | Toggle to hide gpu-sweep auto-created exams from MLPerf table |

### Frontend Env Vars
| Key | Example | Purpose |
|-----|---------|---------|
| `VITE__APP_API_BASE_URL` | `http://10.254.184.195:30980/api` | Backend base URL for axios |
| `VITE__GPU_SWEEP_ENABLED` | `true` | Enables sweep UI controls; false shows disabled alert |
