#!/usr/bin/env python3
"""Real Atom+ variance sweep — 5 retries on actual node5 silicon (post-fix)."""
import json, urllib.request
from datetime import datetime, timezone

BACKEND = "http://10.254.177.41:30980"
TS = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
NAME = f"REAL-ATOM-variance-{TS}"

body = {
    "name": NAME,
    "description": "Real Atom+ variance sweep on node5 silicon (post per-vendor URL routing)",
    "benchmark": "mlperf",
    "model": "rebellions/Llama-3.1-8B-Instruct",
    "precision": "fp16",
    "framework": "vllm-rbln",
    "batch_size": 1,
    "dataset": "cnn_dailymail",
    "data_number": 100,
    "npu_type": "ATOM",
    "npu_num": 2,
    "cpu_core": 8,
    "ram_capacity": 64,
    "retry_num": 5,
    "max_output_tokens": 128,
    "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
    "error_log": "",
}
req = urllib.request.Request(
    f"{BACKEND}/api/npu-eval/create",
    data=json.dumps(body).encode(),
    method="POST",
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=15) as r:
    res = json.loads(r.read().decode())
print(f"Created: id={res.get('data', {}).get('id')} name={NAME}")
