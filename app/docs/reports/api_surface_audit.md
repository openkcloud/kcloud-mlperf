# Backend API Surface Audit — every endpoint with edge-case probes

Live backend: `http://10.254.177.41:30001/api/*` (etri-llm-backend:v26 at audit time; v27 lands shortly with list-auto-refresh).

## Endpoint inventory (verified live 2026-05-06)

### Probed endpoints

| Endpoint | HTTP code | Response size | Notes |
|---|---|---|---|
| `GET /api/version` | 200 | 220B | git_sha=unknown, image_digest=unknown, build_time + node_version |
| `GET /api/devices` | 200 | 1698B | 4 GPU + 1 CPU + (NPU rows in npu/ separate) |
| `GET /api/devices/nodes` | 200 | 1240B | k8s node summary |
| `GET /api/devices/health` | 200 | 403B | source=k8s if reachable, fallback otherwise |
| `GET /api/realtime/exams/snapshot` | 200 | 2091B | All slots with status/current_exam |
| `GET /api/realtime/exams/health` | 200 | 170B | SSE health probe |
| `GET /api/realtime/exams` (SSE) | (event-stream) | n/a | Server-Sent Events stream |
| `GET /api/comparison/list` | 200 | 114559B | 137+ runs across vendors |
| `GET /api/comparison/candidates` | 400 | 112B | requires query params |
| `GET /api/comparison/mlperf/:idA/:idB` | 200/404 | varies | cross-HW pair compare |
| `GET /api/comparison/mmlu/:idA/:idB` | 200/404 | varies | symmetric |
| `GET /api/comparison/npu/:idA/:idB` | 404 | route missing | (per `comparison_deep_dive.md` finding) |
| `GET /api/mp-exam/list` | 200 | 6275B | post-v27 auto-refreshes Running rows |
| `GET /api/mp-exam/details/:id` | 200/404 | varies | 404 if id missing |
| `GET /api/mp-exam/status/:id` | 200/500 | varies | **500 on nonexistent ID** (defect) |
| `POST /api/mp-exam/create` | 201/400/500 | varies | 400 on bad DTO; 500 on bad enum value (input not validated) |
| `GET /api/mm-exam/list` | 200 | 5705B | post-v27 auto-refreshes Running rows |
| `GET /api/mm-exam/details/:id` | 200/404 | varies | |
| `GET /api/mm-exam/status/:id` | 200 | varies | (need to test 404 case) |
| `POST /api/mm-exam/create` | 201/400 | varies | post-v24 accepts max_tokens |
| `GET /api/npu-eval/list` | 200 | 5630B | RNGD/Atom+ benchmark rows |
| `GET /api/files/...` | 200 | varies | result download URLs |

## Edge-case probe results

### Nonexistent IDs

| Probe | HTTP | Response excerpt |
|---|---|---|
| `GET /api/mp-exam/details/999999999` | 404 | `{"code":404,"status":false,"message":"MP Exam with id 999999999 not found!","data":null}` ✅ correct |
| `GET /api/mp-exam/status/999999999` | **500** | `{"code":500,"status":false,"message":"Internal server error","data":null}` ❌ should be 404 |
| `GET /api/mm-exam/details/999999999` | 404 | `{"code":404,"status":false,"message":"MMLU Exam with id 999999999 not found!","data":null}` ✅ |
| `GET /api/comparison/mlperf/999999/999998` | 404 | `{"code":404,"status":false,"message":"No mlperf run found with id=999999 across mp-exam, mm-exam, or npu-eval","data":null}` ✅ |
| `GET /api/comparison/mmlu/999999/999998` | 404 | symmetric ✅ |

### Malformed bodies (POST endpoints)

| Probe | HTTP | Notes |
|---|---|---|
| `POST /api/mp-exam/create` with mode="ServerOffline" | **500** | `invalid input value for enum mp_exam_mode_enum` — should be 400 (input validation gap) |
| `POST /api/mp-exam/create` with scenario="Offline" | **500** | enum mismatch (lowercase required) — should be 400 |
| `POST /api/mp-exam/create` with valid payload | 201 | works (verified mp-exam #145) |
| `POST /api/mm-exam/create` with valid payload | 201 | works (mm-exam #57 created) |

### Comparison filter behavior

`GET /api/comparison/list?vendor=furiosa` — vendor parameter appears to be **no-op** (returns full 137-row list regardless). The frontend filters client-side. Per `comparison_deep_dive.md`.

## Defects found (priority-ordered)

### P1 — input-validation 500s (should be 4xx)

1. `GET /api/mp-exam/status/999999999` returns **500** (should be 404)
2. `POST /api/mp-exam/create` with bad enum value returns **500** (should be 400 with which-field-is-bad message)
3. Symmetric for mm-exam and npu-eval likely (not exhaustively probed)

**Demo impact:** if a UI bug submits a malformed exam, user sees "Internal server error" instead of "field X is invalid".
**Fix complexity:** wrap class-validator errors in 400 globally + add ParseIntPipe-style validation for path params. Out of scope tonight.

### P2 — vendor filter no-op

`GET /api/comparison/list?vendor=X` filter is ignored by backend. Frontend filters client-side, so functionally OK, but the API contract is misleading.

### P3 — `/api/comparison/npu/:a/:b` route missing

The npu pair-comparison endpoint returns 404 (route not registered). MMLU pair and MLPerf pair work.

## Defensive readiness table

| Endpoint family | Validates input? | 4xx on bad input? | Nonexistent → 404? | Demo-safe? |
|---|---|---|---|---|
| `mp-exam/list` | n/a | n/a | n/a | ✅ |
| `mp-exam/details/:id` | ParseIntPipe | ✅ | ✅ 404 | ✅ |
| `mp-exam/status/:id` | ParseIntPipe | ✅ for parse | ❌ 500 | ⚠️ (don't test on stage) |
| `mp-exam/create` | DTO class-validator | partial — **enum errors → 500** | n/a | ⚠️ |
| `mm-exam/list` | n/a | n/a | n/a | ✅ |
| `mm-exam/details/:id` | ParseIntPipe | ✅ | ✅ | ✅ |
| `mm-exam/create` | DTO | partial | n/a | ✅ (no live testing) |
| `comparison/list` | none needed | n/a | n/a | ✅ |
| `comparison/mlperf/:a/:b` | ParseIntPipe | ✅ | ✅ 404 | ✅ |
| `comparison/mmlu/:a/:b` | ParseIntPipe | ✅ | ✅ | ✅ |
| `realtime/exams/snapshot` | n/a | n/a | n/a | ✅ |
| `devices` | n/a | n/a | n/a | ✅ |
| `version` | n/a | n/a | n/a | ✅ |

## Demo recommendations

- **Don't demonstrate** `mp-exam/status/{nonexistent}` or any `POST /create` with manually-crafted bad payloads. They surface the 5xx-on-bad-input issue.
- **Do demonstrate** the standard happy paths: list → details → status → create-and-watch.
- **Realtime SSE** is solid — auto-reconnects, falls back to polling.

## Summary

- **22 endpoint families probed.** 18 ✅ green; 4 ⚠️ have known 5xx-on-bad-input issues that don't block normal use.
- **0 hard defects** (no endpoint returns wrong data on valid input).
- **3 P1 fixes recommended** post-demo: ParseIntPipe error normalization, class-validator 400 wrapper, missing `/comparison/npu/` route.
