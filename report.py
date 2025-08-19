from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Tuple

import matplotlib


# Ensure headless rendering
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from util_logs import parse_detail, parse_summary


def _plot_latency_cdf(latencies_ms, out_png: Path) -> None:
    if not latencies_ms:
        return
    xs = sorted(latencies_ms)
    ps = [i / (len(xs) - 1) if len(xs) > 1 else 1.0 for i in range(len(xs))]
    plt.figure(figsize=(6, 4))
    plt.plot(xs, ps)
    plt.xlabel("Latency (ms)")
    plt.ylabel("CDF")
    plt.grid(True, alpha=0.3)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(out_png)
    plt.close()


def _plot_tokens_per_sec(tokens_per_sec: float, out_png: Path) -> None:
    plt.figure(figsize=(4, 3))
    plt.bar(["tokens/sec"], [tokens_per_sec])
    plt.ylabel("Tokens/sec")
    plt.grid(True, axis="y", alpha=0.3)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(out_png)
    plt.close()


def build_summary_and_report(
    run_dir: Path,
    args_dict: Dict[str, Any],
    sysinfo: Dict[str, Any],
    run_outcome: Dict[str, Any],
) -> Tuple[Dict[str, Any], str]:
    plots_dir = run_dir / "plots"
    plots_dir.mkdir(parents=True, exist_ok=True)

    # Gather logs if present
    perf_dir = run_dir / "Performance"
    acc_dir = run_dir / "Accuracy"
    summary_txt = perf_dir / "mlperf_log_summary.txt"
    detail_txt = perf_dir / "mlperf_log_detail.txt"
    summary_metrics = parse_summary(summary_txt)
    latencies_ms = parse_detail(detail_txt)

    # Create plots according to scenario/mode
    tokens_per_sec_png = plots_dir / "tokens_per_sec.png"
    latency_cdf_png = plots_dir / "latency_cdf.png"

    if run_outcome.get("mode") == "performance":
        if run_outcome.get("scenario") == "offline":
            _plot_tokens_per_sec(run_outcome.get("tokens_per_sec", 0.0), tokens_per_sec_png)
        else:
            _plot_latency_cdf(latencies_ms, latency_cdf_png)

    # Build summary.json
    summary: Dict[str, Any] = {
        "meta": {
            "timestamp": datetime.now().isoformat(),
            "mlperf_version": args_dict.get("version"),
            "division": "Closed",
            "category": args_dict.get("category"),
            "scenario": args_dict.get("scenario"),
            "backend": args_dict.get("backend"),
            "precision": args_dict.get("precision"),
            "model": args_dict.get("model"),
        },
        "system": sysinfo,
        "run": run_outcome,
        "logs": {
            "summary_txt": str(summary_txt) if summary_txt.exists() else None,
            "detail_txt": str(detail_txt) if detail_txt.exists() else None,
            "accuracy_json": str(acc_dir / "mlperf_log_accuracy.json") if (acc_dir / "mlperf_log_accuracy.json").exists() else None,
            "rouge_json": str(acc_dir / "rouge.json") if (acc_dir / "rouge.json").exists() else None,
        },
        "plots": {
            "tokens_per_sec": str(tokens_per_sec_png) if tokens_per_sec_png.exists() else None,
            "latency_cdf": str(latency_cdf_png) if latency_cdf_png.exists() else None,
        },
        "parsed_metrics": summary_metrics,
    }

    # Build report.md
    lines = []
    lines.append(f"# MLPerf Inference v{args_dict.get('version')} — Clean-Slate Runner")
    lines.append("")
    lines.append(
        f"Category={args_dict.get('category')}, Scenario={args_dict.get('scenario')}, Backend=vLLM, Precision={args_dict.get('precision')}, Model={args_dict.get('model')}"
    )
    lines.append("")
    lines.append("## Accuracy")
    if run_outcome.get("mode") == "accuracy":
        rouge = run_outcome.get("rouge", {})
        passed = run_outcome.get("passed")
        lines.append(f"ROUGE-1: {rouge.get('rouge1', 0):.4f}")
        lines.append(f"ROUGE-2: {rouge.get('rouge2', 0):.4f}")
        lines.append(f"ROUGE-L: {rouge.get('rougeL', 0):.4f}")
        lines.append(f"ROUGE-Lsum: {rouge.get('rougeLsum', 0):.4f}")
        lines.append(f"Gate passed: {passed}")
    else:
        lines.append("(Not an accuracy run)")
    lines.append("")

    lines.append("## Performance")
    if run_outcome.get("mode") == "performance":
        scen = run_outcome.get("scenario")
        if scen == "offline":
            lines.append(f"Tokens/sec: {run_outcome.get('tokens_per_sec', 0.0):.2f}")
            if (plots_dir / "tokens_per_sec.png").exists():
                lines.append("![](plots/tokens_per_sec.png)")
        elif scen == "server":
            lines.append(f"Target QPS: {run_outcome.get('target_qps', 0.0):.3f}")
            lines.append(f"Achieved QPS: {run_outcome.get('achieved_qps', 0.0):.3f}")
            lat = run_outcome.get("latency_ms", {})
            lines.append(
                f"Latency p50/p90/p95/p99 (ms): {lat.get('p50',0):.2f}/{lat.get('p90',0):.2f}/{lat.get('p95',0):.2f}/{lat.get('p99',0):.2f}"
            )
            if (plots_dir / "latency_cdf.png").exists():
                lines.append("![](plots/latency_cdf.png)")
        else:
            lat = run_outcome.get("latency_ms", {})
            lines.append(
                f"Latency p50/p90/p95/p99 (ms): {lat.get('p50',0):.2f}/{lat.get('p90',0):.2f}/{lat.get('p95',0):.2f}/{lat.get('p99',0):.2f}"
            )
            if (plots_dir / "latency_cdf.png").exists():
                lines.append("![](plots/latency_cdf.png)")
    else:
        lines.append("(Not a performance run)")
    lines.append("")

    lines.append("## System")
    lines.append("```")
    lines.append(json.dumps(sysinfo, indent=2))
    lines.append("```")
    lines.append("")

    lines.append("## Files")
    for key, val in summary["logs"].items():
        if val:
            lines.append(f"- {key}: {os.path.relpath(val, run_dir)}")
    for key, val in summary["plots"].items():
        if val:
            lines.append(f"- plot {key}: {os.path.relpath(val, run_dir)}")

    report_md = "\n".join(lines) + "\n"
    return summary, report_md


