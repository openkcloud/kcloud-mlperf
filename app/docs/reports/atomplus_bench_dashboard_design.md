# Atom+ Live Bench Dashboard — Design Note

## Goal
The "Live Bench Dashboard (node5 - Atom+)" iframe panel on `/npu-eval/atomplus` must look **structurally identical** to "Live Bench Dashboard (node4 — RNGD)" served by `/home/kcloud/bench_dashboard.py` on node4 at `http://10.254.202.114:30890/`.

Sister-spec to `gpu_bench_dashboard_l40_design.md` (node2 / NVIDIA L40); this doc covers node5 / Rebellions Atom+.

## Topology

| Item | Value |
|---|---|
| Host node | `node5` / `rebellion-atom-1` (10.254.202.111) |
| SSH | port **22** (NOT 122 like nodes 1–3) |
| User / pass | kcloud / <SUDO_PASS> |
| NPUs | 2 × RBLN-CA22 (rbln0, rbln1) |
| Telemetry tool | `rbln-stat` (rich Device Information table: NPU, Name, Device, PCI BUS ID, Temp, Power, Perf, Memory, Util) |
| Listen port | `30892` (free; +1 from L40's `30891`, +2 from RNGD's `30890`) |
| Backend API reachable from node5 | yes — node5 has cluster-IP routing to `http://10.254.177.41:30001` |
| Sudo | requires password (<SUDO_PASS>) |

## rbln-stat sample output (verified live 2026-05-06T09:18Z)

```
+-----+-----------+---------+---------------+------+---------+------+---------------------+-------+
| NPU |    Name   | Device  |   PCI BUS ID  | Temp |  Power  | Perf |  Memory(used/total) |  Util |
+=====+===========+=========+===============+======+=========+======+=====================+=======+
| 0   | RBLN-CA22 | rbln0   |  0000:c3:00.0 |  33C |  18.1W  | P14  |    0.0B / 15.7GiB   |   0.0 |
| 1   | RBLN-CA22 | rbln1   |  0000:c4:00.0 |  36C |  19.3W  | P14  |    0.0B / 15.7GiB   |   0.0 |
+-----+-----------+---------+---------------+------+---------+------+---------------------+-------+
```

Parser strategy: split on `|`, ignore separator lines (those starting with `+`), extract NPU index + Temp (strip `C`) + Power (strip `W`) + Util (strip `%` and decimal). Same in-memory ring buffer pattern as L40 dashboard (720 samples = 60 min @ 5 s).

## Active-exam discovery

`/api/atomplus-bench/list` does NOT exist (verified 404). `/api/comparison/list` returns 200 with all benchmark runs across vendors; filter client-side:

```python
[r for r in payload["data"]["runs"]
 if isinstance(r.get("hardware"), dict)
 and r["hardware"].get("vendor") == "rebellions"
 and str(r.get("status")) == "Running"]
```

Same pattern the frontend Atom+ page already uses (`ComparisonApi.list({vendor:'rebellions'})` per the prior `rngd_dashboard_contract.md`).

## Comparison panel

Reuse the same `/api/comparison/list` source as RNGD + L40 dashboards. Pull canonical TT100T rows + display in the standard accent-color (#58a6ff) bordered card.

## Visual parity contract

Same as L40 design (see `gpu_bench_dashboard_l40_design.md` §"Visual parity contract"). Specifically:

- `<title>node5 Atom+ NPU bench dashboard</title>`
- `<meta http-equiv='refresh' content='5'>`
- Identical `:root { --bg #0e1117; --panel #161b22; --border #2a313a; --text #c9d1d9; --muted #8b949e; --ok #3fb950; --bad #f85149; --warn #d29922; --accent #58a6ff; }`
- h1: `<h1>node5 Atom+ NPU bench dashboard <span class='meta'>· auto-refresh 5s · HH:MM:SS</span></h1>`
- Status badges row (rbln-stat available, backend api, exam discovery)
- Comparison panel
- `<div class='grid'>` with active-bench cards + Atom+ hardware-identity card

## Differences (intentional)

| Element | L40 (node2) | Atom+ (node5) |
|---|---|---|
| Hardware card title | `GPU (NVIDIA L40 ×2)` | `NPU (Rebellions Atom+ ×2)` |
| Telemetry tool | `nvidia-smi` | `rbln-stat` |
| Vendor color | `#4F46E5` (NVIDIA indigo) | `#A855F7` (Rebellions purple) |
| Active-exam API | `/api/mp-exam/list` filtered to gpu_type contains L40 | `/api/comparison/list` filtered to vendor=='rebellions' |
| KV row labels | "L40 #N Temp/Power/Util" | "RBLN #N Temp/Power/Util" |

## Deployment plan (US-005)

```
sudo systemd-run \
  --unit=atomplus-bench-dashboard \
  --collect \
  --property=WorkingDirectory=/home/kcloud \
  --property=StandardOutput=journal \
  /usr/bin/python3 /home/kcloud/atomplus_bench_dashboard.py
```

Script binds `0.0.0.0:30892`. Cluster-wide accessibility verified by `curl http://10.254.202.111:30892/` from the orchestrator host.

## Frontend wiring (US-006)

Add `getAtomPlusLiveBenchUrl()` to `web/src/components/benchmark-page/PrometheusIframeDashboard.tsx`:

```ts
export function getAtomPlusLiveBenchUrl(): string {
  return (
    (import.meta.env.VITE__APP_ATOMPLUS_LIVE_BENCH_URL as string | undefined) ??
    'http://10.254.202.111:30892/'
  );
}
```

Re-export from `web/src/components/benchmark-page/index.ts`.

Edit `web/src/pages/npu-eval/atomplus/index.tsx`:

```tsx
// before
import { ... LiveBenchDashboard } from '@/components/benchmark-page';
const NPU_REALTIME_URL = (import.meta.env.VITE__APP_NPU_REALTIME_URL as string | undefined) || ...;
<LiveBenchDashboard title="Live Bench Dashboard (node5 - Atom+)" src={NPU_REALTIME_URL} ... />

// after
import { ... LiveBenchDashboard, getAtomPlusLiveBenchUrl } from '@/components/benchmark-page';
<LiveBenchDashboard title="Live Bench Dashboard (node5 - Atom+)" src={getAtomPlusLiveBenchUrl()} ... />
```

## Verification (US-008)

Side-by-side HTML diff between node5:30892 + node2:30891 + node4:30890. All three must:
1. Return HTTP 200
2. Have `<meta http-equiv='refresh' content='5'>`
3. Define identical CSS variables
4. Have h1 containing `auto-refresh 5s`
5. Render comparison panel from same `/api/comparison/list` source

Atom+ dashboard additionally must contain `#A855F7` literal somewhere (vendor color).
