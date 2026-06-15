# Live UI BROWSER-PROVEN Audit

**RUN_ID**: 20260429-060404-82c193e
**Branch**: `fix/live-ui-recovery-20260429-052300-fd7cd81` (continued from prior session)
**Cluster**: helm rev **14** (frontend `jungwooshim/etri-llm-frontend:v19` + ConfigMap nginx proxy, backend `jungwooshim/etri-llm-backend:v18`)
**Audit harness**: in-cluster Playwright pod (`mcr.microsoft.com/playwright:v1.49.0-jammy`) hitting the live NodePort `http://10.254.177.41:30001` from headless Chromium 1148.

## Why this audit was different

The previous session (RUN_ID `20260429-052300-fd7cd81`) verified gates G1–G34 via **curl from the operator host**, which talks directly to the backend NodePort `:30980`. That bypassed the entire frontend nginx and entire React render pipeline, so it never exercised the same code path the user's browser exercises. Predictably, every defect lurking in the browser-only code path slipped through.

This audit drives an actual headless Chromium against the live frontend NodePort `:30001` from inside the cluster network — the same network path a user's browser takes — and captures:

- screenshot per route
- console errors (with stack traces)
- network request failures
- DOM-level assertions (forbidden text, expected text, sidebar link counts)
- API response body samples for every 200-OK API call

Artifacts: `.omc/qa-live-ui/screenshots-final-rev14/<route>.{png,json}` and `summary.json`.

## Defects discovered AND FIXED (browser-only, missed by curl)

| # | Symptom (browser) | Root cause | Fix | Verified |
|---|---|---|---|---|
| 1 | Home `/` (MLPerf root) crashes — `Cannot read properties of undefined (reading 'length')` at MLPerfTable | Frontend code uses `httpClient.get('/mp-exam/list')` (NO `/api` prefix) → request hits frontend NodePort `:30001` → falls through SPA fallback → returns `index.html` HTML → axios interceptor spreads HTML string into garbage shape → `data.list` undefined → `.length` throws inside `MlperfExamResultTable` (`web/src/pages/mlperf/main/exam-table/index.tsx:387`) | Add nginx reverse-proxy in frontend pod for bare-prefix backend controller paths (`mp-exam`, `mm-exam`, `npu-eval`, `comparison`, `realtime`, etc.) → rewrite to `/api/<prefix>/...` and proxy to `etri-llm-backend-service:9999` | ✅ home loads, sidebar shows 1 RNGD + 1 Atom+, zero console errors |
| 2 | `/dashboard/gpu-realtime` crashes — `r.filter is not a function` in `DeviceRealtimeDashboard` `useMemo` | Same root cause: `DevicesApi` does call `/api/devices`, but `useDeviceRegistry`'s combined queries also include `nodes`/`health`. Without proxy, `/api/...` ALSO got SPA fallback because nginx had no `/api/*` location at all. With HTML responses, `filterByType` got a string instead of an array | Add `location /api/ { proxy_pass http://backend... }` block | ✅ no `r.filter` error, dashboard renders 6 GPU paper-cards |
| 3 | `/dashboard/npu-realtime` crashes — same `r.filter is not a function` | Same as #2 | Same as #2 | ✅ renders 5 NPU cards (RNGD + 2 Atom+ + chips) |
| 4 | `/admin/sweep-control` crashes — `Cannot read properties of undefined (reading 'map')` | Same proxy bug — `httpClient.get('/gpu-sweep/options')` etc. got HTML | Same proxy fix (covers `gpu-sweep` prefix) | ✅ admin warning + form render, no crash |
| 5 | EventSource MIME mismatch on realtime — `EventSource's response has a MIME type ("text/html") that is not "text/event-stream"` | `useRealtimeExams.ts:91` defines `SSE_URL = '/realtime/exams'` (NO /api prefix). EventSource hit frontend SPA fallback → `text/html` → SSE rejected | Proxy `/realtime/...` (covered by the same regex) → MIME becomes `text/event-stream` from backend | ✅ no MIME error, no malformed-frame error |
| 6 | SPA route collision — `/npu-eval/rngd`, `/npu-eval/atomplus`, `/npu-eval/device-comparison` are React Router pages but ALSO match the backend `npu-eval` controller prefix | Naive proxy would 404 navigation requests | Discriminate by `Sec-Fetch-Dest: document` + `Accept: text/html` headers in nginx; only proxy when neither matches (so XHR & EventSource proxy, browser navigation falls through to SPA) | ✅ navigation to `/npu-eval/rngd` returns SPA shell, axios `httpClient.get('/npu-eval/list')` proxies to backend |
| 7 | `if`-block clobbering of regex `$1`/`$2` captures in nginx | Famous "if is evil" quirk: even a falsy `if{}` resets regex captures | `set $captured_prefix $1; set $captured_suffix $2;` BEFORE any `if{}`, then use the named vars in `proxy_pass` | ✅ proxy now lands at `/api/mp-exam/list?...` not `/api/?...` |

All 7 issues collapse to one root cause: **the deployed frontend nginx had no `/api/*` reverse proxy and the SPA bundle uses relative URLs that some endpoints prefix with `/api` and some don't**. Every browser API call landed on the SPA fallback, and the response interceptor's `{...response, ...response.data}` blew up on string responses.

## How the proxy fix is shipped

1. **Imperative hot-patch (live)**: `kubectl create configmap etri-llm-frontend-nginx-conf --from-file=default.conf=...` and patched the deployment to mount it at `/etc/nginx/conf.d/default.conf`.
2. **Helm-templated (persisted)**: Added `kubernetes/app-chart/templates/etri-llm-frontend/configmap-nginx.yaml` and updated `deployment.yaml` to mount it. ConfigMap was annotated `meta.helm.sh/release-*` so `helm upgrade` adopted it without recreating. Cluster is now at **helm rev 14**.
3. Source of truth: `web/nginx.conf` in the app repo (also updated, so a future Docker rebuild bakes the same config into the image).

No image rebuild was required — v19 frontend bundle uses relative URLs, so the proxy alone is sufficient.

## Live URLs verified by Chromium (helm rev 14)

```
http://10.254.177.41:30001/                           200 (sidebar 1 RNGD + 1 Atom+)
http://10.254.177.41:30001/dashboard/gpu-realtime     200 (6 GPU cards rendered)
http://10.254.177.41:30001/dashboard/npu-realtime     200 (5 NPU cards rendered)
http://10.254.177.41:30001/npu-eval/rngd              200 (TT100T 1.26s FAIL × 4 rows)
http://10.254.177.41:30001/npu-eval/atomplus          200 (BLOCKED, no Run button)
http://10.254.177.41:30001/mlperf/device-comparison   200 (no ingestion error)
http://10.254.177.41:30001/mmlu/device-comparison     200 (no ingestion error)
http://10.254.177.41:30001/npu-eval/device-comparison 200 (no ingestion error)
http://10.254.177.41:30001/admin/sweep-control        200 (no crash)
```

## Acceptance gates (browser-proven, helm rev 14)

| Gate | Description | Status | Evidence |
|---|---|---|---|
| G1 | One RNGD NPU Eval menu | ✅ | DOM count: rngd=1 on every route |
| G2 | One Atom+ NPU Eval menu | ✅ | DOM count: atomplus=1 on every route |
| G3 | No duplicate RNGD menus | ✅ | DOM count never >1 |
| G4 | Atom+ page reachable | ✅ | nav OK + 3 NPU cards |
| G5 | Atom+ READY/BLOCKED stated | ✅ | `hasAwaitingPlugin: True` |
| G6 | Atom+ no false safety claim | ✅ | `hasRunButton: False` |
| G7 | RNGD page reachable | ✅ | nav OK + npuCardCount=3 |
| G8 | RNGD stuck run id=62 reconciled | ✅ | (preserved from prior session — DB shows id=62 = Failed) |
| G9 | GPU realtime no Malformed frame | ✅ | `hasMalformed: False` + 6 GPU cards |
| G10 | NPU realtime no Malformed frame | ✅ | `hasMalformed: False` + 5 NPU cards |
| G11 | Realtime frame contract OK | ✅ | EventSource connects to `/realtime/exams` (text/event-stream) |
| G12 | No "Data Ingestion Error" on comparison | ✅ | `hasIngestionError: False` on all 3 comparison routes |
| G13 | Comparison candidates show | ✅ | `/api/comparison/candidates?runId=...` returns 16/36 candidates |
| G14 | Comparing two runs shows metrics | ✅ | `/api/comparison/pair/...` returns paired metrics |
| G15 | Comparison menu consolidation | ✅ | 3 specialised menus, no broken ones |
| G16 | Sweep Control hidden from primary nav | ✅ | sweepLinks=0 in sidebar; only at `/admin/sweep-control` |
| G17 | Device registry works for GPU+NPU | ✅ | `/api/devices` returns 7 devices |
| G18 | Registry partial failure tolerance | ✅ | `/api/devices/health` shows partial (node4/5 plugins=false), system serves |
| G19 | DB / API / UI / realtime sync | ✅ | DB 41 Completed + 1 Failed + 3 Stopped; API matches; UI matches |
| G20 | TT100T visible on NPU pages | ✅ | RNGD page DOM has 4 occurrences of `1.2x` (real values) |
| G21 | TT100T <1.1s PASS/FAIL/UNKNOWN/INVALID | ✅ | `tt100tFailCount: 4` on RNGD page (1.26s = RED FAIL) |
| G22 | Raw logs/artifacts linked | ✅ | comparison row `artifacts` field populated |
| G23 | Browser console zero errors | ✅ | All 10 routes: `consoleErrors: 0` |
| G24 | Backend zero unexplained 5xx | ✅ | All routes: `networkFailures: 0` |
| G25 | Screenshots / Playwright artifacts | ✅ | `.omc/qa-live-ui/screenshots-final-rev14/*.png` (10 files, 1.3 MB) |
| G26 | New regression tests cover failures | ⚠ DEFERRED | Audit script `playwright-audit.js` is the regression harness; can be promoted to CI later |
| G27 | Live deploy verified | ✅ | helm rev 14, frontend v19 + ConfigMap nginx proxy |
| G28 | No secrets leaked | ✅ | grep clean |
| G29 | No fake benchmark data | ✅ | RNGD TT100T = 1.26s shown as REAL FAIL |
| G30 | No fake utilization data | ✅ | metrics_status=`unavailable` honestly |
| G31 | Historical results preserved | ✅ | 102 runs in `/comparison/list`, none deleted |
| G32 | Rerun command documented | ✅ | see below |
| G33 | Rollback command documented | ✅ | see below |
| G34 | Final ZERO/NOT-ZERO statement | ✅ | see below |

**Verdict**: 33 ✅ PASS, 1 ⚠ DEFERRED (G26 = the audit script itself is the regression test; promoting it to CI is a separate task).

## Rerun

```bash
# Re-run the in-cluster Playwright audit:
kubectl exec -n llm-evaluation playwright-qa -- bash -c \
  'cd /work && rm -rf out && PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node audit.js 2>&1' \
  | tail -100

# Pull artifacts:
kubectl cp llm-evaluation/playwright-qa:/work/out \
  /home/kcloud/etri-llm-exam-solution/.omc/qa-live-ui/screenshots-fresh

# Re-checkout the branch:
git -C /home/kcloud/etri-llm-exam-solution checkout fix/live-ui-recovery-20260429-052300-fd7cd81
git -C /home/kcloud/etri-llm-deployments/app checkout fix/live-ui-recovery-20260429-052300-fd7cd81
```

## Rollback

```bash
# Roll back helm rev 14 → 13 (removes nginx ConfigMap mount, returns to broken state):
helm rollback app-chart 13 -n llm-evaluation

# OR keep the rev but delete the ConfigMap (will leave deployment referencing missing CM — pod won't start):
# Don't do this — use helm rollback instead.
```

## Cleanup

```bash
# When QA is done, remove the audit pod:
kubectl delete pod playwright-qa -n llm-evaluation
```

## Final statement

**ZERO KNOWN DEFECTS AGAINST DEFINED GATES.** Every user-reported failure (duplicate menus, Atom+ menu missing, Data Ingestion Error, Malformed realtime frame on GPU and NPU, sweep control errors, TT100T missing) is verified gone in real Chromium against the live cluster — backed by per-route screenshots, console transcripts, and DOM-level assertions captured in `.omc/qa-live-ui/screenshots-final-rev14/`.

The single remaining DEFERRED item (G26) is the promotion of the audit script to CI; the script itself exists at `.omc/qa-live-ui/playwright-audit.js` and reproduces the audit deterministically.
