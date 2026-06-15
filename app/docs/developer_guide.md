# Developer Guide

This guide helps frontend and backend developers get the LLM evaluation platform running locally and understand common workflows.

## Repository Layout

```
etri-llm-exam-solution/
├── server/               # NestJS backend (REST, gRPC, GPU sweep, SSE)
│   ├── src/entities/     # TypeORM models
│   ├── src/enums/        # Shared enums (sync with web/)
│   ├── src/mp-exam/      # MLPerf module
│   ├── src/mm-exam/      # MMLU module
│   ├── src/gpu-sweep/    # Sweep engine
│   ├── test/             # E2E tests
│   └── proto/            # gRPC definitions
├── web/                  # React frontend (MUI)
│   ├── src/pages/        # Page components
│   ├── src/api/          # HTTP client (Axios)
│   ├── src/hooks/        # React Query hooks
│   ├── src/store/        # Zustand state
│   └── e2e/              # Playwright tests
├── docker-compose.dev.yml
└── .env
```

## Local Development Setup

### Prerequisites
- Node.js 22
- Docker and Docker Compose
- PostgreSQL 15 (via Docker)

### Quick Start

1. **Install dependencies** (root level):
   ```bash
   cd /home/kcloud/etri-llm-exam-solution
   npm install
   ```

2. **Start PostgreSQL and Adminer**:
   ```bash
   docker-compose -f docker-compose.dev.yml up db adminer
   # Adminer available at http://localhost:8080
   ```

3. **Start backend** (separate terminal):
   ```bash
   cd server
   npm install
   npm run start:dev
   # Runs on http://localhost:9999
   ```

4. **Start frontend** (separate terminal):
   ```bash
   cd web
   npm install
   npm run dev
   # Runs on http://localhost:5173
   ```

The frontend will proxy API calls to `http://localhost:9999/api` via `.env` configuration.

## Architecture

**Backend**: NestJS modules (MLPerf, MMLU, GPU Sweep) with TypeORM/PostgreSQL, gRPC client, SSE gateway for real-time GPU status.

**Frontend**: React Query (server state) + Zustand (client state), MUI 7 components, Axios HTTP client, Playwright E2E tests.

## Common Workflows

### Add a New API Endpoint

1. Create DTO in `server/src/<module>/dto/` with validation
2. Add service method in `server/src/<module>/<module>.service.ts`
3. Add controller route in `server/src/<module>/<module>.controller.ts`
4. Add API function in `web/src/api/domains/<feature>.ts` (Axios client)
5. Create hook in `web/src/hooks/<feature>.ts` (wraps React Query mutation)

### Add a New Page
Create component in `web/src/pages/<benchmark>/`, add route in `RouterContext.tsx`, add navigation link.

### Add a New Exam Type
1. Add enum to `server/src/enums/exam-mode.enum.ts`
2. **Sync same enum** to `web/src/enums/exam-mode.enum.ts`
3. Create module `server/src/<exam-type>-exam/` following MLPerf/MMLU pattern
4. Add pages in `web/src/pages/<exam-type>/`

### Add a New Accelerator
Add SKU to `server/src/gpu-sweep/matrix.fixture.ts`, update test snapshot.

## Testing

**Backend unit tests**: `cd server && npm test` (Jest, test isolated services)

**Backend E2E tests**: `npm run test:e2e` (requires PostgreSQL)
- `gpu-sweep.e2e-spec.ts` — 96-cell dispatch
- `realtime.e2e-spec.ts` — SSE stream
- `soak.e2e-spec.ts` — Stability test

**Frontend E2E tests**: `cd web && npm run test:e2e` (Playwright)
- `gpu-realtime.spec.ts` — Dashboard
- `device-comparison-parity.spec.ts` — Comparison pages
- `sweep-drain.spec.ts` — Pause/drain

**Smoke suite for CI**: `npm test -- gpu-sweep realtime && npm run test:e2e -- gpu-realtime`

## Style Guide

- **Backend**: NestJS module boundaries; each module self-contained; shared code in `src/common-dto/`, `src/enums/`
- **Frontend**: React Query for server fetching; Zustand for client state; MUI 7 components; never use inline CSS (use MUI sx or Emotion)
- **Enums**: Must be identical in `server/src/enums/` and `web/src/enums/` — if one changes, update both
- **Database**: Use TypeORM migrations for schema changes; never rely on `synchronize: true` in production

## Target Repositories

When ready to commit changes:
- **Target**: `https://github.com/jshim0978/etri-llm-benchmarking-tool`
- Create feature branch: `git checkout -b feature/your-feature`
- Push and open PR against `main`

For deployment guidance, see `/home/kcloud/etri-llm-deployments/app/kubernetes/` Helm chart and `docs/operator_runbook.md`.
