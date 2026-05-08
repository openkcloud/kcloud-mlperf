#!/usr/bin/env python3
"""Two more sweep variations for triangulation.

Variation 2 — VARIANCE: retry_num=5 captures run-to-run variance per device.
Variation 3 — LONG-OUTPUT: max_tokens=512 (vs canonical 128) tests TT100T methodology stability.

Locked params (FP8 truth, same model class as canonical sweep):
  L40   = NVIDIA-L40, Llama-3.1-8B-Instruct-FP8, vllm,         precision=auto
  A40   = NVIDIA-A40, Llama-3.1-8B-Instruct-FP8, vllm,         precision=auto
  RNGD  = furiosa-ai/Llama-3.1-8B-Instruct,    furiosa-llm,  precision=FP8
  Atom+ = rebellions/Llama-3.1-8B-Instruct,    optimum-rbln, precision=fp8

Usage:
  python3 /home/kcloud/sweep-variance-and-long.py variance
  python3 /home/kcloud/sweep-variance-and-long.py long
  python3 /home/kcloud/sweep-variance-and-long.py both
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

BACKEND = os.environ.get("BACKEND", "http://10.254.177.41:30980")


def started_at():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def post_json(path, body):
    url = f"{BACKEND}{path}"
    payload = json.dumps(body).encode()
    req = urllib.request.Request(url, data=payload, method="POST",
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def post_mp(prefix, gpu_type, tag, n_samples, max_tokens, retry_num):
    body = {
        "name": f"{prefix}-{tag}",
        "description": f"{prefix} sweep variation",
        "model": "Llama-3.1-8B-Instruct-FP8",
        "precision": "auto",
        "mode": "performance",
        "framework": "vllm",
        "batch_size": 1,
        "min_duration": 0,
        "dataset": "cnn_eval.json",
        "data_number": n_samples,
        "scenario": "offline",
        "target_qps": 1,
        "num_workers": 1,
        "tensor_parallel_size": 1,
        "device_type": "GPU",
        "gpu_type": gpu_type,
        "gpu_num": 1,
        "cpu_core": 7,
        "ram_capacity": 16,
        "retry_num": retry_num,
        "max_output_tokens": max_tokens,
        "started_at": started_at(),
        "error_log": "",
    }
    print(f"[mp:{tag}] gpu={gpu_type} n={n_samples} max_tok={max_tokens} retry={retry_num}")
    res = post_json("/api/mp-exam/create", body)
    print(f"  -> id={res.get('data',{}).get('id')}")


def post_npu(prefix, npu_type, model, framework, precision, dataset, tag, n_samples, max_tokens, retry_num):
    body = {
        "name": f"{prefix}-{tag}",
        "description": f"{prefix} sweep variation",
        "benchmark": "mlperf",
        "model": model,
        "precision": precision,
        "framework": framework,
        "batch_size": 1,
        "dataset": dataset,
        "data_number": n_samples,
        "npu_type": npu_type,
        "npu_num": 1,
        "cpu_core": 8,
        "ram_capacity": 64,
        "retry_num": retry_num,
        "max_output_tokens": max_tokens,
        "started_at": started_at(),
        "error_log": "",
    }
    print(f"[npu:{tag}] npu={npu_type} model={model} precision={precision} retry={retry_num}")
    res = post_json("/api/npu-eval/create", body)
    print(f"  -> id={res.get('data',{}).get('id')}")


def variance_sweep():
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    prefix = f"variance-{ts}"
    print(f"=== VARIANCE sweep '{prefix}' (retry_num=5, n=100, max_tok=128) ===\n")
    post_mp(prefix, "NVIDIA-L40", "l40", 100, 128, 5)
    post_mp(prefix, "NVIDIA-A40", "a40", 100, 128, 5)
    post_npu(prefix, "RNGD",
             "furiosa-ai/Llama-3.1-8B-Instruct", "furiosa-llm", "FP8",
             "CNN-DailyMail", "rngd", 100, 128, 5)
    post_npu(prefix, "ATOM",
             "rebellions/Llama-3.1-8B-Instruct", "optimum-rbln", "fp8",
             "cnn_dailymail", "atomplus", 100, 128, 5)
    print(f"\nVariance sweep launched. Prefix: {prefix}")


def long_output_sweep():
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    prefix = f"longout-{ts}"
    print(f"=== LONG-OUTPUT sweep '{prefix}' (n=20, max_tok=512, retry=3) ===\n")
    post_mp(prefix, "NVIDIA-L40", "l40", 20, 512, 3)
    post_mp(prefix, "NVIDIA-A40", "a40", 20, 512, 3)
    post_npu(prefix, "RNGD",
             "furiosa-ai/Llama-3.1-8B-Instruct", "furiosa-llm", "FP8",
             "CNN-DailyMail", "rngd", 20, 512, 3)
    post_npu(prefix, "ATOM",
             "rebellions/Llama-3.1-8B-Instruct", "optimum-rbln", "fp8",
             "cnn_dailymail", "atomplus", 20, 512, 3)
    print(f"\nLong-output sweep launched. Prefix: {prefix}")


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "both"
    if arg == "variance":
        variance_sweep()
    elif arg == "long":
        long_output_sweep()
    elif arg == "both":
        variance_sweep()
        print()
        long_output_sweep()
    else:
        print(f"Unknown arg: {arg}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
