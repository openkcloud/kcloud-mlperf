# Rack 4 kcloud-tool 설치 — 운영/롤백/이식 문서 (2026-06-08)

LIVE OpenStack-on-K8s 시범서비스(KubeSphere/kube-ovn) 위에 **무영향**으로 설치. 모든 리소스는 `kcloud-tool` namespace 내부, cluster-scoped 객체는 namespace 1개뿐.

## 1. 설치된 리소스 (전부 `kcloud-tool` ns, label `app.kubernetes.io/managed-by=kcloud-tool`)
| kind | name | 비고 |
|---|---|---|
| Namespace | `kcloud-tool` | PSA enforce=restricted, istio-injection 미부여 |
| ServiceAccount | `kcloud-mlperf-sa` | automount=false |
| Role/RoleBinding | `kcloud-mlperf-role` / `-rolebinding` | namespaced: pods,pods/log,jobs get/list/watch |
| PVC | `kcloud-mlperf-results` | 1Gi RWO, SC `general`(rook-ceph RBD), Bound (PV pvc-4151fab2…) |
| ConfigMap | `kcloud-mlperf-bench-scripts` / `-cpubench-scripts` / `-netcheck-scripts` / `-singlegen-scripts` / `-microbench-scripts` / `kcloud-mlperf-webui-app` | 벤치/WebUI 스크립트 |
| Job (완료·보존) | `kcloud-mlperf-smoke` / `-cpu-benchmark` / `-endpoint-netcheck` / `-endpoint-single-generation` / `-endpoint-microbench` | 전부 Complete |
| Deployment | `kcloud-mlperf-webui` | 1/1, image python:3.11-slim@sha256:a3ab…, restricted, probes |
| Service | `kcloud-mlperf-webui` | **ClusterIP** 10.233.24.86:80→8080 |

검증 결과: CPU smoke OK / CPU bench OK / endpoint netcheck OK / single-gen OK(=OK., 3tok) / micro-bench 5/5 / **WebUI POST /api/run 5/5 success, p50~0.05s, ~55 tok/s**. 기존 실패 Pod 96(=95 openstack+1 monitoring) 불변, kcloud-tool 외 변경 0.

## 2. 접속
- port-forward (deploy 노드): `svc/kcloud-mlperf-webui 18080:80 --address 0.0.0.0`, pidfile `~/kcloud-render/webui-portforward.pid`, log `~/kcloud-render/webui-portforward.log`.
- URL: **http://localhost:18080 (via: ssh -L 18080:127.0.0.1:18080 -p 12150 kcloud@10.254.202.104) — 10.254.202.104 is uplink-only; or http://192.168.90.150:18080** (deploy host). API: `GET /healthz`, `GET /api/config`, `POST /api/run`, `GET /api/runs`, `GET /api/run/<file>`.
- 결과 저장: PVC `kcloud-mlperf-results` → `/mnt/datasets/webui-runs/run-<ts>.json` (+ 기존 벤치 결과 `/mnt/datasets/{cpu-benchmark,endpoint-*}`).

## 3. ROLLBACK / UNINSTALL (label-scoped; 명시 승인 후에만 실행)
```bash
export KUBECONFIG=$HOME/.kube/config
# 0) port-forward 종료
kill "$(cat ~/kcloud-render/webui-portforward.pid)" 2>/dev/null
# 1) DRY-RUN 먼저 (무변경)
kubectl -n kcloud-tool delete deploy,svc,job,configmap,rolebinding,role,serviceaccount \
  -l app.kubernetes.io/managed-by=kcloud-tool --dry-run=server
# 2) 실삭제 (순서: webui→jobs→cm→rbac)
kubectl -n kcloud-tool delete deploy,svc -l app.kubernetes.io/managed-by=kcloud-tool
kubectl -n kcloud-tool delete job -l app.kubernetes.io/managed-by=kcloud-tool
kubectl -n kcloud-tool delete configmap -l app.kubernetes.io/managed-by=kcloud-tool
kubectl -n kcloud-tool delete rolebinding,role,serviceaccount -l app.kubernetes.io/managed-by=kcloud-tool
# 3) PVC (별도 승인; general=ReclaimPolicy Delete → PV 자동 정리, 신규 RBD라 공유데이터 아님)
# kubectl -n kcloud-tool delete pvc -l app.kubernetes.io/managed-by=kcloud-tool
# 4) namespace (별도 승인; 완전 무흔적)
# kubectl delete namespace kcloud-tool
```
무영향 근거: 전부 신규 ns 내부 + 공통 label로만 식별 → ns 밖 무접촉. cluster-scoped 공유객체(ClusterRole/CRD/Webhook/SC/PV수동) 미생성. PVC의 PV는 `general` 신규 RBD 볼륨.

## 4. 공식 ETRI 차트 Rack4 이식 — 차단요소 & 필요 승인
공식 차트(`app-chart`: frontend v69 + backend v61 + k8s-api v1.0.0 + operator v1.0.1)를 jw와 "동일 구조"로 올리려면:
| 요구 | jw 현황 | Rack4 가능성 | 필요 조치/승인 |
|---|---|---|---|
| **CRD** `exams.resources.etri.llm` | 존재 | 금지(§6 STOP) | **CRD 생성 명시 승인** |
| **ClusterRole×2 + ClusterRoleBinding×2** (api/operator: pods create/delete, nodes patch, jobs, exams) | 존재 | 금지(cluster-scoped) | **ClusterRole/CRB 명시 승인** (또는 단일-ns 한정 Role로 축소 + operator를 namespace-scoped 모드로 — 코드 변경 필요) |
| **PostgreSQL** `etri-llm-db-service:5432` (DB `llmEvaluationDB`) | node4 NFS 백엔드 | ✅ 가능 | kcloud-tool ns 내 postgres Deployment+PVC(아래 §5) |
| **NFS PVC** model/dataset/results-nfs-pvc | node4 NFS exports | ✅ 가능 | §5 S1(Ceph PVC) 또는 S2(storage1 NFS)로 대체 |
| **Secret** (backend env, regcred imagePull) | 평문 DB pw + dockerconfig | 조건부 | DB pw는 신규 랜덤 Secret로 생성(승인), 이미지가 public이면 regcred 불요(확인 필요) |
| **NodePort** frontend:30001 | 사용 | 금지 | values override → **ClusterIP** + port-forward |
| **시험 실행 = 가속기 노드 Job** | A30/RNGD device-plugin | ✅ 아님 | Rack4엔 가속기 k8s 미노출 → operator 시험이 실제 실행되려면 **device-plugin 설치(금지)** 필요. 단 **endpoint 호출형 시험만 한다면** 가속기 불요(백엔드가 외부 endpoint를 호출하도록 설정 시) |

**판정**: DB/스토리지/NodePort는 Rack4-safe하게 해결 가능. **CRD + ClusterRole + (실가속기 시험 시)device-plugin** 만이 명시 승인/별도 트랙 대상. 이 3개를 승인하면 공식 차트 이식 가능; 승인 없이는 **경량 WebUI(이미 설치 완료)** 가 시범서비스용 정답.

### 공식 차트 values override 초안 (Rack4)
```
global.namespace: kcloud-tool
components.etriLLMFrontend.service.type: ClusterIP   # NodePort 제거
components.etriLLMBackend.secret.DATABASE_HOST: etri-llm-db.kcloud-tool.svc.cluster.local
components.etriLLMBackend.secret.DATABASE_PASSWORD: <신규 랜덤, Secret로>
# model/dataset/results PVC → general(-multi-attach) StorageClass 기반 신규 PVC로 교체
# operator/api ClusterRole → (승인 시) 그대로, 또는 namespaced Role + WATCH_NAMESPACE=kcloud-tool
```

## 5. 저장소/DB Migration Plan (jw → Rack4 독립)
### 스토리지 옵션 (Rack4 storage 분석 기반)
- **storage2(.162)/storage3(.163) = 활성 Ceph OSD 노드** → 절대 미접촉.
- **storage1(.161) = Ceph 아님** (ceph procs 0, NFS/postgres 없음, raw 미사용 디스크 4×3.5T+2×3.6T≈14TB). NFS lift-and-shift 후보.
- **S1 (권장, host 무변경)**: 모든 kcloud-tool PVC를 기존 **rook-ceph `general`(RBD,RWO)** + **`general-multi-attach`(CephFS,RWX)** StorageClass로 생성. NFS 설치 불요, 검증 완료(현 PVC가 general로 Bound). models/datasets는 RWX(general-multi-attach), postgres/results는 RWO(general).
- **S2 (대안, 정확한 NFS 재현)**: storage1에 nfs-kernel-server 설치 + jw와 동일 export(`/mnt/models /mnt/datasets /mnt/results /mnt/etri-llm-evaluation-postgres`) 재현 → host mutation(apt+systemctl) = **별도 승인/윈도우** 필요.

### DB migration
- 신규: kcloud-tool ns에 postgres Deployment(예: postgres:16) + PVC(general RWO, 10–20Gi) + 신규 랜덤 비밀번호 Secret → backend가 이 DB를 가리키도록 values 수정. **빈 스키마로 초기화**(백엔드가 TypeORM 마이그레이션 수행) = 가장 안전.
- 기존 jw 데이터 이전이 필요하면: jw node4 `/mnt/etri-llm-evaluation-postgres`에서 `pg_dump`(승인 후) → Rack4 ns postgres로 `psql restore`. **단 jw postgres 중단 금지**(읽기 dump만).

### 데이터(models/datasets) migration
- jw node4 NFS(`/mnt/models`,`/mnt/datasets`)에서 Rack4 대상(S1 CephFS PVC or S2 storage1 NFS)으로 복사. 용량 산정(read-only로 `du -sh` 먼저) + 대역폭/시간 추정 + 체크섬 검증 후 진행. **destructive op 금지, jw 원본 보존.**

## 6. 운영 주의
- `.114:8000`(jw RNGD endpoint)는 jw stateful 백본(NFS postgres/models/results + Prometheus/Loki + 추론). 벤치 시 **항상 furiosa-smi idle 게이트** + 저부하(req≤5/conc1/QPS≤0.2). 운영 정식화하려면 compute1에 RNGD serving 자급(SDK 설치=윈도우) 또는 endpoint를 Rack4 내부로 이전.
- WebUI는 RWO PVC를 점유 → 동시에 같은 PVC를 쓰는 Job을 다른 노드에 띄우지 말 것(WebUI가 in-process로 벤치 수행하므로 불필요).
- port-forward는 deploy host 세션 한정. 영구 외부노출(NodePort/LB/Ingress)은 금지 정책.
