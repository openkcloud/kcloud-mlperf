## kcloud-mlperf — 쿠버네티스 LLM 벤치마크 (Llama 3.1 8B)

**마스터/워커 IP만 설정하면 바로 실행되는** bare-metal K8s 벤치마크 모음입니다.

| 벤치마크 | 설명 | 구현 |
|---|---|---|
| **MLPerf Inference** | CNN/DailyMail 요약 → ROUGE | **MLCommons 공식 LoadGen** |
| **MMLU-Pro** | 5-shot CoT 평가 → 정확도 | TIGER-Lab 공식 |
| **LLM Inference** | vLLM 처리량 테스트 | vLLM 백엔드 |

> **권장:** 항상 `--smoke`(10샘플) 먼저 통과 → 풀 데이터 실행

---

## ✅ 처음 사용자 3단계 (바로 실행)

### 0) 준비물
- Ubuntu 20.04/22.04 머신 2대 이상 (마스터 1 + GPU 워커 1+)
- 워커 노드에 NVIDIA 드라이버 설치
- HuggingFace 토큰 (Llama 3.1 라이선스 승인 필요)

### 1) 레포 받기 + 설정 파일 작성
```bash
git clone --recursive https://github.com/openkcloud/kcloud-mlperf.git
cd kcloud-mlperf

cp config/cluster.env config/cluster.env.local
nano config/cluster.env.local
```

`config/cluster.env.local` 예시:
```bash
MASTER_IP="129.254.202.181"
WORKER_IP="129.254.202.129"
WORKER_USER="kcloud"
WORKER_SSH_PORT="22"   # 필요 시 수정
HF_TOKEN="hf_..."
```

### 2) 클러스터 설치 (마스터 → 워커)
**마스터에서 실행:**
```bash
./scripts/setup_master.sh
```

**GPU 워커에서 실행:**
```bash
./scripts/setup_worker.sh
```

**워커가 조인된 후, 마스터에서 라벨링:**
```bash
kubectl get nodes
kubectl label node <워커노드이름> nvidia.com/gpu.present=true
```

### 3) 바로 실행
```bash
# 준비 상태 점검
./scripts/preflight.sh

# 스모크 테스트 (10샘플, ~15분)
./scripts/run_benchmarks.sh --smoke

# 전체 벤치마크 (8~10시간)
./scripts/run_benchmarks.sh
```

---

## 👇 이 레포에서 보면 되는 파일만

```
config/cluster.env(.local)   # IP, 계정, HF 토큰
scripts/setup_master.sh      # 마스터 설치
scripts/setup_worker.sh      # 워커 설치
scripts/preflight.sh         # 점검/자동수정
scripts/run_benchmarks.sh    # 실행
k8s/jobs/*.yaml              # 실제 실행되는 K8s Job
```

---

## 자주 쓰는 명령어

```bash
# 특정 벤치마크만 실행
./scripts/run_benchmarks.sh --smoke --mlperf
./scripts/run_benchmarks.sh --smoke --mmlu
./scripts/run_benchmarks.sh --smoke --inference

# 자동수정(마스터 IP 변경, 라벨 누락 등)
./scripts/preflight.sh --fix
./scripts/run_benchmarks.sh --smoke --fix
```

---

## 결과 위치

```
results/<RUN_ID>/
├── summary.txt
├── mlperf-bench.log
├── mlperf-bench-metrics.txt
├── mmlu-bench.log
└── inference-bench.log
```

---

## 간단 트러블슈팅

### 1) 클러스터 연결 안 됨
```bash
./scripts/preflight.sh --fix
sudo systemctl status kubelet
sudo crictl ps | grep kube-apiserver
```

### 2) GPU Pending
```bash
kubectl get nodes -o jsonpath='{.items[*].status.allocatable.nvidia\.com/gpu}'
kubectl logs -n kube-system -l name=nvidia-device-plugin-ds --tail=50
```

---

## 참고
- `mlcommons_inference/` : MLCommons 공식 구현(서브모듈)
- `mmlu_pro/` : TIGER-Lab 공식 구현(서브모듈)
