## kcloud-mlperf — Kubernetes LLM Benchmark Suite (Llama 3.1 8B)

Kubernetes 위에서 **Llama 3.1 8B(Instruct)** 모델로 아래 3가지 벤치마크를 실행하여 클러스터/GPU 환경을 검증하는 스크립트 모음입니다.

| 벤치마크 | 설명 | 공식 구현 |
|---------|------|----------|
| **MLPerf Inference** | CNN/DailyMail 요약 → ROUGE 스코어 | MLCommons 기반 |
| **MMLU-Pro** | 5-shot Chain-of-Thought 평가 → 정확도 | TIGER-Lab 공식 |
| **LLM Inference** | vLLM 처리량 테스트 | vLLM 백엔드 |

> **팁**: 항상 `--smoke`로 10샘플 테스트를 먼저 통과시키고, 풀 데이터로 올리세요.

---

## 프로젝트 구조

```
kcloud-mlperf/
├── benchmarks/                     # Python 벤치마크 스크립트
│   ├── mlperf_summarization.py     # MLPerf CNN/DailyMail (공식 평가)
│   ├── mmlu_pro_cot.py             # MMLU-Pro 5-shot CoT (공식 평가)
│   └── inference_throughput.py     # vLLM 처리량 테스트
├── k8s/
│   ├── 00-namespace.yaml           # mlperf 네임스페이스
│   └── jobs/                       # Kubernetes Job 템플릿
│       ├── mlperf-job.yaml
│       ├── mmlu-job.yaml
│       └── inference-job.yaml
├── scripts/
│   ├── run_benchmarks.sh           # 벤치마크 실행 (메인)
│   ├── bootstrap_cluster_and_bench.sh  # 클러스터 + 벤치 한번에
│   ├── setup_master_node.sh        # 마스터 노드 셋업
│   ├── setup_worker_node.sh        # 워커 노드 셋업
│   ├── install_nvidia_plugin.sh    # NVIDIA 플러그인 설치
│   └── deploy_to_worker.sh         # 워커 배포
├── config/
│   └── workers.txt                 # 워커 노드 목록
├── results/                        # 실행 결과 (자동 생성)
├── mlcommons_inference/            # 서브모듈 (MLCommons 공식)
└── mmlu_pro/                       # 서브모듈 (TIGER-Lab 공식)
```

---

## 핵심 스크립트

| 스크립트 | 용도 |
|---------|------|
| `scripts/bootstrap_cluster_and_bench.sh` | 마스터 셋업 → 워커 조인 → GPU 플러그인 → 벤치 실행 (End-to-end) |
| `scripts/run_benchmarks.sh` | 벤치마크만 실행 (클러스터가 이미 있을 때) |

---

## 요구 사항

### 공통
- OS: Ubuntu 22.04 권장
- Kubernetes: kubeadm 기반 (v1.28 계열)
- 네트워크: `pypi.org`, `huggingface.co`, `cdn-lfs.huggingface.co` 접근 필요

### GPU 워커 노드
- NVIDIA GPU (예: A30 24GB)
- NVIDIA 드라이버 설치됨

---

## HuggingFace 토큰 준비

1. 토큰 발급: https://huggingface.co/settings/tokens (read 권한)
2. 모델 라이선스 수락: https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct
3. 환경변수로 주입:

```bash
export HF_TOKEN="hf_..."
```

---

## 빠른 시작

### 1) 전체 셋업 + 스모크 테스트 (권장)

```bash
cd /home/jungwooshim/kcloud-mlperf
HF_TOKEN=hf_... ./scripts/bootstrap_cluster_and_bench.sh --smoke
```

### 2) 클러스터 있을 때, 벤치만 실행

```bash
# 스모크 테스트 (10샘플, ~15분)
HF_TOKEN=hf_... ./scripts/run_benchmarks.sh --smoke

# 풀 데이터 (8~10시간)
HF_TOKEN=hf_... ./scripts/run_benchmarks.sh
```

### 3) 개별 벤치마크만 실행

```bash
# MLPerf만
./scripts/run_benchmarks.sh --smoke --mlperf

# MMLU-Pro만
./scripts/run_benchmarks.sh --smoke --mmlu

# Inference만
./scripts/run_benchmarks.sh --smoke --inference
```

---

## 벤치마크 상세

### MLPerf Inference (`benchmarks/mlperf_summarization.py`)
- **데이터셋**: CNN/DailyMail test split (~11k 샘플)
- **메트릭**: ROUGE-1, ROUGE-2, ROUGE-L
- **백엔드**: vLLM (배치 추론)
- **통과 기준**: ROUGE-L ≥ 0.15

### MMLU-Pro (`benchmarks/mmlu_pro_cot.py`)
- **데이터셋**: TIGER-Lab/MMLU-Pro (~12k 문제)
- **방식**: 5-shot Chain-of-Thought (카테고리별 예시)
- **백엔드**: vLLM
- **통과 기준**: 정확도 ≥ 35%

### LLM Inference (`benchmarks/inference_throughput.py`)
- **테스트**: 단일 프롬프트 + 배치 처리량
- **백엔드**: vLLM
- **메트릭**: tokens/s

---

## 결과/로그 저장 위치

```
results/<RUN_ID>/
├── summary.txt                 # 전체 요약
├── mlperf-bench.log            # MLPerf 로그
├── mlperf-bench-manifest.yaml  # 실행된 Job YAML
├── mmlu-bench.log              # MMLU-Pro 로그
├── mmlu-bench-manifest.yaml
├── inference-bench.log         # Inference 로그
└── inference-bench-manifest.yaml
```

---

## 워커 노드 목록 (`config/workers.txt`)

```text
# user@host 형식
kcloud@129.254.202.129 -p 122

# 주석 처리로 비활성화
# kcloud@129.254.202.130
```

---

## 트러블슈팅

### Pod가 Pending (Insufficient GPU)

```bash
kubectl describe pod -n mlperf <pod>
kubectl logs -n kube-system -l name=nvidia-device-plugin-ds --tail=100
```

NVIDIA 런타임 재설정:

```bash
ssh kcloud@<worker> "sudo nvidia-ctk runtime configure --runtime=containerd && sudo systemctl restart containerd kubelet"
kubectl delete pod -n kube-system -l name=nvidia-device-plugin-ds
```

### DNS 오류 (pip install 실패)

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns -o wide
kubectl get endpoints -n kube-system kube-dns
```

### CNI 충돌 (cni0 IP 에러)

```bash
sudo ip link delete cni0 2>/dev/null || true
sudo rm -rf /var/lib/cni/*
sudo systemctl restart containerd kubelet
```

---

## 참고 문서

- `K8S_SETUP.md` - Kubernetes 수동 셋업 가이드
- `MULTINODE_SETUP.md` - 멀티노드 구성 가이드
- `mlcommons_inference/` - MLCommons 공식 구현 (서브모듈)
- `mmlu_pro/` - TIGER-Lab 공식 구현 (서브모듈)
