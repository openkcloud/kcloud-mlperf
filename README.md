# MLPerf_local_test (한국어 가이드)

Llama 3.1-8B 모델로 MLPerf 스타일 추론 벤치마크(서버/오프라인, 성능/정확도)와 MMLU 평가를 수행하는 파이프라인입니다. 10단계 전체 파이프라인을 “스모크(빠른 검증)”로 먼저 확인하고, 문제 없으면 전체 실행을 진행하도록 설계했습니다. 모든 산출물은 표준 디렉터리 구조와 HTML 리포트로 저장됩니다.

### 필수 준비물
- NVIDIA GPU + 드라이버, CUDA 런타임(로컬 실행 기준)
- 디스크 여유 공간: 모델 다운로드에 최소 30GB 이상 권장
- Hugging Face 토큰: Llama 3.1-8B 권한 필요
  - `.env` 파일에 아래와 같이 설정
    - `HUGGINGFACE_TOKEN=hf_xxx`

### 최초 설정
```bash
# 1) 토큰 준비 (.env 생성)
cp -n .env.sample .env 2>/dev/null || true
echo "HUGGINGFACE_TOKEN=hf_XXXXXXXXXXXXXXXX" >> .env  # 본인 토큰으로 교체

# 2) (선택) Hugging Face 로그인 캐시
huggingface-cli login  # 프롬프트에 토큰 입력
```

### 먼저: 빠른 스모크(10단계 전체 파이프라인의 최소 샘플 검증)
- 서버 성능 → 서버 정확도 → 오프라인 성능 → 오프라인 정확도 → MMLU 순서로 실행
- 각 단계별 HTML 리포트 생성, 메모리 세이프/소수 샘플로 즉시 확인 가능
- 최초 실행 시 모델이 자동 다운로드됩니다(토큰 필수)

```bash
# 최소 샘플(기본 5개)로 10단계 전체 검증
RUN_PERF_SERVER=1 RUN_ACC_SERVER=1 RUN_PERF_OFFLINE=1 RUN_ACC_OFFLINE=1 RUN_MMLU_SMOKE=1 \
SMOKE_FAST=1 SMOKE_SAMPLES=5 MMLU_LIMIT=20 FORCE_FREE_GPU=1 \
bash scripts/smoke_all_10.sh
```

### 그 다음: 올인원 실행(스모크 기본값 포함)
- 위 스모크 기본값으로 한 번에 실행하려면 아래만 실행해도 됩니다.
```bash
bash scripts/run_all_in_one.sh
```

### 올인원 스크립트 플래그(독립 실행/정교한 제어)
아래 플래그로 각 단계를 독립적으로 켜고 끄거나, 샘플 수/설정을 바꿀 수 있습니다.

```bash
Usage: run_all_in_one.sh [options]
  --server-perf [0|1]     Server 성능 실행 (기본 1)
  --server-acc  [0|1]     Server 정확도 실행 (기본 1)
  --offline-perf [0|1]    Offline 성능 실행 (기본 1)
  --offline-acc  [0|1]    Offline 정확도 실행 (기본 1)
  --mmlu         [0|1]    MMLU 실행 (기본 1)
  --samples N             MLPerf total-sample-count (기본 13368)
  --user-conf PATH        LoadGen user.conf (기본 user.conf)
  --verbose               상세 로그 (set -x)
  --help                  도움말
```

예시:
- 서버 성능만 전체 샘플로 실행
```bash
bash scripts/run_all_in_one.sh --server-acc 0 --offline-perf 0 --offline-acc 0 --mmlu 0
```
- 5,000 샘플로 전체 4단계(서버/오프라인, 성능/정확도) 실행
```bash
bash scripts/run_all_in_one.sh --samples 5000
```
- 정확도 전용(서버/오프라인) + 상세 로그
```bash
bash scripts/run_all_in_one.sh --server-perf 0 --offline-perf 0 --verbose
```

### 출력/결과 위치
- 모든 산출물은 다음에 저장됩니다.
```
results/<RUN_ID>/<task>/
  ├─ run.log, mlperf_log_*  # 원본 로그
  ├─ benchmark_report_*.html # HTML 리포트
  └─ 기타 JSON
```
- 최신 실행 링크: `results/latest` → 가장 최근 RUN_ID

### 자주 쓰는 환경 변수(스모크/안정성)
- `SMOKE_SAMPLES`: 스모크에서 사용할 샘플 수(기본 5)
- `MMLU_LIMIT`: MMLU 평가 샘플 상한(테스트 용)
- `FORCE_FREE_GPU=1`: 실행 전 잔여 vLLM/벤치 프로세스 정리
- `RUN_PERF_SERVER`/`RUN_ACC_SERVER`/`RUN_PERF_OFFLINE`/`RUN_ACC_OFFLINE`/`RUN_MMLU_SMOKE`: 단계별 활성화 토글
- 메모리 세이프 기본값(스크립트 내 지정)
  - `VLLM_MAX_MODEL_LEN=4096`, `VLLM_GPU_MEM_UTILIZATION=0.88~0.95`, `VLLM_ENFORCE_EAGER=1`

### 상세 로그와 리포트
- 실시간 로그 파일
  - `scripts/run_all_in_one.sh`: `results/<RUN_ID>/logs/run_all.log`
  - 각 단계 실행 로그: `results/<RUN_ID>/mlperf/<case>/run.log`, `results/<RUN_ID>/mmlu/lm_eval.log`
- HTML 리포트
  - 각 단계 완료 후 `benchmark_report_*.html` 자동 생성(가능한 경우)
  - MLPerf: `results/<RUN_ID>/mlperf/<case>/benchmark_report_*.html`
  - MMLU:   `results/<RUN_ID>/mmlu/benchmark_report_*.html`

### 토큰/캐시 관련
- 모델 캐시가 없으면 스크립트가 자동으로 `huggingface_hub.snapshot_download`를 호출합니다.
- 401 Unauthorized 발생 시:
  - `.env`의 `HUGGINGFACE_TOKEN` 값 확인(공백/따옴표 제거)
  - `export HUGGINGFACE_HUB_TOKEN=hf_xxx` 후 재실행
  - `huggingface-cli login`으로 1회 로그인

### 자주 겪는 문제와 해결
- OOM(CUDA out of memory):
  - 스모크 기본값(배치 1, 짧은 길이, 낮은 GPU mem util)으로 재시도
  - 다른 실행이 GPU 메모리를 점유 중일 수 있으므로 `FORCE_FREE_GPU=1` 사용
- INVALID(성능 제약 불충족):
  - 스모크는 샘플 수가 적어 조기 종료 조건을 충족하지 못할 수 있습니다(정상)
  - 전체 측정이 필요할 때는 샘플 수/지속 시간/목표 QPS를 늘리세요

### Docker 사용(선택 사항)
- 로컬 환경 대신 Docker로 통합 실행하려면 이미지를 빌드하세요.
```bash
docker build -t mlbench -f docker/Dockerfile .
```
- 컨테이너 실행 예(작업 디렉터리 마운트, 토큰 전달 필요):
```bash
docker run --gpus all --rm --env-file .env -v $(pwd):/workspace mlbench
```

### 디렉터리 개요
- `scripts/smoke_all_10.sh`: 10단계 스모크(각 단계별 리포트 포함)
- `scripts/run_all_in_one.sh`: 스모크 기본값의 원클릭 실행
- `inference-master/...`: MLPerf 스타일 벤치 SUT/메인 로직
- `generate_report_from_json.py`: JSON → HTML 리포트 생성기(안전한 분기처리 적용)

문의/기여 환영합니다. 이 README만 보고도 토큰만 준비되었다면 스모크 → 올인원 순으로 바로 실행이 가능합니다.


