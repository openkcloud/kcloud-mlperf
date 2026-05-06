#!/usr/bin/env python3
"""Live web dashboard for the Rebellions Atom+ NPU on node5.

Single-file, stdlib-only. Serves an HTML page on :30892 that auto-refreshes
every 5s. Visual layout mirrors /home/kcloud/bench_dashboard.py on node4
(RNGD) so the iframe embed inside web/src/pages/npu-eval/atomplus/index.tsx
("Live Bench Dashboard (node5 - Atom+)") looks structurally identical to
"Live Bench Dashboard (node4 — RNGD)".

Run:
    python3 /home/kcloud/atomplus_bench_dashboard.py
or
    sudo systemd-run --unit=atomplus-bench-dashboard --collect \
        --property=WorkingDirectory=/home/kcloud \
        /usr/bin/python3 /home/kcloud/atomplus_bench_dashboard.py
"""
from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("ATOMPLUS_BENCH_DASHBOARD_PORT", "30892"))
NODE_NAME = os.environ.get("ATOMPLUS_BENCH_DASHBOARD_NODE", "node5")
NPU_LABEL = os.environ.get("ATOMPLUS_BENCH_DASHBOARD_LABEL", "Rebellions Atom+")
VENDOR_FILTER = os.environ.get("ATOMPLUS_BENCH_VENDOR", "rebellions").lower()
VENDOR_COLOR = os.environ.get("ATOMPLUS_BENCH_VENDOR_COLOR", "#A855F7")  # purple
BACKEND_URL = os.environ.get("ATOMPLUS_BENCH_BACKEND_URL", "http://10.254.177.41:30001")

TELEMETRY_INTERVAL_SEC = 5
TELEMETRY_HISTORY_LEN = 720  # 60 min @ 5 s

_telemetry_lock = threading.Lock()
_telemetry_history: list[deque] = []  # one deque per NPU
_rbln_snapshot_text = ""

# rbln-stat row format (after splitting on '|'):
#   ['', ' 0   ', ' RBLN-CA22 ', ' rbln0   ', '  0000:c3:00.0 ', '  33C ', '  18.1W  ', ' P14  ', '    0.0B / 15.7GiB   ', '   0.0 ', '']
# Indices:                       0          1            2          3                4         5           6        7        8                       9
# Index of NPU#: 1, Name: 2, Device: 3, BUS: 4, Temp: 5, Power: 6, Perf: 7, Memory: 8, Util: 9
RBLN_TEMP_RE = re.compile(r"(\d+(?:\.\d+)?)\s*C")
RBLN_POWER_RE = re.compile(r"(\d+(?:\.\d+)?)\s*W")
RBLN_UTIL_RE = re.compile(r"(\d+(?:\.\d+)?)")


def _run_rbln_stat() -> tuple[list[dict], str]:
    """Return (per-NPU dicts, raw stdout). Empty rows on failure."""
    try:
        out = subprocess.run(
            ["rbln-stat"],
            capture_output=True, text=True, timeout=4, check=True,
        ).stdout
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return [], "(rbln-stat unavailable)"
    rows: list[dict] = []
    for line in out.splitlines():
        if not line.startswith("|"):
            continue
        # Skip the header rows (those don't start with a digit after trimming)
        parts = [p.strip() for p in line.split("|")]
        # parts[0] is empty (left of leading |), parts[-1] is empty (right of trailing |)
        if len(parts) < 10:
            continue
        npu_field = parts[1]
        if not npu_field.isdigit():
            continue
        try:
            temp_m = RBLN_TEMP_RE.search(parts[5])
            power_m = RBLN_POWER_RE.search(parts[6])
            util_m = RBLN_UTIL_RE.search(parts[9])
            rows.append({
                "index": int(npu_field),
                "name": parts[2],
                "device": parts[3],
                "pci_bus": parts[4],
                "temp_c": float(temp_m.group(1)) if temp_m else None,
                "power_w": float(power_m.group(1)) if power_m else None,
                "perf": parts[7],
                "memory": parts[8],
                "util_pct": float(util_m.group(1)) if util_m else None,
            })
        except (ValueError, IndexError):
            continue
    return rows, out


def _telemetry_poller():
    global _rbln_snapshot_text
    while True:
        rows, raw = _run_rbln_stat()
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
            _rbln_snapshot_text = raw
        time.sleep(TELEMETRY_INTERVAL_SEC)


def _get_telemetry_snapshot() -> tuple[list[dict], list[deque], str]:
    with _telemetry_lock:
        rows = []
        for i, hist in enumerate(_telemetry_history):
            if hist:
                rows.append({"index": i, **hist[-1]})
        return rows, [deque(d) for d in _telemetry_history], _rbln_snapshot_text


def fetch_comparison_runs() -> list[dict]:
    """Return cross-HW comparison rows from /api/comparison/list. Best-effort."""
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


def fetch_active_atomplus_exams() -> list[dict]:
    """Return Running Atom+ runs from /api/comparison/list filtered by vendor."""
    return [
        r for r in fetch_comparison_runs()
        if isinstance(r.get("hardware"), dict)
        and str(r["hardware"].get("vendor", "")).lower() == VENDOR_FILTER
        and str(r.get("status", "")) == "Running"
    ]


def fetch_recent_atomplus_runs(limit: int = 5) -> list[dict]:
    """Return last N completed Atom+ runs, newest first."""
    completed = [
        r for r in fetch_comparison_runs()
        if isinstance(r.get("hardware"), dict)
        and str(r["hardware"].get("vendor", "")).lower() == VENDOR_FILTER
        and str(r.get("status", "")) == "Completed"
    ]
    completed.sort(key=lambda r: r.get("completed_at") or r.get("started_at") or "", reverse=True)
    return completed[:limit]


def render_sparkline(values: list[float | None], stroke: str) -> str:
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


def _kv_row(label: str, value: float | None, fmt: str = "", suffix: str = "") -> str:
    if value is None:
        rendered = "—"
    else:
        rendered = format(value, fmt) + (f" {suffix}" if suffix else "")
    return f"<div class='kv'><span>{label}</span><b>{rendered}</b></div>"


def _elapsed_seconds(started_at: str | None) -> float | None:
    if not started_at:
        return None
    try:
        ts = dt.datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        now = dt.datetime.now(ts.tzinfo) if ts.tzinfo else dt.datetime.now()
        return max(0.0, (now - ts).total_seconds())
    except (ValueError, TypeError):
        return None


def render_active_exam_card(run: dict) -> str:
    name = html.escape(str(run.get("name", "(unnamed)")))
    eid = html.escape(str(run.get("id", "?")))
    benchmark = html.escape(str(run.get("benchmark", "?")))
    model = html.escape(str(run.get("model", "?")))
    precision = html.escape(str(run.get("precision", "?")))
    hw = run.get("hardware") if isinstance(run.get("hardware"), dict) else {}
    hw_model = html.escape(str(hw.get("model", "Atom+")))
    started = html.escape(str(run.get("started_at", "?")))

    elapsed = _elapsed_seconds(run.get("started_at"))
    pct = min(99.0, (elapsed / 180.0) * 100) if elapsed is not None else 5.0
    bar_color = "#16A34A" if pct < 95 else "#F97316"
    elapsed_str = f"{int(elapsed)}s elapsed" if elapsed is not None else "starting"
    progress_block = (
        f"<div class='progress'><div style='width:{pct:.1f}%; background:{bar_color}'></div></div>"
        f"<div class='meta'>{elapsed_str} (pct estimated against ~180s baseline)</div>"
    )
    return (
        f"<section class='card' style='border-color: {VENDOR_COLOR};'>"
        f"<h3 style='color: {VENDOR_COLOR};'>k8s {NPU_LABEL} {benchmark} run #{eid} — {name} (Running)</h3>"
        f"<div class='kv'><span>State</span><b style='color: {VENDOR_COLOR};'>Running on cluster</b></div>"
        f"<div class='kv'><span>Hardware</span><b>{hw_model}</b></div>"
        f"<div class='kv'><span>Model</span><b>{model}</b></div>"
        f"<div class='kv'><span>Precision</span><b>{precision}</b></div>"
        f"<div class='kv'><span>Started</span><b>{started}</b></div>"
        f"{progress_block}"
        f"<div class='meta'>Live state from <code>/api/comparison/list</code> filtered "
        f"<code>hardware.vendor=='{VENDOR_FILTER}'</code> + <code>status=='Running'</code>.</div>"
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


def render_npu_card(rows: list[dict], hist: list[deque], rbln_text: str) -> str:
    sub_rows: list[str] = []
    for r in rows:
        idx = r.get("index")
        sub_rows.append(_kv_row(f"RBLN #{idx} Temp",  r.get("temp_c"),   ".0f", "°C"))
        sub_rows.append(_kv_row(f"RBLN #{idx} Power", r.get("power_w"),  ".1f", "W"))
        sub_rows.append(_kv_row(f"RBLN #{idx} Util",  r.get("util_pct"), ".1f", "%"))
    kv_block = "".join(sub_rows) or "<div class='kv'><span>State</span><b>rbln-stat unavailable</b></div>"

    sparks = []
    for i, hbuf in enumerate(hist[:2]):
        temps = [s.get("temp_c") for s in hbuf]
        powers = [s.get("power_w") for s in hbuf]
        sparks.append(
            f"<figure>{render_sparkline(temps, stroke='#f78166')}"
            f"<figcaption>RBLN #{i} Temp · 60min</figcaption></figure>"
        )
        sparks.append(
            f"<figure>{render_sparkline(powers, stroke=VENDOR_COLOR)}"
            f"<figcaption>RBLN #{i} Power · 60min</figcaption></figure>"
        )
    spark_block = "<div class='spark'>" + "".join(sparks) + "</div>" if sparks else ""

    return (
        "<section class='card'>"
        f"<h3>NPU ({NPU_LABEL} ×{len(rows) if rows else '?'})</h3>"
        f"{kv_block}"
        f"{spark_block}"
        f"<pre style='margin-top:8px;'>{html.escape(rbln_text)}</pre>"
        "</section>"
    )


def render_recent_runs_panel(runs: list[dict]) -> str:
    if not runs:
        return ""
    rows = []
    for r in runs:
        eid = html.escape(str(r.get("id", "?")))
        name = html.escape(str(r.get("name", "?"))[:40])
        bench = html.escape(str(r.get("benchmark", "?")))
        completed = html.escape(str(r.get("completed_at") or r.get("started_at", "?"))[:19])
        metrics = r.get("metrics") if isinstance(r.get("metrics"), dict) else {}
        tt = metrics.get("tt100t_seconds")
        tt_str = (f"{float(tt) * 1000:.0f} ms"
                  if isinstance(tt, (int, float)) and tt < 100
                  else f"{tt:.0f} ms" if isinstance(tt, (int, float))
                  else "—")
        rows.append(
            f"<tr><td>#{eid}</td><td>{bench}</td><td>{name}</td>"
            f"<td>{tt_str}</td><td>{completed}</td></tr>"
        )
    return (
        "<section class='card'>"
        f"<h3>Recent activity — last completed {NPU_LABEL} runs</h3>"
        "<table style='width:100%; border-collapse: collapse; font-size: 12px;'>"
        "<thead><tr style='border-bottom: 1px solid var(--border); color: var(--muted);'>"
        "<th align='left'>ID</th><th align='left'>Bench</th><th align='left'>Name</th>"
        "<th align='left'>TT100T</th><th align='left'>Completed</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
        f"<div class='meta'>Last 5 Completed runs on {NPU_LABEL}. Source: <code>/api/comparison/list</code> filtered <code>hardware.vendor=='{VENDOR_FILTER}'</code>.</div>"
        "</section>"
    )


def _badge(label: str, ok: bool, suffix: str = "") -> str:
    cls = "ok" if ok else "bad"
    sym = "active" if ok else "down"
    return (f"<span class='badge {cls}'>{html.escape(label)} · {sym}"
            f"{(' · ' + html.escape(suffix)) if suffix else ''}</span>")


def render_html() -> str:
    rows, hist, rbln_text = _get_telemetry_snapshot()
    rbln_ok = bool(rows)
    backend_ok = True
    active_runs: list[dict] = []
    try:
        active_runs = fetch_active_atomplus_exams()
    except Exception:
        backend_ok = False
    try:
        comparison_runs = fetch_comparison_runs()
    except Exception:
        comparison_runs = []
        backend_ok = False

    badges = [
        _badge("rbln-stat", rbln_ok),
        _badge("backend api", backend_ok, BACKEND_URL.replace("http://", "")),
        _badge("exam discovery", True, f"{len(active_runs)} active"),
    ]

    active_cards = "\n".join(render_active_exam_card(r) for r in active_runs)
    if not active_cards:
        active_cards = (
            "<section class='card' style='opacity:0.65;'>"
            f"<h3>No {NPU_LABEL} benchmarks active</h3>"
            "<div class='kv'><span>State</span><b>idle</b></div>"
            "<div class='meta'>Live state from <code>/api/comparison/list</code>; this card "
            f"lights up purple when any run with <code>hardware.vendor=='{VENDOR_FILTER}'</code> "
            "and <code>status='Running'</code> is detected.</div>"
            "</section>"
        )

    comparison_panel = render_comparison_panel(comparison_runs)
    npu_card = render_npu_card(rows, hist, rbln_text)
    recent_runs_panel = render_recent_runs_panel(fetch_recent_atomplus_runs(limit=5))

    return f"""<!doctype html>
<html lang='en'>
<head>
<meta charset='utf-8'>
<title>{NODE_NAME} Atom+ NPU bench dashboard</title>
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
  <h1>{NODE_NAME} {NPU_LABEL} NPU bench dashboard <span class='meta'>· auto-refresh 5s · {dt.datetime.now():%H:%M:%S}</span></h1>
  <div>{''.join(badges)}</div>

  {comparison_panel}

  <div class='grid'>
    {active_cards}
    {npu_card}
  </div>

  {recent_runs_panel}

  <div class='footer'>
    Served by <code>atomplus_bench_dashboard.py</code> on port {PORT}. Stop with <code>sudo systemctl stop atomplus-bench-dashboard.service</code> or kill the python process. Page refreshes every 5s. Telemetry source: <code>rbln-stat</code> snapshot every 5s; in-memory ring buffer of last 60 min.
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

    def log_message(self, fmt, *args):
        return


def main() -> None:
    poller = threading.Thread(target=_telemetry_poller, daemon=True)
    poller.start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"atomplus_bench_dashboard listening on :{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
