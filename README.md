# MLPerf_local_test (Docker 전용, 한국어 기본 README)

이 저장소는 LLaMA 3.1-8B의 MLPerf 스타일 추론 벤치마크와 MMLU 평가를 위한 Docker 전용 파이프라인을 제공합니다. 결과는 표준화된 디렉터리 구조로 저장되며, 원클릭 실행을 지원합니다.

## 준비
- GPU가 Docker 컨테이너에서 사용 가능해야 합니다: `--gpus all`
- `.env` 파일에 `HUGGINGFACE_TOKEN=` 값을 설정하세요 (샘플: `.env.sample`)

## 이미지 빌드
```bash
docker build -t mlbench -f docker/Dockerfile .
```

## 원클릭 실행 (권장)
- 한 번에 빌드 → MLPerf → MMLU → 리포트까지 실행:
```bash
make all-in-one
# 또는
bash scripts/run_all_in_one.sh
```

## 먼저 빠르게 전체 파이프라인 점검(스모크)
- 전체 실행 전에, 아주 적은 샘플로 10단계 파이프라인이 정상 동작하는지 먼저 확인하세요.
- 서버 성능/정확도, 오프라인 성능/정확도, MMLU까지 순차 실행하며 각 단계별 리포트를 생성합니다.

```bash
# 최소 샘플로 전체 10단계 검사
RUN_PERF_SERVER=1 RUN_ACC_SERVER=1 RUN_PERF_OFFLINE=1 RUN_ACC_OFFLINE=1 RUN_MMLU_SMOKE=1 \
SMOKE_FAST=1 SMOKE_SAMPLES=5 MMLU_LIMIT=20 FORCE_FREE_GPU=1 \
bash scripts/smoke_all_10.sh

# 문제가 없으면 전체 실행(올인원) 진행
bash scripts/run_all_in_one.sh
```

## 개별 실행 예시
- 드라이런(다운로드 없이 동작 경로만 확인):
```bash
docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mlperf --dry-run
docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mmlu --dry-run
```

- 실제 실행(새 RUN_ID 사용):
```bash
RID=$(date +%Y%m%d-%H%M%S)
docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mlperf --run-id "$RID" --accuracy
docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench mmlu   --run-id "$RID" --shots 5
docker run --rm -v $(pwd):/workspace mlbench report --run-id "$RID"
```

## 출력 경로
- 모든 산출물은 다음에 저장됩니다.
```
results/<YYYYmmdd-HHMMSS>/<task>/{raw,summary}/
```
- 최신 실행 링크: `results/latest` → 가장 최근 RUN_ID
- 각 작업 요약: `results/<RUN_ID>/<task>/summary/summary.json`
- 통합 요약: `results/<RUN_ID>/summary.json`, `results/<RUN_ID>/summary.md`
 - HTML 리포트: 각 작업 디렉터리에 `benchmark_report_*.html`

## 문서
- 한국어 가이드: `docs/README.ko.md`
- 영어 가이드: `docs/README.md`
- 트러블슈팅: `docs/troubleshooting.md`

## 주의사항
- 토큰은 절대 로그에 출력하지 않습니다. 누락 시 친절한 메시지와 함께 종료 코드 2로 종료합니다.
- GPU/드라이버가 없거나 권한 문제가 있으면 컨테이너 실행이 실패할 수 있습니다.

## 자주 사용하는 옵션
- `SMOKE_SAMPLES`: 스모크에서 사용할 샘플 수(기본 5)
- `MMLU_LIMIT`: MMLU 평가 샘플 상한(테스트 용도)
- `FORCE_FREE_GPU=1`: 실행 전 잔여 vLLM/벤치 프로세스 정리
- `RUN_PERF_SERVER/ACC_SERVER/PERF_OFFLINE/ACC_OFFLINE/RUN_MMLU_SMOKE`: 단계별 활성화 토글


