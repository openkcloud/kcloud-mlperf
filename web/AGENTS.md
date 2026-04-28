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
