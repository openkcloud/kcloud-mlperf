# 몬드리안AI 용역 결과물 설치 및 재배포 가이드

> 작성 기준일: 2026-03-11 (최종 갱신)
> 작성 근거: `/home/kcloud` 디렉터리 내 실제 파일 분석 결과
> 대상 독자: 시스템 운영자, 재배포 담당자

---

## 1. 문서 목적과 범위

### 1.1 목적

본 문서는 몬드리안AI가 ETRI(한국전자통신연구원)에 납품한 LLM 평가 시스템의 **설치 절차**, **재배포 방법**, **운영 유의사항**을 운영자가 독립적으로 수행할 수 있도록 기술한 가이드다.

### 1.2 범위

| 항목 | 포함 여부 | 비고 |
|---|---|---|
| Kubernetes 클러스터 신규 설치 | 포함 | Kubespray 기반 |
| 인프라 컴포넌트 배포 (NFS, GPU Operator, Loki 등) | 포함 | Helm 기반 |
| 애플리케이션 신규 배포 | 포함 | app-chart Helm 기반 |
| 소스 수정 없이 이미지 재배포 | 포함 | values.yaml 수정 기준 |
| Frontend/Backend 소스 수정 후 빌드 및 재배포 | 부분 포함 | GitHub 저장소 접근 필요, 빌드 절차는 추가 검증 필요 |
| 모니터링 운영 상세 | 미포함 | 별도 운영 가이드 참조 |

### 1.3 문서 구조 안내

각 절은 다음 표식으로 정보 성격을 구분한다.

- **[확인됨]**: 실제 파일 분석을 통해 사실 확인된 내용
- **[절차]**: 운영자가 수행해야 하는 단계별 절차
- **[변경 포인트]**: 재배포 시 수정이 필요한 파일/항목
- **[주의]**: 알려진 위험 요소 또는 오류 가능성
- **[추가 검증 필요]**: 파일만으로는 확인 불가하여 운영자 또는 GitHub 저장소 확인이 필요한 사항

---

## 2. 현재 구조에 대한 핵심 전제

운영자가 반드시 이해해야 하는 구조적 전제 사항이다.

### 2.1 배포 자산과 애플리케이션 소스의 분리

| 구분 | 위치 | 역할 |
|---|---|---|
| 배포/인프라 자산 | `/home/kcloud` (본 서버) | Helm chart, Kubernetes YAML, 설치 스크립트 |
| 애플리케이션 소스 | GitHub: `https://github.com/mondrian-cloudteam/etri-llm-exam-solution` | Frontend/Backend 소스 코드 |
| 컨테이너 이미지 | Docker Hub (`jungwooshim/` 계정, 이전: `mondrianai/`) | 빌드된 이미지 |

> [확인됨] 이 서버에 애플리케이션 소스 코드가 `/home/kcloud/etri-llm-exam-solution/` 경로에 존재한다. Frontend는 `web/` 디렉터리, Backend는 `server/` 디렉터리에 위치한다.

### 2.2 이미지 갱신 방식

소스 코드를 수정하고 재배포하려면 다음 흐름이 필요하다.

```
GitHub 소스 수정 → Docker 이미지 빌드 → Docker Hub 푸시 → app-chart/values.yaml 이미지 태그 수정 → helm upgrade
```

### 2.3 현재 네임스페이스 구조

**[확인됨]** 실제 배포에 사용되는 네임스페이스는 아래와 같다.

| 네임스페이스 | 용도 |
|---|---|
| `monitoring` | Prometheus, Alloy |
| `etri-llm` | (01-create-ns.sh에서 생성, 현재 미사용 가능성 있음) |
| `gpu-operator` | NVIDIA GPU Operator |
| `loki` | Loki 로그 집계 |
| `nfs-provisioner` | NFS Subdir External Provisioner |
| `llm-evaluation` | 실제 애플리케이션 (Frontend, Backend, DB, K8s API, Operator) |

> [주의] `01-create-ns.sh`는 `etri-llm` 네임스페이스를 생성하지만, 실제 앱은 `llm-evaluation` 네임스페이스에 배포된다. `llm-evaluation`은 `redeploy_full.sh`에서 별도로 `kubectl create ns llm-evaluation` 명령으로 생성된다. 자세한 내용은 15절 참조.

---

## 3. 시스템 전체 구성 요약

### 3.1 노드 구성

**[확인됨]**

| 노드 | 역할 | IP | SSH 포트 | GPU |
|---|---|---|---|---|
| node1 | Control Plane (CPU) | 10.254.177.41 | 122 | 없음 |
| node2 | Worker + NFS 서버 | 10.254.184.195 | 122 | L40 |
| node3 | Worker | 10.254.184.196 | 122 | A40 |

### 3.2 스토리지 구성

**[확인됨]** NFS 서버는 node2(10.254.184.195)이며, 다음 경로를 공유한다.

| NFS 내보내기 경로 | Kubernetes PV 이름 | 마운트 용량 | Pod 내 마운트 경로 |
|---|---|---|---|
| `/mnt/models` | `model-nfs-pv` | 2Ti | `/usr/src/app/mnt/models/` (backend) |
| `/mnt/datasets` | `dataset-nfs-pv` | 2Ti | `/usr/src/app/mnt/datasets/` (backend) |
| `/mnt/results` | `results-nfs-pv` | 2Ti | `/usr/src/app/mnt/result/` (backend) |
| `/mnt/etri-llm-evaluation-postgres` | (database.yaml PV) | 100Gi | PostgreSQL 데이터 디렉터리 |

> [주의] NFS Provisioner values-override.yaml에 NFS 경로가 `etri-lllm-evaluation-nfs-server`(L이 3개)로 오타 기재되어 있다. 15절 참조.

### 3.3 애플리케이션 컴포넌트

**[확인됨]**

| 컴포넌트 | Docker 이미지 | 서비스 타입 | 외부 포트 | 내부 포트 |
|---|---|---|---|---|
| Frontend | `jungwooshim/etri-cloud-frontend:v1.0.0` | NodePort | 30001 | 5173 |
| Backend | `jungwooshim/etri-cloud-backend:latest` | NodePort | 30980 | 9999 |
| K8s API | `mondrianai/etri-llm-k8s-api:v1.0.0` | ClusterIP | 없음 | 9090 |
| K8s Operator | `mondrianai/etri-llm-k8s-operator:v1.0.1` | (webhook/metrics) | 없음 | 9443 / 8443 |

### 3.4 데이터베이스

**[확인됨]**

| 항목 | 값 |
|---|---|
| 이미지 | `postgres:15.4-alpine` |
| 서비스 호스트 | `etri-llm-db-service.llm-evaluation.svc.cluster.local` |
| 포트 | 5432 |
| 데이터베이스명 | `llmEvaluationDB` |
| 사용자 | `postgres` |
| 비밀번호 | `<DB_PASSWORD>` |

> [주의] 비밀번호가 `database.yaml` 및 `backend/secret.yaml`에 평문으로 기재되어 있다. 운영 환경에서는 Kubernetes Secret 또는 외부 비밀 관리 시스템 사용을 권장한다.

### 3.5 모니터링 스택

**[확인됨]**

| 컴포넌트 | 버전 | 네임스페이스 | 비고 |
|---|---|---|---|
| Loki | 2.2.1 | loki | NodePort 32222, PVC 500Gi (nfs-client) |
| kube-prometheus-stack | 79.1.1 | monitoring | Prometheus + Grafana |
| Alloy | 1.4.0 | monitoring | 로그 수집 에이전트 |

---

## 4. `/home/kcloud` 디렉터리 및 배포 자산 구조

### 4.1 최상위 디렉터리 구조

**[확인됨]**

```
/home/kcloud/
├── etri-llm-deployments/
│   └── kubespray/                          # Kubernetes 클러스터 프로비저닝
│       ├── inventory/etri/hosts.yml        # 노드 인벤토리
│       ├── inventory/etri/artifacts/admin.conf  # 생성된 kubeconfig
│       └── install.sh                      # Kubespray 실행 스크립트
│
└── mondrianai-etri-llm-deployments-a9c4c59c4869/
    └── kubernetes/                         # 모든 배포 자산의 루트
        ├── redeploy_full.sh               # 전체 재배포 스크립트
        ├── kubeconfig/config              # 클러스터 접근 인증 파일
        ├── 00-export-kubeconfig           # kubeconfig 환경변수 설정
        ├── 01-create-ns.sh                # 네임스페이스 생성
        ├── 02-deploy-nfs-provisioner.sh   # NFS Provisioner 배포
        ├── 03-deploy-gpu-operator.sh      # GPU Operator 배포
        ├── 04-deploy-loki.sh              # Loki 배포
        ├── 05-deploy-prometheus.sh        # Prometheus 배포
        ├── 06-deploy-alloy.sh             # Alloy 배포
        ├── 07-deploy-llm-evaluation.sh    # 앱 배포 (최종 단계)
        ├── nfs-subdir-external-provisioner-4.0.18/  # NFS Provisioner Helm chart
        ├── gpu-operator-25.10.0/          # GPU Operator Helm chart
        ├── loki-2.2.1/                    # Loki Helm chart
        ├── kube-prometheus-stack-79.1.1/  # Prometheus Helm chart
        ├── alloy-1.4.0/                   # Alloy Helm chart
        └── app-chart/                     # 애플리케이션 Helm chart
            ├── 01-install.sh              # 앱 신규 설치
            ├── 02-upgrade.sh              # 앱 업그레이드
            ├── values.yaml                # 핵심 설정 파일 (이미지 태그 등)
            ├── templates/
            │   ├── data-volume.yaml       # NFS PV/PVC 정의
            │   ├── database.yaml          # PostgreSQL 정의
            │   ├── regcred.yaml           # Docker Hub pull secret
            │   ├── etri-llm-frontend/     # Frontend 배포 리소스
            │   ├── etri-llm-backend/      # Backend 배포 리소스
            │   ├── etri-llm-k8s-api/      # K8s API 배포 리소스
            │   └── etri-llm-k8s-operator/ # K8s Operator 배포 리소스
            └── charts/                    # 서브 차트 (있는 경우)
```

### 4.2 핵심 파일 요약

| 파일 경로 (kubernetes/ 기준) | 역할 | 수정 필요 시점 |
|---|---|---|
| `app-chart/values.yaml` | 이미지 태그, 환경변수, 시크릿 | 이미지 갱신 시 **필수** |
| `app-chart/templates/data-volume.yaml` | NFS PV/PVC 정의 | NFS 경로 변경 시 |
| `app-chart/templates/database.yaml` | PostgreSQL 배포 정의 | DB 설정 변경 시 |
| `kubeconfig/config` | 클러스터 접근 인증 | 클러스터 재설치 시 |
| `redeploy_full.sh` | 전체 재배포 자동화 | 참조용 (직접 실행 주의) |

---

## 5. 사전 준비사항

### 5.1 로컬 환경 요구사항

**[절차]** 배포 작업을 수행하는 머신(또는 node1)에 다음 도구가 설치되어 있어야 한다.

| 도구 | 최소 버전 | 설치 확인 명령 |
|---|---|---|
| `kubectl` | 1.28 이상 | `kubectl version --client` |
| `helm` | 3.x | `helm version` |
| `ansible` | 2.12 이상 | `ansible --version` (Kubespray용) |
| `python3` | 3.9 이상 | `python3 --version` |
| `docker` 또는 `buildah` | 최신 권장 | `docker --version` |
| `git` | 최신 권장 | `git --version` |

### 5.2 네트워크 접근 요구사항

| 대상 | 용도 | 확인 방법 |
|---|---|---|
| 10.254.177.41:122 | node1 SSH | `ssh -p 122 kcloud@10.254.177.41` |
| 10.254.184.195:122 | node2 SSH | `ssh -p 122 kcloud@10.254.184.195` |
| 10.254.184.196:122 | node3 SSH | `ssh -p 122 kcloud@10.254.184.196` |
| registry-1.docker.io | Docker Hub 이미지 pull | `curl https://registry-1.docker.io` |
| github.com | 소스 코드 클론 (소스 수정 시) | `curl https://github.com` |

> [추가 검증 필요] 내부망 환경에서 Docker Hub 및 GitHub 접근 가능 여부를 사전에 확인해야 한다. 망이 분리된 경우 내부 레지스트리 미러 설정이 필요하다.

### 5.3 kubeconfig 설정

**[절차]** 배포 명령 실행 전 반드시 kubeconfig를 설정해야 한다.

```bash
# kubernetes/ 디렉터리로 이동
cd /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/

# kubeconfig 환경변수 설정
export KUBECONFIG=$(realpath kubeconfig/config)

# 클러스터 접속 확인
kubectl get nodes
```

정상 시 다음과 유사한 출력이 나타나야 한다.

```
NAME    STATUS   ROLES           AGE   VERSION
node1   Ready    control-plane   ...   v1.xx.x
node2   Ready    worker          ...   v1.xx.x
node3   Ready    worker          ...   v1.xx.x
```

### 5.4 Docker Hub 인증 확인

**[확인됨]** `app-chart/values.yaml`에 Docker Hub 자격증명이 base64 인코딩되어 포함되어 있다. 이미지 pull이 실패하는 경우 아래를 확인한다.

> [확인됨 2026-03-11] Docker Hub 계정이 `mondrianai/`에서 `jungwooshim/`으로 변경되었다. values.yaml의 자격증명 및 이미지 경로가 `jungwooshim` 계정 기준으로 업데이트되었다.

```bash
# 현재 pull secret 확인
kubectl get secret image-pull-secret -n llm-evaluation -o yaml

# secret이 없는 경우 재생성 (values.yaml의 dockerconfigjson 값 활용)
kubectl create secret docker-registry image-pull-secret \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=<Docker Hub 사용자명> \
  --docker-password=<Docker Hub 토큰> \
  -n llm-evaluation
```

> [주의] values.yaml에 Docker Hub 자격증명이 base64로 인코딩되어 저장되어 있다. base64는 암호화가 아니므로 보안상 노출 위험이 있다. Git 저장소에 업로드하지 않도록 주의한다.

---

## 6. 신규 설치 절차

> 이 절은 클러스터가 아직 존재하지 않는 상태에서 처음부터 설치하는 경우에 해당한다.
> 클러스터가 이미 운영 중이라면 7절(재배포)로 이동한다.

### 6.1 Phase 1: Kubernetes 클러스터 프로비저닝 (Kubespray)

**[절차]**

> [확인됨] 클러스터 프로비저닝은 `/home/kcloud/etri-llm-deployments/kubespray/` 디렉터리에서 수행된다. 이 디렉터리에는 Kubespray 전체 소스와 ETRI 전용 인벤토리가 포함되어 있다.

#### 6.1.0 Kubespray 디렉터리 구조

```
/home/kcloud/etri-llm-deployments/kubespray/
├── cluster.yml                    # Kubespray 메인 플레이북 (클러스터 생성)
├── reset.yml                      # 클러스터 초기화(제거) 플레이북
├── 01-provision.sh                # 클러스터 프로비저닝 실행 스크립트
├── 99-conn-check.sh               # 노드 SSH 연결 테스트 스크립트
├── inventory/etri/                # ETRI 전용 인벤토리
│   ├── hosts.yml                  # [민감정보] 노드 IP, SSH 계정/비밀번호
│   ├── credentials/               # kubeadm 인증서 키
│   └── group_vars/
│       ├── all/all.yml            # 전역 설정 (바이너리 경로, LB, NTP 등)
│       ├── k8s_cluster/
│       │   ├── k8s-cluster.yml    # K8s 핵심 설정 (버전, CNI, DNS 등)
│       │   └── addons.yml         # 애드온 설정 (Helm, Metrics Server 등)
│       └── etcd.yml               # etcd 설정
└── roles/                         # Ansible 역할 (Kubespray 내장)
```

#### 6.1.1 핵심 스크립트 역할

**[확인됨]** 클러스터 프로비저닝에 사용되는 스크립트는 다음과 같다.

| 스크립트 | 위치 | 역할 | 실행 시점 |
|---|---|---|---|
| `install.sh` | `/home/kcloud/install.sh` | Ansible 설치 → hosts.yml 생성 → 연결 테스트 → 프로비저닝 일괄 실행 | 최초 1회 |
| `99-conn-check.sh` | `kubespray/99-conn-check.sh` | 모든 노드에 Ansible ping 실행 (SSH 연결 테스트) | 프로비저닝 전 확인용 |
| `01-provision.sh` | `kubespray/01-provision.sh` | `cluster.yml` 플레이북 실행 (실제 K8s 클러스터 생성) | 클러스터 생성 시 |

**`99-conn-check.sh` 내용:**
```bash
#!/usr/bin/env bash
CLUSTER_NAME=etri
ansible -m ping all -i inventory/"$CLUSTER_NAME"
```
- 인벤토리의 모든 노드(node1, node2, node3)에 SSH 접속하여 Ansible ping을 실행한다.
- 모든 노드가 `pong`을 반환해야 프로비저닝 진행이 가능하다.

**`01-provision.sh` 내용:**
```bash
#!/usr/bin/env bash
export ANSIBLE_PERSISTENT_COMMAND_TIMEDOUT=600
CLUSTER_NAME=etri
ansible-playbook -i inventory/"$CLUSTER_NAME" cluster.yml -b -vvv -e ansible_ssh_timeout=61
```
- `cluster.yml`은 Kubespray의 메인 플레이북으로, K8s 컨트롤 플레인, etcd, 워커 노드, CNI(Calico), CoreDNS 등을 자동으로 설치한다.
- `-b`: become (sudo) 모드로 실행
- `-vvv`: 상세 로그 출력 (디버깅용)
- `ansible_ssh_timeout=61`: SSH 연결 타임아웃 61초
- `ANSIBLE_PERSISTENT_COMMAND_TIMEDOUT=600`: 장시간 명령 타임아웃 600초

**`install.sh` 실행 흐름:**
```
[STEP 0] PATH 설정 ($HOME/.local/bin 추가)
    ↓
[STEP 1] pip install --user ansible (Ansible 설치)
    ↓
[STEP 2] hosts.yml 자동 생성 (3노드 인벤토리, 비밀번호 하드코딩)
    ↓
[STEP 3] kubespray 디렉터리로 이동
    ↓
[STEP 4-1] ansible -m ping all (SSH 연결 테스트)
[STEP 4-2] ./99-conn-check.sh 실행 (동일 테스트)
    ↓
[STEP 5] ./01-provision.sh 실행 (cluster.yml 플레이북 → K8s 클러스터 생성)
```

#### 6.1.2 Kubespray 인벤토리 확인

**[확인됨]** `hosts.yml`의 구조는 다음과 같다.

```yaml
all:
  hosts:
    node1:
      ansible_host: 10.254.177.41
      ansible_port: 122
      ansible_user: kcloud
      ansible_password: "********"       # [민감정보]
      ansible_become_password: "********" # [민감정보]
    node2:
      ansible_host: 10.254.184.195
      ansible_port: 122
      # ... (동일 구조)
    node3:
      ansible_host: 10.254.184.196
      ansible_port: 122
      # ... (동일 구조)
  children:
    kube_control_plane:
      hosts:
        node1:              # node1만 컨트롤 플레인
    kube_node:
      hosts:
        node2:              # GPU 워커
        node3:              # GPU 워커
    etcd:
      hosts:
        node1:              # etcd도 node1에서 실행
    k8s_cluster:
      children:
        kube_control_plane:
        kube_node:
    calico_rr:
      hosts: {}             # Calico Route Reflector 미사용
```

> [주의] `ansible_password`와 `ansible_become_password`가 평문으로 기재되어 있다. 이관 시 SSH 키 기반 인증으로 전환하고, hosts.yml에서 비밀번호 항목을 제거해야 한다.

#### 6.1.3 Kubespray 핵심 설정값

**[확인됨]** `group_vars/k8s_cluster/k8s-cluster.yml`에서 확인된 주요 설정:

| 설정 항목 | 현재 값 | 설명 |
|---|---|---|
| `kube_version` | `v1.28.12` | Kubernetes 버전 |
| `kube_network_plugin` | `calico` | CNI 플러그인 (Calico) |
| `kube_service_addresses` | `10.233.0.0/18` | 서비스 CIDR |
| `kube_pods_subnet` | `10.233.64.0/18` | Pod CIDR |
| `kube_network_node_prefix` | `24` | 노드당 Pod IP 범위 (/24 = 최대 254개) |
| `container_manager` | `containerd` | 컨테이너 런타임 |
| `kube_proxy_mode` | `ipvs` | kube-proxy 모드 |
| `dns_mode` | `coredns` | DNS 서비스 |
| `enable_nodelocaldns` | `true` | 노드 로컬 DNS 캐시 사용 |
| `kube_encrypt_secret_data` | `false` | Secret 암호화 비활성 |
| `auto_renew_certificates` | `false` | 인증서 자동 갱신 비활성 |

**[확인됨]** `group_vars/k8s_cluster/addons.yml`에서 확인된 활성 애드온:

| 애드온 | 활성 여부 | 비고 |
|---|---|---|
| `helm_enabled` | `true` | Helm 사전 설치 |
| `metrics_server_enabled` | `true` | 메트릭 서버 |
| `local_path_provisioner_enabled` | `true` | 로컬 경로 프로비저너 |
| `ingress_nginx_enabled` | `false` | Ingress 미사용 (NodePort 방식) |
| `cert_manager_enabled` | `false` | 인증서 관리자 미사용 |
| `metallb_enabled` | `false` | MetalLB 미사용 |

**[확인됨]** `group_vars/all/all.yml`에서 확인된 전역 설정:

| 설정 항목 | 현재 값 | 설명 |
|---|---|---|
| `loadbalancer_apiserver_port` | `6443` | API 서버 로드밸런서 포트 |
| `ntp_enabled` | `false` | NTP 시간 동기화 비활성 |
| `kube_webhook_token_auth` | `false` | Webhook 토큰 인증 비활성 |

> [주의] `ntp_enabled: false` — 노드 간 시간 차이가 발생하면 인증서 검증이나 로그 시간 순서에 문제가 생길 수 있다. 운영 환경에서는 NTP 활성화를 권장한다.

> [주의] `auto_renew_certificates: false` — K8s 인증서는 기본 1년 만료된다. 수동 갱신 또는 자동 갱신 활성화를 계획해야 한다.

#### 6.1.4 SSH 접속 확인 및 키 배포

**[절차]**

```bash
# 방법 1: hosts.yml에 비밀번호가 이미 있으므로 바로 99-conn-check.sh 실행
cd /home/kcloud/etri-llm-deployments/kubespray/
bash 99-conn-check.sh

# 정상 출력 예시:
# node1 | SUCCESS => {"changed": false, "ping": "pong"}
# node2 | SUCCESS => {"changed": false, "ping": "pong"}
# node3 | SUCCESS => {"changed": false, "ping": "pong"}
```

SSH 키 기반 인증으로 전환하려면:

```bash
# SSH 키 생성 (이미 있으면 생략)
ssh-keygen -t ed25519 -C "kubespray-deploy"

# 각 노드에 키 배포
ssh-copy-id -p 122 kcloud@10.254.177.41
ssh-copy-id -p 122 kcloud@10.254.184.195
ssh-copy-id -p 122 kcloud@10.254.184.196

# 키 배포 후 hosts.yml에서 ansible_password, ansible_become_password 제거 가능
```

> [주의] `install.sh`와 `hosts.yml` 모두에 SSH 패스워드 `<SUDO_PASS>`가 평문으로 기재되어 있다. 이관 시 반드시 SSH 키 기반 인증으로 전환하고 패스워드를 제거해야 한다.

#### 6.1.5 Kubespray 실행 (클러스터 생성)

**[절차]**

```bash
# 방법 1: install.sh로 일괄 실행 (Ansible 설치 + 인벤토리 생성 + 프로비저닝)
cd /home/kcloud
bash install.sh

# 방법 2: 개별 스크립트 순서대로 실행 (권장 — 단계별 확인 가능)
cd /home/kcloud/etri-llm-deployments/kubespray/

# Step 1: Ansible 설치 확인
python3 -m pip install --user ansible
export PATH="$HOME/.local/bin:$PATH"
ansible --version

# Step 2: 연결 테스트
bash 99-conn-check.sh
# 3개 노드 모두 pong 확인

# Step 3: 클러스터 프로비저닝 (소요시간: 약 30~60분)
bash 01-provision.sh
```

> [주의] `01-provision.sh`는 내부적으로 `ansible-playbook -i inventory/etri cluster.yml -b -vvv`를 실행한다. `-vvv` 옵션으로 상세 로그가 출력되며, 실행 중 중단 시 동일 명령을 재실행하면 멱등성(idempotency)에 의해 이미 완료된 단계는 건너뛰고 미완료 단계부터 재개된다.

#### 6.1.6 kubeconfig 복사

**[절차]** 프로비저닝 완료 후 생성된 kubeconfig를 복사한다.

```bash
# 생성된 admin.conf를 로컬 kubectl 설정으로 복사
mkdir -p ~/.kube
cp /home/kcloud/etri-llm-deployments/kubespray/inventory/etri/artifacts/admin.conf ~/.kube/config

# 배포 자산 디렉터리의 kubeconfig에도 복사 (00-export-kubeconfig에서 참조)
cp /home/kcloud/etri-llm-deployments/kubespray/inventory/etri/artifacts/admin.conf \
   /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/kubeconfig/config
```

#### 6.1.7 클러스터 상태 확인

**[절차]**

```bash
export KUBECONFIG=/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/kubeconfig/config
kubectl get nodes -o wide
kubectl get pods -A
```

정상 시 출력:
```
NAME    STATUS   ROLES           AGE   VERSION    INTERNAL-IP      ...
node1   Ready    control-plane   ...   v1.28.12   10.254.177.41    ...
node2   Ready    <none>          ...   v1.28.12   10.254.184.195   ...
node3   Ready    <none>          ...   v1.28.12   10.254.184.196   ...
```

> [주의] 클러스터 재설치(이전) 시에는 노드 IP가 변경될 수 있다. 변경 시 다음 파일들을 모두 갱신해야 한다:
> - `kubespray/inventory/etri/hosts.yml` — 노드 IP
> - `kubernetes/kubeconfig/config` — API 서버 주소
> - `app-chart/templates/etri-llm-backend/secret.yaml` — API base URL (프론트엔드가 참조)
> - `app-chart/templates/etri-llm-k8s-api/secret.yaml` — 백엔드 gRPC 주소
> - NFS PV의 서버 주소 (`data-volume.yaml`)

---

### 6.2 Phase 2: 인프라 컴포넌트 배포

**[절차]** 아래 절차를 순서대로 실행한다. 각 단계에서 성공 여부를 확인한 후 다음 단계로 진행한다.

```bash
cd /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/

# kubeconfig 설정
source 00-export-kubeconfig
# 또는: export KUBECONFIG=$(realpath kubeconfig/config)
```

#### 단계 1: 네임스페이스 생성

```bash
bash 01-create-ns.sh
```

생성되는 네임스페이스: `monitoring`, `etri-llm`, `gpu-operator`, `loki`, `nfs-provisioner`

> [주의] `llm-evaluation` 네임스페이스는 이 스크립트에서 생성되지 않는다. 7단계(앱 배포) 전에 별도로 생성해야 한다. (아래 6.3절 참조)

확인:
```bash
kubectl get namespaces
```

#### 단계 2: NFS Provisioner 배포

```bash
bash 02-deploy-nfs-provisioner.sh
```

내부적으로 실행:
```bash
cd nfs-subdir-external-provisioner-4.0.18/
bash 01-install.sh
# helm install -n nfs-provisioner nfs-subdir-external-provisioner -f values-override.yaml ./
```

> [주의] NFS 서버: `10.254.184.195`, NFS 경로: `/mnt/etri-lllm-evaluation-nfs-server` (오타 주의: L 3개)
> 실제 NFS 서버의 내보내기 경로와 일치하는지 반드시 확인한다. 불일치 시 PVC가 Bound 상태가 되지 않는다.

확인:
```bash
kubectl get pods -n nfs-provisioner
kubectl get storageclass
```

#### 단계 3: GPU Operator 배포

```bash
bash 03-deploy-gpu-operator.sh
```

내부적으로 실행:
```bash
cd gpu-operator-25.10.0/
bash 01-install.sh
# helm install -n gpu-operator gpu-operator -f values-override.yaml ./
```

> [추가 검증 필요] GPU Operator 배포 후 node2(L40)와 node3(A40)에서 GPU가 정상 인식되는지 확인이 필요하다.

확인:
```bash
kubectl get pods -n gpu-operator
kubectl describe node node2 | grep -i nvidia
kubectl describe node node3 | grep -i nvidia
```

#### 단계 4: Loki 배포

```bash
bash 04-deploy-loki.sh
```

내부적으로 실행:
```bash
cd loki-2.2.1/loki/
bash 01-install.sh
# helm install -n loki loki -f values-override.yaml ./
```

설정 요약:
- PVC: 500Gi, storageClassName: `nfs-client`
- 외부 접근 포트: NodePort 32222

확인:
```bash
kubectl get pods -n loki
kubectl get pvc -n loki
```

#### 단계 5: Prometheus 배포

```bash
bash 05-deploy-prometheus.sh
```

내부적으로 실행:
```bash
cd kube-prometheus-stack-79.1.1/charts/prometheus/
bash 01-install.sh
```

확인:
```bash
kubectl get pods -n monitoring
```

#### 단계 6: Alloy 배포

```bash
bash 06-deploy-alloy.sh
```

내부적으로 실행:
```bash
cd alloy-1.4.0/
bash 01-install.sh
# helm install -n monitoring alloy -f values-override.yaml ./
```

확인:
```bash
kubectl get pods -n monitoring
```

---

### 6.3 Phase 3: 애플리케이션 배포

**[절차]**

```bash
cd /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/
export KUBECONFIG=$(realpath kubeconfig/config)
```

#### 단계 1: llm-evaluation 네임스페이스 생성

```bash
kubectl create ns llm-evaluation
```

#### 단계 2: NFS PV/PVC 생성

```bash
kubectl apply -f app-chart/templates/data-volume.yaml
# 또는 redeploy_full.sh 참고:
kubectl apply -f data-volume.yaml
```

확인:
```bash
kubectl get pv
kubectl get pvc -n llm-evaluation
```

모든 PVC가 `Bound` 상태여야 한다.

#### 단계 3: 데이터베이스 배포

```bash
kubectl apply -f app-chart/templates/database.yaml
# 또는:
kubectl apply -f database.yaml
```

확인:
```bash
kubectl get pods -n llm-evaluation -l app=etri-llm-db
kubectl get svc -n llm-evaluation
```

PostgreSQL Pod가 `Running` 상태인지 확인한다.

#### 단계 4: 애플리케이션 Helm 설치

```bash
cd app-chart/
bash 01-install.sh
# 내부: helm install -n llm-evaluation app-chart -f values.yaml ./
```

확인:
```bash
kubectl get pods -n llm-evaluation
kubectl get svc -n llm-evaluation
```

---

### 6.4 설치 후 전체 상태 확인

```bash
# 전체 Pod 상태
kubectl get pods -A

# 서비스 포트 확인
kubectl get svc -A | grep NodePort

# PVC 상태
kubectl get pvc -A
```

모든 Pod가 `Running` 또는 `Completed` 상태이고, PVC가 모두 `Bound` 상태여야 한다.

---

## 7. 소스 수정 없이 재배포하는 방법

> 소스 코드 변경 없이 기존 이미지로 앱을 재시작하거나, 새로운 태그의 이미지로 교체하는 경우에 해당한다.

### 7.1 단순 재시작 (이미지 변경 없음)

Pod를 재시작하는 가장 간단한 방법이다.

```bash
export KUBECONFIG=$(realpath /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/kubeconfig/config)

# 특정 Deployment 재시작
kubectl rollout restart deployment/<deployment-name> -n llm-evaluation

# 전체 llm-evaluation 네임스페이스 재시작
kubectl rollout restart deployment -n llm-evaluation
```

### 7.2 이미지 태그만 변경하여 재배포

**[변경 포인트]** 가장 중요한 파일은 `app-chart/values.yaml`이다.

#### 단계 1: values.yaml 수정

```bash
cd /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/app-chart/
# 텍스트 편집기로 values.yaml 열기
vi values.yaml
```

수정 대상 경로 (values.yaml 내):

| 컴포넌트 | values.yaml 키 경로 | 현재 값 |
|---|---|---|
| Frontend | `components.etriLLMFrontend.containers.image` | `jungwooshim/etri-cloud-frontend:v1.0.0` |
| Backend | `components.etriLLMBackend.containers.image` | `jungwooshim/etri-cloud-backend:latest` |
| K8s API | `components.etriLLMAPI.containers.image` | `mondrianai/etri-llm-k8s-api:v1.0.0` |
| K8s Operator | `components.etriLLMOperator.containers.image` | `mondrianai/etri-llm-k8s-operator:v1.0.1` |

예시 (frontend를 v1.0.1로 업그레이드):
```yaml
components:
  etriLLMFrontend:
    containers:
      image: jungwooshim/etri-cloud-frontend:v1.0.1   # 변경
```

#### 단계 2: Helm upgrade 실행

```bash
cd /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/app-chart/
bash 02-upgrade.sh
# 내부: helm upgrade -n llm-evaluation app-chart -f values.yaml ./
```

#### 단계 3: 배포 확인

```bash
# 롤아웃 상태 확인
kubectl rollout status deployment -n llm-evaluation

# 이미지 확인
kubectl get pods -n llm-evaluation -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].image}{"\n"}{end}'
```

### 7.3 전체 재배포 스크립트 사용

**[주의]** `redeploy_full.sh`는 전체 앱 스택을 재배포한다. 데이터 영속성에 영향을 줄 수 있으므로 내용을 확인 후 실행한다.

```bash
cd /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/
# 내용 확인 후 실행
cat redeploy_full.sh
bash redeploy_full.sh
```

---

## 8. Frontend 수정 후 재배포

### 8.1 전체 흐름

```
1. GitHub 저장소 클론
2. Frontend 소스 수정
3. Docker 이미지 빌드
4. Docker Hub에 이미지 푸시
5. app-chart/values.yaml에서 frontend 이미지 태그 수정
6. helm upgrade 실행
7. 배포 확인
```

### 8.2 단계별 절차

#### 단계 1: 소스 클론

```bash
git clone https://github.com/mondrian-cloudteam/etri-llm-exam-solution.git
cd etri-llm-exam-solution
```

> [확인됨] Frontend 소스는 `web/` 디렉터리에 위치한다. Dockerfile은 `web/Dockerfile.dev` (개발/현재 배포용)과 `web/Dockerfile.prod` (Nginx 프로덕션용)이 있다.

#### 단계 2: Frontend 소스 수정

```bash
# frontend 디렉터리 이동
cd web/
# 소스 수정 후 저장
```

> [확인됨] Frontend는 Vite 기반이며, 현재 배포는 `Dockerfile.dev`를 사용하여 Vite 개발 서버(포트 5173)로 실행된다. `Dockerfile.prod`는 Nginx(포트 80)를 사용하나 현재 배포에 사용되지 않는다.

#### 단계 3: Docker 이미지 빌드

```bash
# 새 버전 태그 결정 (예: v1.0.1)
NEW_TAG="v1.0.1"
```

> [주의] 이 서버에는 Docker가 설치되어 있지 않다. nerdctl이 있으나 rootless containerd가 설정되어 있지 않아 사용 불가하다. 대신 아래 방법 중 하나를 사용한다.

```bash
# 방법 1: Kaniko Pod 사용 (권장)
# 1) 빌드 컨텍스트를 tar로 압축
cd /home/kcloud/etri-llm-exam-solution
tar -czf /tmp/frontend-context.tar.gz --exclude=node_modules -C web .

# 2) NFS 볼륨에 복사 (backend pod를 통해)
kubectl cp /tmp/frontend-context.tar.gz llm-evaluation/<backend-pod>:/usr/src/app/mnt/result/frontend-context.tar.gz

# 3) Kaniko Pod 생성 및 실행 (부록 A 참조)

# 방법 2: 외부 머신에서 Docker로 빌드
docker build -t jungwooshim/etri-cloud-frontend:${NEW_TAG} -f Dockerfile.dev .
docker push jungwooshim/etri-cloud-frontend:${NEW_TAG}
```

#### 단계 4: Docker Hub 푸시

```bash
# 방법 2(외부 머신)를 사용하는 경우:
docker login
docker push jungwooshim/etri-cloud-frontend:${NEW_TAG}
```

#### 단계 5: values.yaml 이미지 태그 수정

```bash
cd /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/app-chart/
vi values.yaml
```

```yaml
components:
  etriLLMFrontend:
    containers:
      image: jungwooshim/etri-cloud-frontend:v1.0.1   # 새 태그로 변경
```

#### 단계 6: Helm upgrade

```bash
bash 02-upgrade.sh
```

#### 단계 7: 확인

```bash
kubectl rollout status deployment -n llm-evaluation
# 브라우저에서 http://10.254.184.195:30001 접속 확인
```

### 8.3 Frontend 환경변수 (API URL) 변경이 필요한 경우

**[확인됨]** Frontend에는 Backend API URL이 하드코딩되어 있다.

```
VITE__APP_API_BASE_URL: http://10.254.184.195:30980/api
```

이 값은 `app-chart/values.yaml` 또는 `app-chart/templates/etri-llm-frontend/` 내의 Secret/ConfigMap에서 수정할 수 있다.

> [주의] IP가 변경되거나 도메인을 사용하는 경우 이 값을 반드시 수정해야 한다. 수정 후 helm upgrade를 실행해야 변경이 반영된다.

---

## 9. Backend 수정 후 재배포

### 9.1 전체 흐름

```
1. GitHub 저장소 클론
2. Backend 소스 수정
3. Docker 이미지 빌드
4. Docker Hub에 이미지 푸시
5. app-chart/values.yaml에서 backend 이미지 태그 수정
6. helm upgrade 실행
7. 배포 확인
```

### 9.2 단계별 절차

#### 단계 1: 소스 클론

```bash
git clone https://github.com/mondrian-cloudteam/etri-llm-exam-solution.git
cd etri-llm-exam-solution
```

> [확인됨] Backend 소스는 `server/` 디렉터리에 위치한다. `server/Dockerfile.prod`를 사용하여 빌드한다.

#### 단계 2: Backend 소스 수정

```bash
cd server/
# 소스 수정 후 저장
```

#### 단계 3: Docker 이미지 빌드

> [주의] 현재 backend 이미지 태그가 `:latest`로 설정되어 있다. 운영 환경에서는 구체적인 버전 태그(예: `v1.0.1`)를 사용하는 것을 강력히 권장한다. `:latest` 태그는 어떤 버전이 실행 중인지 추적하기 어렵다.

```bash
# 버전 태그 사용 권장
NEW_TAG="v1.0.1"
```

> [주의] 이 서버에는 Docker가 설치되어 있지 않다. Frontend와 동일하게 Kaniko 또는 외부 머신을 사용한다 (부록 A 참조).

```bash
# 방법 1: Kaniko Pod 사용 (권장)
cd /home/kcloud/etri-llm-exam-solution
tar -czf /tmp/backend-context.tar.gz --exclude=node_modules -C server .

kubectl cp /tmp/backend-context.tar.gz llm-evaluation/<backend-pod>:/usr/src/app/mnt/result/backend-context.tar.gz
# Kaniko Pod 생성 시 --dockerfile=Dockerfile.prod, destination=jungwooshim/etri-cloud-backend:${NEW_TAG} 사용

# 방법 2: 외부 머신에서 Docker로 빌드
docker build -t jungwooshim/etri-cloud-backend:${NEW_TAG} -f Dockerfile.prod .
docker push jungwooshim/etri-cloud-backend:${NEW_TAG}
```

#### 단계 4: Docker Hub 푸시

```bash
# 방법 2(외부 머신)를 사용하는 경우:
docker login
docker push jungwooshim/etri-cloud-backend:${NEW_TAG}
```

#### 단계 5: values.yaml 수정

```bash
cd /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/app-chart/
vi values.yaml
```

```yaml
components:
  etriLLMBackend:
    containers:
      image: jungwooshim/etri-cloud-backend:v1.0.1   # 새 태그로 변경 (latest 탈피 권장)
```

#### 단계 6: Helm upgrade

```bash
bash 02-upgrade.sh
```

#### 단계 7: 확인

```bash
kubectl rollout status deployment -n llm-evaluation

# Backend 로그 확인
kubectl logs -n llm-evaluation -l app=etri-llm-backend --tail=50

# Backend API 응답 확인
curl http://10.254.184.195:30980/api/health   # [추가 검증 필요: 실제 health endpoint 경로 확인]
```

### 9.3 Backend 환경변수 및 DB 연결 정보 변경

Backend의 DB 연결 정보는 `app-chart/templates/etri-llm-backend/secret.yaml`(또는 values.yaml 내 secret 섹션)에서 관리된다.

> [주의] DB 패스워드가 평문으로 기재되어 있다. 변경이 필요한 경우 `database.yaml`과 `backend/secret.yaml`을 함께 수정해야 한다.

---

## 10. Frontend/Backend를 함께 수정한 경우

### 10.1 권장 절차

Frontend와 Backend를 동시에 변경하는 경우 다음 순서로 진행한다.

```
1. Backend 이미지 빌드 및 푸시 (9절 참조)
2. Frontend 이미지 빌드 및 푸시 (8절 참조)
3. values.yaml에서 두 이미지 태그를 한 번에 수정
4. helm upgrade 한 번 실행
5. 배포 확인
```

단일 `helm upgrade`로 두 컴포넌트를 동시에 업데이트하면 롤백도 단일 단위로 가능하다.

### 10.2 values.yaml 동시 수정 예시

```yaml
components:
  etriLLMFrontend:
    containers:
      image: jungwooshim/etri-cloud-frontend:v1.0.1   # 수정
  etriLLMBackend:
    containers:
      image: jungwooshim/etri-cloud-backend:v1.0.1    # 수정
```

### 10.3 롤백 절차

```bash
# Helm 릴리즈 히스토리 확인
helm history app-chart -n llm-evaluation

# 이전 버전으로 롤백
helm rollback app-chart <REVISION_NUMBER> -n llm-evaluation

# 롤백 상태 확인
kubectl rollout status deployment -n llm-evaluation
```

---

## 11. 주요 설정 파일과 수정 포인트

### 11.1 app-chart/values.yaml 구조 요약

**[변경 포인트]** 재배포 시 가장 자주 수정하게 되는 파일이다.

| 섹션 | 주요 내용 | 수정 빈도 |
|---|---|---|
| `global.namespace` | 배포 네임스페이스 (`llm-evaluation`) | 낮음 |
| `components.etriLLMFrontend.containers.image` | Frontend 이미지 | 이미지 업데이트 시 |
| `components.etriLLMBackend.containers.image` | Backend 이미지 | 이미지 업데이트 시 |
| `components.etriLLMAPI.containers.image` | K8s API 이미지 | 이미지 업데이트 시 |
| `components.etriLLMOperator.containers.image` | K8s Operator 이미지 | 이미지 업데이트 시 |
| `imagePullSecrets` | Docker Hub 인증 시크릿명 | 드물게 |
| Frontend Secret: `VITE__APP_API_BASE_URL` | Backend API URL (하드코딩) | IP/도메인 변경 시 |
| DB 인증 정보 | postgres 사용자/패스워드 | DB 재설정 시 |
| Docker Hub 자격증명 (`dockerconfigjson`) | base64 인코딩된 인증 정보 | 자격증명 갱신 시 |

### 11.2 인프라 컴포넌트 설정 파일

| 컴포넌트 | 설정 파일 위치 | 주요 수정 포인트 |
|---|---|---|
| NFS Provisioner | `nfs-subdir-external-provisioner-4.0.18/values-override.yaml` | NFS 서버 IP, NFS 경로 |
| GPU Operator | `gpu-operator-25.10.0/values-override.yaml` | GPU 드라이버 버전 |
| Loki | `loki-2.2.1/loki/values-override.yaml` | 스토리지 크기, 보존 기간 |
| Prometheus | `kube-prometheus-stack-79.1.1/charts/prometheus/values-override.yaml` | 스크레이프 설정 |
| Alloy | `alloy-1.4.0/values-override.yaml` | 로그 수집 대상 |

### 11.3 imagePullPolicy 주의사항

**[확인됨]** 모든 컴포넌트의 `imagePullPolicy`가 `Always`로 설정되어 있다.

```yaml
imagePullPolicy: Always
```

이는 Pod 재시작 시마다 Docker Hub에서 이미지를 새로 pull하므로, 네트워크 연결이 필요하다. 오프라인 환경이나 Docker Hub 장애 시 Pod 재시작이 불가능할 수 있다.

> [추가 검증 필요] 내부 레지스트리 미러 환경인 경우 `imagePullPolicy`를 `IfNotPresent`로 변경하고 내부 레지스트리 경로로 이미지를 수정해야 한다.

---

## 12. 포트 30001 노출 구조

### 12.1 사용자 요청 흐름

**[확인됨]**

```
사용자 브라우저
    │
    ▼
http://<node IP>:30001
    │
    ▼  (Kubernetes NodePort → Service)
Frontend Pod (컨테이너 포트 5173)
    │  Vite 앱에서 API 호출
    ▼
http://10.254.184.195:30980/api  ← 하드코딩된 IP
    │
    ▼  (Kubernetes NodePort → Service)
Backend Pod (컨테이너 포트 9999)
    │
    ▼
PostgreSQL (ClusterIP, 포트 5432)
    │
    ▼
K8s API (ClusterIP, 포트 9090)
```

### 12.2 노드별 접근 가능한 외부 포트

NodePort 서비스는 클러스터의 **모든 노드**에서 동일한 포트로 접근 가능하다.

| 서비스 | 노드 포트 | 접근 URL 예시 |
|---|---|---|
| Frontend | 30001 | `http://10.254.177.41:30001`, `http://10.254.184.195:30001`, `http://10.254.184.196:30001` |
| Backend | 30980 | `http://10.254.177.41:30980`, `http://10.254.184.195:30980`, `http://10.254.184.196:30980` |
| Loki | 32222 | `http://10.254.177.41:32222` |

### 12.3 하드코딩 IP 관련 운영 주의사항

**[주의]** Frontend Secret에 Backend URL이 다음과 같이 하드코딩되어 있다.

```
VITE__APP_API_BASE_URL: http://10.254.184.195:30980/api
```

이로 인해 다음 상황에서 Frontend가 정상 동작하지 않는다.

| 상황 | 영향 |
|---|---|
| node2(10.254.184.195) IP가 변경된 경우 | API 요청 실패 |
| 도메인 기반 접근으로 전환하는 경우 | URL 수정 필요 |
| 다른 노드 IP로 Backend를 지목하는 경우 | URL 수정 필요 |

변경 시 `app-chart/values.yaml` 내 Frontend Secret의 `VITE__APP_API_BASE_URL` 값을 수정하고 `helm upgrade`를 실행해야 한다.

---

## 13. 운영 검증 체크리스트

### 13.1 배포 후 즉시 확인 항목

**[절차]** 배포 완료 직후 아래 항목을 순서대로 확인한다.

```bash
export KUBECONFIG=$(realpath /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/kubeconfig/config)
```

- [ ] **전체 Pod 상태**: 모든 Pod가 `Running` 또는 `Completed`
  ```bash
  kubectl get pods -A | grep -v Running | grep -v Completed
  ```
  위 명령에서 출력이 없어야 정상이다.

- [ ] **llm-evaluation 네임스페이스 Pod 확인**
  ```bash
  kubectl get pods -n llm-evaluation
  ```

- [ ] **PVC 상태**: 모든 PVC가 `Bound`
  ```bash
  kubectl get pvc -A
  ```

- [ ] **서비스 포트 확인**
  ```bash
  kubectl get svc -n llm-evaluation
  ```

- [ ] **Frontend 접근 확인**
  ```bash
  curl -I http://10.254.184.195:30001
  # HTTP 200 또는 HTML 응답 확인
  ```

- [ ] **Backend API 접근 확인**
  ```bash
  curl http://10.254.184.195:30980/api/    # [추가 검증 필요: 실제 endpoint 확인]
  ```

- [ ] **DB 연결 확인**
  ```bash
  kubectl exec -n llm-evaluation -it <postgres-pod-name> -- psql -U postgres -d llmEvaluationDB -c "\dt"
  ```

- [ ] **GPU 인식 확인** (GPU 워크로드 실행 전)
  ```bash
  kubectl get nodes -o custom-columns=NAME:.metadata.name,GPU:.status.allocatable."nvidia\.com/gpu"
  ```

### 13.2 정기 운영 점검 항목

| 주기 | 확인 항목 | 명령 |
|---|---|---|
| 매일 | Pod 재시작 여부 | `kubectl get pods -A | awk '$4 > 5'` |
| 매일 | 디스크 사용량 | `kubectl get pvc -A` |
| 주간 | 로그 적재 상태 | Grafana Loki 대시보드 확인 |
| 주간 | GPU 메트릭 | Grafana NVIDIA 대시보드 확인 |
| 월간 | 이미지 취약점 | Docker Hub 또는 이미지 스캐너 활용 |

### 13.3 Helm 릴리즈 상태 확인

```bash
# 설치된 모든 Helm 릴리즈 목록
helm list -A

# 특정 릴리즈 상세 확인
helm status app-chart -n llm-evaluation

# 릴리즈 히스토리
helm history app-chart -n llm-evaluation
```

---

## 14. 자주 발생할 수 있는 문제와 대응

### 14.1 Pod이 ImagePullBackOff 상태인 경우

**증상**: Pod 상태가 `ImagePullBackOff` 또는 `ErrImagePull`

**원인 및 대응**:

1. Docker Hub 인증 실패
   ```bash
   # image-pull-secret 확인
   kubectl get secret image-pull-secret -n llm-evaluation

   # 시크릿 재생성
   kubectl create secret docker-registry image-pull-secret \
     --docker-server=https://index.docker.io/v1/ \
     --docker-username=<사용자명> \
     --docker-password=<패스워드 또는 토큰> \
     -n llm-evaluation --dry-run=client -o yaml | kubectl apply -f -
   ```

2. 이미지 태그 오류
   ```bash
   # 실제 이미지 이름 확인
   kubectl describe pod <pod-name> -n llm-evaluation | grep Image
   # values.yaml에서 올바른 태그로 수정 후 helm upgrade
   ```

3. Docker Hub 접근 불가 (네트워크)
   ```bash
   # 노드에서 Docker Hub 접근 테스트
   curl -I https://registry-1.docker.io
   ```

### 14.2 PVC가 Pending 상태인 경우

**증상**: `kubectl get pvc -A`에서 `Pending` 상태

**원인 및 대응**:

1. NFS Provisioner 미동작
   ```bash
   kubectl get pods -n nfs-provisioner
   kubectl logs -n nfs-provisioner <provisioner-pod-name>
   ```

2. NFS 서버 마운트 실패
   ```bash
   # node에서 NFS 마운트 테스트
   showmount -e 10.254.184.195

   # NFS 경로 오타 확인 (etri-lllm vs etri-llm)
   cat /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/nfs-subdir-external-provisioner-4.0.18/values-override.yaml
   ```

3. StorageClass 미존재
   ```bash
   kubectl get storageclass
   ```

### 14.3 Frontend에서 API 요청 실패

**증상**: 브라우저에서 Frontend 접근 가능하나, 데이터 로딩 실패

**원인 및 대응**:

1. Backend Pod 미동작
   ```bash
   kubectl get pods -n llm-evaluation -l app=etri-llm-backend
   kubectl logs -n llm-evaluation -l app=etri-llm-backend --tail=50
   ```

2. API URL 하드코딩 오류 (IP 변경 시)
   ```bash
   # 현재 설정된 API URL 확인
   kubectl get secret -n llm-evaluation etri-llm-frontend-secret -o jsonpath='{.data.VITE__APP_API_BASE_URL}' | base64 -d
   ```

   잘못된 IP가 설정된 경우 values.yaml 수정 후 `helm upgrade` 실행

### 14.4 Database 연결 실패

**증상**: Backend 로그에 DB 연결 오류

```bash
# DB Pod 상태 확인
kubectl get pods -n llm-evaluation | grep postgres

# DB 접속 테스트
kubectl exec -n llm-evaluation -it <postgres-pod-name> -- psql -U postgres -d llmEvaluationDB

# Backend에서 DB 연결 확인
kubectl exec -n llm-evaluation -it <backend-pod-name> -- nc -zv etri-llm-db-service 5432
```

### 14.5 Backend가 ERR_HTTP_HEADERS_SENT로 크래시하는 경우

**증상**: Frontend에서 데이터 로딩이 갑자기 중단됨. Backend Pod 상태는 `Running`으로 표시되지만 실제 프로세스는 종료된 상태.

**원인**: 벤더 코드의 NestJS 컨트롤러(`mp-exam-result.controller.ts:63`)에서 HTTP 응답 헤더를 중복 전송하는 버그. 시험 결과 조회 시 트리거됨.

```
Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
    at ServerResponse.setHeader (node:_http_outgoing:700:11)
    at <anonymous> (/app/src/mp-exam-result/mp-exam-result.controller.ts:63:25)
```

**즉시 대응**:
```bash
# Backend Pod 강제 재시작
kubectl delete pod -n llm-evaluation -l app=etri-llm-backend

# 새 Pod 기동 확인 (약 10~15초 소요)
kubectl get pods -n llm-evaluation -l app=etri-llm-backend -w
```

**근본 해결**: GitHub 저장소(`etri-llm-exam-solution`)의 Backend 소스에서 `mp-exam-result.controller.ts`의 중복 응답 전송 로직을 수정해야 함. 해당 컨트롤러 함수에 `return` 누락 또는 조건 분기 오류가 있을 가능성이 높음.

**예방**: Backend 컨테이너에 liveness probe 설정 추가를 권장함 (현재 미설정 상태). values.yaml에 아래와 같이 추가:
```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 9999
  initialDelaySeconds: 30
  periodSeconds: 10
```

### 14.6 Frontend에서 Dataset 목록이 로딩되지 않는 경우

**증상**: Model 선택 후 Dataset 드롭다운이 비어 있음.

**원인**: Frontend가 `/api/files/settings` 엔드포인트를 호출하여 모델별 데이터셋 매핑 정보를 받아오려 하지만, Backend에는 해당 API 라우트가 존재하지 않음 (404 반환). 벤더 코드의 Frontend-Backend 불일치 문제.

**현재 확인된 Backend 라우트**:
- `GET /api/files/models` — 정상 동작
- `GET /api/files/datasets` — 정상 동작
- `GET /api/files/settings` — **미구현 (404)**

**즉시 대응**: Frontend 코드를 수정하여 settings 엔드포인트 실패 시 `/api/files/datasets` 직접 호출로 대체하도록 fallback 로직 추가 (본 가이드 작성 시점에 이미 적용됨).

**근본 해결**: Backend에 `/api/files/settings` 엔드포인트를 구현하거나, NFS에 `settings.json` 파일을 생성하여 모델별 데이터셋 매핑 정보를 제공해야 함.

### 14.7 GPU를 인식하지 못하는 경우

**증상**: GPU 워크로드 스케줄링 실패

```bash
# GPU Operator Pod 상태 확인
kubectl get pods -n gpu-operator

# 노드 GPU 리소스 확인
kubectl describe node node2 | grep -A5 "Allocatable"
kubectl describe node node3 | grep -A5 "Allocatable"

# NVIDIA 드라이버 로드 확인
kubectl logs -n gpu-operator -l app=nvidia-driver-daemonset --tail=30
```

### 14.6 regcred.yaml 템플릿 오류

**[주의]** `regcred.yaml`이 `.global.environment`를 참조하지만 `values.yaml`에는 `.global.namespace`만 존재한다. helm install/upgrade 시 이 템플릿에서 오류가 발생할 수 있다.

```bash
# 오류 확인
helm template app-chart -n llm-evaluation -f values.yaml ./ | grep -i error

# 임시 대응: regcred를 수동으로 생성
kubectl create secret docker-registry image-pull-secret \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=<사용자명> \
  --docker-password=<토큰> \
  -n llm-evaluation
```

자세한 내용은 15절 참조.

---

## 15. 코드/문서 상 불일치 및 추가 검증 필요 사항

**[주의]** 이 절은 파일 분석 과정에서 발견된 잠재적 문제들을 기록한다. 각 항목은 실제 운영 환경에서 확인 및 수정이 필요하다.

### 15.1 네임스페이스 불일치

| 파일 | 기재 내용 | 문제점 |
|---|---|---|
| `01-create-ns.sh` | `etri-llm` 네임스페이스 생성 | 실제 앱은 `llm-evaluation`에 배포됨 |
| `app-chart/01-install.sh` | `-n llm-evaluation` 사용 | `01-create-ns.sh`에서 생성하지 않는 네임스페이스 |
| `redeploy_full.sh` | `kubectl create ns llm-evaluation` | 별도 명령으로 생성 |

**권장 조치**: `01-create-ns.sh`에 `llm-evaluation` 네임스페이스 생성 명령을 추가하거나, `redeploy_full.sh`와 신규 설치 가이드에 해당 단계를 명시적으로 포함한다.

### 15.2 regcred.yaml 템플릿 변수 오류

| 파일 | 문제 내용 |
|---|---|
| `app-chart/templates/regcred.yaml` | `.global.environment` 참조 |
| `app-chart/values.yaml` | `.global.namespace`만 정의됨 (`.global.environment` 없음) |

**영향**: `helm install` 또는 `helm upgrade` 시 `regcred.yaml` 렌더링 실패 가능

**권장 조치**:
- `regcred.yaml`에서 `.global.environment`를 `.global.namespace`로 수정
- 또는 `values.yaml`에 `global.environment` 키를 추가

### 15.3 etri-llm-k8s-api deployment 네임스페이스 변수 오류

| 파일 | 문제 내용 |
|---|---|
| `app-chart/templates/etri-llm-k8s-api/deployment.yaml` | 네임스페이스 지정에 `.global.environment` 사용 |
| `app-chart/values.yaml` | `.global.namespace`만 정의됨 |

**권장 조치**: `deployment.yaml`에서 `.global.environment`를 `.global.namespace`로 수정

### 15.4 NFS 경로 오타

| 파일 | 기재 값 | 예상 올바른 값 |
|---|---|---|
| `nfs-subdir-external-provisioner-4.0.18/values-override.yaml` | `/mnt/etri-lllm-evaluation-nfs-server` | `/mnt/etri-llm-evaluation-nfs-server` |

**영향**: NFS Provisioner가 존재하지 않는 경로에 마운트를 시도하여 PVC 생성 실패 가능

**권장 조치**:
1. 실제 node2 서버에서 NFS 내보내기 경로 확인: `showmount -e 10.254.184.195`
2. values-override.yaml의 경로를 실제 경로와 일치하도록 수정

### 15.5 Backend 이미지 태그 `:latest` 사용

| 컴포넌트 | 현재 태그 | 권장 방식 |
|---|---|---|
| Backend | `:latest` | 명시적 버전 태그 (예: `v1.0.0`) |
| 기타 컴포넌트 | `v1.0.0`, `v1.0.1` | 유지 |

**영향**: `:latest` 태그는 버전 추적이 불가능하며, `imagePullPolicy: Always`와 결합 시 의도치 않은 버전이 배포될 수 있다.

**권장 조치**: Backend 이미지 빌드 및 배포 시 명시적 버전 태그를 사용하고 values.yaml에 반영한다.

### 15.6 민감 정보 평문 노출

| 위치 | 노출 내용 | 위험도 |
|---|---|---|
| `database.yaml` | DB 패스워드 (`<DB_PASSWORD>`) | 높음 |
| `app-chart/templates/etri-llm-backend/secret.yaml` | DB 패스워드 | 높음 |
| `install.sh` | SSH 패스워드 (`<SUDO_PASS>`) | 높음 |
| `app-chart/values.yaml` | Docker Hub 자격증명 (base64) | 중간 |

**권장 조치**:
- Kubernetes Secrets를 외부 비밀 관리 시스템(Vault, AWS Secrets Manager 등)과 연동
- 최소한 Secret을 Git 저장소에 커밋하지 않도록 `.gitignore` 설정
- SSH 키 기반 인증으로 전환하여 패스워드 하드코딩 제거

### 15.7 Frontend API URL 하드코딩

**현재 상태**:
```
VITE__APP_API_BASE_URL: http://10.254.184.195:30980/api
```

**권장 조치**:
- 도메인 기반 URL 사용 또는
- 상대 경로(Nginx Proxy 구성 등)로 전환

### 15.8 추가 확인이 필요한 사항 목록

| 번호 | 항목 | 확인 방법 |
|---|---|---|
| 1 | GitHub 저장소 빌드 방법 (Dockerfile, docker-compose 등) | GitHub 저장소 직접 확인 |
| 2 | Backend health check API endpoint | GitHub 저장소 API 문서 확인 |
| 3 | 실제 node2 NFS 내보내기 경로 목록 | `showmount -e 10.254.184.195` |
| 4 | Grafana 대시보드 접근 URL 및 초기 인증 정보 | Prometheus values-override.yaml 확인 |
| 5 | K8s Operator가 관리하는 CRD 목록 | `kubectl get crd` |
| 6 | GPU Operator에서 관리하는 드라이버 버전 | gpu-operator values-override.yaml 확인 |
| 7 | 현재 운영 중인 LLM 모델 목록 | `/mnt/models` NFS 경로 확인 |
| 8 | Backend가 사용하는 DB 스키마 | GitHub 저장소 마이그레이션 파일 확인 |

### 14.8 MMLU Math 카테고리 누락 문제

**MMLU Math 카테고리 누락 문제**

> [확인됨 2026-03-11] 초기 배포 시 `mm_exam_result` 테이블에 `result_acc_math` 컬럼이 누락되어 있었다. 이로 인해:
> - API 응답에 math 정확도 데이터가 포함되지 않음
> - Frontend 그래프에서 NaN 값으로 인해 모든 바 차트가 렌더링되지 않음

해결: DB에 컬럼 추가 후 summary.txt 파일에서 데이터 백필

```sql
ALTER TABLE mm_exam_result ADD COLUMN result_acc_math float8 DEFAULT 0;
-- 기존 데이터 백필은 summary.txt에서 math 값을 추출하여 UPDATE
```

또한 배포된 backend 코드에 버그가 있었음: `case 'math': result.result_acc_other = value;` (math 값을 other에 저장).
수정된 소스에서는 `result.result_acc_math = value`로 올바르게 저장됨.

### 14.9 Backend 볼륨 마운트 경로 불일치 문제 (모델/데이터셋 미표시)

**Backend 볼륨 마운트 경로 불일치 문제**

> [확인됨 2026-03-11] 커스텀 이미지(`jungwooshim/etri-cloud-backend`)로 재배포 후 웹 UI에서 모델과 데이터셋이 표시되지 않는 문제가 발생했다.

**원인**: Backend의 `files.service.ts`는 `process.cwd()` + `mnt/models` 경로로 파일을 읽는다. 컨테이너의 작업 디렉터리(WORKDIR)가 `/usr/src/app`이므로 실제 참조 경로는 `/usr/src/app/mnt/models/`이다. 그러나 원래 Helm 배포 템플릿(`deployment.yaml`)의 `volumeMounts`는 `/app/mnt/models/`로 마운트하고 있어 경로 불일치가 발생했다.

**증상**:
- API 호출 시 `ENOENT: no such file or directory, scandir '/usr/src/app/mnt/models'` 오류
- 웹 UI의 모델/데이터셋 선택 드롭다운이 비어 있음
- NFS PV/PVC는 정상 Bound 상태이며 NFS 데이터도 존재함

**해결**: `app-chart/templates/etri-llm-backend/deployment.yaml`의 `volumeMounts` 경로를 수정

```yaml
# 수정 전 (잘못된 경로)
volumeMounts:
- name: model-volume
  mountPath: /app/mnt/models/
- name: dataset-volume
  mountPath: /app/mnt/datasets/
- name: results-volume
  mountPath: /app/mnt/result/

# 수정 후 (올바른 경로)
volumeMounts:
- name: model-volume
  mountPath: /usr/src/app/mnt/models/
- name: dataset-volume
  mountPath: /usr/src/app/mnt/datasets/
- name: results-volume
  mountPath: /usr/src/app/mnt/result/
```

수정 후 `helm upgrade app-chart . -n llm-evaluation` 실행하여 반영.

> [주의] Backend Docker 이미지의 WORKDIR이 변경되면 이 경로도 함께 변경해야 한다. `kubectl exec deploy/etri-llm-backend -- pwd`로 현재 작업 디렉터리를 확인할 수 있다.

**검증 방법**:
```bash
# 모델 API 확인
curl -s http://10.254.184.195:30980/api/files/models
# 정상: {"code":200,"status":true,"data":[{"name":"Llama-3.1-8B-Instruct","type":"folder"}]}

# 데이터셋 API 확인
curl -s http://10.254.184.195:30980/api/files/datasets
# 정상: {"code":200,"status":true,"data":[{"name":"cnn_eval.json","type":"file"},{"name":"mmlu-pro","type":"folder"},{"name":"settings.json","type":"file"}]}
```

---

## 부록 A: Kaniko 빌드 절차

이 서버에는 Docker가 설치되어 있지 않으므로, 컨테이너 이미지 빌드 시 Kubernetes 클러스터 내 Kaniko Pod를 사용한다.

### A.1 사전 준비

Kaniko는 Docker Hub 인증을 위해 `kaniko-secret` 시크릿이 필요하다. 이미 존재하는지 확인한다.

```bash
kubectl get secret kaniko-secret -n llm-evaluation
```

없는 경우 생성:

```bash
kubectl create secret docker-registry kaniko-secret \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=jungwooshim \
  --docker-password=<Docker Hub 토큰> \
  -n llm-evaluation
```

### A.2 Frontend 빌드 예시

```bash
# 1) 빌드 컨텍스트 준비
cd /home/kcloud/etri-llm-exam-solution
tar -czf /tmp/frontend-context.tar.gz --exclude=node_modules -C web .

# 2) NFS 볼륨에 복사 (backend pod 이름은 실제 값으로 교체)
BACKEND_POD=$(kubectl get pod -n llm-evaluation -l app=etri-llm-backend -o jsonpath='{.items[0].metadata.name}')
kubectl cp /tmp/frontend-context.tar.gz llm-evaluation/${BACKEND_POD}:/usr/src/app/mnt/result/frontend-context.tar.gz

# 3) Kaniko Pod 생성
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: kaniko-frontend
  namespace: llm-evaluation
spec:
  restartPolicy: Never
  initContainers:
  - name: setup
    image: busybox
    command: ['sh', '-c', 'mkdir -p /workspace && cd /workspace && tar -xzf /context/frontend-context.tar.gz']
    volumeMounts:
    - name: results-volume
      mountPath: /context
    - name: workspace
      mountPath: /workspace
  containers:
  - name: kaniko
    image: gcr.io/kaniko-project/executor:latest
    args:
    - "--dockerfile=Dockerfile.dev"
    - "--context=dir:///workspace"
    - "--destination=jungwooshim/etri-cloud-frontend:v1.0.0"
    - "--cache=false"
    volumeMounts:
    - name: kaniko-secret
      mountPath: /kaniko/.docker
    - name: workspace
      mountPath: /workspace
  volumes:
  - name: results-volume
    persistentVolumeClaim:
      claimName: results-nfs-pvc
  - name: kaniko-secret
    secret:
      secretName: kaniko-secret
      items:
      - key: .dockerconfigjson
        path: config.json
  - name: workspace
    emptyDir: {}
EOF

# 4) 빌드 진행 확인
kubectl logs -n llm-evaluation kaniko-frontend -f

# 5) 완료 후 Pod 삭제
kubectl delete pod kaniko-frontend -n llm-evaluation
```

### A.3 Backend 빌드 예시

Frontend와 동일하나 다음 값을 변경한다:

- tar 압축 대상: `-C server .`
- Pod 이름: `kaniko-backend`
- `--dockerfile=Dockerfile.prod`
- `--destination=jungwooshim/etri-cloud-backend:v1.0.1`

---

## 16. 향후 변경 작업 전 확인사항

### 16.1 이미지 업데이트 전 체크리스트

- [ ] 현재 운영 중인 이미지 버전 확인: `kubectl get pods -n llm-evaluation -o wide`
- [ ] 현재 Helm 릴리즈 상태 저장: `helm get values app-chart -n llm-evaluation > current-values-backup-$(date +%Y%m%d).yaml`
- [ ] 새 이미지가 Docker Hub에 실제로 존재하는지 확인
- [ ] 데이터베이스 스키마 변경 여부 확인 (마이그레이션 필요 시 절차 별도 수립)
- [ ] NFS 볼륨 데이터 백업 여부 확인

### 16.2 클러스터 재설치 전 체크리스트

- [ ] 현재 Helm 릴리즈 설정 전체 백업
- [ ] PostgreSQL 데이터 백업 (`pg_dump`)
- [ ] NFS 데이터 백업 (모델, 데이터셋, 결과)
- [ ] kubeconfig 백업
- [ ] 모든 Secret 값 기록 (또는 별도 저장소에 저장)

### 16.3 변경 작업 시 주의사항

| 변경 유형 | 주의 사항 |
|---|---|
| values.yaml 수정 | 반드시 백업 후 수정 (`cp values.yaml values.yaml.bak`) |
| helm upgrade | 먼저 `helm diff`로 변경사항 미리 확인 (helm-diff 플러그인 필요) |
| kubectl apply | 직접 YAML 적용 시 Helm과 충돌 가능, 가급적 Helm을 통해 관리 |
| 네임스페이스 삭제 | 데이터 손실 위험, 반드시 PV 백업 후 진행 |
| NFS 경로 변경 | 기존 데이터 마이그레이션 절차 별도 수립 필요 |

### 16.4 helm diff 플러그인 활용 (권장)

```bash
# helm-diff 플러그인 설치
helm plugin install https://github.com/databus23/helm-diff

# 업그레이드 전 변경사항 미리 확인
helm diff upgrade app-chart -n llm-evaluation -f values.yaml ./app-chart/
```

---

## 17. 부록

### 부록 A. 설치 스크립트 역할 정리

| 스크립트 | 위치 | 역할 | 내부 실행 명령 |
|---|---|---|---|
| `install.sh` | `kubespray/` | Kubernetes 클러스터 프로비저닝 | `ansible-playbook cluster.yml` |
| `00-export-kubeconfig` | `kubernetes/` | kubeconfig 환경변수 설정 | `export KUBECONFIG=...` |
| `01-create-ns.sh` | `kubernetes/` | 네임스페이스 생성 (5개) | `kubectl create namespace` |
| `02-deploy-nfs-provisioner.sh` | `kubernetes/` | NFS Provisioner 배포 | `01-install.sh` 호출 |
| `03-deploy-gpu-operator.sh` | `kubernetes/` | GPU Operator 배포 | `01-install.sh` 호출 |
| `04-deploy-loki.sh` | `kubernetes/` | Loki 배포 | `01-install.sh` 호출 |
| `05-deploy-prometheus.sh` | `kubernetes/` | Prometheus + Grafana 배포 | `01-install.sh` 호출 |
| `06-deploy-alloy.sh` | `kubernetes/` | Alloy (로그 에이전트) 배포 | `01-install.sh` 호출 |
| `07-deploy-llm-evaluation.sh` | `kubernetes/` | 앱 배포 | `app-chart/01-install.sh` 호출 |
| `app-chart/01-install.sh` | `kubernetes/app-chart/` | 앱 Helm 신규 설치 | `helm install -n llm-evaluation` |
| `app-chart/02-upgrade.sh` | `kubernetes/app-chart/` | 앱 Helm 업그레이드 | `helm upgrade -n llm-evaluation` |
| `redeploy_full.sh` | `kubernetes/` | 전체 앱 재배포 자동화 | 위 스크립트들 순차 실행 |

### 부록 B. 컨테이너 이미지 참조

| 컴포넌트 | 이미지 | 태그 | pull 정책 |
|---|---|---|---|
| Frontend | `mondrianai/etri-llm-frontend` | `v1.0.0` | Always |
| Backend | `mondrianai/etri-llm-backend` | `latest` | Always |
| K8s API | `mondrianai/etri-llm-k8s-api` | `v1.0.0` | Always |
| K8s Operator | `mondrianai/etri-llm-k8s-operator` | `v1.0.1` | Always |
| PostgreSQL | `postgres` | `15.4-alpine` | (기본값) |

### 부록 C. 서비스 및 포트 요약

| 서비스명 | 네임스페이스 | 서비스 타입 | 클러스터 포트 | 노드 포트 (외부) | 컨테이너 포트 |
|---|---|---|---|---|---|
| etri-llm-frontend-service | llm-evaluation | NodePort | 80 | 30001 | 5173 |
| etri-llm-backend-service | llm-evaluation | NodePort | 9999 | 30980 | 9999 |
| etri-llm-k8s-api-service | llm-evaluation | ClusterIP | 9090 | 없음 | 9090 |
| etri-llm-db-service | llm-evaluation | ClusterIP | 5432 | 없음 | 5432 |
| loki | loki | NodePort | 3100 | 32222 | 3100 |

> [추가 검증 필요] K8s Operator의 서비스 타입 및 포트(9443/8443)는 추가 확인이 필요하다.

### 부록 D. 스토리지 경로 요약

| PV 이름 | NFS 서버 | NFS 경로 | 용량 | PVC 이름 | 사용처 |
|---|---|---|---|---|---|
| `model-nfs-pv` | 10.254.184.195 | `/mnt/models` | 2Ti | `model-nfs-pvc` | Backend: `/usr/src/app/mnt/models/` |
| `dataset-nfs-pv` | 10.254.184.195 | `/mnt/datasets` | 2Ti | `dataset-nfs-pvc` | Backend: `/usr/src/app/mnt/datasets/` |
| `results-nfs-pv` | 10.254.184.195 | `/mnt/results` | 2Ti | `results-nfs-pvc` | Backend: `/usr/src/app/mnt/result/` |
| `etri-llm-db-pv` | 10.254.184.195 | `/mnt/etri-llm-evaluation-postgres` | 100Gi | `etri-llm-db-pvc` | PostgreSQL 데이터 |
| Loki PVC (동적) | (nfs-client 프로비저닝) | 자동 생성 | 500Gi | 자동 생성 | Loki 로그 데이터 |

### 부록 E. 실제 수정 대상 파일 목록

재배포 시 수정 가능한 파일의 완전한 경로 목록이다.

| 용도 | 파일 절대 경로 |
|---|---|
| 앱 이미지 태그 변경 | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/app-chart/values.yaml` |
| NFS Provisioner 설정 | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/nfs-subdir-external-provisioner-4.0.18/values-override.yaml` |
| GPU Operator 설정 | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/gpu-operator-25.10.0/values-override.yaml` |
| Loki 설정 | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/loki-2.2.1/loki/values-override.yaml` |
| Prometheus 설정 | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/kube-prometheus-stack-79.1.1/charts/prometheus/values-override.yaml` |
| Alloy 설정 | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/alloy-1.4.0/values-override.yaml` |
| 앱 NFS PV/PVC | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/app-chart/templates/data-volume.yaml` |
| PostgreSQL 배포 | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/app-chart/templates/database.yaml` |
| Docker Hub pull secret | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/app-chart/templates/regcred.yaml` |
| Kubespray 노드 인벤토리 | `/home/kcloud/etri-llm-deployments/kubespray/inventory/etri/hosts.yml` |
| 클러스터 kubeconfig | `/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/kubeconfig/config` |

### 부록 F. 주요 kubectl 명령 빠른 참조

```bash
# === 상태 확인 ===
kubectl get pods -A                                    # 전체 Pod 상태
kubectl get pods -n llm-evaluation                     # 앱 Pod 상태
kubectl get svc -n llm-evaluation                      # 서비스/포트 확인
kubectl get pvc -A                                     # PVC 상태
kubectl get nodes -o wide                              # 노드 상태

# === 로그 확인 ===
kubectl logs -n llm-evaluation -l app=etri-llm-frontend --tail=50
kubectl logs -n llm-evaluation -l app=etri-llm-backend --tail=50
kubectl logs -n llm-evaluation -l app=etri-llm-db --tail=50

# === 이벤트 확인 ===
kubectl get events -n llm-evaluation --sort-by='.lastTimestamp'

# === Pod 상세 확인 ===
kubectl describe pod <pod-name> -n llm-evaluation

# === 재시작 ===
kubectl rollout restart deployment -n llm-evaluation

# === Helm 관리 ===
helm list -A
helm history app-chart -n llm-evaluation
helm rollback app-chart <revision> -n llm-evaluation

# === DB 접근 ===
kubectl exec -n llm-evaluation -it \
  $(kubectl get pod -n llm-evaluation -l app=etri-llm-db -o jsonpath='{.items[0].metadata.name}') \
  -- psql -U postgres -d llmEvaluationDB
```

---

*본 문서는 `/home/kcloud` 디렉터리의 실제 파일 분석을 기반으로 작성되었으며, 운영 환경에서의 실제 동작은 사전 검증이 필요하다. 파일 상의 불일치 및 추가 검증 필요 사항은 15절을 참조한다.*
