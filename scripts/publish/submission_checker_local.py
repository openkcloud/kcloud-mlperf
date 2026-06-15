#!/usr/bin/env python3
"""WS-H local submission checker (subset of upstream MLPerf).

Validates that a publication bundle (built by `build-publication-bundle.ts`)
contains the structural artifacts an MLPerf 5.1 submission *would* require.

This is a strict subset of the upstream
  https://github.com/mlcommons/inference/blob/master/tools/submission/submission_checker.py
We check directory presence, file presence, and that JSON files parse — we do
NOT validate LoadGen log contents, accuracy thresholds, or compliance test
verdicts. For a real submission, run upstream `submission_checker.py` after
running this local pre-flight.

Usage:
    python3 scripts/publish/submission_checker_local.py <bundle-root>
    python3 scripts/publish/submission_checker_local.py <path-to-tarball.tgz>

Exit codes:
    0 = all structural checks passed
    1 = one or more required artifacts missing or invalid
    2 = bundle root / tarball not found or unreadable
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tarfile
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List


REQUIRED_TOP_LEVEL = [
    "methods.md",
    "results.csv",
    "reproducibility.json",
    "methodology_caveats.md",
    "ADR.md",
    "manifest.json",
]

REQUIRED_PER_MLPERF_RUN = [
    "mlperf_log_summary.txt",
    "mlperf_log_detail.txt",
    "accuracy.txt",
    "mlperf.conf",
    "user.conf",
    "system_desc_id.json",
]

REQUIRED_COMPLIANCE = [
    "compliance/TEST01/verify_accuracy.txt",
    "compliance/TEST04/verify_performance.txt",
    "compliance/TEST05/verify_performance.txt",
]


@dataclass
class CheckResult:
    passed: List[str] = field(default_factory=list)
    failed: List[str] = field(default_factory=list)

    def ok(self, label: str) -> None:
        self.passed.append(label)

    def fail(self, label: str) -> None:
        self.failed.append(label)

    @property
    def is_pass(self) -> bool:
        return not self.failed


def _check_file(root: Path, rel: str, result: CheckResult) -> None:
    full = root / rel
    if full.is_file():
        result.ok(f"present: {rel}")
    else:
        result.fail(f"missing: {rel}")


def _check_json(root: Path, rel: str, result: CheckResult) -> None:
    full = root / rel
    if not full.is_file():
        result.fail(f"missing: {rel}")
        return
    try:
        with full.open("r", encoding="utf-8") as fh:
            json.load(fh)
        result.ok(f"valid-json: {rel}")
    except json.JSONDecodeError as exc:
        result.fail(f"invalid-json: {rel} ({exc.msg} at line {exc.lineno})")


def check_bundle(root: Path) -> CheckResult:
    """Run the full structural checklist on a bundle directory."""
    result = CheckResult()

    if not root.is_dir():
        result.fail(f"bundle root is not a directory: {root}")
        return result

    # Top-level required files
    for rel in REQUIRED_TOP_LEVEL:
        if rel.endswith(".json"):
            _check_json(root, rel, result)
        else:
            _check_file(root, rel, result)

    # MLPerf per-run artifacts
    mlperf_dir = root / "mlperf"
    if mlperf_dir.is_dir():
        run_dirs = [p for p in mlperf_dir.iterdir() if p.is_dir()]
        if not run_dirs:
            # mlperf/ may legitimately be empty if the bundle has no MLPerf
            # runs (e.g. MMLU-only sweep). Don't fail.
            result.ok("mlperf/: directory present, no runs (acceptable)")
        for run_dir in sorted(run_dirs):
            run_id = run_dir.name
            for rel in REQUIRED_PER_MLPERF_RUN:
                full_rel = f"mlperf/{run_id}/{rel}"
                if rel.endswith(".json"):
                    _check_json(root, full_rel, result)
                else:
                    _check_file(root, full_rel, result)
    else:
        # mlperf/ entirely absent: only OK if the bundle has no MLPerf runs.
        # We can't tell without parsing manifest.json, so warn-fail.
        result.fail(
            "missing: mlperf/ directory (expected even if empty for MLPerf-aligned bundles)"
        )

    # Compliance suite stubs
    for rel in REQUIRED_COMPLIANCE:
        _check_file(root, rel, result)

    # raw_logs/ directory should exist (stubs are acceptable).
    raw_logs = root / "raw_logs"
    if raw_logs.is_dir():
        result.ok("present: raw_logs/")
    else:
        result.fail("missing: raw_logs/ directory")

    return result


def _extract_tarball(tarball: Path) -> Path:
    tmp_root = Path(tempfile.mkdtemp(prefix="pubbundle-check-"))
    with tarfile.open(tarball, "r:gz") as tf:
        # Mitigate path traversal — only allow members inside the staging dir.
        for member in tf.getmembers():
            target = (tmp_root / member.name).resolve()
            if not str(target).startswith(str(tmp_root.resolve()) + os.sep) and \
               target != tmp_root.resolve():
                raise RuntimeError(
                    f"tarball contains unsafe member path: {member.name}"
                )
        tf.extractall(tmp_root)
    # Bundles tar with `-C parent base` so the extract dir contains a single
    # bundle-id folder. Find it.
    children = [p for p in tmp_root.iterdir() if p.is_dir()]
    if len(children) != 1:
        raise RuntimeError(
            f"expected exactly one top-level dir in tarball, found {len(children)}"
        )
    return children[0]


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "WS-H local submission-checker (structural subset of upstream "
            "MLPerf submission_checker.py)."
        ),
    )
    parser.add_argument(
        "bundle",
        help="Path to a bundle directory or a .tgz tarball.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only print failures and a final verdict line.",
    )
    args = parser.parse_args(argv)

    target = Path(args.bundle)
    if not target.exists():
        print(f"error: not found: {target}", file=sys.stderr)
        return 2

    if target.is_file() and target.suffixes[-2:] == [".tgz"] or str(target).endswith(
        ".tar.gz"
    ):
        try:
            root = _extract_tarball(target)
        except (tarfile.TarError, RuntimeError) as exc:
            print(f"error: failed to extract tarball: {exc}", file=sys.stderr)
            return 2
    elif target.is_dir():
        root = target
    else:
        print(f"error: bundle must be a directory or .tgz, got: {target}", file=sys.stderr)
        return 2

    result = check_bundle(root)

    if not args.quiet:
        for line in result.passed:
            print(f"PASS  {line}")
    for line in result.failed:
        print(f"FAIL  {line}", file=sys.stderr)

    print(
        f"=== verdict: {'PASS' if result.is_pass else 'FAIL'} "
        f"({len(result.passed)} passed, {len(result.failed)} failed) ===",
    )
    print(
        "note: this is a LOCAL subset checker. For a real MLPerf 5.1",
        "submission, run upstream submission_checker.py from",
        "github.com/mlcommons/inference/tools/submission/.",
    )

    return 0 if result.is_pass else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
