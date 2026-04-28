# Testing Guide

Comprehensive overview of test suites, how to run them, and how to add new tests.

## Test Inventory

### Backend Unit Tests

Located in `server/src/` matching `*.spec.ts` pattern.

| Test | Purpose | Command |
|------|---------|---------|
| `app.controller.spec.ts` | Root controller health checks | `npm test -- app.controller` |
| `gpu-sweep.service.spec.ts` | Sweep cell generation, node allocation | `npm test -- gpu-sweep.service` |
| `matrix.fixture.spec.ts` | Snapshot: 96 cells, trim rules (fp8 limits, TP matching) | `npm test -- matrix.fixture` |
| `realtime.service.spec.ts` | SSE message formatting, subscriber state | `npm test -- realtime.service` |

**Run all unit tests**:
```bash
cd server
npm test
```

**Watch mode** (re-run on file change):
```bash
npm test:watch
```

**Coverage report**:
```bash
npm test:cov
# Output: coverage/index.html
```

### Backend E2E Tests

Located in `server/test/` matching `*.e2e-spec.ts` pattern. Require running PostgreSQL.

| Test | Purpose | Command |
|------|---------|---------|
| `gpu-sweep.e2e-spec.ts` | Full 96-cell dispatch, per-node mutex, 60s stagger | `npm run test:e2e -- gpu-sweep` |
| `gpu-sweep-calibration.e2e-spec.ts` | Calibration mode (1 canonical cell), quiet-window status | `npm run test:e2e -- gpu-sweep-calibration` |
| `realtime.e2e-spec.ts` | SSE stream real-time updates, subscriber lifecycle | `npm run test:e2e -- realtime` |
| `soak.e2e-spec.ts` | Stability: 100+ exams in flight for 10+ minutes | `npm run test:e2e -- soak` |

**Run all E2E tests** (requires database up):
```bash
cd server
docker-compose -f ../docker-compose.dev.yml up -d db
npm run test:e2e
```

**Run specific E2E test**:
```bash
npm run test:e2e -- gpu-sweep
```

### Frontend E2E Tests

Located in `web/e2e/` matching `*.spec.ts` pattern. Use Playwright.

| Test | Purpose | Command |
|------|---------|---------|
| `gpu-realtime.spec.ts` | GPU dashboard renders devices, SSE updates every 2s, sweep progress visible | `npm run test:e2e -- gpu-realtime` |
| `device-comparison-parity.spec.ts` | MLPerf and MMLU comparison pages render and update identically | `npm run test:e2e -- device-comparison-parity` |
| `sweep-drain.spec.ts` | Admin can toggle pause/drain; UI updates reflect state | `npm run test:e2e -- sweep-drain` |

**Run all Playwright tests**:
```bash
cd web
npm run test:e2e
```

**Interactive test runner** (see what's happening):
```bash
npm run test:e2e:ui
```

## Running Tests

**Setup**: `docker-compose -f docker-compose.dev.yml up db`

**Backend**: `cd server && npm test` (unit) or `npm run test:e2e` (E2E, needs DB)

**Frontend**: `cd web && npm run test:e2e`

**Smoke suite** (CI gate): `npm test -- gpu-sweep realtime && npm run test:e2e -- gpu-realtime`

## Adding a Unit Test

**Backend**: Create `*.spec.ts` next to source. Use `@nestjs/testing.Test.createTestingModule()` to mock repositories.

**Frontend**: Create `*.spec.ts` in `web/e2e/`. Use page objects + Playwright locators. Run via `npm run test:e2e`.

## Common Patterns

**Page objects** (reusable test helpers): Create classes with navigation and assertion methods.

**Mocking HTTP**: `page.route('**/api/**', route => route.abort('timedout'))`

**DB seeding (E2E)**: Use `dataSource.getRepository(Entity).save({...})` in beforeEach.

## Coverage Gaps

| Gap | Fix |
|-----|-----|
| New API endpoint untested | Add E2E test; verify response shape |
| SSE 5xx fallback untested | Test that blocks SSE, verifies poll fallback |
| Concurrent writes untested | Add soak test with 100+ parallel exams |
| Enum drift (server ≠ web) | CI gate: diff server and web enum files |

## Debugging

**Jest**: `npm run test:debug` (inspector), `npm test -- --testNamePattern="pattern"` (single test)

**Playwright**: `npm run test:e2e -- --debug` (step through), `--headed` (see browser), `--trace on` (save recording)
