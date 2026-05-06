#!/usr/bin/env python3
"""Live web dashboard for the L40 GPU on node2.

Single-file, stdlib-only. Serves an HTML page on :30891 that auto-refreshes
every 5s. Visual layout mirrors /home/kcloud/bench_dashboard.py on node4
(RNGD) so the iframe embed inside web/src/pages/mlperf/main/MLPerfPage.tsx
("Live GPU Dashboard (MLPerf — L40)") looks structurally identical to
"Live Bench Dashboard (node4 — RNGD)".

Run:
    python3 /home/kcloud/gpu_bench_dashboard_l40.py
or
    sudo systemd-run --unit=gpu-bench-dashboard-l40 --collect \
        --property=WorkingDirectory=/home/kcloud \
        /usr/bin/python3 /home/kcloud/gpu_bench_dashboard_l40.py
"""
from __future__ import annotations

import datetime as dt
import html
import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("GPU_BENCH_DASHBOARD_PORT", "30891"))
NODE_NAME = os.environ.get("GPU_BENCH_DASHBOARD_NODE", "node2")
GPU_LABEL = os.environ.get("GPU_BENCH_DASHBOARD_LABEL", "NVIDIA L40")
GPU_FILTER = os.environ.get("GPU_BENCH_DASHBOARD_FILTER", "L40").upper()
BACKEND_URL = os.environ.get("GPU_BENCH_BACKEND_URL", "http://10.254.177.41:30001")

TELEMETRY_INTERVAL_SEC = 5
TELEMETRY_HISTORY_LEN = 720  # 60 min @ 5 s

_telemetry_lock = threading.Lock()
_telemetry_history: list[deque] = []  # one deque per GPU
_smi_snapshot_text = ""

NVIDIA_SMI_QUERY = (
    "index,name,temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total"
)


def _run_nvidia_smi() -> list[dict]:
    """Return list of per-GPU dicts. Empty list on failure."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=" + NVIDIA_SMI_QUERY,
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=4, check=True,
        ).stdout.strip()
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return []
    rows = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 7:
            continue
        try:
            rows.append({
                "index": int(parts[0]),
                "name": parts[1],
                "temp_c": float(parts[2]) if parts[2] not in ("N/A", "[N/A]") else None,
                "power_w": float(parts[3]) if parts[3] not in ("N/A", "[N/A]") else None,
                "util_pct": float(parts[4]) if parts[4] not in ("N/A", "[N/A]") else None,
                "mem_used_mib": int(float(parts[5])) if parts[5] not in ("N/A", "[N/A]") else None,
                "mem_total_mib": int(float(parts[6])) if parts[6] not in ("N/A", "[N/A]") else None,
            })
        except ValueError:
            continue
    return rows


def _smi_table_text(rows: list[dict]) -> str:
    if not rows:
        return "(nvidia-smi unavailable)"
    header = "+-------+--------------+--------+----------+---------+--------------+"
    lines = [header,
             "| Index | Name         | Temp   | Power    | Util    | Memory       |",
             header]
    for r in rows:
        lines.append(
            "| {idx:^5} | {name:<12} | {temp:>5} | {pw:>7}  | {ut:>5}  | {mem:<12} |".format(
                idx=r["index"],
                name=r["name"][:12],
                temp=f"{r['temp_c']:.0f}°C" if r["temp_c"] is not None else "—",
                pw=f"{r['power_w']:.1f} W" if r["power_w"] is not None else "—",
                ut=f"{r['util_pct']:.0f} %" if r["util_pct"] is not None else "—",
                mem=(f"{r['mem_used_mib']}/{r['mem_total_mib']} MiB"
                     if r['mem_used_mib'] is not None and r['mem_total_mib'] is not None
                     else "—"),
            )
        )
    lines.append(header)
    return "\n".join(lines)


def _telemetry_poller():
    global _smi_snapshot_text
    while True:
        rows = _run_nvidia_smi()
        with _telemetry_lock:
            while len(_telemetry_history) < len(rows):
                _telemetry_history.append(deque(maxlen=TELEMETRY_HISTORY_LEN))
            for i, r in enumerate(rows):
                _telemetry_history[i].append({
                    "ts": time.time(),
                    "temp_c": r["temp_c"],
                    "power_w": r["power_w"],
                    "util_pct": r["util_pct"],
                })
            _smi_snapshot_text = _smi_table_text(rows)
        time.sleep(TELEMETRY_INTERVAL_SEC)


def _get_telemetry_snapshot() -> tuple[list[dict], list[deque], str]:
    with _telemetry_lock:
        rows = []
        for i, hist in enumerate(_telemetry_history):
            if hist:
                rows.append({"index": i, **hist[-1]})
        return rows, [deque(d) for d in _telemetry_history], _smi_snapshot_text


def fetch_active_l40_exams() -> list[dict]:
    """Return Running L40 mp-exam (MLPerf) rows from cluster API. Best-effort."""
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/mp-exam/list",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=3) as r:
            payload = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, OSError):
        return []
    rows = (payload or {}).get("data", {}).get("list", []) if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return []
    return [
        r for r in rows
        if isinstance(r, dict)
        and str(r.get("status", "")) == "Running"
        and GPU_FILTER in str(r.get("gpu_type", "")).upper()
    ]


def fetch_comparison_runs() -> list[dict]:
    """Return cross-HW comparison rows (canonical / TT100T table). Best-effort."""
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/comparison/list",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=3) as r:
            payload = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, OSError):
        return []
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, dict):
        runs = data.get("runs") or data.get("list") or []
    elif isinstance(data, list):
        runs = data
    else:
        runs = []
    return [r for r in runs if isinstance(r, dict)]


def render_sparkline(values: list[float | None], stroke: str) -> str:
    """SVG polyline sparkline, same shape as node4's render_sparkline."""
    samples = [v for v in values if v is not None]
    if not samples:
        return ("<svg viewBox='0 0 200 40' style='width:100%;max-width:200px;"
                "height:auto;display:block;'></svg>")
    width = 200.0
    height = 40.0
    n = len(samples)
    vmin = min(samples)
    vmax = max(samples)
    span = (vmax - vmin) or 1.0
    pts = []
    for i, v in enumerate(samples):
        x = (i / max(1, n - 1)) * width if n > 1 else 0.0
        y = height - ((v - vmin) / span) * (height - 4) - 2
        pts.append(f"{x:.1f},{y:.1f}")
    return (
        f"<svg viewBox='0 0 200 40' preserveAspectRatio='xMidYMid meet' "
        f"style='width:100%;max-width:200px;height:auto;display:block;'>"
        f"<polyline fill='none' stroke='{stroke}' stroke-width='1.5' "
        f"points='{' '.join(pts)}'/></svg>"
    )


def render_active_exam_card(exam: dict) -> str:
    name = html.escape(str(exam.get("name", "(unnamed)")))
    eid = html.escape(str(exam.get("id", "?")))
    model = html.escape(str(exam.get("model", "?")))
    precision = html.escape(str(exam.get("precision", "?")))
    dataset = html.escape(str(exam.get("dataset", "?")))
    n = exam.get("data_number", "?")
    max_tok = exam.get("max_output_tokens", "?")
    started = html.escape(str(exam.get("started_at", "?")))
    gpu_type = html.escape(str(exam.get("gpu_type", "?")))
    return (
        "<section class='card' style='border-color: #3fb950;'>"
        f"<h3 style='color: #3fb950;'>k8s {GPU_FILTER} MLPerf exam #{eid} — {name} (Running)</h3>"
        "<div class='kv'><span>State</span><b style='color: #3fb950;'>Running on cluster</b></div>"
        f"<div class='kv'><span>GPU type</span><b>{gpu_type}</b></div>"
        f"<div class='kv'><span>Model</span><b>{model}</b></div>"
        f"<div class='kv'><span>Precision</span><b>{precision}</b></div>"
        f"<div class='kv'><span>Dataset</span><b>{dataset} ({n} samples)</b></div>"
        f"<div class='kv'><span>Max output tokens</span><b>{max_tok}</b></div>"
        f"<div class='kv'><span>Started</span><b>{started}</b></div>"
        "<div class='meta'>Live state from <code>/api/mp-exam/list</code> on cluster control plane. "
        "Per-sample progress not exposed via this surface — see the exam pod logs (<code>kubectl logs job/mlperf-"
        f"{eid}-1-1 -n llm-evaluation</code>) for token throughput.</div>"
        "</section>"
    )


def render_comparison_panel(runs: list[dict]) -> str:
    if not runs:
        return ("<section class='card' style='border-color: #58a6ff;'>"
                "<h3 style='color: #58a6ff;'>Cross-HW MLPerf TT100T comparison</h3>"
                "<div class='meta'>No comparison runs available from "
                "<code>/api/comparison/list</code>.</div></section>")
    header = (
        "<thead><tr style='border-bottom: 1px solid var(--border); color: var(--muted);'>"
        "<th align='left'>Device</th><th align='left'>Run</th>"
        "<th>Exam</th><th>Samples</th><th>TT100T (ms)</th><th>TPS</th>"
        "</tr></thead>"
    )
    body_rows = []
    for r in runs[:8]:
        hw = r.get("hardware") if isinstance(r.get("hardware"), dict) else {}
        device = html.escape(str(hw.get("model") or r.get("gpu_type") or r.get("npu_type") or "?"))
        run_name = html.escape(str(r.get("name") or r.get("exam_name") or "?"))
        exam_id = html.escape(str(r.get("id") or r.get("exam_id") or "?"))
        n_samples = html.escape(str(r.get("data_number") or r.get("samples") or "?"))
        metrics = r.get("metrics") if isinstance(r.get("metrics"), dict) else {}
        tt100t = metrics.get("tt100t_seconds") or r.get("tt100t_seconds") or r.get("tt100t")
        tps = metrics.get("tps") or r.get("tps")
        tt100t_str = (f"{float(tt100t) * 1000:.0f} ms"
                      if isinstance(tt100t, (int, float)) and tt100t < 100
                      else f"{tt100t:.0f} ms" if isinstance(tt100t, (int, float))
                      else "—")
        tps_str = f"{float(tps):.2f}" if isinstance(tps, (int, float)) else "—"
        body_rows.append(
            f"<tr><td>{device}</td><td>{run_name}</td><td>#{exam_id}</td>"
            f"<td>{n_samples}</td><td><b>{tt100t_str}</b></td><td>{tps_str}</td></tr>"
        )
    return (
        "<section class='card' style='border-color: #58a6ff;'>"
        "<h3 style='color: #58a6ff;'>Cross-HW MLPerf TT100T comparison</h3>"
        "<table style='width:100%; border-collapse: collapse; font-size: 12px;'>"
        f"{header}<tbody>{''.join(body_rows)}</tbody></table>"
        "<div class='meta'>Live from <code>/api/comparison/list</code>; first 8 rows shown.</div>"
        "</section>"
    )


def render_gpu_card(rows: list[dict], hist: list[deque], smi_text: str) -> str:
    sub_rows = []
    for r in rows:
        sub_rows.append(
            f"<div class='kv'><span>L40 #{r.get('index')} Temp</span>"
            f"<b>{r.get('temp_c'):.2f} °C</b></div>"
            if r.get('temp_c') is not None else
            f"<div class='kv'><span>L40 #{r.get('index')} Temp</span><b>—</b></div>"
        )
        sub_rows.append(
            f"<div class='kv'><span>L40 #{r.get('index')} Power</span>"
            f"<b>{r.get('power_w'):.1f} W</b></div>"
            if r.get('power_w') is not None else
            f"<div class='kv'><span>L40 #{r.get('index')} Power</span><b>—</b></div>"
        )
        sub_rows.append(
            f"<div class='kv'><span>L40 #{r.get('index')} Util</span>"
            f"<b>{r.get('util_pct'):.0f} %</b></div>"
            if r.get('util_pct') is not None else
            f"<div class='kv'><span>L40 #{r.get('index')} Util</span><b>—</b></div>"
        )
    kv_block = "".join(sub_rows) or "<div class='kv'><span>State</span><b>nvidia-smi unavailable</b></div>"

    sparks = []
    for i, hbuf in enumerate(hist[:2]):
        temps = [s.get("temp_c") for s in hbuf]
        powers = [s.get("power_w") for s in hbuf]
        sparks.append(
            f"<figure>{render_sparkline(temps, stroke='#f78166')}"
            f"<figcaption>L40 #{i} Temp · 60min</figcaption></figure>"
        )
        sparks.append(
            f"<figure>{render_sparkline(powers, stroke='#58a6ff')}"
            f"<figcaption>L40 #{i} Power · 60min</figcaption></figure>"
        )
    spark_block = "<div class='spark'>" + "".join(sparks) + "</div>" if sparks else ""

    return (
        "<section class='card'>"
        f"<h3>GPU ({GPU_LABEL} ×{len(rows) if rows else '?'})</h3>"
        f"{kv_block}"
        f"{spark_block}"
        f"<pre style='margin-top:8px;'>{html.escape(smi_text)}</pre>"
        "</section>"
    )


def _badge(label: str, ok: bool, suffix: str = "") -> str:
    cls = "ok" if ok else "bad"
    sym = "active" if ok else "down"
    return (f"<span class='badge {cls}'>{html.escape(label)} · {sym}"
            f"{(' · ' + html.escape(suffix)) if suffix else ''}</span>")


def render_html() -> str:
    rows, hist, smi_text = _get_telemetry_snapshot()
    nvidia_ok = bool(rows)
    backend_ok = True
    active_exams: list[dict] = []
    try:
        active_exams = fetch_active_l40_exams()
    except Exception:
        backend_ok = False
    try:
        comparison_runs = fetch_comparison_runs()
    except Exception:
        comparison_runs = []
        backend_ok = False

    badges = [
        _badge("nvidia-smi", nvidia_ok),
        _badge("backend api", backend_ok, BACKEND_URL.replace("http://", "")),
        _badge("exam discovery", True, f"{len(active_exams)} active"),
    ]

    active_cards = "\n".join(render_active_exam_card(e) for e in active_exams)
    if not active_cards:
        active_cards = (
            "<section class='card' style='opacity:0.65;'>"
            f"<h3>No {GPU_FILTER} MLPerf benchmarks active</h3>"
            "<div class='kv'><span>State</span><b>idle</b></div>"
            "<div class='meta'>Live state from <code>/api/mp-exam/list</code>; this card lights up "
            f"green when any MLPerf exam with <code>gpu_type</code> containing <code>{GPU_FILTER}</code> "
            "and <code>status=Running</code> is detected.</div>"
            "</section>"
        )

    comparison_panel = render_comparison_panel(comparison_runs)
    gpu_card = render_gpu_card(rows, hist, smi_text)

    return f"""<!doctype html>
<html lang='en'>
<head>
<meta charset='utf-8'>
<title>{NODE_NAME} L40 GPU bench dashboard</title>
<meta http-equiv='refresh' content='5'>
<style>
  :root {{
    color-scheme: dark;
    --bg: #0e1117; --panel: #161b22; --border: #2a313a;
    --text: #c9d1d9; --muted: #8b949e; --ok: #3fb950;
    --bad: #f85149; --warn: #d29922; --accent: #58a6ff;
  }}
  body {{ background: var(--bg); color: var(--text); font: 13px/1.45 -apple-system,Menlo,monospace; margin: 0; padding: 16px; }}
  h1 {{ font-size: 16px; margin: 0 0 8px; }}
  h3 {{ font-size: 12px; margin: 0; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }}
  section.card, section.log {{ background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin: 8px 0; }}
  section.log header {{ display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }}
  .meta {{ color: var(--muted); font-size: 11px; }}
  pre {{ background: #0a0d12; padding: 8px; border-radius: 4px; max-height: 280px; overflow: auto; margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-all; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 8px; }}
  .kv {{ display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed var(--border); }}
  .kv:last-child {{ border-bottom: none; }}
  .kv span {{ color: var(--muted); }}
  .kv b {{ color: var(--text); font-weight: 600; }}
  .progress {{ background: #0a0d12; height: 14px; border-radius: 4px; overflow: hidden; margin: 6px 0 10px; }}
  .progress > div {{ height: 100%; background: linear-gradient(90deg, var(--accent), var(--ok)); transition: width 0.3s; }}
  .badge {{ display: inline-block; padding: 3px 8px; border-radius: 3px; font-size: 11px; margin: 2px 4px 2px 0; border: 1px solid var(--border); }}
  .badge.ok {{ color: var(--ok); border-color: rgba(63,185,80,0.4); }}
  .badge.bad {{ color: var(--bad); border-color: rgba(248,81,73,0.4); }}
  .badge.warn {{ color: var(--warn); border-color: rgba(210,153,34,0.4); }}
  .badge.muted {{ color: var(--muted); }}
  .row {{ display: grid; grid-template-columns: 2fr 1fr; gap: 8px; }}
  @media (max-width: 800px) {{ .row {{ grid-template-columns: 1fr; }} }}
  .spark {{ display: flex; align-items: center; gap: 12px; flex-wrap: wrap; max-width: 100%; overflow: hidden; }}
  .spark figure {{ margin: 0; min-width: 0; }}
  .spark figure svg {{ max-width: 100%; height: auto; display: block; }}
  .spark figcaption {{ color: var(--muted); font-size: 11px; }}
  .footer {{ color: var(--muted); font-size: 11px; margin-top: 12px; }}
</style>
</head>
<body>
  <h1>{NODE_NAME} L40 GPU bench dashboard <span class='meta'>· auto-refresh 5s · {dt.datetime.now():%H:%M:%S}</span></h1>
  <div>{''.join(badges)}</div>

  {comparison_panel}

  <div class='grid'>
    {active_cards}
    {gpu_card}
  </div>

  <div class='footer'>
    Served by <code>gpu_bench_dashboard_l40.py</code> on port {PORT}. Stop with <code>sudo systemctl stop gpu-bench-dashboard-l40.service</code> or kill the python process. Page refreshes every 5s. No state is written to disk; telemetry is in-memory ring buffer (60 min @ 5 s).
  </div>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path in ("/", "/index.html"):
            body = render_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        self.send_error(404)

    def log_message(self, fmt, *args):  # silence noisy default access log
        return


def main() -> None:
    poller = threading.Thread(target=_telemetry_poller, daemon=True)
    poller.start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"gpu_bench_dashboard_l40 listening on :{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
