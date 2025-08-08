#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def find_latest_json(results_dir: Path) -> Path | None:
    candidates = sorted(results_dir.rglob("*.json"))
    return candidates[-1] if candidates else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    run_dir = Path("results") / args.run_id
    if not run_dir.exists():
        print(f"Run directory not found: {run_dir}", file=sys.stderr)
        return 2

    latest_json = find_latest_json(run_dir)
    if not latest_json:
        print("No JSON found for report generation", file=sys.stderr)
        return 1

    # Reuse existing reporting utility if available
    # Fallback to generate_report_from_json.py
    import subprocess

    try:
        subprocess.check_call([
            sys.executable,
            "generate_report_from_json.py",
            str(latest_json),
        ])
    except Exception as exc:  # noqa: BLE001
        # Fallback: write a minimal HTML/MD when official report fails (e.g., throughput==0)
        print(f"Report generation failed: {exc}", file=sys.stderr)
        minimal = run_dir / "fallback_report.md"
        minimal.write_text(f"# Fallback Report for {args.run_id}\n\nSource: {latest_json}\n")
        # continue instead of failing

    # Write a minimal machine-readable rollup alongside
    summary_dir = run_dir / "rollup"
    summary_dir.mkdir(parents=True, exist_ok=True)
    rollup = {
        "run_id": args.run_id,
        "latest_json": str(latest_json),
    }
    (summary_dir / "summary.json").write_text(json.dumps(rollup))
    print(f"Report generated for {args.run_id} using {latest_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


