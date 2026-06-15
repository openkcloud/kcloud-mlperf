<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-21 | Updated: 2026-04-21 -->

# web/src

## Purpose
React 19 frontend source code for the LLM evaluation dashboard. Provides exam management, result visualization with MUI X Charts, and multi-run comparison views for both MLPerf and MMLU benchmarks. Uses React Query for server state, Zustand for client state, and MUI 7 for the design system.

## Key Files

| File | Description |
|------|-------------|
| `index.tsx` | React DOM entry point |
| `App.tsx` | Root component — wraps app in context providers (theme, router, query, notifications) |
| `vite-env.d.ts` | Vite environment type declarations |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `api/` | HTTP client layer: Axios instance, domain-specific API functions, TypeScript interfaces |
| `api/domains/` | API functions grouped by domain: `files`, `mm-exam`, `mp-exam` |
| `api/types/` | TypeScript interfaces matching backend DTOs and API responses |
| `assets/` | SVG icons and static images |
| `components/` | Reusable UI components: charts (Bar, Line, HorizontalBar), inputs, modals, tables, loader |
| `components/Graphs/` | Chart components using MUI X Charts |
| `components/Inputs/` | Text input and textarea components |
| `components/Modal/` | Modal dialog component |
| `components/Table/` | Data table with sorting, pagination (@tanstack/react-table) |
| `constants/` | App constants: dataset mappings, HTTP status codes, timezone configs |
| `contexts/` | React context providers: Notification, Query (React Query), Router, Theme (MUI) |
| `enums/` | Shared enums — must stay in sync with `server/src/enums/` |
| `helpers/` | Utility functions (formatting, data transformation) |
| `hooks/` | Custom React hooks for data fetching (wrapping React Query) |
| `layouts/` | Page layout components (header, sidebar, content area) |
| `libs/` | Axios HTTP client with request/response interceptors |
| `pages/` | Page components organized by benchmark type |
| `pages/mlperf/` | MLPerf pages: main (exam list/create), test-result, test-comparison |
| `pages/mmlu/` | MMLU pages: main (exam list/create), test-result, test-comparison |
| `store/` | Zustand stores: comparison selections, notification state |
| `styles/` | Global CSS styles |

## For AI Agents

### Working In This Directory
- Components use MUI 7 — import from `@mui/material`, not custom CSS for standard UI elements
- Charts use `@mui/x-charts` — check MUI X docs for API
- API layer in `api/` wraps all backend calls — never call Axios directly from components
- Custom hooks in `hooks/` wrap React Query — use these for data fetching in components
- Enums in `enums/` **must match** `server/src/enums/` — if backend adds a new status, update here too
- Environment variable access: only `VITE_*` prefixed vars are exposed by Vite

### Testing Requirements
- Component tests should use React Testing Library
- Test charts with edge cases: empty data, single data point, large datasets
- Test comparison views with 0, 1, and multiple selected runs

### Common Patterns
- API layer: `api/domains/<feature>.ts` → exports functions used by `hooks/<feature>.ts` → consumed by `pages/`
- State: server state via React Query hooks, client-only state via Zustand stores
- Routing: defined in `contexts/RouterContext` using React Router v7
- All list pages use `@tanstack/react-table` with the shared Table component
- MUI theme customization in `contexts/ThemeContext`
- Notifications via `contexts/NotificationContext` (toast-style)

## Dependencies

### Internal
- `api/types/` ← mirrors backend DTOs for type safety
- `enums/` ← shared with `server/src/enums/` (manual sync)
- `components/` ← used by all `pages/`
- `hooks/` ← used by `pages/` for data fetching
- `contexts/` ← wraps entire app in `App.tsx`

### External
- React 19, React Router 7
- MUI 7 (@mui/material, @mui/x-charts, @mui/x-date-pickers)
- @tanstack/react-query, @tanstack/react-table
- Zustand (client state)
- React Hook Form (form handling)
- Axios (HTTP client)
- xlsx (Excel export), dayjs (dates), lodash (utils)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
