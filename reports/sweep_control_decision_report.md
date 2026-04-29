# Sweep Control Decision — Lane F Report

**RUN_ID**: 20260429-060404-82c193e
**Decision**: HIDDEN from primary nav. Direct access at `/admin/sweep-control` only.

## Live state (Playwright)

| Probe | Result |
|---|---|
| `/admin/sweep-control` reachable | ✅ 200 OK, SPA renders |
| `/admin/sweep-control` admin-warning Alert visible | ✅ "Admin-only page. Sweep Control is not accessible from the main navigation." |
| Sidebar `Sweep Control` / `Batch Benchmark Runner` link count | 0 (hidden) |
| Console errors | 0 |
| Network failures | 0 |

Screenshot: `.omc/qa-live-ui/screenshots-final-rev14/sweep-control.png`

## Backend feature-flag state (verified via API)

```
GET /api/gpu-sweep/options
{
  "data": {
    "enabled": false,
    "feature_flag_reason": "feature_flag_off",
    "benchmarks": [...all enabled:false, disabled_reason:feature_flag_off...],
    "hardware":   [...all enabled:false...],
    "nodes":      [...all enabled:false...]
  }
}
```

The whole feature is gated by `GPU_SWEEP_ENABLED=false` in production secret env. The page surfaces this state cleanly via `disabled_reason="feature_flag_off"` chips/labels — not via blank empty state.

## Why this decision

The user explicitly stated "I do not know what Sweep Control is for." Per the mission brief: "prefer hiding/removing from primary nav unless a useful workflow can be demonstrated in browser." The feature is currently disabled by env-flag in production, so showing it in the primary sidebar would mislead users into thinking it's an active feature.

The page is preserved at `/admin/sweep-control` so an operator who needs it (e.g., when running a dev cluster with `GPU_SWEEP_ENABLED=true`) can still reach it directly. The admin-warning Alert at the top tells them this is an internal/admin-only path.

## Acceptance

- ✅ Sweep Control hidden from primary nav (G16)
- ✅ Direct route still works and explains it is admin/internal (G16)
- ✅ Page does not crash (G16, regression-fixed by helm rev 14 nginx proxy — previously crashed with `Cannot read properties of undefined (reading 'map')`)
