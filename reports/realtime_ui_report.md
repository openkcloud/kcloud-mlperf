# Real-Time UI Features Design Report

## Current State

### Existing Result Pages
The application provides six benchmark result pages that currently display static result data:
- `/mlperf/test-result` — MLPerf accuracy/performance graphs
- `/mmlu/test-result` — MMLU-Pro subject accuracy bar graphs
- `/npu/test-result` — NPU time-to-100-tokens (TT100T) and latency charts
- `/mlperf/device-comparison` — MLPerf cross-device comparison
- `/mmlu/device-comparison` — MMLU-Pro cross-device comparison
- `/npu/device-comparison` — NPU cross-device comparison

Each page displays pre-computed results after a benchmark completes, with download buttons for raw artifacts.

### Existing Real-Time Mechanisms
The backend has foundational real-time infrastructure:
- **SSE endpoint** `/api/realtime/exams` — Server-Sent Events stream that emits exam snapshot every 2 seconds (max 20 concurrent subscribers)
- **Snapshot API** `/api/realtime/exams/snapshot` — Point-in-time view of all active exams with status, progress, and metrics
- **Health endpoint** `/api/realtime/exams/health` — Subscriber count and timestamp
- **Loki API** `/api/loki/instant/:benchmark/:id` — Instant Loki query for pod logs (returns latest entry, not a range)

### Frontend Real-Time Hooks
- `useRealtimeExams()` — React hook that consumes the SSE stream and decodes snapshots (exists in the codebase)
- `DeviceRealtimeDashboard` component — Used on `/dashboard/gpu-realtime` to display live GPU utilization and exam status

## Gap Analysis

### What's Missing
1. **No footer panel on result pages** — The six result pages (mlperf/test-result, mmlu/test-result, npu/test-result, device-comparison variants) have no live log or status footer.
2. **No log range query** — Loki API only supports instant queries (single latest entry). A range query is needed to show the last 200 lines of logs during an exam.
3. **No artifacts manifest** — No backend endpoint to list results artifacts per run (results/RUN_ID/manifest.sha256 files are stored on NFS but not exposed via API).
4. **No iframe target** — No Grafana dashboard URL pinning guidance, and no static HTML report bundle generation.

### JobStatusFooter Component Requirements
The footer must display:
- **Status chip + phase** — Current job state (Pending|Running|Failed|Completed), current pipeline phase (e.g., "model-load", "inference", "cleanup")
- **Live log stream** — Last 200 lines via Loki range query OR pod tail via kubectl proxy, updated every 2–5 seconds
- **Artifacts section** — Links to results/RUN_ID/ directory contents (model weights, benchmark reports, profiling traces)
- **Errors/warnings** — Highlighted if failure detected in logs
- **Final metrics** — If run is complete, display accuracy/latency summary (partial metrics if in-progress)

### Current vs. Future State

| Feature | Status | Implementation |
|---------|--------|-----------------|
| SSE stream | Exists | `/api/realtime/exams` polls all exams every 2s |
| Snapshot API | Exists | `/api/realtime/exams/snapshot` → job state, progress |
| Instant Loki query | Exists | `/api/loki/instant/:benchmark/:id` |
| Range Loki query | **Missing** | Need `/api/loki/range/:benchmark/:id?lines=200` |
| Pod tail fallback | **Missing** | Backend proxy to `kubectl logs -f <pod>` (if SSE saturated) |
| Artifacts API | **Missing** | GET `/api/results/{run_id}/artifacts` → manifest list |
| JobStatusFooter component | **Missing** | React component, generic across benchmarks |
| Grafana panel embedding | **Unknown** | Depends on Grafana dashboard existence |
| Report bundle generation | **Missing** | scripts/16_generate_reports.sh should emit HTML package |

## Recommended Design

### Architecture: Shared JobStatusFooter Component

Create a single reusable `<JobStatusFooter>` component (450 lines max) with three sections:

**Section 1: Status Bar**
- Chip showing state (Pending→blue, Running→orange, Completed→green, Failed→red)
- Current phase tag (if available from snapshot)
- Duration (elapsed time from start_time to now or end_at)
- Estimated completion (if in-progress)

**Section 2: Live Log Stream**
- Dark-background terminal-style container, monospace font, max-height 400px with vertical scroll
- Default: Loki range query for last 200 lines, refreshed every 3 seconds
- Fallback: If Loki unavailable or pod logs needed, switch to kubectl tail (via `/api/logs/pod-tail/:namespace/:pod-name`)
- Sticky-scroll to bottom on new logs
- Search/filter box for "error", "warning", "accuracy", etc.
- Copy-to-clipboard button for full log text

**Section 3: Artifacts & Metrics**
- Left column: Artifact links (model weights, benchmark results CSV, profiling traces) from `/api/results/{run_id}/artifacts`
- Right column: Summary metrics (if complete: final accuracy, latency; if in-progress: partial values with "±" estimate)
- Download button for entire results/ directory as .tar.gz

### Backend API Additions

**1. Loki Range Query**
```
GET /api/loki/range/:benchmark/:id?lines=200&start_time_iso=2026-04-28T10:00:00Z&end_time_iso=2026-04-28T10:05:00Z
```
Returns last N lines of logs within time window.

**2. Results Artifacts Endpoint**
```
GET /api/results/:run_id/artifacts
Response:
{
  "run_id": "20260428-072038-a612a54",
  "artifacts": [
    { "path": "results/mlperf/results.json", "size_bytes": 15360, "type": "json" },
    { "path": "results/mlperf/model.safetensors", "size_bytes": 5242880, "type": "model" },
    ...
  ],
  "manifest_sha256": "abc123...",
  "total_size_bytes": 5258240,
  "download_url": "/api/results/:run_id/download?format=tar.gz"
}
```

**3. Pod Tail Fallback**
```
GET /api/logs/pod-tail/:namespace/:pod-name?lines=100
```
Proxy to `kubectl logs -n {namespace} {pod-name} --tail=100`. Returns plain text.

### Iframe Option: Grafana Panel Embedding

If a Grafana dashboard exists for the cluster (IP, dashboard slug known):
- Compute time range: `start_time_ms = exam.started_at`, `end_time_ms = exam.end_at || now()`
- Construct Grafana panel URL:
  ```
  https://<grafana-host>/d/<dashboard-slug>?orgId=1&panelId=<id>&kiosk&from=<start_ms>&to=<end_ms>
  ```
- Embed as `<iframe src="..." style={{ width: '100%', height: '600px', border: 'none' }} />`

If no Grafana dashboard: fallback to static HTML report bundle (see below).

### Report Bundle Generation

Modify `scripts/16_generate_reports.sh`:
- After all benchmarks complete, generate a self-contained HTML report per run:
  - Index page listing all exams with links to individual reports
  - Per-exam report: embed graphs (as PNG/SVG), summary table, log excerpt
  - Store at `results/{RUN_ID}/report-bundle/index.html`
- In result pages, iframe points to this bundle:
  ```html
  <iframe src={`/api/results/${run_id}/report-bundle/index.html`} />
  ```

## Acceptance Criteria

- [ ] `<JobStatusFooter>` component renders on all six result pages below the main table
- [ ] Loki range query API (`/api/loki/range/:benchmark/:id`) returns last 200 log lines
- [ ] Artifacts API (`/api/results/:run_id/artifacts`) lists all files in results/ directory with sizes
- [ ] Log stream auto-refreshes every 3 seconds while exam is running
- [ ] Fallback to pod-tail if Loki endpoint is slow/unavailable
- [ ] Status chip reflects actual exam state from snapshot (Pending|Running|Completed|Failed)
- [ ] Live log stream scrolls to bottom automatically on new lines
- [ ] Artifacts section shows download links and total size
- [ ] Component handles missing data gracefully (e.g., no logs available → "No logs yet")
- [ ] Iframe (Grafana or static bundle) displays correctly in test across all pages
- [ ] Component is responsive on mobile (sidebar layout collapses to stacked on <768px)
