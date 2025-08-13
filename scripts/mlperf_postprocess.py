#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
import subprocess
import sys


def parse_run_log(run_log: Path) -> dict:
    data: dict = {
        "metadata": {},
        "performance": {},
        "accuracy": {},
    }
    if not run_log.exists():
        return data

    txt = run_log.read_text(errors="ignore")
    # Extract the MLPerf Results Summary block
    # Example lines we parse safely if present
    # Server summary line
    m = re.search(r"Completed samples per second\s*:\s*([0-9.]+)", txt)
    if m:
        try:
            data["performance"]["throughput_samples_per_second"] = float(m.group(1))
        except Exception:
            pass
    # Offline summary line
    m = re.search(r"Samples per second:\s*([0-9.]+)", txt)
    if m and "throughput_samples_per_second" not in data.get("performance", {}):
        try:
            data.setdefault("performance", {})["throughput_samples_per_second"] = float(m.group(1))
        except Exception:
            pass
    m = re.search(r"Completed tokens per second:\s*([0-9.]+)", txt)
    if m:
        try:
            data["performance"]["throughput_tokens_per_second"] = float(m.group(1))
        except Exception:
            pass
    m = re.search(r"Scenario\s*:\s*(\w+)", txt)
    if m:
        data["metadata"]["scenario"] = m.group(1)
    m = re.search(r"Mode\s*:\s*(\w+)", txt)
    if m:
        data["metadata"]["mode"] = m.group(1)

    # Latencies (ns)
    def _ns(key: str, pattern: str):
        mm = re.search(pattern, txt)
        if mm:
            try:
                data["performance"][key] = float(mm.group(1)) / 1e9
            except Exception:
                pass

    _ns("latency_mean_s", r"Mean latency \(ns\)\s*:\s*([0-9.]+)")
    _ns("latency_p50_s", r"50\.00 percentile latency \(ns\)\s*:\s*([0-9.]+)")
    _ns("latency_p90_s", r"90\.00 percentile latency \(ns\)\s*:\s*([0-9.]+)")

    # First token latency and TPOT
    _ns("ttft_mean_s", r"Mean First Token latency \(ns\)\s*:\s*([0-9.]+)")
    _ns("tpot_mean_s", r"Mean Time to Output Token \(ns\)\s*:\s*([0-9.]+)")

    # Processed queries (for samples estimate)
    mm = re.search(r"Processed\s+(\d+)\s+queries", txt)
    if mm:
        try:
            data["metadata"]["processed_queries"] = int(mm.group(1))
        except Exception:
            pass

    return data


def maybe_run_accuracy_eval(app_dir: Path, outdir: Path, dataset_path: Path) -> dict:
    # If evaluation.py exists, try to run and extract ROUGE
    acc: dict = {}
    eval_py = app_dir / "evaluation.py"
    if not eval_py.exists() or not dataset_path.exists():
        return acc
    log_file = outdir / "evaluation.log"
    try:
        with log_file.open("w") as lf:
            subprocess.run(
                [
                    sys.executable,
                    str(eval_py),
                    "--mlperf-accuracy-file",
                    str(outdir / "mlperf_log_accuracy.json"),
                    "--dataset-file",
                    str(dataset_path),
                    "--dtype",
                    "int32",
                ],
                check=False,
                stdout=lf,
                stderr=subprocess.STDOUT,
            )
        txt = log_file.read_text(errors="ignore")
        # Heuristic parse for ROUGE lines like: rouge1: 0.387, rouge2: 0.159, rougeL: 0.245
        r1 = re.search(r"rouge1\s*[:=]\s*([0-9.]+)", txt)
        r2 = re.search(r"rouge2\s*[:=]\s*([0-9.]+)", txt)
        rl = re.search(r"rougeL\s*[:=]\s*([0-9.]+)", txt)
        if r1:
            acc["rouge1"] = float(r1.group(1))
        if r2:
            acc["rouge2"] = float(r2.group(1))
        if rl:
            acc["rougeL"] = float(rl.group(1))
    except Exception:
        pass
    return acc


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--app-dir", required=True)
    p.add_argument("--dataset", required=False, default="")
    p.add_argument("--mode", required=False, default="performance")
    args = p.parse_args()

    outdir = Path(args.outdir)
    app_dir = Path(args.app_dir)
    dataset = Path(args.dataset) if args.dataset else Path("")
    run_log = outdir / "run.log"

    summary = parse_run_log(run_log)
    # If accuracy mode, try to get ROUGE via evaluation
    if (args.mode or "").lower().startswith("acc"):
        acc = maybe_run_accuracy_eval(app_dir, outdir, dataset)
        if acc:
            summary["accuracy"].update(acc)
        # Try to derive sample count from accuracy JSON
        acc_json = outdir / "mlperf_log_accuracy.json"
        if acc_json.exists():
            try:
                acc_data = json.loads(acc_json.read_text(errors="ignore"))
                if isinstance(acc_data, list):
                    samples = len(acc_data)
                    summary.setdefault("metadata", {})["samples"] = samples
                    summary.setdefault("performance", {})["samples_processed"] = samples
            except Exception:
                pass
    else:
        # For performance runs, reuse processed_queries as samples if available
        pq = summary.get("metadata", {}).get("processed_queries")
        if pq:
            summary.setdefault("metadata", {})["samples"] = pq
            summary.setdefault("performance", {})["samples_processed"] = pq

    # Best-effort total_time based on throughput and samples when possible
    thr = summary.get("performance", {}).get("throughput_samples_per_second", 0.0)
    samples = (
        summary.get("metadata", {}).get("samples")
        or summary.get("performance", {}).get("samples_processed")
        or summary.get("metadata", {}).get("processed_queries")
        or 0
    )
    if thr and samples:
        summary["performance"]["total_time_seconds_estimated"] = samples / max(thr, 1e-9)

    (outdir / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"Wrote {outdir/'summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


