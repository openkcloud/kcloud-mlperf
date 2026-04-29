<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-21 | Updated: 2026-04-21 -->

# web

## Purpose
React 19 frontend for the LLM evaluation platform. MUI-based dashboard providing exam management, real-time result visualization with charts, and multi-run comparison for MLPerf and MMLU benchmarks. Built with Vite, styled with Emotion/MUI, state managed by Zustand + React Query.

## Key Files

| File | Description |
|------|-------------|
| `src/index.tsx` | React app entry point |
| `src/App.tsx` | Root component with context providers |
| `vite.config.ts` | Vite build configuration |
| `tsconfig.json` | TypeScript config for React |
| `package.json` | Dependencies and scripts |
| `Dockerfile.dev` | Dev Docker image with Vite HMR |
| `Dockerfile.prod` | Multi-stage build → Nginx Alpine for static serving |
| `.env` | Environment variables (API base URL) |
| `.eslintrc` | ESLint rules |
| `.prettierrc` | Code formatting |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | Application source code (see `src/AGENTS.md`) |
| `src/pages/dashboard/gpu-realtime/` | Real-time GPU saturation dashboard (mirrors `npu/device-comparison`); see root `AGENTS.md` "GPU Sweep Mode". |
| `src/pages/dashboard/sweep-control/` | Admin UI for starting / pausing / draining the 96-cell sweep matrix. |
| `src/pages/{mlperf,mmlu}/device-comparison/` | Per-benchmark device-comparison pages sharing `DeviceRealtimeDashboard` with the GPU dashboard. |
| `public/` | Static assets served directly |

## For AI Agents

### Working In This Directory
- Run `npm install` before development
- Dev server: `npm run dev` (Vite HMR on port 5173)
- Backend must be running on port 9999 for API calls
- `.env` contains `VITE_API_BASE_URL` — Vite exposes only `VITE_`-prefixed env vars
- Production build outputs to `dist/` served by Nginx

### Testing Requirements
- `npm test` for unit tests
- Verify UI changes against both MLPerf and MMLU sections
- Test chart rendering with various data shapes (empty, single, multiple results)

### Common Patterns
- MUI 7 components with Emotion CSS-in-JS styling
- React Query for server state (auto-refetch, caching)
- Zustand stores for comparison selections and notifications
- React Router v7 for navigation
- Axios HTTP client with interceptors in `src/libs/`
- Barrel exports via `index.ts` files

## Dependencies

### Internal
- Consumes REST API from `../server/` on port 9999
- Shares enum values with backend (must keep in sync manually)

### External
- React 19, React Router 7
- MUI 7 (material, x-charts, x-date-pickers)
- Vite 7 (build tooling)
- Axios, Zustand, React Query (@tanstack/react-query)
- React Hook Form, @tanstack/react-table
- xlsx (Excel export), dayjs, lodash

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->

## Real-time Device Dashboards

The frontend now displays real-time device status across three vendors via dedicated dashboard pages:

### GPU Realtime Dashboard (`/dashboard/gpu-realtime`)

Live GPU saturation metrics for NVIDIA devices on node2/node3:
- 4 device cards (L40, A40, L40-44GiB, A40-44GiB)
- Real-time status: idle / running / preparing / error
- Exam queue depth per node
- SSE updates every 2 seconds (503 fallback to 5s polling if subscriber cap exceeded)

### NPU Realtime Dashboard (`/dashboard/npu-realtime`)

Live NPU metrics for Furiosa (node4) and Rebellions (node5):
- Furiosa RNGD: 4 warboy devices (node4, Ready)
- Rebellions Atom+: 2 atomplus devices (node5, pending_join until join completes)
- Shows device status and pending_join reason
- Same SSE / polling mechanism as GPU dashboard

### Device Comparison Pages

Aggregate metrics per device across completed exams:
- `/mlperf/device-comparison` — MLPerf throughput/latency by device
- `/mmlu/device-comparison` — MMLU accuracy/latency by device
- Automatically updated when new exams complete

**Key Hook**: `useDeviceRegistry()` in `src/hooks/useDeviceRegistry.ts` — auto-refreshes device list every 30s, triggers dashboard re-renders on status change.

## Operator Documentation Index

| Document | Location | Purpose |
|----------|----------|---------|
| Node5 Join Runbook | `../docs/node5_atomplus_runbook.md` | Step-by-step Rebellions Atom+ join with rollback (LEAD-GATED) |
| Dashboard Troubleshooting | `../docs/dashboard_troubleshooting.md` | Empty state diagnostics + reason codes for gpu-realtime, npu-realtime, sweep-control, device-comparison pages |
| Sweep Control Usage | `../docs/sweep_control_usage.md` | How to start/pause/drain GPU sweeps; disabled reasons and fixes |
| Device Registry | `../docs/device_registry.md` | Device discovery, API integration, vendor separation |
| Operator Recovery | `../docs/operator_recovery_runbook.md` | Emergency procedures and troubleshooting |

See parent `AGENTS.md` "Compute Devices" section for the three distinct vendor ecosystems (NVIDIA GPU, Furiosa RNGD, Rebellions Atom+) and why they must NOT be conflated.
