## kcloud-mlperf — Kubernetes LLM Benchmark Suite (Llama 3.1 8B)

이 저장소는 Kubernetes 위에서 **Llama 3.1 8B(Instruct)** 모델로 아래 3가지 워크로드를 돌려 “클러스터가 제대로 붙었는지 / GPU가 잡히는지 / 모델이 정상 동작하는지”를 빠르게 확인할 수 있게 만든 스크립트 모음입니다.

- **MLPerf 스타일 요약 벤치**: CNN/DailyMail test split 요약 → ROUGE-L 계산
- **MMLU-Pro**: TIGER-Lab/MMLU-Pro 평가 → 정확도 계산
- **LLM Inference sanity**: 단일 프롬프트 생성 테스트

> 실사용 팁: 항상 `--smoke`로 먼저 10샘플 스모크를 통과시키고, 그 다음 풀 데이터로 올리는 게 제일 안전합니다.

---

## 핵심 스크립트(이 README 기준)

- **End-to-end (추천)**: `scripts/bootstrap_cluster_and_bench.sh`
  - 마스터(kubeadm) 셋업 → 워커 셋업/조인 → GPU 플러그인/RuntimeClass → 벤치 실행까지 한 번에 진행
  - 워커 목록은 `config/workers.txt` 한 파일로 관리
- **벤치만 실행(클러스터 이미 있음)**: `scripts/run_benchmarks.sh`
  - MLPerf / MMLU / Inference를 선택 실행
  - 결과/로그를 `results/<RUN_ID>/`에 저장

보조 스크립트:
- `scripts/setup_master_node.sh`: 마스터 노드 설치/초기화 (kubeadm, flannel 등)
- `scripts/setup_worker_node.sh`: 워커 노드 설치 (containerd, NVIDIA toolkit, kubelet 등)

---

## 요구 사항

### 공통
- OS: Ubuntu 22.04 권장
- Kubernetes: kubeadm 기반(v1.28 계열)
- 외부 네트워크: 기본 스크립트는 **파드 안에서** `pip install`, HuggingFace 모델 다운로드, dataset 다운로드를 수행합니다.
  - 사내망/방화벽 환경이면 `pypi.org`, `huggingface.co`, `cdn-lfs.huggingface.co` 접근이 가능해야 합니다.

### GPU 워커 노드
- NVIDIA GPU (예: A30 24GB)
- NVIDIA 드라이버 설치(이미 설치되어 있으면 스킵됨)

---

## HuggingFace 토큰 준비

1) 토큰 발급: `https://huggingface.co/settings/tokens` (read 권한)  
2) 모델 접근 승인: `meta-llama/Llama-3.1-8B-Instruct` 페이지에서 라이선스 수락  
3) 실행 시 환경변수로 주입:

```bash
export HF_TOKEN="hf_..."
```

스크립트는 `mlperf` 네임스페이스에 `hf-token` 시크릿을 만들거나(또는 placeholder면) 갱신합니다.

---

## 워커 노드 목록 파일(`config/workers.txt`)

워커를 늘리거나 줄일 때는 이 파일만 수정하면 됩니다.

형식:
- 한 줄에 **1 워커**
- `#`로 주석 가능
- `user@host` 또는 `host`(user 기본값 `kcloud`)
- SSH 옵션을 뒤에 그대로 붙일 수 있음(포트 포함)

예시:

```text
# user@host
kcloud@129.254.202.129 -p 122

# host only (defaults to user 'kcloud')
# 129.254.202.130
```

---

## 1) 전부 다 한 번에 (bare-metal → smoke)

마스터 노드에서 실행합니다.

```bash
cd /home/jungwooshim/kcloud-mlperf
HF_TOKEN=hf_... ./scripts/bootstrap_cluster_and_bench.sh --smoke
```

### 동작 요약
- 마스터: kubeadm init + CNI 설치(기본 flannel) + join command 생성
- 워커: setup → (필요 시) reset/clean → join
- GPU: NVIDIA device plugin 배포 + `RuntimeClass nvidia` 생성
- 벤치: `run_benchmarks.sh --smoke` 실행

### “다시 돌릴 때” 주의
기본값으로 `MASTER_CLEAN=1`, `WORKER_CLEAN=1`이 동작해 **기존 kubeadm 상태/CNI 흔적을 지우고** 다시 만듭니다(데모/재현 목적).

- 클린업 끄기:

```bash
MASTER_CLEAN=0 WORKER_CLEAN=0 HF_TOKEN=hf_... ./scripts/bootstrap_cluster_and_bench.sh --smoke
```

---

## 2) 전부 다 한 번에 (full data)

```bash
cd /home/jungwooshim/kcloud-mlperf
HF_TOKEN=hf_... ./scripts/bootstrap_cluster_and_bench.sh
```

> 풀 데이터는 수 시간 걸립니다(환경에 따라 8~10h). 스모크 통과 후 진행을 권장합니다.

---

## 3) 클러스터는 이미 있고, 벤치만 실행

```bash
cd /home/jungwooshim/kcloud-mlperf
HF_TOKEN=hf_... ./scripts/run_benchmarks.sh --smoke
```

### 개별 잡만 실행
- MLPerf만:

```bash
HF_TOKEN=hf_... ./scripts/run_benchmarks.sh --smoke --mlperf
```

- MMLU만:

```bash
HF_TOKEN=hf_... ./scripts/run_benchmarks.sh --smoke --mmlu
```

- Inference만:

```bash
HF_TOKEN=hf_... ./scripts/run_benchmarks.sh --smoke --inference
```

> `--smoke`를 빼면 full dataset 모드로 동작합니다.

---

## 4) 마스터/워커만 따로 셋업하고 싶을 때

### 마스터 셋업(로컬)

```bash
cd /home/jungwooshim/kcloud-mlperf
AUTO_YES=1 MASTER_CLEAN=1 ./scripts/setup_master_node.sh
```

### 워커 셋업(원격)

```bash
scp -P 122 ./scripts/setup_worker_node.sh kcloud@129.254.202.129:/tmp/
ssh -p 122 kcloud@129.254.202.129 "AUTO_YES=1 /tmp/setup_worker_node.sh"
```

그리고 마스터에서 join command 생성 후 워커에서 실행:

```bash
kubeadm token create --print-join-command
# 출력된 join 커맨드를 워커에서 sudo로 실행
```

---

## 결과/로그 저장 위치

`run_benchmarks.sh`는 실행마다 타임스탬프 디렉터리를 만들고, 잡별 로그/매니페스트/진단을 남깁니다.

예:

```text
results/20260112-152403/
  summary.txt
  mlperf-bench.log
  mlperf-bench-manifest.yaml
  mlperf-bench-diagnostics.log          # 실패 시에만 의미 있음
  mmlu-bench.log
  mmlu-bench-manifest.yaml
  inference-bench.log
  inference-bench-manifest.yaml
```

---

## 트러블슈팅(자주 나오는 것들)

### 1) Pod가 Pending에서 안 내려옴 (Insufficient GPU)

```bash
kubectl describe pod -n mlperf <pod>
kubectl describe node kcloud | grep -n "nvidia.com/gpu" -C2
kubectl logs -n kube-system -l name=nvidia-device-plugin-ds --tail=200
```

`nvidia-device-plugin` 로그에 `could not load NVML library`가 뜨면,
워커에서 아래를 한 번만 실행하면 대부분 해결됩니다:

```bash
ssh -p 122 kcloud@129.254.202.129 \
  "sudo nvidia-ctk runtime configure --runtime=containerd --set-as-default && \
   sudo systemctl restart containerd && \
   sudo systemctl restart kubelet"
kubectl delete pod -n kube-system -l name=nvidia-device-plugin-ds
```

### 2) pip install이 “Temporary failure in name resolution”로 실패

대부분 **kube-dns(CoreDNS) 엔드포인트가 비어있거나**, CNI가 꼬여서 kube-system 파드가 못 뜬 경우입니다.

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns -o wide
kubectl get endpoints -n kube-system kube-dns -o wide
```

### 3) CoreDNS가 ContainerCreating에 오래 걸림 / flannel cni0 IP 충돌

증상 예:
- `failed to set bridge addr: "cni0" already has an IP address different from 10.244.0.1/24`

이건 이전 CNI 흔적이 남아있는 경우가 많고, 지금 스크립트는 재실행 시 자동으로 정리하도록 되어 있습니다.
그래도 재발하면 아래로 확인/정리:

```bash
ip addr show cni0
sudo ip link delete cni0 2>/dev/null || true
sudo rm -rf /var/lib/cni/*
sudo systemctl restart containerd kubelet
```

---

## 참고(레거시 문서)

- `K8S_SETUP.md`, `MULTINODE_SETUP.md`는 작성 시점이 달라 일부 내용이 현재 스크립트와 다를 수 있습니다.
- 최신 흐름은 이 README와 `scripts/bootstrap_cluster_and_bench.sh`, `scripts/run_benchmarks.sh`를 기준으로 보세요.

