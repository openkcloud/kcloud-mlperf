#!/usr/bin/env python3
"""Aggregate all 3-sweep results (canonical + variance + long-output) into a single
markdown table for the demo-Monday audit doc.

Pulls from the live cluster DB. Assumes the canonical/variance/long-output sweeps
were created today (May 8) with the prefix conventions:
  - canonical-sweep-20260508-005541-{l40,a40,rngd,atomplus}
  - variance-20260508-005916-{l40,a40,rngd,atomplus}
  - longout-20260508-011100-{l40,a40,rngd,atomplus}

Usage:
  python3 /home/kcloud/aggregate-sweep-results.py
"""
import json
import statistics
import subprocess
import sys

DEVICES = [
    ("L40",   "mp_exam",  "mp_exam_result",  161, 163, 165, "result_perf_tps"),
    ("A40",   "mp_exam",  "mp_exam_result",  162, 164, 166, "result_perf_tps"),
    ("RNGD",  "npu_exam", "npu_exam_result",  84,  86,  88, "result_tps"),
    ("Atom+", "npu_exam", "npu_exam_result",  85,  87,  89, "result_tps"),
]

DB_EXEC = ["kubectl", "exec", "-n", "llm-evaluation", "deploy/etri-llm-db",
           "--", "psql", "-U", "postgres", "-d", "llmEvaluationDB", "-t", "-A", "-F,", "-c"]


def query(sql):
    r = subprocess.run(DB_EXEC + [sql], capture_output=True, text=True, check=True)
    rows = []
    for line in r.stdout.strip().split("\n"):
        if not line:
            continue
        rows.append(line.split(","))
    return rows


def fetch(table_exam, table_result, exam_id, tps_col):
    """Return list of (tt100t, tps) tuples for an exam, divided by 1000 if mp_exam."""
    sql = (
        f"SELECT result_tt100t, {tps_col} "
        f"FROM {table_result} WHERE exam_id={exam_id} AND result_tt100t IS NOT NULL "
        f"ORDER BY id;"
    )
    rows = query(sql)
    out = []
    for r in rows:
        if len(r) < 2:
            continue
        try:
            tt = float(r[0]) if r[0] else None
            tp = float(r[1]) if r[1] else None
        except ValueError:
            continue
        if tt is None or tp is None:
            continue
        # Convert mp_exam ms -> s
        if table_exam == "mp_exam":
            tt = tt / 1000.0
        out.append((tt, tp))
    return out


def stats(rows):
    if not rows:
        return None
    tts = [r[0] for r in rows]
    tps = [r[1] for r in rows]
    return {
        "n": len(tts),
        "tt_mean": statistics.mean(tts),
        "tt_min":  min(tts),
        "tt_max":  max(tts),
        "tt_std":  statistics.pstdev(tts) if len(tts) > 1 else 0.0,
        "tps_mean": statistics.mean(tps),
        "tps_min":  min(tps),
        "tps_max":  max(tps),
    }


def fmt(s):
    if not s:
        return "_no data_"
    return (f"n={s['n']}  "
            f"TT100T mean={s['tt_mean']:.3f} σ={s['tt_std']:.3f} "
            f"min={s['tt_min']:.3f} max={s['tt_max']:.3f}  |  "
            f"TPS mean={s['tps_mean']:.2f} max={s['tps_max']:.2f}")


def main():
    print("=" * 80)
    print("Cross-vendor TT100T sweep aggregation — canonical + variance + long-output")
    print("=" * 80)

    md_lines = []
    md_lines.append("| Device | Sweep | n | TT100T mean ± σ (s) | TT100T min – max (s) | TPS mean / max |")
    md_lines.append("|---|---|---|---|---|---|")

    for label, t_exam, t_res, c_id, v_id, l_id, tps_col in DEVICES:
        for sweep_label, eid in [("Canonical", c_id), ("Variance",  v_id), ("Long-output", l_id)]:
            rows = fetch(t_exam, t_res, eid, tps_col)
            s = stats(rows)
            print(f"  {label:7} {sweep_label:12} (id={eid}): {fmt(s)}")
            if s:
                md_lines.append(f"| **{label}** | {sweep_label} | {s['n']} | "
                                f"{s['tt_mean']:.3f} ± {s['tt_std']:.3f} | "
                                f"{s['tt_min']:.3f} – {s['tt_max']:.3f} | "
                                f"{s['tps_mean']:.2f} / {s['tps_max']:.2f} |")
            else:
                md_lines.append(f"| **{label}** | {sweep_label} | 0 | _no data_ | _no data_ | _no data_ |")

    print()
    print("Markdown table:")
    print("=" * 80)
    for l in md_lines:
        print(l)
    print()


if __name__ == "__main__":
    main()
