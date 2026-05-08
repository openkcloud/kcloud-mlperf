#!/usr/bin/env python3
"""Real Atom+ canonical benchmark — first run hitting node5 silicon (post-fix).

Triggers a single canonical mlperf exam on RBLN-CA22 via the new per-vendor
URL routing (backend v33). This proves Atom+ measurements are now coming from
actual silicon, not the RNGD inference server.
"""
import json, urllib.request
from datetime import datetime, timezone

BACKEND = "http://10.254.177.41:30980"
TS = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
NAME = f"REAL-ATOM-canonical-{TS}"

body = {
    "name": NAME,
    "description": "First post-fix Atom+ canonical run on actual node5 silicon",
    "benchmark": "mlperf",
    "model": "rebellions/Llama-3.1-8B-Instruct",
    "precision": "fp16",   # vendor-honest: RBLN-CA22 has no FP8 silicon
    "framework": "vllm-rbln",
    "batch_size": 1,
    "dataset": "cnn_dailymail",
    "data_number": 100,
    "npu_type": "ATOM",
    "npu_num": 2,          # TP=2 (matches the precompiled artifact)
    "cpu_core": 8,
    "ram_capacity": 64,
    "retry_num": 1,
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
