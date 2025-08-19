# MLPerf LLaMA-3.1-8B Runner (Clean Slate)

Minimal, universal, easy-to-run benchmark suite for MLPerf Inference v5.1 using vLLM.

## Quickstart (Docker)

```bash
docker build -t mlperf-llama31:clean .

# Accuracy (Datacenter/Offline)
docker run --gpus all --rm --env-file .env -v $PWD/results:/app/results mlperf-llama31:clean \
  python run.py --model meta-llama/Llama-3.1-8B-Instruct \
  --category datacenter --scenario offline --mode accuracy \
  --tensor-parallel-size auto --max-model-len 4096 --precision bf16

# Performance (Datacenter/Offline)
docker run --gpus all --rm --env-file .env -v $PWD/results:/app/results mlperf-llama31:clean \
  python run.py --category datacenter --scenario offline --mode performance \
  --tensor-parallel-size auto --max-model-len 4096 --precision bf16

# Server performance (auto QPS from last Offline)
docker run --gpus all --rm --env-file .env -v $PWD/results:/app/results mlperf-llama31:clean \
  python run.py --category datacenter --scenario server --mode performance \
  --server-target-qps auto --tensor-parallel-size auto --max-model-len 4096 --precision bf16

# Edge SingleStream performance
docker run --gpus all --rm --env-file .env -v $PWD/results:/app/results mlperf-llama31:clean \
  python run.py --category edge --scenario singlestream --mode performance \
  --tensor-parallel-size auto --max-model-len 4096 --precision bf16 --total-sample-count 512

# Combined accuracy + performance for selected scenario
docker run --gpus all --rm --env-file .env -v $PWD/results:/app/results mlperf-llama31:clean \
  python run.py --category datacenter --scenario offline --mode both \
  --tensor-parallel-size auto --max-model-len 4096 --precision bf16
```

## Files
- `run.py`: single CLI for accuracy/performance across scenarios
- `mmlu.py`: MMLU inference-only evaluator
- `util_logs.py`: parse LoadGen logs to structured JSON
- `report.py`: summary.json + report.md + basic matplotlib plots
- `requirements.txt`, `Dockerfile`

## Results Layout
```
results/
  latest -> 2025MMDD-hhmmss
  index.md               # list of historical runs
  2025MMDD-hhmmss/
    config.json
    summary.json
    report.md
    plots/
    Performance/{mlperf_log_summary.txt, mlperf_log_detail.txt}
    Accuracy/{mlperf_log_accuracy.json, rouge.json}
```

## Behavior
- `--mode accuracy`: runs deterministic generation, computes ROUGE, writes `Accuracy/*`, renders report.
- `--mode performance`: runs selected scenario, writes `Performance/*`, renders report.
- `--mode both`: runs accuracy first then performance and renders a combined report.
- Historical index: `results/index.md` is updated after each run; `results/latest` points to the newest.

## Local (no Docker)
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export HF_TOKEN=...; export HUGGINGFACE_HUB_TOKEN=$HF_TOKEN
python run.py --category datacenter --scenario offline --mode accuracy --max-model-len 4096 --precision bf16
```

## Expected metrics (targets)
- Accuracy gate: ROUGE-Lsum >= 0.99 (>= 0.999 if `--high-accuracy 1`).
- Datacenter Offline: Tokens/sec reported in `summary.json` under `run.performance.tokens_per_sec`.
- Datacenter Server: Target vs Achieved QPS and latency percentiles in report.
- Edge SingleStream: Latency p50/p90/p95/p99 in report; CDF plot in `plots/`.

Reference model: `meta-llama/Llama-3.1-8B-Instruct` (access required).


