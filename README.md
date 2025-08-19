# MLPerf LLaMA-3.1-8B Runner (Clean Slate)

Minimal, universal, easy-to-run benchmark suite for MLPerf Inference v5.1 using vLLM.

## Quickstart (Docker)

```bash
docker build -t mlperf-llama31:clean .
# Accuracy example (Datacenter/Offline)
docker run --gpus all --rm -it -e HF_TOKEN=$HF_TOKEN -v $PWD/results:/app/results mlperf-llama31:clean \
  python run.py --category datacenter --scenario offline --mode accuracy --precision fp16
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
  2025MMDD-hhmmss/
    config.json
    summary.json
    report.md
    plots/
    Performance/{mlperf_log_summary.txt, mlperf_log_detail.txt}
    Accuracy/{mlperf_log_accuracy.json, rouge.json}
```


