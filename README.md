# MLPerf_local_test (한국어 가이드)

Llama 3.1-8B 모델로 MLPerf 스타일 추론 벤치마크(서버/오프라인, 성능/정확도)와 MMLU 평가를 수행하는 파이프라인입니다. 10단계 전체 파이프라인을 “스모크(빠른 검증)”로 먼저 확인하고, 문제 없으면 전체 실행을 진행하도록 설계했습니다. 모든 산출물은 표준 디렉터리 구조와 HTML 리포트로 저장됩니다.

### 프로젝트 개요
- **무엇을 하는가**: 하나의 Docker 이미지로 Llama 3.1-8B에 대해 MLPerf Inference 스타일 벤치마크(서버/오프라인, 성능/정확도)와 MMLU를 자동 실행하고, 각 단계별로 일관된 `summary.json`과 사람이 읽기 쉬운 HTML 리포트를 생성합니다.
- **왜 필요한가**:
  - **재현성**: 팀·머신·환경이 달라도 동일한 결과를 도출하는 컨테이너 기반 실행
  - **빠른 검증**: 10단계 스모크로 파이프라인 이상 유무를 수 분 내 확인 후 풀런 진행
  - **일관 리포팅**: 결과를 공통 스키마(`summary.json`)와 리포트로 통합, 비교·아카이빙 용이
  - **운영 의사결정**: 모델/드라이버/하드웨어 변경이 지표(Throughput/Latency/ROUGE/MMLU)에 미치는 영향 추적
- **핵심 특징**:
  - Docker-only 2단계 UX: `docker build` → `docker run smoke/full`
  - vLLM 백엔드 사용, 메모리 안전 기본값과 권한/캐시 처리 내장
  - HF 토큰/캐시 자동 처리, 실패 시 원인 로그 노출
  - 한국어 우선 문서와 표준 결과 디렉터리 레이아웃(`results/<RUN_ID>/...`)

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

#### 스모크 스크립트 플래그(독립 실행/정교 제어)
환경변수 대신 CLI 플래그로도 동일한 제어가 가능합니다.

```bash
Usage: smoke_all_10.sh [options]
  --server-perf [0|1]     Server 성능 실행 (기본 1)
  --server-acc  [0|1]     Server 정확도 실행 (기본 1)
  --offline-perf [0|1]    Offline 성능 실행 (기본 1)
  --offline-acc  [0|1]    Offline 정확도 실행 (기본 1)
  --mmlu         [0|1]    MMLU 실행 (기본 1)
  --samples N             스모크 샘플 수 (기본 5)
  --fast                  보수적 메모리/배치(기본 ON 권장)
  --verbose               상세 로그(set -x)
```

예시:
- 10단계 모두 실행(샘플 5, 빠른 모드)
```bash
bash scripts/smoke_all_10.sh --server-perf 1 --server-acc 1 --offline-perf 1 --offline-acc 1 --mmlu 1 --samples 5 --fast --verbose
```
- 서버 성능만 실행
```bash
bash scripts/smoke_all_10.sh --server-perf 1 --server-acc 0 --offline-perf 0 --offline-acc 0 --mmlu 0 --samples 5 --fast
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

#### MLPerf 결과 정규화(summary.json)
- 스모크는 각 MLPerf 단계 완료 후 `scripts/mlperf_postprocess.py`로 `run.log`를 파싱하여
  `results/<RUN_ID>/mlperf/<case>/summary.json`을 생성합니다.
- 성능(throughput, latency, TTFT/TPOT)와 정확도(ROUGE; `evaluation.py`가 있을 경우 자동 계산)를
  하나의 JSON으로 정규화해 HTML 리포트 생성에 사용됩니다.

#### 전체 롤업
- 스모크 완료 후 전체 실행 결과를 간단 집계한 머신 판독용 롤업을 생성합니다.
  - `results/<RUN_ID>/rollup/run_rollup.json`

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

### Docker 권장 실행 (빌드 1회 + 런타임 마운트)
빌드는 1회만 수행하고, 스크립트는 마운트로 교체하여 빠르게 반복 실행할 수 있습니다.

```bash
# 1) 이미지 빌드
docker build -t mlbench -f docker/Dockerfile .

# 2) 스모크(10단계) 실행 예시 (메모리 세이프 캡 포함)
docker run --gpus all --rm --env-file .env \
  -e HF_HUB_ENABLE_HF_TRANSFER=1 \
  -e MKL_THREADING_LAYER=GNU -e MKL_SERVICE_FORCE_INTEL=1 \
  -e TORCHINDUCTOR_CACHE_DIR=/app/results/.torchinductor \
  -e MAX_LEN_USER=1024 -e GPU_MEM_UTIL=0.90 -e KV_CACHE_DTYPE=fp8 \
  -e SMOKE_PROMPT_TOKENS=128 -e SMOKE_MAX_NEW_TOKENS=4 \
  -v "$(pwd)/results:/app/results" \
  -v "$(pwd)/.hf_cache:/app/.cache/huggingface" \
  -v "$(pwd)/scripts/smoke_all_10.sh:/app/scripts/smoke_all_10.sh:ro" \
  -v "$(pwd)/inference-master/language/llama3.1-8b/SUT_VLLM.py:/app/inference-master/language/llama3.1-8b/SUT_VLLM.py:ro" \
  -v "$(pwd)/inference-master/language/llama3.1-8b/download_cnndm.py:/app/inference-master/language/llama3.1-8b/download_cnndm.py:ro" \
  --entrypoint /bin/bash mlbench -c \
  "bash /app/scripts/smoke_all_10.sh --server-perf 1 --server-acc 1 --offline-perf 1 --offline-acc 1 --mmlu 1 --samples 5 --fast --verbose"
```

엔트리포인트(`smoke`/`all-in-one`)를 직접 사용할 수도 있으나, 개발 중에는 위와 같이 스크립트를 마운트한 뒤 `--entrypoint /bin/bash`로 실행하는 편이 빠릅니다.

#### 전체 샘플(13,368) 실행 권장 설정
전체 실행 시에는 `MAX_LEN_USER`를 더 크게 주는 것이 안전합니다. 24GB GPU 기준 아래 설정을 추천합니다.

```bash
docker run --gpus all --rm --env-file .env \
  -e HF_HUB_ENABLE_HF_TRANSFER=1 \
  -e MKL_THREADING_LAYER=GNU -e MKL_SERVICE_FORCE_INTEL=1 \
  -e TORCHINDUCTOR_CACHE_DIR=/app/results/.torchinductor \
  -e MAX_LEN_USER=4096 -e GPU_MEM_UTIL=0.90 -e KV_CACHE_DTYPE=fp8 \
  -v "$(pwd)/results:/app/results" \
  -v "$(pwd)/.hf_cache:/app/.cache/huggingface" \
  -v "$(pwd)/scripts/run_all_in_one.sh:/app/scripts/run_all_in_one.sh:ro" \
  --entrypoint /bin/bash mlbench -c \
  "bash /app/scripts/run_all_in_one.sh --samples 13368 --verbose"
```

참고: 여러 GPU가 있는 경우, 여유 메모리가 가장 큰 GPU를 선택해 실행하면 안정성이 높습니다.

### 디렉터리 개요
- `scripts/smoke_all_10.sh`: 10단계 스모크(각 단계별 리포트 포함)
- `scripts/run_all_in_one.sh`: 스모크 기본값의 원클릭 실행
- `inference-master/...`: MLPerf 스타일 벤치 SUT/메인 로직
- `generate_report_from_json.py`: JSON → HTML 리포트 생성기(안전한 분기처리 적용)

문의/기여 환영합니다. 이 README만 보고도 토큰만 준비되었다면 스모크 → 올인원 순으로 바로 실행이 가능합니다.


