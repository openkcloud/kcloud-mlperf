# ETRI LLM 모델 성능 평가 도구 - 사용자 가이드

## 목차

1. [시스템 소개](#1-시스템-소개)
2. [접속 방법](#2-접속-방법)
3. [성능 평가 (MLPerf) 사용법](#3-성능-평가-mlperf-사용법)
4. [멀티모달 평가 (MMLU-Pro) 사용법](#4-멀티모달-평가-mmlu-pro-사용법)
5. [모델 및 데이터셋 관리](#5-모델-및-데이터셋-관리)
6. [GPU 리소스 확인](#6-gpu-리소스-확인)
7. [로그 및 모니터링](#7-로그-및-모니터링)
8. [FAQ](#8-faq)

---

## 1. 시스템 소개

### 1.1 도구 목적

ETRI LLM 모델 성능 평가 도구는 대규모 언어 모델(LLM)의 품질과 성능을 체계적으로 측정하기 위한 웹 기반 도구입니다.

### 1.2 주요 기능

| 기능 | 설명 |
|------|------|
| **MLPerf 성능 평가** | MLPerf 벤치마크를 사용한 LLM 추론 성능 측정 (처리량, 지연 시간 등) |
| **MLPerf 정확도 평가** | ROUGE 스코어 기반 LLM 텍스트 생성 정확도 측정 |
| **MMLU-Pro 평가** | 다양한 학문 분야의 객관식 문제를 통한 LLM 지식 수준 평가 |
| **GPU 리소스 관리** | 사용 가능한 GPU 자동 인식, 평가별 GPU 할당 |
| **결과 기록 및 비교** | 모든 평가 결과 자동 저장, 이력 조회 및 비교 |
| **실행 로그 조회** | 평가 실행 중/후 실시간 로그 확인 |

### 1.3 평가 유형

#### MLPerf 평가 (MP-Exam)

MLPerf Inference 벤치마크를 기반으로 두 가지 모드를 지원합니다:

- **정확도(Accuracy) 모드**: 모델의 텍스트 생성 품질을 ROUGE 스코어(ROUGE-1, ROUGE-2, ROUGE-L, ROUGE-Lsum)로 측정합니다.
- **성능(Performance) 모드**: 초당 처리 샘플 수(SPS), 초당 토큰 수(TPS), 지연 시간(Latency) 등 추론 속도를 측정합니다.

시나리오:

- **Offline**: 전체 데이터셋을 한 번에 처리하는 방식. 최대 처리량 측정에 적합합니다.
- **Server**: 실시간 요청을 시뮬레이션하는 방식. 실제 서비스 환경의 성능을 측정합니다.

#### MMLU-Pro 평가 (MM-Exam)

Massive Multitask Language Understanding - Professional 벤치마크를 기반으로 LLM의 지식 수준을 평가합니다.
수학, 물리, 컴퓨터 과학, 법학 등 14개 학문 분야에 걸쳐 10지선다 문제를 출제합니다.

### 1.4 용어 정리

| 용어 | 설명 |
|------|------|
| **SPS** (Samples Per Second) | 초당 처리된 입력 샘플 수 |
| **TPS** (Tokens Per Second) | 초당 생성된 토큰 수 |
| **TTFT** (Time To First Token) | 첫 번째 토큰이 생성될 때까지의 시간 (Server 시나리오) |
| **TPOT** (Time Per Output Token) | 출력 토큰 1개당 소요 시간 (Server 시나리오) |
| **TT100T** (Time To 100 Tokens) | 100개 토큰 생성에 소요되는 시간 |
| **ROUGE** | 텍스트 요약 품질 지표 (ROUGE-1, ROUGE-2, ROUGE-L, ROUGE-Lsum) |
| **VRAM Peak** | 평가 중 최대 GPU 메모리 사용량 (GB) |
| **GPU Util** | 평가 중 평균 GPU 사용률 (%) |
| **Tensor Parallel** | 모델을 여러 GPU에 분할하여 병렬 처리 |
| **VALID/INVALID** | MLPerf 기준 충족 여부 (처리량이 목표 QPS를 만족하는지) |

---

## 2. 접속 방법

### 2.1 웹 UI 접속

브라우저에서 아래 주소로 접속합니다:

```
http://<서버_IP>:30001/
```

> **참고**: `<서버_IP>`는 Kubernetes 클러스터의 노드 IP 중 하나입니다 (컨트롤 플레인 또는 워커 노드 모두 가능).

### 2.2 지원 브라우저

- Google Chrome (권장)
- Mozilla Firefox
- Microsoft Edge

### 2.3 화면 구성

웹 UI는 좌측 사이드바와 메인 콘텐츠 영역으로 구성됩니다:

- **MLPerf 평가**: MLPerf 기반 성능/정확도 평가 관리
- **MLPerf 결과**: MLPerf 평가 결과 조회
- **MMLU-Pro 평가**: MMLU-Pro 기반 지식 평가 관리
- **MMLU-Pro 결과**: MMLU-Pro 평가 결과 조회

---

## 3. 성능 평가 (MLPerf) 사용법

### 3.1 평가 목록 조회

좌측 메뉴에서 **MLPerf 평가** 를 선택하면 기존 평가 목록을 볼 수 있습니다.

각 평가 항목에는 다음 정보가 표시됩니다:

| 항목 | 설명 |
|------|------|
| **이름** | 평가 식별 이름 |
| **모델** | 사용된 LLM 모델 (예: Llama-3.1-8B-Instruct) |
| **모드** | accuracy 또는 performance |
| **시나리오** | offline 또는 server |
| **GPU 타입** | 사용된 GPU 모델 (예: NVIDIA-L40-44GiB) |
| **상태** | Preparing / Running / Completed / Error |
| **시작 시간** | 평가 시작 시각 |

#### 상태별 의미

| 상태 | 의미 |
|------|------|
| **Preparing** | 평가 환경 준비 중 (컨테이너 생성, GPU 할당) |
| **Undefined** | 평가가 생성되었으나 아직 스케줄링 대기 중 |
| **Running** | 평가 실행 중 |
| **Completed** | 평가 정상 완료 |
| **Error** | 평가 실행 중 오류 발생 (error_log에서 상세 내용 확인 가능) |

### 3.2 새 평가 생성

평가 목록 화면에서 **생성** 또는 **+ 추가** 버튼을 클릭합니다.

#### 기본 설정

| 항목 | 설명 | 예시 값 |
|------|------|---------|
| **이름** | 평가를 식별할 이름 | `20260226-acc-off` |
| **설명** | 평가에 대한 설명 | `Llama 정확도 오프라인 테스트` |
| **모델** | NFS의 `/mnt/models/`에 있는 모델 선택 | `Llama-3.1-8B-Instruct` |
| **정밀도** | 모델 가중치 정밀도 | `bfloat16` |
| **프레임워크** | 추론 프레임워크 | `vllm` |

#### 평가 모드 설정

| 항목 | 설명 | 예시 값 |
|------|------|---------|
| **모드** | `accuracy` (정확도) 또는 `performance` (성능) | `accuracy` |
| **시나리오** | `offline` (배치) 또는 `server` (실시간) | `offline` |

#### 시나리오별 추가 설정

**Offline 시나리오**:

| 항목 | 설명 | 기본값 |
|------|------|--------|
| **Min Duration** | 최소 실행 시간 (ms) | `600000` (10분) |
| **Batch Size** | 한 번에 처리할 샘플 수 | `1` |

**Server 시나리오**:

| 항목 | 설명 | 기본값 |
|------|------|--------|
| **Min Duration** | 최소 실행 시간 (ms) | `120000` (2분) |
| **Target QPS** | 목표 초당 요청 수 | `0.5` |
| **Num Workers** | 동시 요청 워커 수 | `1` |

#### GPU 리소스 설정

| 항목 | 설명 | 예시 값 |
|------|------|---------|
| **GPU 타입** | 사용할 GPU 모델 선택 | `NVIDIA-L40-44GiB` |
| **GPU 수** | 할당할 GPU 개수 | `2` |
| **Tensor Parallel Size** | 텐서 병렬 분할 수 (GPU 수 이하) | `1` |
| **CPU 코어** | 할당할 CPU 코어 수 | `8` |
| **RAM 용량** | 할당할 메모리 (GB) | `16` |

#### 데이터셋 설정

| 항목 | 설명 | 예시 값 |
|------|------|---------|
| **데이터셋** | NFS의 `/mnt/datasets/`에 있는 파일 | `cnn_eval.json` |
| **데이터 수** | 사용할 샘플 수 (0 = 전체) | `0` |

#### 반복 설정

| 항목 | 설명 | 예시 값 |
|------|------|---------|
| **반복 횟수** | 평가를 몇 번 반복 실행할지 | `1` |

설정 완료 후 **생성** 버튼을 클릭하면 평가가 시작됩니다.

### 3.3 평가 진행 확인

평가가 생성되면 상태가 `Preparing` -> `Running` -> `Completed` 순으로 변경됩니다.

- 목록에서 실시간으로 상태를 확인할 수 있습니다.
- 평가 행을 클릭하면 상세 정보를 볼 수 있습니다.

> **소요 시간 안내**: 
> - 정확도(Accuracy) 평가: 약 5~20시간 (데이터셋 크기와 GPU에 따라 다름)
> - 성능(Performance) 평가: 최소 Min Duration 이상 + 준비 시간

### 3.4 평가 결과 조회

좌측 메뉴에서 **MLPerf 결과**를 선택합니다.

#### 정확도(Accuracy) 결과 항목

| 결과 항목 | 설명 |
|-----------|------|
| **ROUGE-1** | 단어 단위 일치율 (Unigram) |
| **ROUGE-2** | 연속 2단어 일치율 (Bigram) |
| **ROUGE-L** | 최장 공통 부분 수열 기반 일치율 |
| **ROUGE-Lsum** | 문장 단위 ROUGE-L 합산 |
| **VRAM Peak** | 최대 GPU 메모리 사용량 (GB) |
| **GPU Util** | 평균 GPU 사용률 (%) |
| **TT100T** | 100 토큰 생성 시간 (초) |

#### 성능(Performance) 결과 항목

| 결과 항목 | 설명 |
|-----------|------|
| **SPS** | 초당 처리 샘플 수 |
| **TPS** | 초당 토큰 처리 수 |
| **TPS Best** | 최대 TPS (최고 성능) |
| **Valid** | MLPerf 유효성 (`VALID` / `INVALID`) |
| **Latency** | 전체 지연 시간 (나노초) |
| **TTFT** | 첫 토큰 생성 시간 (Server 시나리오) |
| **TPOT** | 토큰당 출력 시간 (Server 시나리오) |
| **VRAM Peak** | 최대 GPU 메모리 사용량 (GB) |
| **GPU Util** | 평균 GPU 사용률 (%) |
| **TT100T** | 100 토큰 생성 시간 (초) |

#### 결과 해석 예시

**정확도 평가 결과**:
```
ROUGE-1: 38.84  |  ROUGE-2: 15.98  |  ROUGE-L: 24.54  |  ROUGE-Lsum: 35.88
VRAM Peak: 39.83 GB  |  GPU Util: 93.3%  |  TT100T: 1802.27s
```
- ROUGE 점수가 높을수록 생성 텍스트의 품질이 좋습니다.

**성능 평가 결과 (Offline)**:
```
SPS: 0.43  |  TPS: 55.48  |  Valid: VALID
VRAM Peak: 39.81 GB  |  GPU Util: 93.2%  |  TT100T: 1802.28s
```
- SPS/TPS가 높을수록 처리 속도가 빠릅니다.
- `VALID`는 MLPerf 기준을 충족했음을 의미합니다.

**성능 평가 결과 (Server)**:
```
SPS: 0.50  |  TPS: 64.48  |  Valid: INVALID
TTFT: 17.00s  |  TPOT: 13.94ms
VRAM Peak: 40.03 GB  |  GPU Util: 82.7%  |  TT100T: 1467.78s
```
- Server 시나리오에서는 TTFT(첫 토큰 시간)와 TPOT(토큰당 시간)가 중요합니다.
- `INVALID`는 Target QPS를 안정적으로 유지하지 못했음을 의미합니다.

### 3.5 결과 다운로드

평가 결과 상세 화면에서 **다운로드** 버튼을 클릭하면 원본 결과 파일을 다운로드할 수 있습니다:

- **결과 파일 (Result)**: 벤치마크 측정 결과 데이터
- **제출 파일 (Submission)**: MLPerf 제출 형식 데이터

### 3.6 평가 중지 / 삭제

- **중지**: 실행 중인 평가를 중단합니다. GPU 리소스가 해제됩니다.
- **삭제**: 평가 기록과 관련 결과를 삭제합니다.

---

## 4. 멀티모달 평가 (MMLU-Pro) 사용법

### 4.1 개요

MMLU-Pro 평가는 LLM의 학문적 지식 수준을 14개 분야에 걸쳐 평가합니다.

지원 분야: 수학(Math), 물리(Physics), 화학(Chemistry), 생물(Biology), 컴퓨터 과학(Computer Science), 법학(Law), 공학(Engineering), 경제(Economics), 역사(History), 심리학(Psychology), 경영(Business), 보건(Health), 철학(Philosophy), 기타(Other)

### 4.2 평가 생성

좌측 메뉴에서 **MMLU-Pro 평가** 를 선택하고 **생성** 버튼을 클릭합니다.

| 항목 | 설명 | 예시 값 |
|------|------|---------|
| **이름** | 평가 식별 이름 | `0122_01` |
| **설명** | 평가 설명 | `MMLU-Pro 전 분야 평가` |
| **모델** | LLM 모델 선택 | `Llama-3.1-8B-Instruct` |
| **정밀도** | 모델 가중치 정밀도 | `bfloat16` |
| **프레임워크** | 추론 프레임워크 | `vllm` |
| **과목** | 평가 분야 (`all` = 전체) | `all` |
| **데이터셋** | MMLU-Pro 데이터셋 | `mmlu-pro` |
| **N-Train** | Few-shot 학습 예시 수 | `1` |
| **GPU Util** | 목표 GPU 사용률 | `0.8` |
| **GPU 타입** | GPU 모델 | `NVIDIA-L40-44GiB` |
| **GPU 수** | GPU 개수 | `2` |
| **반복 횟수** | 반복 실행 수 | `5` |

### 4.3 결과 조회

좌측 메뉴에서 **MMLU-Pro 결과**를 선택합니다.

#### MMLU-Pro 결과 항목

| 결과 항목 | 설명 |
|-----------|------|
| **전체 정확도** | 모든 분야의 평균 정답률 (%) |
| **분야별 정확도** | 각 학문 분야별 정답률 |
| **반복별 결과** | 각 반복 실행의 개별 결과 |

> **소요 시간**: MMLU-Pro 전체 분야(`all`) 평가는 약 2~4일이 소요될 수 있습니다.

---

## 5. 모델 및 데이터셋 관리

### 5.1 모델 관리

평가에 사용할 LLM 모델은 NFS 스토리지의 `/mnt/models/` 디렉토리에 위치해야 합니다.

#### 현재 등록된 모델 확인

웹 UI의 평가 생성 화면에서 모델 드롭다운을 확인하거나, API를 통해 조회합니다:

```bash
curl http://<서버_IP>:30980/api/files/models
```

#### 새 모델 추가

NFS 서버(node2)에 SSH로 접속하여 모델을 추가합니다:

```bash
# NFS 서버 노드에서
cd /mnt/models/

# HuggingFace 모델 다운로드 예시
# (git-lfs 필요: apt install git-lfs)
git lfs install
git clone https://huggingface.co/<org>/<model-name>
```

또는 다른 노드에서 NFS 마운트를 통해 복사합니다:

```bash
# NFS 마운트 (다른 노드에서)
sudo mount -t nfs <NFS_서버_IP>:/mnt/models /mnt/models

# 모델 복사
cp -r /path/to/model /mnt/models/

# 마운트 해제
sudo umount /mnt/models
```

> **중요**: 모델 디렉토리명이 웹 UI에서 모델 선택 시 표시되는 이름입니다.

### 5.2 데이터셋 관리

평가 데이터셋은 NFS 스토리지의 `/mnt/datasets/` 디렉토리에 위치합니다.

#### 현재 등록된 데이터셋 확인

```bash
curl http://<서버_IP>:30980/api/files/datasets
```

#### 모델-데이터셋 매핑

어떤 모델에 어떤 데이터셋을 사용할 수 있는지는 설정 파일로 관리됩니다:

```bash
curl http://<서버_IP>:30980/api/files/settings
```

응답 예시 (`data` 부분):

```json
{
  "code": 200, "status": true, "message": "...",
  "data": {
    "mlperf": {
      "Llama-3.1-8B-Instruct": ["cnn_eval.json"]
    },
    "mmlu": {
      "Llama-3.1-8B-Instruct": ["mmlu-pro"]
    }
  }
}
```

이 매핑은 `/mnt/datasets/settings.json` 파일에서 관리됩니다. 새 모델이나 데이터셋을 추가한 경우 이 파일을 업데이트해야 합니다.

### 5.3 결과 데이터

평가 결과는 NFS의 `/mnt/results/` 디렉토리에 저장됩니다. 각 평가 실행별로 하위 디렉토리가 생성됩니다.

---

## 6. GPU 리소스 확인

### 6.1 웹 UI에서 확인

평가 생성 시 GPU 타입 드롭다운에서 사용 가능한 GPU 목록과 수량을 확인할 수 있습니다.

### 6.2 API를 통한 확인

```bash
# MLPerf 평가용 GPU 목록
curl http://<서버_IP>:30980/api/mp-exam/gpu-list

# MMLU-Pro 평가용 GPU 목록
curl http://<서버_IP>:30980/api/mm-exam/gpu-list
```

응답 예시:

```json
{"code":200,"status":true,"message":"...","data":{"gpus":[{"gpuModel":"NVIDIA-L40-44GiB","gpuCount":2},{"gpuModel":"NVIDIA-A40-44GiB","gpuCount":2}]}}
```

> **참고**: 모든 GPU가 평가 실행 중인 경우 `"data":{}` 로 빈 결과가 반환됩니다.

### 6.3 GPU 리소스 사용 시 주의사항

- 평가 실행 시 요청한 GPU가 해당 노드에서 독점적으로 할당됩니다.
- GPU 수가 2개인 노드에서 2개 GPU를 모두 사용하는 평가를 실행하면, 해당 노드에서 추가 평가를 실행할 수 없습니다.
- 동시에 여러 평가를 실행하려면 각 평가가 서로 다른 GPU 노드를 사용하도록 설정하세요.
- Tensor Parallel Size는 GPU 수 이하로 설정해야 합니다.

---

## 7. 로그 및 모니터링

### 7.1 평가 실행 로그

평가 실행 중 또는 완료 후, 상세 화면에서 실행 로그를 확인할 수 있습니다.
로그는 Loki를 통해 수집되며, Backend가 Loki API를 통해 조회합니다.

### 7.2 명령줄에서 로그 확인

```bash
# 실행 중인 평가 Pod 확인
kubectl get pods -n llm-evaluation

# 평가 Pod 로그 확인
kubectl logs -n llm-evaluation <평가_pod_이름> --tail=100

# 실시간 로그 스트리밍
kubectl logs -n llm-evaluation <평가_pod_이름> -f
```

### 7.3 시스템 모니터링

#### GPU 사용 현황 (노드에서 직접 확인)

```bash
# GPU 워커 노드에 SSH 접속 후
nvidia-smi

# 실시간 모니터링 (1초마다 갱신)
watch -n 1 nvidia-smi
```

#### 클러스터 상태

```bash
# 노드 상태
kubectl get nodes

# 전체 Pod 상태
kubectl get pods -n llm-evaluation

# 리소스 사용량
kubectl top nodes
kubectl top pods -n llm-evaluation
```

---

## 8. FAQ

### Q1: 평가 생성 시 모델 목록이 비어있습니다.

**원인**: `/mnt/models/` 디렉토리에 모델이 없거나, NFS 마운트에 문제가 있습니다.

**해결**: NFS 서버(node2)에서 모델 디렉토리를 확인하고, Backend Pod가 볼륨을 정상 마운트했는지 확인하세요.

```bash
# NFS 서버에서
ls -la /mnt/models/

# Backend Pod의 마운트 확인
kubectl exec -n llm-evaluation deployment/etri-llm-backend -- ls /usr/src/app/mnt/models/
```

### Q2: 평가가 Error 상태가 되었습니다.

**원인**: GPU 리소스 부족, 모델 로딩 실패, 메모리 부족 등 다양한 원인이 있을 수 있습니다.

**해결**: 평가 상세 화면에서 `error_log`를 확인하세요. 일반적인 원인별 조치:

| 에러 메시지 | 조치 |
|------------|------|
| `no nodes have enough resources` | 다른 GPU 타입을 선택하거나, 실행 중인 평가가 완료될 때까지 대기 |
| `Loki search failed` | Loki 서비스 상태 확인 (`kubectl get pods -n loki`) |
| `OOM` (Out of Memory) | RAM 또는 GPU 메모리 할당량을 늘리거나, 모델 정밀도를 낮추세요 |

### Q3: 평가가 Preparing 상태에서 멈춰있습니다.

**원인**: 컨테이너 이미지 다운로드 중이거나, GPU 리소스 할당 대기 중일 수 있습니다.

**해결**:

```bash
# 평가 Pod 상태 확인
kubectl describe pod -n llm-evaluation <평가_pod_이름>

# 이벤트 섹션에서 대기 원인 확인
# - 이미지 Pull 중: "Pulling image ..."
# - GPU 부족: "Insufficient nvidia.com/gpu"
```

### Q4: GPU가 하나만 표시됩니다.

**원인**: nvidia-device-plugin Pod가 일부 노드에서 정상 실행되지 않고 있을 수 있습니다.

**해결**: GPU Operator Pod 상태를 확인합니다.

```bash
kubectl get pods -n gpu-operator
# nvidia-device-plugin-daemonset-xxx 이 모든 GPU 노드에서 Running인지 확인
```

CrashLoopBackOff 상태라면, 해당 노드에서 `nvidia-persistenced` 서비스를 확인하세요.

### Q5: 동시에 여러 평가를 실행할 수 있나요?

**가능합니다**, 단 GPU 리소스가 충분한 경우에 한합니다.

- 각 GPU 노드에는 2개의 GPU가 있으므로, 1개 GPU를 사용하는 평가를 노드당 최대 2개 동시 실행할 수 있습니다.
- 서로 다른 GPU 타입(예: L40과 A40)을 선택하면 자동으로 다른 노드에 배치됩니다.

### Q6: 새 데이터셋을 추가하려면 어떻게 하나요?

1. NFS 서버의 `/mnt/datasets/` 디렉토리에 데이터셋 파일을 복사합니다.
2. `/mnt/datasets/settings.json` 파일을 편집하여 모델-데이터셋 매핑을 추가합니다.
3. 웹 UI에서 평가 생성 시 새 데이터셋이 선택 가능한지 확인합니다.

### Q7: 평가 결과 원본 파일은 어디에 있나요?

NFS 서버의 `/mnt/results/` 디렉토리에 각 평가별로 저장됩니다. 웹 UI의 결과 상세 화면에서도 다운로드할 수 있습니다.
