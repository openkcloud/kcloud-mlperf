# L40 Live Bench Dashboard — Design Note

## Goal
The "Live GPU Dashboard (MLPerf — L40)" iframe panel on `/mlperf` must look **structurally identical** to "Live Bench Dashboard (node4 — RNGD)" served by `/home/kcloud/bench_dashboard.py` on node4 at `http://10.254.202.114:30890/`.

## Topology

| Item | Value |
|---|---|
| Host node | `node2` (10.254.184.195) |
| SSH | port 122, user `kcloud` |
| GPUs | 2 × NVIDIA L40 (indices 0 + 1) |
| nvidia-smi | present, returns full per-GPU telemetry |
| Listen port | `30891` (free; chosen to be a +1 from node4's `30890`) |
| Backend API reachable from node2 | yes — `curl http://10.254.177.41:30001/api/devices` returns 200 |
| Sudo | requires password (same `<SUDO_PASS>`) |

## Telemetry source

Poll `nvidia-smi --query-gpu=index,name,temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits` every 5 s into an in-memory ring buffer (max 720 samples = 60 min @ 5 s). Same buffer pattern as node4's `npu-telemetry.log` rolling window, but backed by Python list rather than disk file (lower disk pressure on node2).

## Active-exam discovery

`urllib.request.urlopen("http://10.254.177.41:30001/api/mp-exam/list", timeout=3)` and filter:

```python
[r for r in payload["data"]["list"]
 if str(r.get("status")) == "Running"
 and "L40" in str(r.get("gpu_type", "")).upper()]
```

Same pattern used by the node4 patch added earlier today (k8s-exam-discovery for RNGD via `/api/npu-eval/list`). Render each as a green-bordered active card identical in structure to `render_k8s_active_card()` from the node4 patch.

## Comparison panel

Reuse the SAME `/api/comparison/list` source as node4 — it already returns all 4 HW vendors. Render the same TT100T comparison table.

## Visual parity contract

The script MUST emit:

- `<title>node2 L40 GPU bench dashboard</title>`
- `<meta http-equiv='refresh' content='5'>`
- Identical CSS `:root` variable block:
  ```
  --bg #0e1117; --panel #161b22; --border #2a313a; --text #c9d1d9;
  --muted #8b949e; --ok #3fb950; --bad #f85149; --warn #d29922; --accent #58a6ff;
  ```
- Identical `body { background: var(--bg); color: var(--text); font: 13px/1.45 -apple-system,Menlo,monospace; }`
- Identical `section.card`, `section.log`, `.kv`, `.progress`, `.badge`, `.spark` rules
- Identical h1 header text shape: `<h1>node2 L40 GPU bench dashboard <span class='meta'>· auto-refresh 5s · HH:MM:SS</span></h1>`
- Identical status-badge row pattern (replace systemd-unit badges with: `nvidia-smi`, `backend api`, `exam discovery`)
- Comparison panel block first
- `<div class='grid'>` containing active-bench cards + L40 hardware card
- L40 hardware card has KV rows for Temp, Power, Util (matches RNGD card's KV rows for Temp/Power)
- Sparkline SVGs use the same `<polyline>` style + `figcaption` pattern, same colors `#f78166` (temp) and `#58a6ff` (power)
- A footer block matching node4's

## Differences (intentional, narrated in card titles only)

| Element | RNGD (node4) | L40 (node2) |
|---|---|---|
| Hardware card title | `NPU (RNGD)` | `GPU (NVIDIA L40 ×2)` |
| Telemetry source | `furiosactl info` snapshot table | `nvidia-smi` snapshot table |
| Active-exam discovery | `/api/npu-eval/list` filtered to RNGD | `/api/mp-exam/list` filtered to L40 |
| Per-device count | 1 NPU | 2 GPUs (rendered as 2 sub-rows) |
| Vendor color (badges) | `#F97316` (orange) | `#4F46E5` (NVIDIA indigo) |
| Status badges | `bench-dashboard.service`, `bench-universal-poster.service` | `nvidia-smi`, `backend api`, `exam discovery` |

## Deployment plan (US-003)

```
sudo systemd-run \
  --unit=gpu-bench-dashboard-l40 \
  --collect \
  --property=WorkingDirectory=/home/kcloud \
  --property=StandardOutput=journal \
  /usr/bin/python3 /home/kcloud/gpu_bench_dashboard_l40.py
```

The script binds `0.0.0.0:30891`. Cluster-wide accessibility verified by `curl http://10.254.184.195:30891/` from the orchestrator (this host).

## Frontend wiring (US-004)

Edit `web/src/pages/mlperf/main/MLPerfPage.tsx`:

```tsx
// before
<LiveBenchDashboard
  title="Live GPU Dashboard (MLPerf — L40)"
  src={getGpuPrometheusUrl()}
  height={900}
/>

// after
<LiveBenchDashboard
  title="Live GPU Dashboard (MLPerf — L40)"
  src={getL40LiveBenchUrl()}
  height={900}
/>
```

Add `getL40LiveBenchUrl()` to `web/src/constants/runtime-env.constants.ts` (or wherever `getGpuPrometheusUrl()` lives); env-var default `VITE__APP_L40_LIVE_BENCH_URL`, hardcoded fallback `http://10.254.184.195:30891/`.

## Verification (US-006)

Side-by-side HTML structural diff between node4:30890 and node2:30891 — both must:
1. Return HTTP 200
2. Have `<meta http-equiv='refresh' content='5'>`
3. Define identical CSS variables (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--ok`, `--bad`, `--warn`, `--accent`)
4. Have an h1 containing `auto-refresh 5s`
5. Render the SAME `<section class='card' style='border-color: #58a6ff;'>` comparison block (pulled from same backend API)
6. Render the SAME `.kv` row structure inside their hardware-identity cards

A green-bordered active-exam card SHOULD appear on the L40 dashboard whenever an L40 MLPerf exam is `status=Running` (mirrors node4's behavior for RNGD exam #78).
