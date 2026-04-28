# LLM 성능평가 도구 설치/재배포/이관 발표자료 초안

---

## 1. 발표 목적

본 발표는 ETRI LLM 성능평가 도구(LLM Benchmarking Tool)의 설치 구조, 운영 체계, 재배포 절차, 저장소 이관 전략을 내부 기술팀에게 공유하고, 향후 운영 및 유지보수를 위한 공통 이해 기반을 마련하는 것을 목적으로 합니다.

**대상 청중**: 시스템 운영자, 인프라 엔지니어, 개발팀
**발표 시간**: 약 40~60분 (질의응답 포함)
**핵심 전달 사항**:
- 3노드 K8s 클러스터 기반 시스템 전체 구조 이해
- 설치 스크립트(00~07) 흐름과 각 단계 역할
- GitHub → Docker Hub → /home/kcloud 3-tier 재배포 흐름
- 현재 운영상 위험 요소 및 개선 방향
- 저장소 이관 시 고려사항

---

## 2. 전체 슬라이드 구성

| 번호 | 슬라이드 제목 | 분류 |
|------|-------------|------|
| S01 | 표지 | 표지 |
| S02 | 발표 목차 | 개요 |
| S03 | 시스템 개요 및 배경 | 개요 |
| S04 | 전체 아키텍처 구성 | 인프라 |
| S05 | 3노드 K8s 클러스터 구성 | 인프라 |
| S06 | 3-Tier 자산 구조: GitHub / Docker Hub / /home/kcloud | 인프라 |
| S07 | 설치 흐름 개요 (00~07 스크립트) | 설치 |
| S07-B | Kubespray 클러스터 프로비저닝 상세 | 설치 |
| S08 | 설치 단계별 상세 (00~03) | 설치 |
| S09 | 설치 단계별 상세 (04~07) | 설치 |
| S10 | 4개 애플리케이션 컴포넌트 구조 | 앱 구조 |
| S11 | 포트 30001 노출 구조 및 트래픽 흐름 | 네트워크 |
| S12 | NFS 스토리지 구조 | 스토리지 |
| S13 | 데이터베이스(PostgreSQL) 구성 | DB |
| S14 | 모니터링 스택 (Loki / Prometheus / Grafana / Alloy) | 모니터링 |
| S15 | 재배포 흐름: Frontend | 운영 |
| S16 | 재배포 흐름: Backend | 운영 |
| S17 | 핵심 설정 파일과 수정 포인트 (values.yaml) | 운영 |
| S18 | 현재 위험 요소 및 점검 사항 | 리스크 |
| S19 | 저장소 이관 전략 요약 | 이관 |
| S20 | 향후 과제 및 개선 방향 | 미래 |

---

## 3. 슬라이드별 상세 초안

---

### S01. 표지

**제목**: ETRI LLM 성능평가 도구
**부제목**: 설치 · 재배포 · 이관 발표자료
**발표자**: (발표자 이름 입력)
**날짜**: 2026년 3월

**목적**: 발표의 공식적인 시작을 알리고, 주제와 발표자를 명확히 소개

**핵심 메시지**:
- 시스템 명칭: ETRI LLM 성능평가 도구 (LLM Benchmarking Tool)
- 주관: 몬드리안 클라우드팀
- 대상: 내부 기술 이전 및 운영 인수인계용 자료

**넣을 표/그림/스크린샷 후보**:
- ETRI 또는 기관 로고
- 몬드리안AI 로고
- 배경: K8s 또는 클라우드 관련 일러스트

**발표 메모**:
> 인사 후 발표 목적과 대상을 간단히 언급. "오늘 발표는 이 시스템을 실제로 설치하고 운영하는 모든 분들이 전체 구조를 이해할 수 있도록 구성했습니다."

---

### S02. 발표 목차

**제목**: 발표 목차

**목적**: 청중이 발표 전체 흐름을 미리 파악하여 맥락을 갖고 청취할 수 있도록 안내

**핵심 메시지**:
1. 시스템 개요 및 전체 아키텍처
2. 설치 구조 및 스크립트 흐름
3. 애플리케이션 컴포넌트 구성
4. 재배포 및 운영 절차
5. 위험 요소 및 이관 전략

**넣을 표/그림/스크린샷 후보**:
- 목차 슬라이드 (번호 + 섹션 제목 리스트)
- 섹션별 색상 구분 아이콘

**발표 메모**:
> 목차를 보여주며 "크게 5개 영역으로 구성했고, 설치부터 운영, 이관까지 전 과정을 다룹니다"라고 안내.

---

### S03. 시스템 개요 및 배경

**제목**: 시스템 개요: ETRI LLM 성능평가 도구란?

**목적**: 이 시스템이 무엇인지, 왜 구축되었는지 배경 설명

**핵심 메시지**:
1. LLM(대형 언어 모델)의 성능을 평가하기 위한 전용 벤치마킹 플랫폼
2. ETRI(한국전자통신연구원) 요구에 맞게 설계된 맞춤형 솔루션
3. 사용자는 웹 UI(포트 30001)를 통해 모델 업로드, 데이터셋 선택, 평가 실행, 결과 확인 가능
4. Kubernetes 기반으로 확장성과 격리성 확보
5. GPU 가속(L40, A40) 환경에서 실제 LLM 추론 및 평가 수행

**넣을 표/그림/스크린샷 후보**:
- 시스템 사용 흐름 다이어그램 (사용자 → 웹 UI → 평가 결과)
- 스크린샷: 웹 프론트엔드 메인 화면 (추가 검증 필요)

**발표 메모**:
> "이 시스템의 핵심은 LLM을 실제 GPU 환경에서 돌려보고, 결과를 정량적으로 측정한다는 것입니다. 단순한 API 호출 테스트가 아닙니다."

---

### S04. 전체 아키텍처 구성

**제목**: 전체 시스템 아키텍처

**목적**: 시스템을 구성하는 모든 레이어(인프라, 앱, 스토리지, 모니터링)를 한 눈에 조망

**핵심 메시지**:
1. 인프라 레이어: 3노드 K8s 클러스터 (Kubespray 기반)
2. 애플리케이션 레이어: frontend / backend / k8s-api / k8s-operator 4개 컴포넌트
3. 스토리지 레이어: NFS (모델, 데이터셋, 결과물 저장) + PostgreSQL DB
4. 모니터링 레이어: Loki + Prometheus + Grafana + Alloy
5. 외부 접근: NodePort 30001 (프론트엔드), NodePort 30980 (백엔드 API)

**넣을 표/그림/스크린샷 후보**:
- 전체 아키텍처 다이어그램 (레이어 구조로 표현)
- 컴포넌트 간 통신 화살표 포함

**발표 메모**:
> "이 그림 하나를 이해하면 전체 시스템의 절반을 이해한 것입니다. 각 레이어를 앞으로 하나씩 자세히 설명하겠습니다."

---

### S05. 3노드 K8s 클러스터 구성

**제목**: 3노드 Kubernetes 클러스터 구성

**목적**: 물리 노드 구성과 역할 분담을 명확히 설명

**핵심 메시지**:
1. **node1** (10.254.177.41): CPU 전용 컨트롤 플레인 — etcd, kube-apiserver, kube-scheduler, kube-controller-manager 실행
2. **node2** (10.254.184.195): L40 GPU 워커 노드 + NFS 서버 — 모델/데이터셋/결과 파일 저장소 역할 겸임
3. **node3** (10.254.184.196): A40 GPU 워커 노드 — LLM 추론 워크로드 처리
4. 클러스터 프로비저닝: Kubespray (Ansible 기반 자동화)
5. GPU 오퍼레이터: NVIDIA GPU Operator로 드라이버 및 런타임 관리

**넣을 표/그림/스크린샷 후보**:
- 노드 구성 표 (IP, 역할, GPU 사양, 담당 역할)
- `kubectl get nodes -o wide` 출력 스크린샷 (추가 검증 필요)
- 물리 노드 배치 다이어그램

**발표 메모**:
> "node2가 NFS 서버와 GPU 워커를 겸하는 구조인데, 운영 부하 관점에서 나중에 분리를 검토할 수 있습니다."

| 노드 | IP | 역할 | GPU |
|------|----|------|-----|
| node1 | 10.254.177.41 | 컨트롤 플레인 (CPU) | 없음 |
| node2 | 10.254.184.195 | 워커 + NFS 서버 | L40 |
| node3 | 10.254.184.196 | 워커 | A40 |

---

### S06. 3-Tier 자산 구조: GitHub / Docker Hub / /home/kcloud

**제목**: 3-Tier 자산 구조 — 코드 · 이미지 · 배포 분리

**목적**: 소스코드, 컨테이너 이미지, 배포 자산이 각각 어디에 있는지 명확히 구분

**핵심 메시지**:
1. **GitHub** (`mondrian-cloudteam/etri-llm-exam-solution`): frontend/backend 소스코드 원본 저장소
2. **Docker Hub** (`mondrianai/` 네임스페이스): 빌드된 컨테이너 이미지 배포 레지스트리
3. **/home/kcloud**: 배포 인프라 자산 — Helm 차트, K8s 매니페스트, 설치 스크립트 (00~07)
4. 세 저장소가 분리되어 있으므로 이관 시 각각 독립적으로 처리 필요
5. 재배포 시 반드시 3-tier 순서 준수: 코드 수정 → 이미지 빌드/푸시 → 배포 자산 업데이트

**넣을 표/그림/스크린샷 후보**:
- 3-tier 분리 다이어그램 (GitHub → Docker Hub → /home/kcloud)
- 각 저장소의 실제 경로/URL 명시 표

**발표 메모**:
> "이 세 저장소의 분리를 이해하는 것이 재배포와 이관의 핵심입니다. 소스는 GitHub, 이미지는 Docker Hub, 배포 설정은 /home/kcloud에 있습니다."

---

### S07. 설치 흐름 개요 (00~07 스크립트)

**제목**: 설치 절차 전체 흐름 — 00번부터 07번까지

**목적**: 설치 자동화 스크립트 전체 흐름을 순서대로 파악

**핵심 메시지**:
1. 설치는 `/home/kcloud` 내 번호 순서대로 실행하는 쉘 스크립트로 자동화되어 있음
2. 00~07 총 8단계로 구성: 클러스터 접근 설정 → 네임스페이스 → 스토리지 → GPU → 모니터링 → 앱 배포
3. 각 단계는 독립적으로 실행 가능하나, 의존 순서를 반드시 준수해야 함
4. 06번과 07번 사이에 수동 작업 존재: `llm-evaluation` 네임스페이스 생성, `data-volume.yaml`, `database.yaml` 적용
5. 전체 설치 완료 후 `kubectl get pods -A` 로 상태 확인 권장

**넣을 표/그림/스크린샷 후보**:
- 설치 흐름 순서도 (화살표 포함 플로우차트)
- 단계별 스크립트명 + 한 줄 설명 표

**발표 메모**:
> "06번과 07번 사이에 수동 단계가 있습니다. 이 부분을 빠뜨리면 앱이 기동되지 않으니 반드시 체크리스트로 관리하세요."

```
00 → 01 → 02 → 03 → 04 → 05 → 06 → [수동] → 07
```

| 스크립트 | 역할 |
|---------|------|
| 00 | kubeconfig export (클러스터 접근 설정) |
| 01 | 네임스페이스 생성 |
| 02 | NFS Provisioner 설치 |
| 03 | NVIDIA GPU Operator 설치 |
| 04 | Loki 설치 (로그 수집) |
| 05 | Prometheus 설치 (메트릭 수집) |
| 06 | Alloy 설치 (에이전트) |
| [수동] | llm-evaluation ns 생성, data-volume.yaml, database.yaml 적용 |
| 07 | 애플리케이션 Helm 차트 배포 |

---

### S07-B. Kubespray 클러스터 프로비저닝 상세

**제목**: Kubernetes 클러스터 생성 — Kubespray 스크립트 흐름

**목적**: 클러스터 재구성/이전 시 사용하는 Kubespray 프로비저닝 스크립트와 핵심 설정을 설명

**핵심 메시지**:
1. 클러스터 프로비저닝 자산은 `/home/kcloud/etri-llm-deployments/kubespray/`에 위치
2. **99-conn-check.sh**: 모든 노드에 Ansible ping으로 SSH 연결 테스트 — 프로비저닝 전 필수 확인
3. **01-provision.sh**: `cluster.yml` 플레이북 실행 — K8s v1.28.12, Calico CNI, containerd, CoreDNS 자동 설치 (30~60분)
4. **install.sh** (`/home/kcloud/`): Ansible 설치 → hosts.yml 생성 → 연결 테스트 → 프로비저닝 일괄 실행하는 통합 스크립트
5. 프로비저닝 완료 후 `inventory/etri/artifacts/admin.conf`를 kubeconfig로 복사해야 kubectl 사용 가능

**넣을 표/그림/스크린샷 후보**:
- Kubespray 실행 흐름도 (install.sh → 99-conn-check.sh → 01-provision.sh)
- hosts.yml 노드 구조 다이어그램 (control_plane: node1, kube_node: node2+node3, etcd: node1)
- 핵심 설정값 표 (K8s 버전, CNI, 서비스 CIDR, Pod CIDR, 컨테이너 런타임)

**발표 메모**:
> "클러스터를 새 환경으로 이전할 때 이 Kubespray 스크립트를 사용합니다. hosts.yml의 IP와 비밀번호를 새 환경에 맞게 수정한 뒤 01-provision.sh를 실행하면 됩니다. 멱등성이 보장되므로 중간에 실패해도 재실행이 가능합니다."

| 설정 항목 | 현재 값 | 비고 |
|---|---|---|
| K8s 버전 | v1.28.12 | k8s-cluster.yml |
| CNI | Calico | kube_network_plugin |
| 컨테이너 런타임 | containerd | container_manager |
| 서비스 CIDR | 10.233.0.0/18 | kube_service_addresses |
| Pod CIDR | 10.233.64.0/18 | kube_pods_subnet |
| kube-proxy | IPVS | kube_proxy_mode |
| DNS | CoreDNS + NodeLocal | dns_mode, enable_nodelocaldns |

---

### S08. 설치 단계별 상세 (00~03)

**제목**: 설치 상세 — 클러스터 접근 · 네임스페이스 · 스토리지 · GPU

**목적**: 설치 초기 4단계(00~03)의 목적과 주의사항을 구체적으로 설명

**핵심 메시지**:
1. **00 - kubeconfig export**: 관리자 kubeconfig 파일을 환경에 설정하여 kubectl 명령 사용 가능하게 함
2. **01 - 네임스페이스 생성**: 모니터링(`monitoring`), 앱(`etri-llm` 또는 `llm-evaluation`) 등 필요한 네임스페이스 사전 생성
3. **02 - NFS Provisioner**: node2의 NFS 서버를 K8s StorageClass로 등록하여 PVC 동적 프로비저닝 활성화
4. **03 - GPU Operator**: NVIDIA GPU Operator 설치로 GPU 드라이버, 런타임, 모니터링 플러그인 자동 관리
5. 03 완료 후 `kubectl get pods -n gpu-operator` 로 GPU 플러그인 파드 정상 기동 확인 필요

**넣을 표/그림/스크린샷 후보**:
- 각 단계 실행 명령어 코드 블록
- NFS StorageClass 동작 원리 다이어그램
- GPU Operator 아키텍처 다이어그램 (추가 검증 필요)

**발표 메모**:
> "NFS Provisioner 설정 시 node2의 NFS export 경로가 정확히 일치해야 합니다. 경로 불일치가 가장 흔한 실패 원인입니다."

---

### S09. 설치 단계별 상세 (04~07)

**제목**: 설치 상세 — 모니터링 스택 · 수동 작업 · 앱 배포

**목적**: 설치 후반 4단계(04~07)와 중간 수동 작업의 목적과 주의사항 설명

**핵심 메시지**:
1. **04 - Loki**: 로그 집계 시스템 설치 (Grafana Loki 스택)
2. **05 - Prometheus**: 메트릭 수집 및 알림 시스템 설치 (kube-prometheus-stack 추정, 추가 검증 필요)
3. **06 - Alloy**: Grafana Alloy 에이전트 설치 (로그/메트릭 전달 에이전트)
4. **[수동 단계]**: `kubectl create namespace llm-evaluation`, `kubectl apply -f data-volume.yaml`, `kubectl apply -f database.yaml` 순서대로 실행
5. **07 - 앱 배포**: `helm upgrade --install app-chart ./app-chart -f values.yaml` 형태로 4개 컴포넌트 일괄 배포

**넣을 표/그림/스크린샷 후보**:
- 수동 단계 체크리스트 박스 형태로 표시
- 07번 Helm 배포 명령어 코드 블록
- 배포 완료 후 `kubectl get pods -n llm-evaluation` 예시 출력

**발표 메모**:
> "수동 단계는 별도 체크리스트로 문서화해두는 것을 강력히 권장합니다. 자동화 스크립트에 통합하는 것이 향후 과제입니다."

---

### S10. 4개 애플리케이션 컴포넌트 구조

**제목**: 애플리케이션 컴포넌트 구성 — 4개 서비스

**목적**: 앱을 구성하는 4개 컴포넌트의 역할과 이미지 정보를 명확히 설명

**핵심 메시지**:
1. **frontend**: 사용자 웹 UI (Vite/React, 내부 포트 5173), NodePort 30001로 외부 노출
2. **backend**: API 서버 (내부 포트 9999), NodePort 30980으로 외부 노출, DB 및 GPU 작업 조율
3. **k8s-api**: K8s 클러스터 관리 API (ClusterIP 내부 전용), K8s Job 생성/조회 담당
4. **k8s-operator**: K8s 커스텀 오퍼레이터, LLM 평가 Job의 생애주기 관리
5. 모든 이미지는 Docker Hub `mondrianai/` 네임스페이스에서 pull

**넣을 표/그림/스크린샷 후보**:
- 컴포넌트 관계도 (frontend → backend → k8s-api / k8s-operator)
- 이미지 태그 정보 표

**발표 메모**:
> "backend만 `:latest` 태그를 사용하고 있어 버전 추적이 어렵습니다. 이 부분은 위험 요소 슬라이드에서 다시 다루겠습니다."

| 컴포넌트 | 이미지 | 태그 | 노출 방식 |
|---------|--------|------|----------|
| frontend | jungwooshim/etri-cloud-frontend | v1.0.0 | NodePort 30001 |
| backend | jungwooshim/etri-cloud-backend | latest | NodePort 30980 |
| k8s-api | mondrianai/etri-llm-k8s-api | v1.0.0 | ClusterIP (내부) |
| k8s-operator | mondrianai/etri-llm-k8s-operator | v1.0.1 | ClusterIP (내부) |

---

### S11. 포트 30001 노출 구조 및 트래픽 흐름

**제목**: 사용자 트래픽 흐름 — 포트 30001부터 백엔드까지

**목적**: 사용자 요청이 어떤 경로로 처리되는지 네트워크 흐름을 시각적으로 설명

**핵심 메시지**:
1. 사용자 브라우저 → `http://10.254.184.195:30001` (node2 NodePort) → frontend 파드 (포트 5173)
2. frontend 내부에 백엔드 API 주소가 **하드코딩**: `http://10.254.184.195:30980/api`
3. frontend → NodePort 30980 → backend 파드 (포트 9999)
4. backend → PostgreSQL DB (llm-evaluation 네임스페이스 내부 ClusterIP)
5. backend → k8s-api (ClusterIP) → K8s Job 생성/관리

**넣을 표/그림/스크린샷 후보**:
- 트래픽 흐름 다이어그램 (왼쪽에서 오른쪽으로 화살표)
- NodePort 동작 원리 간략 도식
- frontend 코드 내 하드코딩 URL 스크린샷 (추가 검증 필요)

**발표 메모**:
> "frontend에 IP가 하드코딩되어 있다는 점이 중요합니다. node2 IP가 바뀌면 이미지를 다시 빌드해야 합니다. 환경 변수로 분리하는 것이 개선 방향입니다."

```
[사용자]
    |
    v
http://10.254.184.195:30001   (NodePort → frontend:5173)
    |
    v  (하드코딩된 URL)
http://10.254.184.195:30980/api  (NodePort → backend:9999)
    |
    +---> PostgreSQL (ClusterIP)
    +---> k8s-api (ClusterIP) ---> k8s-operator
```

---

### S12. NFS 스토리지 구조

**제목**: NFS 스토리지 구조 — 모델 · 데이터셋 · 결과물 저장

**목적**: NFS 기반 공유 스토리지 구조와 각 용도별 경로를 설명

**핵심 메시지**:
1. NFS 서버: node2 (10.254.184.195) 에서 운영
2. K8s NFS Provisioner를 통해 StorageClass 및 PVC 자동 프로비저닝
3. 주요 저장 대상: LLM 모델 파일, 평가 데이터셋, 평가 결과 파일
4. `data-volume.yaml`: NFS 기반 PersistentVolume / PersistentVolumeClaim 정의 (수동 적용)
5. NFS 경로 및 export 설정은 node2 서버에서 별도 관리 (추가 검증 필요)

**넣을 표/그림/스크린샷 후보**:
- NFS 스토리지 다이어그램 (node2 NFS ↔ K8s PVC ↔ 파드)
- `kubectl get pv,pvc -n llm-evaluation` 예시 출력 (추가 검증 필요)
- data-volume.yaml 핵심 필드 코드 블록

**발표 메모**:
> "NFS가 단일 장애점(SPOF)임을 인지해야 합니다. node2에 장애가 생기면 모델 파일 접근 불가로 평가 자체가 중단됩니다."

---

### S13. 데이터베이스(PostgreSQL) 구성

**제목**: PostgreSQL 데이터베이스 구성

**목적**: DB 배포 방식과 역할을 설명하고, 데이터 보호 관련 주의사항 공유

**핵심 메시지**:
1. PostgreSQL은 `llm-evaluation` 네임스페이스 내 K8s 파드로 운영
2. `database.yaml` 매니페스트로 Deployment + Service + PVC 형태로 배포 (수동 적용)
3. 저장 데이터: 평가 작업 메타데이터, 사용자 정보, 평가 결과 레코드 등 (추가 검증 필요)
4. 데이터 영속성: NFS PVC 마운트로 파드 재시작 시에도 데이터 유지
5. **현재 위험**: 비밀번호가 평문(Plaintext)으로 설정 파일에 노출되어 있음

**넣을 표/그림/스크린샷 후보**:
- `database.yaml` 핵심 구조 코드 블록 (비밀번호 마스킹 처리)
- K8s Secret 전환 방법 간략 도식
- DB 연결 흐름 다이어그램 (backend → PostgreSQL ClusterIP)

**발표 메모**:
> "비밀번호 평문 저장은 현재 가장 급하게 개선해야 할 보안 이슈입니다. K8s Secret으로 전환하는 것이 최우선 개선 과제입니다."

---

### S14. 모니터링 스택 (Loki / Prometheus / Grafana / Alloy)

**제목**: 모니터링 스택 구성 — 로그 · 메트릭 · 대시보드 · 에이전트

**목적**: 4개 모니터링 컴포넌트의 역할과 상호 관계를 설명

**핵심 메시지**:
1. **Loki**: 파드 로그 집계 및 저장 (로그 백엔드)
2. **Prometheus**: 클러스터 및 앱 메트릭 수집, 알림 규칙 관리
3. **Grafana**: Loki/Prometheus 데이터를 시각화하는 대시보드 UI
4. **Alloy**: Grafana Alloy 에이전트, 각 노드에서 로그/메트릭 수집 후 Loki/Prometheus로 전달
5. 모니터링 컴포넌트는 `monitoring` 네임스페이스에 배포 (추가 검증 필요)

**넣을 표/그림/스크린샷 후보**:
- 모니터링 스택 데이터 흐름 다이어그램
- Grafana 대시보드 스크린샷 (추가 검증 필요)
- 컴포넌트별 역할 요약 표

**발표 메모**:
> "GPU 메트릭(GPU 사용률, VRAM 사용량)이 Prometheus로 수집되고 있는지 반드시 확인이 필요합니다. GPU Operator가 정상 설치된 경우 DCGM Exporter가 자동으로 메트릭을 노출합니다."

| 컴포넌트 | 역할 | 주요 포트 |
|---------|------|---------|
| Loki | 로그 집계/저장 | 3100 (추가 검증 필요) |
| Prometheus | 메트릭 수집/알림 | 9090 (추가 검증 필요) |
| Grafana | 시각화 대시보드 | 3000 (추가 검증 필요) |
| Alloy | 수집 에이전트 | - |

---

### S15. 재배포 흐름: Frontend

**제목**: Frontend 재배포 절차

**목적**: frontend 코드 변경 후 실제 서비스에 반영하는 전체 절차를 단계별로 설명

**핵심 메시지**:
1. GitHub `mondrian-cloudteam/etri-llm-exam-solution` 에서 frontend 코드 수정 및 PR 머지
2. Docker 이미지 빌드: `docker build -t mondrianai/etri-llm-frontend:v1.x.x .`
3. Docker Hub 푸시: `docker push mondrianai/etri-llm-frontend:v1.x.x`
4. `/home/kcloud/app-chart/values.yaml` 에서 frontend 이미지 태그를 새 버전으로 업데이트
5. Helm 업그레이드 실행: `helm upgrade app-chart ./app-chart -f values.yaml -n llm-evaluation`

**넣을 표/그림/스크린샷 후보**:
- Frontend 재배포 파이프라인 순서도
- values.yaml 이미지 태그 수정 전/후 diff 예시
- `kubectl rollout status deployment/frontend -n llm-evaluation` 확인 명령

**발표 메모**:
> "현재 CI/CD 파이프라인이 없어 모든 단계가 수동입니다. GitHub Actions 등으로 자동화하는 것이 향후 과제입니다."

```
GitHub 코드 수정
    ↓
docker build + push to Docker Hub
    ↓
values.yaml 태그 업데이트 (/home/kcloud)
    ↓
helm upgrade
    ↓
kubectl rollout status 확인
```

---

### S16. 재배포 흐름: Backend

**제목**: Backend 재배포 절차

**목적**: backend 코드 변경 후 재배포 절차와 `:latest` 태그 사용 시 주의사항 설명

**핵심 메시지**:
1. GitHub에서 backend 코드 수정 후 이미지 빌드: `docker build -t mondrianai/etri-llm-backend:latest .`
2. **주의**: backend는 `:latest` 태그 사용 — 이미지 pull 정책이 `Always` 가 아니면 새 이미지가 반영되지 않을 수 있음
3. Docker Hub 푸시 후 파드 강제 재시작 필요: `kubectl rollout restart deployment/backend -n llm-evaluation`
4. k8s-api, k8s-operator 재배포도 동일한 흐름 (각각 버전 태그 사용)
5. 재배포 후 로그 확인: `kubectl logs -f deployment/backend -n llm-evaluation`

**넣을 표/그림/스크린샷 후보**:
- Backend 재배포 순서도
- `:latest` 태그 위험성 설명 박스 (강조 처리)
- imagePullPolicy 설정 코드 블록

**발표 메모**:
> "`:latest` 태그의 가장 큰 문제는 어떤 버전이 실제로 실행 중인지 알 수 없다는 점입니다. 즉시 버전 태그로 전환할 것을 권장합니다."

---

### S17. 핵심 설정 파일과 수정 포인트 (values.yaml)

**제목**: 핵심 설정 파일 — app-chart/values.yaml

**목적**: 재배포 및 운영 시 가장 자주 수정하게 되는 values.yaml 구조와 수정 포인트 안내

**핵심 메시지**:
1. 위치: `/home/kcloud/app-chart/values.yaml`
2. 주요 수정 항목: 이미지 태그(버전 변경 시), NodePort 번호, 환경변수, 리소스 요청/제한 값
3. 템플릿 변수 주의: `.global.environment` 와 `.global.namespace` 등 전역 변수 혼용 오류 발생 이력 있음
4. 네임스페이스 설정: `etri-llm` vs `llm-evaluation` 혼용 주의 — 실제 배포 네임스페이스와 반드시 일치해야 함
5. 변경 후 반드시 `helm template` 으로 렌더링 결과 사전 검증 권장

**넣을 표/그림/스크린샷 후보**:
- values.yaml 주요 섹션 코드 블록 (이미지, 포트, 환경변수 부분)
- 수정 포인트 강조 표 (항목명, 현재 값, 수정 방법)
- `helm template` 검증 명령어 예시

**발표 메모**:
> "values.yaml 한 파일에서 4개 컴포넌트를 모두 제어합니다. 수정 전 항상 `helm template --debug` 로 렌더링 결과를 확인하세요."

---

### S18. 현재 위험 요소 및 점검 사항

**제목**: 현재 운영 위험 요소 및 점검 사항

**목적**: 현재 확인된 위험 요소를 우선순위와 함께 명시하여 개선 계획 수립 기반 마련

**핵심 메시지**:
1. **[높음] 비밀번호 평문 노출**: DB 접속 정보가 설정 파일에 평문으로 기재 → K8s Secret으로 즉시 전환 필요
2. **[높음] 하드코딩된 IP 주소**: frontend 코드 내 `10.254.184.195` 하드코딩 → IP 변경 시 이미지 재빌드 필요
3. **[중간] backend `:latest` 태그**: 버전 추적 불가, 의도치 않은 버전 배포 위험 → 버전 태그 전환 필요
4. **[중간] 네임스페이스 혼용**: `etri-llm` vs `llm-evaluation` 혼용으로 설정 오류 가능성 → 표준화 필요
5. **[높음] 볼륨 마운트 경로 불일치**: Backend WORKDIR(`/usr/src/app`)과 Helm 템플릿 mountPath(`/app/mnt/`) 불일치 → 모델/데이터셋 미표시 → 수정 완료
6. **[낮음] 템플릿 변수 오류**: Helm 템플릿 내 `.global.environment` vs `.global.namespace` 혼용 이력 → 정기 검증 필요

**넣을 표/그림/스크린샷 후보**:
- 위험 요소 요약 표 (위험항목, 위험도, 영향, 개선방안)
- 신호등 색상(빨강/노랑/녹색) 위험도 시각화

**발표 메모**:
> "이 중 비밀번호 평문 노출은 보안 감사 시 즉각 지적될 사항이므로 가장 먼저 처리해야 합니다."

| 위험 항목 | 위험도 | 영향 | 권장 조치 |
|---------|--------|------|---------|
| DB 비밀번호 평문 노출 | 높음 | 보안 침해 | K8s Secret 전환 |
| 하드코딩된 IP | 높음 | 재빌드 필요 | 환경변수 분리 |
| backend :latest 태그 | 중간 | 버전 추적 불가 | 버전 태그 사용 |
| 네임스페이스 혼용 | 중간 | 배포 오류 | 표준화 |
| 볼륨 마운트 경로 불일치 | 높음 | 모델/데이터셋 미표시 | mountPath 수정 (해결됨) |
| 템플릿 변수 혼용 | 낮음 | 렌더링 오류 | 정기 검증 |

---

### S19. 저장소 이관 전략 요약

**제목**: 저장소 이관 전략 — 3-Tier 각각의 이관 방법

**목적**: 시스템 이관(조직 변경, 인프라 이전 등) 시 각 저장소별 처리 방법을 명확히 안내

**핵심 메시지**:
1. **GitHub 이관**: `mondrian-cloudteam/etri-llm-exam-solution` → 대상 조직으로 repository transfer 또는 fork + 새 remote 설정
2. **Docker Hub 이관**: `mondrianai/` 네임스페이스 이미지 → 새 레지스트리(Docker Hub 신규 org 또는 Harbor, ECR 등)로 재태깅 후 푸시, values.yaml 이미지 경로 전면 업데이트 필요
3. **/home/kcloud 이관**: 전체 디렉토리를 tar로 압축 후 신규 배포 서버에 복사, kubeconfig 재설정 후 설치 스크립트 재실행
4. 이관 전 반드시 확인: DB 데이터 백업(pg_dump), NFS 데이터 스냅샷, 현재 실행 중인 이미지 태그 기록
5. 이관 후 검증: `kubectl get pods -A`, 포트 30001 접속 확인, 실제 평가 작업 테스트 실행 (추가 검증 필요)

**넣을 표/그림/스크린샷 후보**:
- 이관 체크리스트 표 (항목별 완료 박스)
- 3-tier 이관 단계 순서도

**발표 메모**:
> "이관 전 DB 백업이 가장 중요합니다. 평가 이력 데이터를 잃으면 복구가 불가능합니다."

---

### S20. 향후 과제 및 개선 방향

**제목**: 향후 과제 및 개선 방향

**목적**: 현재 시스템의 한계를 인정하고, 우선순위가 높은 개선 항목을 공유하여 후속 작업 계획 기반 마련

**핵심 메시지**:
1. **보안 강화**: K8s Secret 도입 (비밀번호), Network Policy 적용, RBAC 세분화
2. **CI/CD 자동화**: GitHub Actions 또는 Jenkins를 통한 빌드-푸시-배포 파이프라인 구성으로 수동 오류 제거
3. **하드코딩 제거**: frontend의 백엔드 URL을 환경변수(ConfigMap)로 분리, Ingress 도입 검토
4. **수동 설치 단계 자동화**: 06~07 사이의 수동 작업(네임스페이스 생성, yaml 적용)을 설치 스크립트에 통합
5. **고가용성(HA) 검토**: 단일 NFS SPOF 해소(Rook-Ceph 등 분산 스토리지 검토), 컨트롤 플레인 HA 구성 (추가 검증 필요)

**넣을 표/그림/스크린샷 후보**:
- 로드맵 타임라인 다이어그램 (단기/중기/장기 구분)
- 개선 항목 우선순위 매트릭스 (영향도 vs 구현 난이도)

**발표 메모**:
> "모든 개선을 한 번에 할 수는 없습니다. 보안(비밀번호 평문)과 CI/CD 자동화를 가장 먼저 처리하고, 나머지는 운영 안정화 후 순차적으로 진행하기를 권장합니다."

---

*본 문서는 발표 초안입니다. `추가 검증 필요` 로 표시된 항목은 실제 환경 확인 후 업데이트가 필요합니다.*
*최종 업데이트: 2026년 3월 11일*
