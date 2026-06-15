> Note: ETRI takeover migration 2026-05-12 — sister deployment directory previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming); now ETRI-owned at `/home/kcloud/etri-llm-deployments/app/`. Container images previously under `mondrianai/*` Docker Hub org are migrating to `ghcr.io/etri-llm/*`. Historical mentions of the legacy names below are preserved for context.

# Live Deployment vs Repo Gap Audit

**RUN_ID:** 20260428-083516-4b786d4  
**Audited:** 2026-04-28T08:42 UTC  
**Auditor:** worker-2 (Lane B, READ-ONLY)

---

## Verdict

**Deployed code matches repo HEAD: NO**

The deployed v14 image was built from the `mondrianai-etri-llm-deployments` repo at commit `623b314`. The `etri-llm-exam-solution` source repo HEAD is `4b786d4`, which is 5 commits ahead of the state captured in v14. Three planned backend endpoints (`/api/gpu-sweep/options`, `/api/comparison`, `/api/devices`) are absent both from the deployed image and the source repo — they are not yet implemented.

---

## Image Tags: Deployed vs Repo

| Component | Deployed Image | Repo values.yaml Image | Match |
|---|---|---|---|
| backend | `jungwooshim/etri-llm-backend:v14` | `jungwooshim/etri-llm-backend:v14` | YES (tag) |
| frontend | `jungwooshim/etri-llm-frontend:v14` | `jungwooshim/etri-llm-frontend:v14` | YES (tag) |
| api | `ghcr.io/etri-llm/etri-llm-k8s-api:v1.0.0` | `ghcr.io/etri-llm/etri-llm-k8s-api:v1.0.0` | YES |
| operator | `mondrianai/etri-llm-k8s-operator:v1.0.1` | `mondrianai/etri-llm-k8s-operator:v1.0.1` | YES |

Tags match `values.yaml`, but the source code embedded in the v14 image is behind the current solution repo HEAD.

---

## Helm Release

| Field | Value |
|---|---|
| Release name | `app-chart` |
| Namespace | `llm-evaluation` |
| Chart version | `app-chart-0.1.0` (appVersion 1.16.0) |
| Current revision | **7** |
| Last upgrade | **Tue Apr 28 08:21:46 2026 UTC** (~17 min before audit) |
| Status | `deployed` |

---

## Git SHA Gap

| Repo | HEAD SHA | Notes |
|---|---|---|
| `etri-llm-exam-solution` (source) | `4b786d4e4a07d1d53ff1702737f636fa65fd8eaf` | Current working source |
| `mondrianai-etri-llm-deployments` (deploy) | `623b314ca5c48f344c7b17bf3773835516e13566` | v14 was built here |
| `/api/version` reported `git_sha` | `"unknown"` | Build env does not inject SHA |

Commits in source repo NOT included in v14 image (5 commits ahead):
1. `4b786d4` — fix(version): resolve package.json across dev/prod paths
2. `86df714` — Merge improve/app-wide-self-improvement (3 comparison pages, JobStatusFooter, /api/version, matrix 110, Loki fix, mmExamService.stop fix)
3. `fbc1f5c` — improve: 4 verified batches — menu pages working
4. `47dc2d9` — improve: 3 verified safe batches + full audit
5. `71c9c77` — feat: Train A GPU saturation + dashboard, route cleanup, dev/migration scripts

---

## Backend Endpoint Audit

| Endpoint | HTTP Status | Response Shape | Notes |
|---|---|---|---|
| `GET /api/version` | 200 | `{code,status,message,data:{git_sha,image_digest,build_time,node_version,app_version}}` | `git_sha:"unknown"`, `image_digest:"unknown"` |
| `GET /api/gpu-sweep/preview` | 200 | `{code,status,message,data:{total_cells:110,cells:[...]}}` | Working; 110 cells |
| `GET /api/gpu-sweep/status` | 200 | `{code,status,message,data:{enabled,paused,reason,active_sweep,node_state:{node2,node3}}}` | sweep disabled |
| `GET /api/gpu-sweep/options` | **404** | `{code:404,status:false,message:"Cannot GET /api/gpu-sweep/options",data:null}` | Not implemented in source |
| `GET /api/realtime/exams/snapshot` | 200 | `{data:{timestamp,slots:[4 slots],sweep_progress,operator_race_alerts}}` | **slots have null metrics even when running** (see below) |
| `GET /api/comparison` | **404** | `{code:404,status:false,message:"Cannot GET /api/comparison",data:null}` | Not implemented in source |
| `GET /api/devices` | **404** | `{code:404,status:false,message:"Cannot GET /api/devices",data:null}` | Not implemented in source |

### /api/realtime/exams/snapshot — slot detail

4 slots returned. One slot (`slot_id:1`, NVIDIA-A40, node2) shows `status:"running"` with `current_exam:{id:52,kind:"mm",exam_name:"MMLU-A40-FP8-Full-v2",elapsed_seconds:1108}`, yet `last_known_metric:{tps:null,tt100t_seconds:null}`. The other 3 slots are idle with null metrics. **Confirmed: running jobs report null metrics.**

---

## Frontend Route Audit

All routes return HTTP 200 with 464 bytes — this is the SPA shell (index.html). Client-side React router handles actual routing. All routes are served correctly by the SPA.

| Route | HTTP Status | Body bytes | Notes |
|---|---|---|---|
| `/` | 200 | 464 | SPA shell |
| `/dashboard/gpu-realtime` | 200 | 464 | SPA shell |
| `/dashboard/sweep-control` | 200 | 464 | SPA shell |
| `/mlperf/device-comparison` | 200 | 464 | SPA shell |
| `/mmlu/device-comparison` | 200 | 464 | SPA shell |
| `/npu-eval/device-comparison` | 200 | 464 | SPA shell |

Frontend pages that depend on missing backend endpoints (`/api/comparison`, `/api/devices`, `/api/gpu-sweep/options`) will render blank or show errors at runtime.

---

## Gap Summary

| Gap | Severity | Description |
|---|---|---|
| Source code 5 commits ahead of deployed image | HIGH | v14 does not include latest fixes (version resolver, comparison pages, JobStatusFooter, Loki fix, mmExamService.stop fix) |
| `/api/gpu-sweep/options` missing | HIGH | Required by sweep-control UI; not implemented in source |
| `/api/comparison` missing | HIGH | Required by 3 device-comparison pages; not implemented in source |
| `/api/devices` missing | HIGH | Required by device registry / dashboard refactor; not implemented in source |
| `git_sha:"unknown"` in /api/version | MEDIUM | Build process does not inject git SHA into image; no traceability |
| Realtime slots null metrics while running | HIGH | `last_known_metric.tps` is null even when exam is running; dashboard shows no live data |

---

## Rebuild + Redeploy Command (when ready)

```bash
# From etri-llm-exam-solution repo root
# 1. Build and push backend
docker build -t jungwooshim/etri-llm-backend:v15 ./server
docker push jungwooshim/etri-llm-backend:v15

# 2. Build and push frontend
docker build -t jungwooshim/etri-llm-frontend:v15 ./web
docker push jungwooshim/etri-llm-frontend:v15

# 3. Update helm values and upgrade
cd /path/to/mondrianai-etri-llm-deployments/kubernetes/app-chart
# Edit values.yaml: bump backend and frontend image tags to v15
helm upgrade app-chart . -n llm-evaluation -f values.yaml
```

Note: The 3 missing endpoints (`/api/gpu-sweep/options`, `/api/comparison`, `/api/devices`) must be implemented in source before rebuilding, or the new image will still return 404 for those routes.
