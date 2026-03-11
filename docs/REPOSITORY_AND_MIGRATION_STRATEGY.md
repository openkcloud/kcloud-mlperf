# LLM 성능평가 도구 보관 및 저장소 이관 전략

> 작성일: 2026-03-11 (최종 갱신)
> 작성 목적: `/home/kcloud` 하의 배포 자산을 체계적으로 형상관리하고, 향후 유지보수 가능한 저장소 구조로 이관하기 위한 전략 수립

---

## 1. 문서 목적

본 문서는 ETRI LLM 성능평가 도구의 배포 및 인프라 자산을 다음 관점에서 정리한다.

1. **현재 상태 진단**: `/home/kcloud` 디렉터리에 산재한 배포 자산의 구조와 성격을 파악한다.
2. **형상관리 필요성 논거**: 현재 버전 관리가 없는 상태에서 발생하는 위험과 비용을 명시한다.
3. **저장소 구조 비교**: 여러 Git 저장소 구성 방안을 비교하고 권장안을 제시한다.
4. **벤더 원본 보존**: 납품 원본을 훼손하지 않고 보존하는 방법을 정의한다.
5. **민감 정보 관리**: 패스워드, 인증정보 등이 git에 노출되지 않도록 원칙을 수립한다.
6. **이관 체크리스트**: 실행 가능한 단계별 절차를 제공한다.

---

## 2. 현재 구조 진단

### 2.1 `/home/kcloud` 디렉터리 개요

현재 `/home/kcloud`는 **git 저장소가 아니며**, 벤더 납품 파일과 운영 스크립트가 혼재된 상태이다.

| 경로 | 성격 | 비고 |
|------|------|------|
| `etri-llm-deployments/kubespray/` | 벤더 납품 - 클러스터 프로비저닝 | Kubespray 기반, 수정 이력 없음 |
| `mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/` | 벤더 납품 - 배포 스크립트, Helm 차트, 매니페스트 | 우리가 수정 중 |
| `etri-llm-deployments.zip` | 벤더 납품 원본 아카이브 | 불변 보존 대상 |
| `install.sh` | 운영 스크립트 | 민감정보 포함 (SSH 패스워드) |
| `redeploy_full.sh` | 운영 스크립트 | 추가 검증 필요 |
| `kubeconfig/config` | 클러스터 관리자 인증정보 | 절대 git 업로드 금지 |
| `~/.kube/config` | kubectl 인증정보 | 절대 git 업로드 금지 |
| `INSTALLATION_GUIDE.md`, `USER_GUIDE.md` | 문서 | 공유 가능 |

### 2.2 애플리케이션 소스 위치

- **외부 GitHub 저장소**: `https://github.com/mondrian-cloudteam/etri-llm-exam-solution`
- Mondrian이 소유한 저장소이며, 프론트엔드/백엔드 소스 코드가 위치한다.
- Dockerfile 포함 여부: **추가 검증 필요**

### 2.3 Docker 이미지 현황

- Docker Hub 계정: `jungwooshim/` (frontend/backend), `mondrianai/` (k8s-api/k8s-operator)
- 관리 대상 이미지: 4개
  - `jungwooshim/etri-cloud-frontend:v1.0.0`
  - `jungwooshim/etri-cloud-backend:latest`
  - `mondrianai/etri-llm-k8s-api:v1.0.0`
  - `mondrianai/etri-llm-k8s-operator:v1.0.1`
- 이미지 라이프사이클: 수동 빌드 (Kaniko Pod 사용), CI/CD 미구성

### 2.4 현재 상태 문제점 요약

- **버전 이력 없음**: 누가, 언제, 무엇을 변경했는지 추적 불가
- **롤백 불가**: 배포 실패 시 이전 상태로 되돌릴 수단이 없음
- **민감정보 혼재**: SSH 패스워드, DB 패스워드, 인증서가 평문으로 파일에 존재
- **벤더 원본과 수정본 구분 불가**: 어느 파일이 납품 원본이고 어느 파일이 우리가 수정한 것인지 불명확

---

## 3. 왜 형상관리가 필요한가

### 3.1 운영 리스크 관점

| 시나리오 | 현재 상태의 위험 | 형상관리 적용 시 |
|----------|-----------------|-----------------|
| 설정 파일 잘못 수정 | 원래 값 알 수 없음 | `git diff`, `git revert`로 즉시 복구 |
| 배포 담당자 교체 | 인수인계 문서 의존, 누락 가능 | git 이력이 인수인계 문서 역할 |
| 동일 환경 재구성 | 기억과 파일에만 의존 | 저장소 체크아웃 후 스크립트 실행 |
| 벤더와 우리 변경 혼재 | 구분 불가 | 브랜치/태그로 명확히 구분 |

### 3.2 감사·납품 관점

- 국가 R&D 과제 특성상 **납품 원본 보존** 및 **변경 이력 제출** 요구가 발생할 수 있다.
- git 이력이 있으면 "벤더 납품 이후 우리가 변경한 사항"을 증명할 수 있다.

### 3.3 협업 관점

- 현재는 단일 서버 계정에서 파일 직접 편집 → 동시 수정 충돌, 실수에 취약
- git을 통해 변경 검토(pull request), 승인 절차를 도입할 수 있다.

---

## 4. Git 적용 적합성 평가

### 4.1 Git에 적합한 자산

다음 파일들은 **텍스트 기반**이므로 Git으로 관리하기에 적합하다.

| 파일 유형 | 예시 | 적합 이유 |
|-----------|------|-----------|
| Helm 차트 | `app-chart/values.yaml` | YAML 텍스트, diff 추적 용이 |
| Kubernetes 매니페스트 | `data-volume.yaml`, `database.yaml` | YAML 텍스트 |
| 셸 스크립트 | `install.sh`, `redeploy_full.sh` | 텍스트, 변경 이력 중요 |
| Helm values override | `values-override.yaml` 류 | YAML 텍스트 |
| 문서 | `*.md` | 마크다운 텍스트 |
| Kubespray inventory (패스워드 제거 후) | `hosts.yml` | 텍스트 (민감정보 제거 필수) |

### 4.2 Git에 적합하지 않은 자산

다음 파일들은 **바이너리 또는 민감정보 포함**으로 일반 git에 올리면 안 된다.

| 파일 유형 | 예시 | 이유 |
|-----------|------|------|
| zip 아카이브 | `etri-llm-deployments.zip` | 바이너리, git diff 불가, 용량 문제 |
| deb 패키지 | `*.deb` (있을 경우) | 바이너리 |
| kubeconfig | `kubeconfig/config`, `~/.kube/config` | 클러스터 관리자 인증정보 |
| 패스워드가 든 hosts.yml | `kubespray/inventory/etri/hosts.yml` | SSH 패스워드 평문 |
| 패스워드가 든 database.yaml | `database.yaml` | DB 패스워드 평문 |
| Docker Hub 인증정보 | `app-chart/values.yaml` 내 base64 시크릿 | 자격증명 |

> **원칙**: 한 번이라도 git에 올라간 민감정보는 이력에서도 남는다. 최초 커밋 전에 반드시 제거하거나 플레이스홀더로 대체해야 한다.

### 4.3 `.gitignore` 권장 항목

```gitignore
# 바이너리 아카이브
*.zip
*.deb
*.tar.gz

# 클러스터 인증정보
kubeconfig/
.kube/
**/*.kubeconfig

# 패스워드가 포함된 파일 (원본 보존용, git 제외)
kubespray/inventory/etri/hosts.yml
# → 패스워드 제거한 hosts.yml.template 은 포함 가능

# 로컬 편의 설정
.DS_Store
*.swp
*.bak

# 생성된 산출물
*.log
```

---

## 5. 가능한 저장소 구조안 비교

### 5.1 Monorepo (단일 저장소)

**구조 예시**
```
etri-llm/
├── app/               # 프론트엔드 + 백엔드 소스
├── infra/             # Helm 차트, 매니페스트, 스크립트
├── docs/              # 문서
└── .gitignore
```

**장점**
- 저장소 1개로 단순 관리
- 앱 코드와 인프라 코드를 함께 검색·참조 가능
- CI/CD 파이프라인 단일화 용이

**단점**
- 앱 소스(잦은 변경)와 인프라(드문 변경)의 변경 주기가 달라 커밋 이력이 혼재
- Mondrian의 GitHub 저장소를 그대로 포크하면 벤더 코드와 우리 인프라가 섞임
- 접근 권한 분리가 어렵다 (인프라 담당자에게 앱 소스가 노출되는 등)
- 저장소가 커질수록 clone 시간 증가

**평가**: 소규모 단일팀에는 단순하지만, 본 프로젝트처럼 이미 Mondrian 소유의 외부 저장소가 존재하는 경우 구조가 어색해진다.

---

### 5.2 Polyrepo (관심사별 복수 저장소)

**구조 예시**
```
etri-llm-app/       # 앱 소스 저장소
etri-llm-infra/     # 인프라 저장소
etri-llm-docs/      # 문서 저장소
etri-llm-kubespray/ # 클러스터 프로비저닝 저장소
```

**장점**
- 관심사가 명확히 분리되어 각 저장소가 독립적으로 버전 관리됨
- 팀/담당자별 접근 권한 세밀하게 설정 가능
- 저장소별 CI/CD 파이프라인 독립 운영

**단점**
- 저장소 4개 이상을 관리해야 하므로 관리 오버헤드 증가
- 앱 버전 v2와 인프라 버전 v1.3이 맞는지 등 **교차 저장소 의존성 관리**가 복잡
- 신규 참여자가 어느 저장소부터 봐야 하는지 혼란

**평가**: 팀 규모가 크거나 각 도메인의 담당자가 완전히 분리된 경우에 적합. 현재 소규모 운영 환경에는 과도할 수 있다.

---

### 5.3 불변 아카이브 + 작업 저장소 (Immutable Archive + Working Repo)

**구조 예시**
```
[별도 스토리지: S3, NAS, GitHub Releases]
  └── etri-llm-deployments.zip  # 벤더 납품 원본, 불변

[작업 저장소: etri-llm-working]
  ├── infra/    # 우리가 수정한 파일만 포함
  └── docs/
```

**장점**
- 벤더 원본과 우리 수정본이 물리적으로 완전히 분리됨
- "우리가 변경한 것만" 저장소에 존재하므로 책임 소재 명확

**단점**
- 전체 그림을 보려면 아카이브와 저장소를 모두 참조해야 함
- 파일이 어디에 속하는지(원본 vs 수정본) 판단 기준이 모호할 수 있음
- 아카이브 스토리지 별도 관리 필요

**평가**: 벤더 원본 보존 요건이 강한 경우 유효하나, 단독으로 사용하면 작업 저장소가 불완전해 보인다. **다른 안과 병행**하는 것이 현실적이다.

---

### 5.4 앱 저장소 / 인프라 저장소 / 문서 저장소 분리안 (권장)

**구조 예시**
```
etri-llm-app/     # Mondrian GitHub 포크 또는 미러
  ├── frontend/
  ├── backend/
  └── Dockerfile* (추가 검증 필요)

etri-llm-infra/   # /home/kcloud 배포 자산
  ├── app-chart/
  │   ├── values.yaml.template  # 민감정보 제거본
  │   └── values.yaml           # .gitignore 처리
  ├── kubernetes/
  │   ├── data-volume.yaml
  │   └── database.yaml.template
  ├── kubespray-config/
  │   └── hosts.yml.template    # 패스워드 제거본
  ├── nfs-subdir-external-provisioner-4.0.18/
  │   └── values-override.yaml
  ├── scripts/
  │   ├── install.sh.template   # 패스워드 제거본
  │   └── redeploy_full.sh
  └── docs/
      ├── INSTALLATION_GUIDE.md
      └── USER_GUIDE.md

etri-llm-docs/    # (선택) 별도 문서 저장소
  ├── REPOSITORY_AND_MIGRATION_STRATEGY.md
  └── ...
```

**장점**
- **이미 존재하는 분리**를 자연스럽게 반영: 앱 소스는 GitHub(Mondrian), 인프라는 `/home/kcloud`
- 앱과 인프라가 독립적으로 버전 관리되어 각자의 릴리즈 주기를 가짐
- Mondrian 저장소 포크로 앱 소스 소유권 확보 가능
- 인프라 저장소에 민감정보 제거 원칙 적용이 용이

**단점**
- 저장소 2~3개를 관리해야 함
- 앱 이미지 태그와 인프라 values.yaml의 이미지 참조를 동기화하는 프로세스 필요

**평가**: 현재 상황에 가장 적합한 구조. 아래 "권장안"으로 채택.

---

## 6. 권장안

> **앱 저장소 + 인프라 저장소 분리 (5.4안) + 벤더 원본 별도 보존 (5.3안 병행)**

### 6.1 저장소 구성

| 저장소명 | 용도 | 초기 소스 | 비고 |
|----------|------|-----------|------|
| `etri-llm-app` | 애플리케이션 소스 (프론트엔드, 백엔드, Dockerfile) | Mondrian GitHub 포크 | 사용자 확인 필요: 포크 권한 여부 |
| `etri-llm-infra` | 배포 자산 (Helm 차트, 매니페스트, 스크립트) | `/home/kcloud` 배포 자산 | 민감정보 제거 후 |
| `etri-llm-docs` | 문서 (선택) | 현재 `.md` 파일들 | 인프라 저장소에 포함해도 무방 |

### 6.2 벤더 원본 보존 위치

| 자산 | 보존 위치 | 방법 |
|------|-----------|------|
| `etri-llm-deployments.zip` | S3, NAS, 또는 GitHub Releases | 불변 아카이브 |
| `mondrianai-etri-llm-deployments-a9c4c59c4869/` (원본 상태) | `etri-llm-infra` 저장소 `vendor/v1.0.0` 태그 | git tag |

### 6.3 저장소 호스팅

- **GitHub**: 공개/비공개 저장소 모두 지원. 조직(Organization) 단위 운영 권장. (사용자 확인 필요: 내부 GitLab/Gitea 사용 여부)
- **접근 권한**: 인프라 저장소는 `private`으로 설정하고 필요한 담당자만 접근

---

## 7. 권장안 선택 이유

### 7.1 현실 구조와의 일치

현재 이미 두 개의 분리된 소스가 존재한다.

- **앱 소스**: Mondrian의 GitHub 저장소 (외부)
- **인프라 자산**: `/home/kcloud` 서버 (내부)

이 자연스러운 경계를 저장소 구조로 그대로 반영하면, 변환 비용이 최소화되고 팀원이 직관적으로 이해할 수 있다.

### 7.2 변경 주기의 분리

- **앱 소스**: 기능 개발, 버그 수정 시마다 변경 → 잦은 커밋, CI/CD 빌드 트리거
- **인프라 자산**: 배포 환경 변경, 설정 조정 시에만 변경 → 드문 커밋, 신중한 검토

두 주기가 다른 자산을 같은 저장소에 두면 이력이 오염된다.

### 7.3 소유권과 책임 명확화

- 앱 저장소: 개발팀 (또는 Mondrian) 소유
- 인프라 저장소: 인프라/운영팀 소유
- 각 저장소에 별도의 코드 리뷰, 배포 정책 적용 가능

### 7.4 민감정보 격리 용이

인프라 저장소만 별도로 `private` 운영하고, 시크릿 관리 정책을 집중 적용할 수 있다.

---

## 8. 벤더 원본 보존 전략

### 8.1 보존 원칙

납품 원본은 **절대 수정하지 않고**, 납품 당시의 상태 그대로 보존한다.

### 8.2 zip 아카이브 보존

`etri-llm-deployments.zip`은 텍스트 파일이 아닌 바이너리 아카이브이므로 git 일반 커밋에 포함하지 않는다.

**권장 보존 방법** (우선순위 순):

1. **GitHub Releases**: `etri-llm-infra` 저장소의 `v0.0.0-vendor` 릴리즈에 zip 파일 첨부
2. **S3 / 기관 NAS**: `s3://etri-llm-artifacts/vendor/etri-llm-deployments.zip` 형태로 보존
3. **Git LFS**: 저장소 내에서 바이너리를 관리해야 하는 경우 (추가 설정 필요)

> 방법 3 Git LFS는 GitHub 무료 계정에서 용량 제한이 있다. 사용자 확인 필요.

### 8.3 디렉터리 원본 스냅샷 보존 (git tag)

`mondrianai-etri-llm-deployments-a9c4c59c4869/` 디렉터리의 **납품 당시 상태**를 git 이력에 고정한다.

```bash
# 1. etri-llm-infra 저장소 초기화
git init etri-llm-infra
cd etri-llm-infra

# 2. 벤더 파일 복사 (민감정보 포함 파일은 .gitignore 처리 후)
cp -r /home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/kubernetes/* .

# 3. 최초 커밋 (벤더 원본 상태)
git add .
git commit -m "chore: vendor baseline from Mondrian delivery (2024-xx-xx)"

# 4. 벤더 베이스라인 태그
git tag vendor/v1.0.0
git tag -a vendor/v1.0.0 -m "Mondrian 납품 원본 (etri-llm-deployments.zip 동일 상태)"
```

이후 우리가 수정하는 모든 변경은 이 태그 이후의 커밋으로 추적된다.

### 8.4 벤더 원본 체크섬 기록

원본 파일 무결성 검증을 위해 체크섬을 문서화한다.

```bash
sha256sum /home/kcloud/etri-llm-deployments.zip
# 결과를 INSTALLATION_GUIDE.md 또는 별도 CHECKSUMS.md에 기록
```

> 현재 체크섬 값: **사용자 확인 필요** (명령 실행 후 기록할 것)

---

## 9. 향후 우리가 수정할 자산의 관리 전략

### 9.1 수정 대상 파일 목록

| 파일 | 주요 수정 내용 | 민감정보 포함 여부 |
|------|---------------|-------------------|
| `app-chart/values.yaml` | 이미지 태그, 포트, 환경별 설정 | 예 (Docker Hub 인증정보, DB 패스워드 참조) |
| `data-volume.yaml` | PVC 크기, 스토리지 클래스 | 아니오 |
| `database.yaml` | DB 설정 | 예 (DB 패스워드 평문) |
| `nfs-subdir-external-provisioner-4.0.18/values-override.yaml` | NFS 서버 주소, 경로 | 환경별 IP 포함 가능 |
| `kubespray/inventory/etri/hosts.yml` | 노드 IP, 사용자명 | 예 (SSH 패스워드) |
| `install.sh` | 설치 자동화 스크립트 | 예 (SSH 패스워드 하드코딩) |

### 9.2 민감정보 파일 처리 전략

민감정보를 포함하는 파일에 대해 **템플릿 분리** 방식을 사용한다.

```
파일명.yaml          ← 실제 값 포함, .gitignore에 등록
파일명.yaml.template ← 플레이스홀더 사용, git에 커밋
```

**예시: `database.yaml.template`**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
stringData:
  password: "{{ DB_PASSWORD }}"  # 실제 값은 환경변수 또는 Vault에서 주입
```

### 9.3 브랜치 전략

```
main (또는 master)
  └── 현재 운영 중인 안정 상태

vendor/v1.0.0 [tag]
  └── 벤더 납품 원본 상태

release/v1.x.x [tag]
  └── 특정 배포 시점 스냅샷

feat/image-update
feat/nfs-config-change
  └── 기능별 작업 브랜치
```

### 9.4 변경 관리 절차

1. `main`에서 작업 브랜치 생성 (`git checkout -b feat/변경내용`)
2. 변경 사항 작업
3. `git diff vendor/v1.0.0` 으로 벤더 원본 대비 변경 확인
4. Pull Request를 통해 리뷰 후 `main` 병합
5. 배포 시점에 릴리즈 태그 부착

---

## 10. Secret / Config / Credential 관리 원칙

### 10.1 현재 민감정보 현황

| 위치 | 민감정보 | 위험도 |
|------|---------|-------|
| `install.sh` | SSH 패스워드 `<SUDO_PASS>` | 높음 |
| `kubespray/inventory/etri/hosts.yml` | SSH 패스워드 평문 | 높음 |
| `app-chart/values.yaml` | Docker Hub 인증정보 (base64) | 높음 |
| `database.yaml` | DB 패스워드 `<DB_PASSWORD>` | 높음 |
| `kubeconfig/config` | 클러스터 관리자 인증정보 | 매우 높음 |
| `~/.kube/config` | kubectl 인증정보 | 매우 높음 |

> **경고**: 위 파일들 중 어느 하나라도 실수로 git에 커밋되면, 이후 git 이력 정리(BFG Repo Cleaner 등)가 필요하며 해당 인증정보는 즉시 교체해야 한다.

### 10.2 즉시 수행해야 할 조치

1. **패스워드 변경 계획 수립**: `<SUDO_PASS>`, `<DB_PASSWORD>` 등 문서에 언급된 패스워드는 이 문서가 공유되기 전에 교체 필요. (**사용자 확인 필요**)
2. **Docker Hub 인증정보 교체**: base64 인코딩은 암호화가 아님. Docker Hub에서 토큰 재발급 권장.
3. **kubeconfig 접근 제한**: `chmod 600 ~/.kube/config` 및 서버 접근 제한

### 10.3 권장 시크릿 관리 방법

| 방법 | 설명 | 권장 시나리오 |
|------|------|--------------|
| **Kubernetes Secrets** | 클러스터 내 시크릿 오브젝트 | 기본 방법, 단독 사용 시 etcd 암호화 필요 |
| **SOPS + age/GPG** | 파일 암호화 후 git 커밋 가능 | 소규모 팀, 추가 인프라 없이 시작 가능 |
| **Sealed Secrets** | 암호화된 시크릿을 git에 커밋 | Kubernetes 클러스터가 있는 경우 |
| **HashiCorp Vault** | 중앙 시크릿 관리 서버 | 대규모, 감사 로그 필요 시 |
| **환경변수 / .env** | 로컬 개발용 | git에 절대 커밋 금지, .gitignore 필수 |

**권장 조합** (현재 규모에 적합):
- 단기: `.gitignore` + `*.template` 패턴으로 민감파일 제외
- 중기: **SOPS + age** 도입으로 암호화된 채 git 관리
- 장기: 운영 성숙 시 Vault 또는 클라우드 시크릿 매니저 도입

### 10.4 `.gitignore` 패턴 (민감정보)

```gitignore
# 인증정보 및 시크릿
kubeconfig/
.kube/
*.kubeconfig
*-secret.yaml
*-credentials.yaml

# 패스워드 포함 파일 (원본)
install.sh
kubespray/inventory/etri/hosts.yml
app-chart/values.yaml
database.yaml

# 위 파일들의 template 버전은 git에 포함:
# install.sh.template
# kubespray/inventory/etri/hosts.yml.template
# app-chart/values.yaml.template
# database.yaml.template
```

---

## 11. 새 저장소로 이관할 때 체크리스트

### Phase 0: 사전 준비 (1~2일)

- [ ] GitHub Organization 또는 GitLab 그룹 생성 결정 (**사용자 확인 필요**: 조직명, 플랫폼)
- [ ] 팀 멤버 계정 정리 및 접근 권한 계획 수립
- [ ] 현재 서버 파일 전체 백업 (`tar czf /backup/kcloud-$(date +%Y%m%d).tar.gz /home/kcloud`)
- [ ] 위 체크섬 실행: `sha256sum /home/kcloud/etri-llm-deployments.zip` 기록
- [ ] 교체 예정인 패스워드 목록 작성 및 교체 일정 확정

### Phase 1: 인프라 저장소 초기화 (1~2일)

- [ ] `etri-llm-infra` 저장소 생성 (private)
- [ ] `.gitignore` 작성 (Section 4.3, 10.4 참고)
- [ ] 민감정보 포함 파일 → `.template` 버전 생성 (플레이스홀더 적용)
  - [ ] `install.sh.template`
  - [ ] `kubespray/inventory/etri/hosts.yml.template`
  - [ ] `app-chart/values.yaml.template`
  - [ ] `database.yaml.template`
- [ ] 민감정보 제거된 파일들 `git add` 및 최초 커밋
  ```bash
  git commit -m "chore: vendor baseline - Mondrian delivery assets"
  ```
- [ ] 벤더 베이스라인 태그 부착
  ```bash
  git tag -a vendor/v1.0.0 -m "Mondrian 납품 원본 기준선"
  ```

### Phase 2: 벤더 원본 아카이브 보존 (반나절)

- [ ] `etri-llm-deployments.zip` 체크섬 기록 후 GitHub Releases 또는 NAS에 업로드
- [ ] 보존 위치 URL/경로를 `README.md`에 기록
- [ ] 원본 아카이브가 정상적으로 접근 가능한지 확인

### Phase 3: 앱 저장소 확보 (사용자 확인 후)

- [ ] Mondrian GitHub 저장소 포크 가능 여부 확인 (**사용자 확인 필요**)
  - 포크 가능: `etri-llm-app` 저장소로 포크
  - 포크 불가: Mondrian으로부터 소스 코드 전달받아 새 저장소 생성
- [ ] Dockerfile 위치 확인 및 빌드 테스트 (**추가 검증 필요**)
- [ ] Docker 이미지 4개의 이름/태그 목록 정리 (**사용자 확인 필요**)

### Phase 4: 운영 설정 마이그레이션 (1~2일)

- [ ] 우리가 수정한 내용을 `main` 브랜치에 커밋 (벤더 원본과의 diff 검토 후)
- [ ] `git diff vendor/v1.0.0 HEAD` 로 변경 사항 목록 확인·문서화
- [ ] 현재 운영 중인 배포 상태 태그 부착
  ```bash
  git tag -a release/v1.0.0 -m "2026-03-10 현재 운영 중인 배포 상태"
  ```

### Phase 5: CI/CD 파이프라인 구성 (선택, 1~3일)

- [ ] 이미지 빌드 자동화 파이프라인 설계 (**사용자 확인 필요**: GitHub Actions vs Jenkins vs 기타)
- [ ] `app-chart/values.yaml`의 이미지 태그 자동 업데이트 방식 결정 (GitOps 여부)
- [ ] 시크릿 주입 방식 확정 (SOPS, Sealed Secrets, 환경변수 등)

### Phase 6: 검증 및 문서화 (반나절~1일)

- [ ] 새 저장소에서 체크아웃 후 배포 재현 가능한지 테스트
- [ ] `README.md`에 저장소 구조, 배포 방법, 시크릿 주입 방법 기술
- [ ] 팀 멤버에게 변경된 워크플로우 공유

---

## 12. 사용자 확인 필요 사항

아래 항목들은 현재 정보만으로 결정할 수 없으며, 담당자 확인이 필요하다.

| 번호 | 항목 | 확인 내용 |
|------|------|-----------|
| 1 | Mondrian GitHub 저장소 포크 권한 | `etri-llm-exam-solution` 저장소를 우리 조직으로 포크할 수 있는가? 라이선스/계약 조건 확인 필요 |
| 2 | Docker 이미지 4개 목록 | `mondrianai/` 계정의 이미지명 및 태그 전체 목록 |
| 3 | Dockerfile 위치 | 앱 소스 저장소에 Dockerfile이 있는가? 없다면 벤더로부터 확보 필요 |
| 4 | git 저장소 호스팅 플랫폼 | GitHub 공개/비공개, 내부 GitLab, 기관 Gitea 등 어느 플랫폼을 사용할 것인가? |
| 5 | 조직(Organization)명 | git 저장소를 만들 조직 또는 사용자 계정명 |
| 6 | 패스워드 교체 일정 | `<SUDO_PASS>`, DB 패스워드, Docker Hub 인증정보 교체 가능 시점 |
| 7 | CI/CD 도구 | GitHub Actions, Jenkins, ArgoCD 등 자동화 도구 선택 |
| 8 | 벤더 원본 아카이브 보존 위치 | S3, 기관 NAS, GitHub Releases 중 어느 것이 가능한가? |
| 9 | `redeploy_full.sh` 내용 | 민감정보 포함 여부 확인 필요 (현재 미확인) |
| 10 | 납품 일자 | `vendor/v1.0.0` 태그 메시지에 기록할 실제 납품일 |

---

## 13. 부록

### 13.1 용어 정리

| 용어 | 설명 |
|------|------|
| **Monorepo** | 여러 프로젝트/모듈을 하나의 git 저장소에서 관리하는 방식 |
| **Polyrepo** | 각 관심사를 별도 git 저장소로 분리 관리하는 방식 |
| **Helm 차트** | Kubernetes 애플리케이션 배포를 위한 패키지 관리 도구 |
| **values.yaml** | Helm 차트의 설정값을 정의하는 파일 |
| **Kubespray** | Ansible 기반 Kubernetes 클러스터 프로비저닝 도구 |
| **SOPS** | 파일 암호화 도구. age/GPG 키로 YAML, JSON 파일 암호화 가능 |
| **Sealed Secrets** | Kubernetes 클러스터 공개키로 암호화된 시크릿을 git에 저장하는 방식 |
| **GitOps** | git을 단일 진실 소스로 삼아 인프라 및 앱 배포를 선언적으로 관리하는 방식 |
| **Git LFS** | Git Large File Storage. 바이너리 파일을 git에서 효율적으로 관리하는 확장 |
| **vendor baseline** | 벤더 납품 원본 상태를 git 이력에 고정하는 기준점 |

### 13.2 참고 링크

| 항목 | URL |
|------|-----|
| 앱 소스 저장소 (Mondrian) | https://github.com/mondrian-cloudteam/etri-llm-exam-solution |
| Kubespray 공식 문서 | https://kubespray.io |
| SOPS 공식 저장소 | https://github.com/getsops/sops |
| Sealed Secrets | https://github.com/bitnami-labs/sealed-secrets |
| Helm 공식 문서 | https://helm.sh/docs |
| GitHub Releases 파일 첨부 | https://docs.github.com/en/repositories/releasing-projects-on-github |

### 13.3 현재 파일 구조 스냅샷 (진단 시점 기준)

```
/home/kcloud/
├── etri-llm-deployments/
│   └── kubespray/                          # 벤더 납품: 클러스터 프로비저닝
│       └── inventory/etri/hosts.yml        # [민감정보] SSH 패스워드
├── mondrianai-etri-llm-deployments-a9c4c59c4869/
│   └── kubernetes/                         # 벤더 납품: 배포 스크립트, Helm 차트
│       ├── app-chart/
│       │   └── values.yaml                 # [민감정보] Docker Hub 인증정보, 포트, 이미지
│       ├── data-volume.yaml
│       ├── database.yaml                   # [민감정보] DB 패스워드 평문
│       ├── nfs-subdir-external-provisioner-4.0.18/
│       │   └── values-override.yaml
│       └── ...
├── etri-llm-deployments.zip               # 벤더 납품 원본 아카이브 (불변 보존 대상)
├── install.sh                             # [민감정보] SSH 패스워드 하드코딩
├── redeploy_full.sh                       # 추가 검증 필요
├── kubeconfig/config                      # [민감정보] 클러스터 관리자 인증정보
├── INSTALLATION_GUIDE.md
├── USER_GUIDE.md
└── REPOSITORY_AND_MIGRATION_STRATEGY.md  # 이 문서
```

### 13.4 권장 `.gitignore` 전체본

```gitignore
# ============================================================
# etri-llm-infra 저장소용 .gitignore
# ============================================================

# 바이너리 / 아카이브
*.zip
*.tar.gz
*.tar.bz2
*.deb
*.rpm

# Kubernetes 인증정보
kubeconfig/
.kube/
*.kubeconfig
**/admin.conf

# 패스워드 포함 파일 (원본)
# → 대신 *.template 파일을 git에 커밋
install.sh
kubespray/inventory/etri/hosts.yml
app-chart/values.yaml
database.yaml

# 환경 변수 파일
.env
.env.*
!.env.template

# 편집기/OS 임시 파일
.DS_Store
Thumbs.db
*.swp
*.swo
*~

# 로그
*.log
logs/

# Helm 의존성 (다운로드되는 것)
charts/
```

---

*본 문서는 2026-03-11 기준 `/home/kcloud` 환경 분석을 바탕으로 작성되었다. 환경 변경 시 갱신이 필요하다.*
