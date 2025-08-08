# MLPerf_local_test (Docker-only UX)

- Build once: `docker build -t mlbench -f docker/Dockerfile .`
- Run:
  - MLPerf (dry-run/run)
    - `docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mlperf --dry-run`
    - `docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mlperf --run-id $(date +%Y%m%d-%H%M%S)`
  - MMLU (dry-run/run)
    - `docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mmlu --dry-run`
    - `docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mmlu --run-id $(date +%Y%m%d-%H%M%S)`
  - Report
    - `docker run --rm -v $(pwd):/workspace mlbench report --run-id latest`

Output layout:
`results/<YYYYmmdd-HHMMSS>/<task>/{raw,summary}/` (symlink `results/latest`)

## One-click run

- `make all-in-one` or `bash scripts/run_all_in_one.sh`
  - Builds → runs MLPerf → runs MMLU → generates report
  - Prereqs: `.env` with `HUGGINGFACE_TOKEN`, Docker GPU available
