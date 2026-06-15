<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-21 | Updated: 2026-04-21 -->

# etri-llm-exam-solution

## Purpose
Full-stack LLM evaluation platform monorepo. NestJS backend (REST API + gRPC) with React frontend (MUI dashboard). Manages MLPerf and MMLU benchmark exams with real-time result visualization, comparison, and Loki-based logging. Deployed to Kubernetes via Helm chart in the ETRI-owned sibling directory `etri-llm-deployments/app/kubernetes/app-chart/`.

## Key Files

| File | Description |
|------|-------------|
| `docker-compose.dev.yml` | Dev environment: PostgreSQL, Adminer, backend (9999), frontend (5173) |
| `docker-compose.prod.yml` | Production builds with Nginx frontend and Node backend |
| `docker-push-simple.sh` | Build and push Docker images to registry |
| `package.json` | Root workspace config — `npm run dev` starts both services |
| `yarn.lock` | Dependency lock file |
| `.dockerignore` | Docker build exclusions |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `server/` | NestJS backend — REST API, TypeORM, gRPC client, Loki logging (see `server/AGENTS.md`) |
| `web/` | React frontend — MUI dashboard, charts, exam management UI (see `web/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- **Monorepo** using Yarn workspaces — run `yarn install` at root
- `npm run dev` starts both server and web concurrently
- `npm run dev:server` / `npm run dev:web` for individual services
- Docker images are built per-service with separate `Dockerfile.dev` and `Dockerfile.prod`
- The `.env` file at root contains database credentials and service URLs — never commit secrets

### Testing Requirements
- Backend: `cd server && npm test` (Jest + Supertest)
- Frontend: `cd web && npm test`
- E2E: Run `docker-compose -f docker-compose.dev.yml up` and verify all services

### Common Patterns
- Backend and frontend share enum definitions (keep in sync)
- TypeORM entities in `server/src/entities/` map to PostgreSQL tables
- gRPC proto definitions in `server/proto/` generate types in `server/proto-types/`
- Frontend uses React Query for server state + Zustand for client state

## Dependencies

### Internal
- Deployed via Helm chart in `../etri-llm-deployments/app/kubernetes/app-chart/` (ETRI-owned; legacy path was `../mondrianai-etri-llm-deployments-*/kubernetes/app-chart/`)
- Docker images referenced: `ghcr.io/etri-llm/etri-llm-frontend`, `ghcr.io/etri-llm/etri-llm-backend` (migration from `jungwooshim/etri-cloud-*` in progress)

### External
- Node.js 22 (Alpine in Docker)
- PostgreSQL 15
- NestJS 11, React 19, MUI 7, Vite 7
- gRPC (ts-proto for codegen)
- TypeORM, Axios, Zustand, React Query

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->

## GPU Sweep Mode

GPU Sweep Mode orchestrates a bounded benchmark sweep across all 4 GPU SKUs (NVIDIA-L40, NVIDIA-A40, NVIDIA-L40-44GiB, NVIDIA-A40-44GiB on node2/node3). It is gated by the `GPU_SWEEP_ENABLED` environment variable (default `false` in production).

### Starting a sweep

```bash
# Full 110-cell sweep (requires GPU_SWEEP_ENABLED=true)
curl -X POST http://localhost:9999/api/gpu-sweep/start \
  -H 'Content-Type: application/json' \
  -d '{"mode":"full"}'

# Calibration sweep (canonical L40/fp8/bs1/n500/TP1 cell on both nodes)
curl -X POST http://localhost:9999/api/gpu-sweep/start \
  -H 'Content-Type: application/json' \
  -d '{"mode":"calibration"}'
```

### Previewing the matrix (no DB writes, always available)

```bash
curl 'http://localhost:9999/api/gpu-sweep/preview'
# Returns: { total_cells, cells[], timeline: { node2[], node3[] }, dedup_keys_excluded[] }
```

### Checking sweep status

```bash
curl http://localhost:9999/api/gpu-sweep/status
# Returns: { enabled, active_sweep, node_state: { node2, node3 } }
```

### Pausing and draining

```bash
# Pause (stops dispatching new cells, lets running ones finish)
curl -X PATCH http://localhost:9999/api/gpu-sweep/pause/1

# Drain (stops all in-flight cells immediately, idempotent)
curl -X PATCH http://localhost:9999/api/gpu-sweep/drain/1
```

### Real-time dashboard (SSE)

The `/realtime/exams` SSE endpoint streams GPU slot snapshots every 2 seconds. Each message includes:
- `gpus[]` — 4 entries (one per SKU): `sku`, `node`, `slot_status` (`idle`/`running`/`preparing`/`error`), `current_exam` (id, kind, elapsed_seconds, last_known_metric)
- `sweep` — current sweep progress (`total_cells`, `completed`, `running`, `pending`, `paused`)
- `alerts[]` — operator-race failure counts

The dashboard at `/dashboard/gpu-realtime` consumes this stream. The SSE endpoint caps subscribers at 20; excess clients receive a `503` with `X-Fallback: poll` and should fall back to 5-second polling of `/api/gpu-sweep/status`.

### Information Architecture

New routes added in Train A:

| Route | Description |
|-------|-------------|
| `/dashboard/gpu-realtime` | Live GPU device cards + sweep progress bar |
| `/dashboard/sweep-control` | Start/pause/drain sweep matrix (admin-gated) |
| `/mlperf/device-comparison` | MLPerf cross-GPU comparison (mirrors NPU page) |
| `/mmlu/device-comparison` | MMLU cross-GPU comparison (mirrors NPU page) |

### Scheduler behaviour

- **Per-node mutex**: only one sweep cell per node (`node2` / `node3`) is in-flight at a time.
- **60-second stagger**: consecutive dispatches to the same node are separated by at least 60 seconds (configurable via `GPU_SWEEP_MIN_STAGGER_SECONDS`).
- **Operator-race recovery**: if a cell's exam stays `Idle` after 90 seconds, the dispatcher marks it `OperatorRaceFailed` and re-queues with stagger. After 10 race failures per hour the sweep auto-pauses.
- **Quiet window**: `QUIET_WINDOW_CRON` prevents new dispatch during `09:00–18:00 KST` on demo-week days. Default: disabled.

### Demo-safety

- `GPU_SWEEP_ENABLED=false` (production default) — sweep cannot be started; preview endpoint is always available.
- The "Hide sweep runs" toggle in the MLPerf/MMLU list is `ON` by default in production so `[sweep:*]`-tagged exams do not appear to demo operators.
- Baseline exam IDs `#129`, `#126`, `#131` (MLPerf) and `#27` (NPU) are protected: the sweep never modifies existing exam rows.
- Rollback: `kubectl rollout undo deployment/etri-llm-backend -n llm-evaluation` restores the previous image; `GPU_SWEEP_ENABLED=false` stops all new dispatches without touching existing DB rows.

### Matrix structure

The canonical sweep matrix contains **110 cells** after 6 trim rules and 20 hand-curated dedup entries. The materialized fixture is locked in `server/src/gpu-sweep/matrix.fixture.ts` and the snapshot test asserts `cells.length === 110`. Key trim rules:

Note: original plan target was 96; the implemented trim rules produce 110 due to the realized FP8 + Ampere fallback handling. 110 is the canonical count.
- TP=2 only on L40 and L40-44GiB (matched pairs)
- No `fp8 + bs=4` on A40 SKUs (Ampere lacks FP8 tensor cores)
- MLPerf `server` scenario only at bs=1 and data_number ≥ 500
- Each cell runs `retry_num=3` passes

See the full ralplan at `.omc/plans/ralplan-gpu-saturation-and-realtime-dashboard.md` for the complete cell budget breakdown.

## Compute Devices: NVIDIA, Furiosa, and Rebellions

The platform supports **three distinct vendor ecosystems** that are completely separate:

| Vendor | Device | Resource | Node | Status |
|--------|--------|----------|------|--------|
| **NVIDIA** | GPU (L40, A40, L40-44GiB, A40-44GiB) | `nvidia.com/gpu` | node2, node3 | Ready ✓ |
| **Furiosa** | RNGD NPU | `furiosa.ai/warboy` | node4 | Ready ✓ |
| **Rebellions** | Atom+ NPU | `rebellions.ai/atomplus` | node5 | Pending Join (requires explicit team lead approval) |

**CRITICAL**: Do NOT conflate vendors or assume they share implementation details. Each vendor:
- Runs its own device plugin (separate namespace/daemonset)
- Advertises separate Kubernetes resources
- Has distinct scheduling and resource allocation rules
- Requires vendor-specific kernel drivers and runtime

See `docs/device_registry.md` for device discovery, registration, and API details.

## Operator Documentation

| Document | Purpose |
|----------|---------|
| `docs/node5_atomplus_runbook.md` | Step-by-step node5 (Rebellions Atom+) join procedure with rollback at each step. Hardware: PCI 1eff:1220, /dev/rsd0, rbln-smi/rbln-stat. **LEAD-GATED**: Do NOT execute without explicit team lead approval. |
| `docs/dashboard_troubleshooting.md` | Empty state diagnostics for all 5 dashboards (gpu-realtime, npu-realtime, sweep-control, mlperf/device-comparison, mmlu/device-comparison). Includes reason codes and resolution steps. |
| `docs/sweep_control_usage.md` | How to use GPU sweep options (full vs calibration). Disabled reason codes and fixes (feature_flag_off, node_not_ready, device_plugin_missing, no_model_artifact, missing_permission, node_pending_join). |
| `docs/device_registry.md` | How /api/devices, cluster.yaml, and Kubernetes API combine. Device vendor separation, data model, and integration with dashboards. |
| `docs/operator_recovery_runbook.md` | Emergency procedures: node NotReady, device plugin crash, helm rollback, database rollback, image rollback, branch revert. Includes prevention checklist. |
| `docs/operator_runbook.md` (existing) | Daily health checks, exam troubleshooting, result access, and rollback procedures. |

## Frontend Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/dashboard/gpu-realtime` | GPU device cards + sweep progress | Real-time GPU saturation metrics (SSE) |
| `/dashboard/npu-realtime` | NPU device cards (Furiosa RNGD + Rebellions Atom+) | Real-time NPU metrics; shows pending_join state for node5 |
| `/dashboard/sweep-control` | Sweep matrix UI (admin-gated) | Start/pause/drain GPU sweep; check status |
| `/mlperf/device-comparison` | Per-device aggregate metrics | Compare MLPerf throughput/latency across GPU SKUs |
| `/mmlu/device-comparison` | Per-device aggregate metrics | Compare MMLU accuracy/latency across all vendors |

## Backend API Endpoints (New in P0)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/devices` | GET | List all devices; supports ?vendor=, ?status= filters |
| `/api/devices/sync` | POST | Force rebuild device registry from cluster |
| `/api/gpu-sweep/start` | POST | Start sweep (mode: full or calibration) |
| `/api/gpu-sweep/pause/{id}` | PATCH | Pause sweep; allow running jobs to finish |
| `/api/gpu-sweep/drain/{id}` | PATCH | Drain sweep; cancel all jobs immediately |
| `/api/gpu-sweep/resume/{id}` | PATCH | Resume paused sweep |
| `/api/gpu-sweep/status` | GET | Get sweep status and node state |
| `/api/gpu-sweep/preview` | GET | Preview sweep matrix without executing |
| `/api/comparison/mlperf` | GET | MLPerf metrics aggregated by device |
| `/api/comparison/mmlu` | GET | MMLU metrics aggregated by device |
| `/api/realtime/exams` | GET (SSE) | Real-time device slot updates (20-subscriber cap, 5s fallback) |

**See Also**: `server/AGENTS.md` for implementation details and device registry internals.
