# MLPerf_local_test Overview

Purpose: Run MLPerf-style inference benchmarks for LLaMA3.1-8B with A30-focused optimizations, generate MLPerf-compliant outputs, and produce reports.

Key areas:
- Docker image and entrypoints: `Dockerfile`, `entrypoint.sh`, `entrypoint_with_local.sh`
- Benchmark orchestration: `run_all.sh`, `run_all_scenarios.sh`, `run_benchmark.sh`
- Evaluation/reporting: `generate_report.sh`, `generate_report_from_json.py`, `report_generator.py`
- MMLU: `llm_eval/`
- Results: `results/` (timestamped subfolders)

Conventions:
- Environment variable `HF_TOKEN` is required for model access.
- Cache volumes mounted at `.cache`; results emitted under `results/`.
- Prefer Make targets and non-interactive runs.
