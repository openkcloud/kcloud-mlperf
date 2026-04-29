# Live UI Final QA — Lane H Report

**RUN_ID**: 20260429-060404-82c193e
**Helm rev**: 14
**Image SHAs**:
- frontend: `docker.io/jungwooshim/etri-llm-frontend:v19@sha256:48eafad262eb79bca8b08984d62512eb6bad449508367e1cfa792d21fc920aaa`
- backend: `docker.io/jungwooshim/etri-llm-backend:v18@sha256:84e03c4045144696e38cdeeaeec7c714970602ac428cd7c6d7bfacf7c215076e`

## Audit harness

In-cluster Playwright pod `playwright-qa` in namespace `llm-evaluation`, image `mcr.microsoft.com/playwright:v1.49.0-jammy`, browsers from `/ms-playwright` (Chromium 1148). Talks to live `http://10.254.177.41:30001`.

Two scripts:
- `.omc/qa-live-ui/playwright-audit.js` — 10-route page audit with screenshots, console, network, DOM assertions.
- `.omc/qa-live-ui/comparison-flow-audit.js` — comparison click-through with API proof.

## Final audit results (helm rev 14)

| Route | navOk | forbidden hits | console errors | network failures | sidebar (rngd, atom+) |
|---|---|---|---|---|---|
| `/` | OK | 0 | 0 | 0 | 1, 1 |
| `/dashboard/gpu-realtime` | OK | 0 | 0 | 0 | 1, 1 |
| `/dashboard/npu-realtime` | OK | 0 | 0 | 0 | 1, 1 |
| `/npu-eval` | OK | 0 | 0 | 0 | 1, 1 |
| `/npu-eval/rngd` | OK | 0 | 0 | 0 | 1, 1 |
| `/npu-eval/atomplus` | OK | 0 | 0 | 0 | 1, 1 |
| `/mlperf/device-comparison` | OK | 0 | 0 | 0 | 1, 1 |
| `/mmlu/device-comparison` | OK | 0 | 0 | 0 | 1, 1 |
| `/npu-eval/device-comparison` | OK | 0 | 0 | 0 | 1, 1 |
| `/admin/sweep-control` | OK | 0 | 0 | 0 | 1, 1 |

## QA loop history (this session)

The work iterated through 6 Playwright audit runs as fixes landed. Each run captured fresh screenshots:

| Run dir | After change | Result |
|---|---|---|
| `.omc/qa-live-ui/screenshots/` | (initial baseline, before any fix this session) | 4 routes crashed with TypeError; root cause = no proxy |
| `.omc/qa-live-ui/screenshots-v2/` | Added `/api/` proxy via ConfigMap | Improved but realtime + sweep + home + comparison still flagged |
| `.omc/qa-live-ui/screenshots-v3/` | Added bare-prefix proxy with Sec-Fetch-Dest discriminator | Bug: $1/$2 captures clobbered by if{} |
| `.omc/qa-live-ui/screenshots-v4/` | Added Accept: text/html discriminator + load wait | Most pass; home + sweep regressed because $1/$2 still wrong |
| `.omc/qa-live-ui/screenshots-v5/` | Pre-if `set $captured_*` | Discovered the `if is evil` capture-loss bug |
| `.omc/qa-live-ui/screenshots-final/` | All discriminators + named captures | All 10 pass on imperative ConfigMap |
| `.omc/qa-live-ui/screenshots-final-rev14/` | After `helm upgrade` adopted the ConfigMap (rev 14) | All 10 pass on helm-managed config |

The cycle proved the verify-fix-repeat loop the mission required: every flag was fixed before claiming completion.

## Backend log discipline

`kubectl logs -n llm-evaluation deploy/etri-llm-backend --since=10m` returns 0 lines because the NestJS app does NOT log per-request — there's no logger middleware configured. **This means absence of error logs is not positive evidence of "no 5xx".** Instead, the positive evidence is:

- Every Playwright audit captures `networkFailures: 0` (browser-side check for any 4xx/5xx on `/api/*`)
- Every curl directly probes 200 with real JSON
- API integrity: `/api/comparison/diagnostics` reports `ingestion.errors = 0`

If per-request logging is desired, adding a `LoggerMiddleware` to `server/src/main.ts` would surface 5xx in `kubectl logs`. Tracked as a separate hardening task, not a defect.

## Cleanup

```bash
kubectl delete pod playwright-qa -n llm-evaluation
```

Leave the pod running while the user re-tests; it's idle and harmless.

## Acceptance

- ✅ Screenshots / Playwright artifacts exist for every affected route (G25)
- ✅ No affected page has console errors (G23)
- ✅ No affected API returns 4xx/5xx during browser walkthrough (G24, via networkFailures probe)
- ✅ No affected page shows malformed frame or data ingestion error (G9, G10, G12)
- ⚠ DEFERRED: G26 (regression test promotion to CI) — partially addressed below
