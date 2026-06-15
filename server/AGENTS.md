<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-21 | Updated: 2026-04-21 -->

# server

## Purpose
NestJS 11 backend for the LLM evaluation platform. Provides REST API for managing MLPerf and MMLU benchmark exams, stores results in PostgreSQL via TypeORM, communicates with an external evaluation service via gRPC, and integrates with Loki for centralized logging. Runs on port 9999.

## Key Files

| File | Description |
|------|-------------|
| `src/main.ts` | Application entry point — bootstraps NestJS with gRPC microservice |
| `src/app.module.ts` | Root module — imports all feature modules, TypeORM, config, scheduling |
| `src/app.controller.ts` | Root controller (health check) |
| `src/app.service.ts` | Root service |
| `ormconfig.ts` | TypeORM database connection configuration |
| `nest-cli.json` | NestJS CLI and build configuration |
| `tsconfig.json` | TypeScript compiler options |
| `tsconfig.build.json` | Production build TypeScript config |
| `package.json` | Dependencies and scripts |
| `Dockerfile.dev` | Development Docker image with hot-reload |
| `Dockerfile.prod` | Multi-stage production build (Node 22-alpine) |
| `eslint.config.mjs` | ESLint configuration |
| `.prettierrc` | Code formatting rules |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | Application source code (see `src/AGENTS.md`) |
| `src/gpu-sweep/` | GPU saturation sweep planner with per-node mutex + 60s stagger; see root `AGENTS.md` "GPU Sweep Mode". |
| `src/realtime/` | SSE gateway (`/api/realtime/exams`) emitting per-GPU snapshots every 2s with 20-subscriber cap and 503 fallback. |
| `proto/` | gRPC Protocol Buffer definitions (`exam.proto`) |
| `proto-types/` | Auto-generated TypeScript types from `.proto` files |
| `mnt/result/` | Mounted directory for exam result files |
| `mnt/datasets/` | Mounted directory for evaluation datasets |
| `test/` | E2E test files — includes `gpu-sweep.e2e-spec.ts`, `gpu-sweep-calibration.e2e-spec.ts` (calibration mode + quiet-window status), `realtime.e2e-spec.ts`, `soak.e2e-spec.ts` |

## For AI Agents

### Working In This Directory
- Run `npm install` before development
- Dev server: `npm run start:dev` (hot-reload via NestJS CLI)
- Database must be running (PostgreSQL on port 5432) — use docker-compose from parent
- gRPC proto changes require regenerating types: check `proto-types/` after editing `proto/exam.proto`
- Environment variables loaded via `@nestjs/config` from `.env` at project root

### Testing Requirements
- Unit tests: `npm test` (Jest)
- E2E tests: `npm run test:e2e` (requires running database)
- Test files follow `*.spec.ts` naming convention

### Common Patterns
- Each feature is a NestJS module with controller, service, DTOs in its own directory
- DTOs use `class-validator` decorators for input validation
- TypeORM entities use decorators for schema definition
- Interceptors handle error formatting, logging, and response transformation
- gRPC client module wraps communication with external evaluation service

## Dependencies

### Internal
- `proto/exam.proto` → generates `proto-types/` TypeScript interfaces
- `mnt/` directories mapped to NFS PVCs in Kubernetes

### External
- NestJS 11 (core, config, schedule, platform-express)
- TypeORM 0.3.x + PostgreSQL driver
- gRPC (@grpc/grpc-js, ts-proto)
- class-validator, class-transformer
- Axios, bcrypt, dayjs, zod

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->

## Device Registry & NPU Support

The backend now integrates compute devices from three distinct vendors via a centralized Device Registry:

| Vendor | Device | Namespace | Implementation |
|--------|--------|-----------|-----------------|
| **NVIDIA** | GPU (L40, A40) | `kube-system` (NVIDIA device plugin) | Standard K8s resource: `nvidia.com/gpu` |
| **Furiosa** | RNGD NPU | `furiosa-system` (Furiosa device plugin) | Custom K8s resource: `furiosa.ai/warboy` |
| **Rebellions** | Atom+ NPU | `furiosa-system` (Rebellions device plugin) | Custom K8s resource: `rebellions.ai/ATOM` |

**Key Location**: `src/device-registry/` — integrates Kubernetes API, cluster.yaml, and gRPC service health checks.

**New Endpoints**:
- `GET /api/devices` — List all devices; supports ?vendor=, ?status= filters
- `POST /api/devices/sync` — Force rebuild device registry from cluster state
- `GET /api/devices/{id}` — Get single device details

See `../docs/device_registry.md` for full API docs and troubleshooting.

## Operator Documentation Index

| Document | Location | Purpose |
|----------|----------|---------|
| Node5 Join Runbook | `../docs/node5_atomplus_runbook.md` | Step-by-step Rebellions Atom+ join with rollback (LEAD-GATED) |
| Dashboard Troubleshooting | `../docs/dashboard_troubleshooting.md` | Empty state diagnostics + reason codes for all 5 dashboards |
| Sweep Control Usage | `../docs/sweep_control_usage.md` | GPU sweep modes, disabled reasons, API reference |
| Device Registry | `../docs/device_registry.md` | How devices are discovered, registered, and exposed via API |
| Operator Recovery | `../docs/operator_recovery_runbook.md` | Emergency procedures: node NotReady, plugin crash, helm rollback |

See parent `AGENTS.md` "Compute Devices" section for vendor separation and key differences.
