#!/usr/bin/env python3
"""Canonical 4-device MLPerf TT100T sweep.

Locked params (mirror successful production rows 75/76/80–83/154–160):
  model     = Llama-3.1-8B-Instruct (FP8 vendor variants)
  n_samples = 100
  max_tokens = 128
  dataset   = CNN-DailyMail
  scenario  = offline (GPU)

Usage:
  python3 /home/kcloud/canonical-sweep.py

Env:
  BACKEND   - default http://10.254.177.41:30980
  N_SAMPLES - default 100
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

BACKEND = os.environ.get("BACKEND", "http://10.254.177.41:30980")
N_SAMPLES = int(os.environ.get("N_SAMPLES", "100"))
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "128"))
TS = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
NAME_PREFIX = os.environ.get("NAME_PREFIX", f"canonical-sweep-{TS}")


def started_at():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def post_json(path, body):
    url = f"{BACKEND}{path}"
    payload = json.dumps(body).encode()
    req = urllib.request.Request(url, data=payload, method="POST",
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def post_mp(gpu_type, cpu_core, tag):
    body = {
        "name": f"{NAME_PREFIX}-{tag}",
        "description": f"canonical FP8 sweep {tag} {TS}",
        "model": "Llama-3.1-8B-Instruct-FP8",
        "precision": "auto",
        "mode": "performance",
        "framework": "vllm",
        "batch_size": 1,
        "min_duration": 0,
        "dataset": "cnn_eval.json",
        "data_number": N_SAMPLES,
        "scenario": "offline",
        "target_qps": 1,
        "num_workers": 1,
        "tensor_parallel_size": 1,
        "device_type": "GPU",
        "gpu_type": gpu_type,
        "gpu_num": 1,
        "cpu_core": cpu_core,
        "ram_capacity": 16,
        "retry_num": 1,
        "max_output_tokens": MAX_TOKENS,
        "started_at": started_at(),
        "error_log": "",
    }
    print(f"[mp:{tag}] POST /api/mp-exam/create gpu_type={gpu_type}")
    res = post_json("/api/mp-exam/create", body)
    data = res.get("data", res)
    print(f"  -> id={data.get('id')} status={data.get('status')}")
    return data


def post_npu(npu_type, model, framework, precision, dataset, tag):
    body = {
        "name": f"{NAME_PREFIX}-{tag}",
        "description": f"canonical FP8 sweep {tag} {TS}",
        "benchmark": "mlperf",
        "model": model,
        "precision": precision,
        "framework": framework,
        "batch_size": 1,
        "dataset": dataset,
        "data_number": N_SAMPLES,
        "npu_type": npu_type,
        "npu_num": 1,
        "cpu_core": 8,
        "ram_capacity": 64,
        "retry_num": 1,
        "max_output_tokens": MAX_TOKENS,
        "started_at": started_at(),
        "error_log": "",
    }
    print(f"[npu:{tag}] POST /api/npu-eval/create npu_type={npu_type} model={model}")
    res = post_json("/api/npu-eval/create", body)
    data = res.get("data", res)
    print(f"  -> id={data.get('id')} status={data.get('status')}")
    return data


def main():
    print(f"=== Canonical sweep {TS} ===")
    print(f"Locked params: model=Llama-3.1-8B FP8 (vendor variants), "
          f"n={N_SAMPLES}, max_tokens={MAX_TOKENS}, dataset=CNN-DailyMail")
    print()

    created = []
    try:
        # GPU side: cap cpu_core at 7 per project_fp8_and_mmlu_fix.md memory
        created.append(("mp", post_mp("NVIDIA-L40", 7, "l40")))
        created.append(("mp", post_mp("NVIDIA-A40", 7, "a40")))

        # NPU side
        created.append(("npu", post_npu("RNGD",
                                        "furiosa-ai/Llama-3.1-8B-Instruct",
                                        "furiosa-llm", "FP8",
                                        "CNN-DailyMail", "rngd")))
        created.append(("npu", post_npu("ATOM",
                                        "rebellions/Llama-3.1-8B-Instruct",
                                        "optimum-rbln", "fp8",
                                        "cnn_dailymail", "atomplus")))
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500] if hasattr(e, "read") else ""
        print(f"\nERROR: HTTP {e.code} {e.reason}: {body}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1

    print()
    print(f"All 4 exams created with prefix '{NAME_PREFIX}'")
    print("Watch:")
    print(f"  kubectl exec -n llm-evaluation deploy/etri-llm-db -- psql -U postgres -d llmEvaluationDB -c \\")
    print(f"    \"SELECT id,name,status,model,precision FROM mp_exam WHERE name LIKE '{NAME_PREFIX}%' \\")
    print(f"     UNION ALL SELECT id,name,status,model,precision FROM npu_exam WHERE name LIKE '{NAME_PREFIX}%';\"")
    return 0


if __name__ == "__main__":
    sys.exit(main())
