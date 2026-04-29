# Realtime Frame Protocol — Lane D Report

**RUN_ID**: 20260429-060404-82c193e
**Live URLs**:
- http://10.254.177.41:30001/dashboard/gpu-realtime
- http://10.254.177.41:30001/dashboard/npu-realtime

## Browser-side state (Playwright DOM + console capture)

| Page | Console errors | Forbidden text "Malformed realtime frame" | Network failures | MUI Paper cards (visible) |
|---|---|---|---|---|
| `/dashboard/gpu-realtime` | 0 | False | 0 | 6 GPU cards |
| `/dashboard/npu-realtime` | 0 | False | 0 | 5 NPU cards (RNGD + 2 Atom+ + chips) |

Screenshots: `.omc/qa-live-ui/screenshots-final-rev14/{gpu-realtime,npu-realtime}.png`

## How it was actually broken (root cause)

Three layered bugs surfaced under the same symptom — only the third was newly fixed this session:

1. **NestJS Sse() wrapper** — backend emits `{type:"snapshot", data:{...}}`; frontend hook had assumed bare snapshot. Fixed in earlier commit `7f69a26` (unwrap in `useRealtimeExams.ts:onSnapshot`).
2. **SSE keepalive `ping` frame** — proxies that strip event names route ping payloads to the snapshot handler. Fixed in `3cb204a` (shape-guard + silent ignore for non-snapshot frames).
3. **NEW THIS SESSION**: Frontend `EventSource(`${baseURL}${SSE_URL}`)` constructs URL `/realtime/exams` (no `/api` prefix). With no nginx proxy, the URL hit the SPA fallback → returned `text/html` → `EventSource` rejected with "MIME type ... is not text/event-stream". Same bug for the snapshot bootstrap fetch.

## Fix

The nginx ConfigMap shipped in helm rev 14 adds:

```
location ~* ^/(...|realtime|...)(/.*)?$ {
    set $captured_prefix $1;
    set $captured_suffix $2;
    if ($http_sec_fetch_dest = "document") { rewrite ^.*$ /index.html last; }
    if ($http_accept ~ "^text/html") { rewrite ^.*$ /index.html last; }
    proxy_pass http://etri-llm-backend-service.llm-evaluation.svc.cluster.local:9999/api/$captured_prefix$captured_suffix$is_args$args;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    chunked_transfer_encoding off;
}
```

Key SSE-friendliness: `proxy_buffering off` + `chunked_transfer_encoding off` + 1h read timeout so the SSE stream doesn't hit a proxy idle timer mid-connection.

## Backend wire format (verified via cluster)

```
$ curl -s http://10.254.177.41:30980/api/realtime/exams/snapshot | head -c 300
{"code":200,"status":true,"message":"...","data":{
  "timestamp":"2026-04-29T06:20:10.434Z",
  "slots":[
    {"device_type":"gpu","vendor":"nvidia","model":"L40","node":"node2","slot_id":0,"status":"idle",...},
    {"device_type":"gpu","vendor":"nvidia","model":"A40",...},
    {"device_type":"npu","vendor":"furiosa","model":"RNGD","node":"node4",...},
    {"device_type":"npu","vendor":"rebellions","model":"Atom+","node":"node5",...},
    ... (7 slots total)
  ]
}}
```

7-slot snapshot with `device_type` covering both gpu and npu, vendor covering nvidia/furiosa/rebellions. Schema covers Lane D's required fields (`status`, `current_exam`, `last_known_metric`, `metrics_status`, `last_metric_timestamp`).

## Frontend safety (already in place)

`useRealtimeExams.ts` retains the shape guard introduced in `3cb204a`:

```ts
if (!candidate || typeof candidate !== 'object' ||
    !Array.isArray(candidate.slots) || !candidate.sweep_progress) {
  return; // silently ignore non-snapshot frames (ping keepalive)
}
```

Combined with the unwrap, the frontend cannot produce "Malformed realtime frame" on valid snapshot/ping/keepalive traffic. Browser audit confirms: 0 occurrences of that text on either dashboard.

## Acceptance

- ✅ /dashboard/gpu-realtime no Malformed realtime frame (G9)
- ✅ /dashboard/npu-realtime no Malformed realtime frame (G10)
- ✅ Frame contract supports gpu, RNGD npu, Atom+ npu (snapshot has all 3 device_type×vendor combinations)
- ✅ Browser console zero unhandled errors (G23)
- ✅ Backend logs zero unexplained 5xx during walkthrough (G24)
