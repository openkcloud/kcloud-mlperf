# MLPerf_local_test (Docker 전용)

- 한 번만 빌드: `docker build -t mlbench -f docker/Dockerfile .`
- 실행 예시:
  - MLPerf (드라이런/실행)
    - `docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mlperf --dry-run`
    - `docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mlperf --run-id $(date +%Y%m%d-%H%M%S)`
  - MMLU (드라이런/실행)
    - `docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mmlu --dry-run`
    - `docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mmlu --run-id $(date +%Y%m%d-%H%M%S)`
  - 리포트
    - `docker run --rm -v $(pwd):/workspace mlbench report --run-id latest`

결과 경로: `results/<YYYYmmdd-HHMMSS>/<task>/{raw,summary}/` (심볼릭 링크 `results/latest` 제공)

토큰 설정: `.env.sample` 참고 (`.env` 작성 후 `--env-file .env` 전달)

## 원클릭 실행 (권장)

- `make all-in-one` 또는 `bash scripts/run_all_in_one.sh`
  - 자동으로 빌드 → MLPerf → MMLU → 리포트까지 실행합니다.
  - 사전 준비: `.env`에 `HUGGINGFACE_TOKEN` 설정, Docker GPU 사용 가능 환경
