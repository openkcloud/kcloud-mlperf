#!/usr/bin/env python3
"""Relaunch NPU long-output sweep (n=20, max_tok=512, retry=3).

Reason: prior NPU exams 88, 89 were orphaned by backend rollouts (v31/v32).
GPU side already completed.  This script only re-creates the NPU side so we
can finish the methodology-robustness validation.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

BACKEND = os.environ.get("BACKEND", "http://10.254.177.41:30980")
TS = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
PREFIX = f"longout-redo-{TS}"


def started_at():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def post_npu(npu_type, model, framework, precision, dataset, tag):
    body = {
        "name": f"{PREFIX}-{tag}",
        "description": f"NPU long-output sweep redo {TS}",
        "benchmark": "mlperf",
        "model": model,
        "precision": precision,
        "framework": framework,
        "batch_size": 1,
        "dataset": dataset,
        "data_number": 20,
        "npu_type": npu_type,
        "npu_num": 1,
        "cpu_core": 8,
        "ram_capacity": 64,
        "retry_num": 3,
        "max_output_tokens": 512,
        "started_at": started_at(),
        "error_log": "",
    }
    url = f"{BACKEND}/api/npu-eval/create"
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        res = json.loads(r.read().decode())
    print(f"[npu:{tag}] -> id={res.get('data', {}).get('id')}")


def main():
    print(f"=== NPU long-output sweep redo '{PREFIX}' ===\n")
    post_npu("RNGD",
             "furiosa-ai/Llama-3.1-8B-Instruct", "furiosa-llm", "FP8",
             "CNN-DailyMail", "rngd")
    post_npu("ATOM",
             "rebellions/Llama-3.1-8B-Instruct", "optimum-rbln", "fp8",
             "cnn_dailymail", "atomplus")
    return 0


if __name__ == "__main__":
    sys.exit(main())
