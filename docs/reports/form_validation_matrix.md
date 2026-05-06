# Form Validation Matrix

Generated from source inspection of all four create-exam forms.
Backend server was not reachable during generation, so HTTP error probes are derived from
source analysis (`forbidNonWhitelisted: true`, `whitelist: true`, `transform: true` with
`enableImplicitConversion: true` in the global `ValidationPipe`).

**Out-of-range behavior (all forms):** NestJS returns HTTP 400 with body
`{ statusCode: 400, message: string[], error: "Bad Request" }`.
Any property not listed in the DTO is also rejected with 400 and message
`"property <name> should not exist"` — this is the exact error pattern from the v24 bug.

---

## 1. MLPerf Create-Exam

**Frontend:** `web/src/pages/mlperf/main/exam-form/index.tsx`
**Form type:** `web/src/pages/mlperf/main/exam-form/form.type.d.ts` (`MpExamFormInput`)
**Submit handler:** `web/src/pages/mlperf/main/MLPerfPage.tsx` (`onSubmit`)
**API type sent:** `web/src/api/types/mp-exam.types.d.ts` (`MpExamCreateBody`)
**Backend DTO:** `server/src/mp-exam/dto/create-mp-exam.dto.ts` (`CreateMpExamDto`)

### Field Table

| Frontend field | API body field | Type | Backend decorators | Valid range / allowed values | Default (form) | User-editable | FE validation rule | Out-of-range behavior |
|---|---|---|---|---|---|---|---|---|
| `name` | `name` | string | `@IsString @Length(1,100)` | 1–100 chars | `""` (auto-generates `model-dataset` on empty) | Yes | none (optional in FE) | 400 if >100 chars or empty string sent |
| `description` | `description` | string | `@IsString @Length(0,500)` | 0–500 chars | `""` | Yes | none | 400 if >500 chars |
| `model` (SelectValue) | `model` | string | `@IsString @Length(1,100)` | any model name, 1–100 chars | `""` (required) | Yes — dropdown from settings/API | `required: "Please select a model"` | 400 if empty or >100 chars |
| `dataset` (SelectValue) | `dataset` | string | `@IsString @Length(1,100)` | any dataset name, 1–100 chars | `""` (required) | Yes — dropdown filtered by model | `required: "Please select a datasets"` | 400 if empty or >100 chars |
| `precision` (SelectValue) | `precision` | string | `@IsString @Length(1,10)` | `bfloat16` \| `float16` \| `float32` (UI enum); backend accepts any string ≤10 chars | `{ value:"bfloat16" }` | Yes — dropdown | `required` | 400 if >10 chars; **no enum enforcement on backend** |
| `mode` (SelectValue) | `mode` | string (MpExamModeEnum) | `@IsString @Length(1,20)` | UI: `accuracy` \| `performance`; backend: any string ≤20 chars | `{ value:"accuracy" }` | Yes — dropdown | `required` | 400 if >20 chars; **no enum enforcement on backend** |
| `scenario` (SelectValue) | `scenario` | string (TestScenarioEnum) | `@IsString @IsNotEmpty` | UI: `offline` \| `server`; backend: any non-empty string | `{ value:"offline" }` | Yes — dropdown | `required` | 400 if empty; **no enum enforcement on backend** |
| `framework` (SelectValue) | `framework` | string | `@IsString @Length(1,100)` | UI: `vllm` \| `pytorch`; backend: any string ≤100 chars | `{ value:"vllm" }` | Yes — dropdown | `required` | 400 if >100 chars |
| `dataNumber` | `data_number` | int | `@IsInt @Min(0)` | ≥0 (0 = full dataset) | `0` | Yes — number input | `min: 0` | FE shows error if <0; backend rejects if <0 or non-integer |
| `targetQps` | `target_qps` | number (float) | `@IsNumber @Min(0)` | ≥0 | `0.5` | Yes — number input | `min: 0` | FE shows error if <0; backend rejects if <0 |
| `batchSize` | `batch_size` | int | `@IsInt @Min(0)` | ≥0 | `1` | Yes — number input | `min: 0` | FE shows error if <0; backend rejects if <0 or non-integer |
| `numOfWorkers` | `num_workers` | int | `@IsInt @Min(0)` | ≥0 | `1` | Yes — number input | `min: 0` | FE shows error if <0 |
| `minDuration` | `min_duration` | int | `@IsInt @Min(0)` | ≥0 (ms); 600000 for offline, 120000 for server | **Auto-set: 600000 (offline) / 120000 (server)** — overrides initial 0 | Yes — number input (no max constraint) | `min: 0` | **MISMATCH — see below**; FE has no upper bound; backend has no upper bound either |
| `tensorParallelSize` | `tensor_parallel_size` | int | `@IsInt @Min(0)` | ≥0 | `1` | Yes — number input | `min: 0` | FE shows error if <0 |
| `maxOutputTokens` | `max_output_tokens` | int (optional) | `@IsOptional @IsInt @Min(16)` | ≥16; no backend max (only FE max 2048) | `128` | Yes — number input | `min:16, max:2048` | **MISMATCH — see below**; FE blocks >2048, backend has no @Max |
| `gpuType` (SelectValue) | `gpu_type` | string | `@IsString @Length(1,100)` | dynamic list from `/mp-exam/gpu-list` | `""` (required) | Yes — dropdown | `required` | 400 if empty or >100 chars |
| `gpuNumber` (SelectValue) | `gpu_num` | int | `@IsInt @Min(0)` | dynamic list filtered by gpuType | `""` (required) | Yes — dropdown | `required` | 400 if <0 |
| `cpuCore` (SelectValue) | `cpu_core` | int | `@IsInt @Min(0)` | 2,4,6,8,10,12,14,16,20,24,28,32,36,40,48,56,64 (UI enum) | `{ value:8 }` | Yes — dropdown | `required` | 400 if <0; **no enum enforcement on backend** |
| `ramSize` | `ram_capacity` | int | `@IsInt @Min(0)` | ≥0 GB | `16` | Yes — number input | `min: 0` | FE shows error if <0 |
| `repetitionCount` | `retry_num` | int | `@IsInt @Min(0)` | ≥0 | `1` | Yes — number input | `min: 0` | FE shows error if <0 |
| `time` (Dayjs) | `started_at` | string (ISO8601) | `@IsString @IsNotEmpty` | any non-empty string | `dayjs()` (now) | Yes — DatePicker | none | 400 if empty |
| _(not in form)_ | `device_type` | string (optional) | `@IsOptional @IsString @Length(1,10)` | e.g. `GPU` | not sent | No | — | silently omitted (optional) |
| _(not in form)_ | `status` | StatusEnum (optional) | `@IsOptional` | StatusEnum values | not sent | No | — | silently omitted |
| _(not in form)_ | `error_log` | string (optional) | `@IsOptional @IsString` | any string | not sent | No | — | silently omitted |
| _(not in form)_ | `end_at` | string (optional) | `@IsOptional @IsString` | any string | not sent | No | — | silently omitted |

---

## 2. MMLU Create-Exam

**Frontend:** `web/src/pages/mmlu/main/exam-form/index.tsx`
**Form type:** `web/src/pages/mmlu/main/exam-form/form.type.d.ts` (`MlExamFormInput`)
**Submit handler:** `web/src/pages/mmlu/main/MMLUPage.tsx` (`onSubmit`) + `ExamConfirmationModal` (adds `n_train`)
**API type sent:** `web/src/api/types/mm-exam.types.d.ts` (`MmExamCreateBody`)
**Backend DTO:** `server/src/mm-exam/dto/create-mm-exam.dto.ts` (`CreateMmExamDto`)

### Field Table

| Frontend field | API body field | Type | Backend decorators | Valid range / allowed values | Default (form) | User-editable | FE validation rule | Out-of-range behavior |
|---|---|---|---|---|---|---|---|---|
| `name` | `name` | string | `@IsString @Length(1,100)` | 1–100 chars | `""` (auto-generates `model-dataset`) | Yes | none (optional in FE) | 400 if >100 chars |
| `description` | `description` | string | `@IsString @Length(0,500)` | 0–500 chars | `""` | Yes | none | 400 if >500 chars |
| `model` (SelectValue) | `model` | string | `@IsString @Length(1,100)` | any model name, 1–100 chars | `""` (required) | Yes — dropdown | `required` | 400 if empty or >100 chars |
| `dataset` (SelectValue) | `dataset` | string | `@IsString @Length(1,100)` | any dataset name, 1–100 chars | `""` (required) | Yes — dropdown filtered by model | `required` | 400 if empty or >100 chars |
| `precision` (SelectValue) | `precision` | string | `@IsString @Length(1,10)` | `bfloat16` \| `float16` \| `float32` (UI); backend: any ≤10 chars | `{ value:"bfloat16" }` | Yes — dropdown | `required` | 400 if >10 chars |
| `framework` (SelectValue) | `framework` | string | `@IsString @Length(1,100)` | UI: `vllm` only; backend: any ≤100 chars | `{ value:"vllm" }` | Yes — dropdown (1 option) | `required` | 400 if >100 chars |
| `subjects` | `subject` | string | `@IsString @Length(1,500)` | any string ≤500 chars | `"all"` | Yes — text input (no FE rules) | none | 400 if >500 chars or empty |
| `dataNumber` | `data_number` | int | `@IsInt @Min(0)` | ≥0 (0 = full) | `0` | Yes — number input | `min: 0` | FE shows error if <0 |
| `batchSize` | `batch_size` | int | `@IsInt @Min(0)` | ≥0 | `1` | Yes — number input | `min: 0` | FE shows error if <0 |
| `gpuUtil` | `gpu_util` | number (float) | `@IsNumber @Min(0)` | ≥0 (typically 0.0–1.0) | `0.8` | Yes — number input | `min: 0` | **MISMATCH — see below**; FE has no max; backend has no max |
| `maxTokens` | `max_tokens` | int (optional) | `@IsOptional @IsInt @Min(16)` | ≥16; no backend max | `128` | Yes — number input | `min:16, max:2048` | **MISMATCH — see below**; FE blocks >2048, backend has no @Max |
| `gpuType` (SelectValue) | `gpu_type` | string | `@IsString @Length(1,100)` | dynamic list from `/mm-exam/gpu-list` | `""` (required) | Yes — dropdown | `required` | 400 if empty |
| `gpuNumber` (SelectValue) | `gpu_num` | int | `@IsInt @Min(0)` | dynamic list filtered by gpuType | `""` (required) | Yes — dropdown | `required` | 400 if <0 |
| `cpuCore` (SelectValue) | `cpu_core` | int | `@IsInt @Min(0)` | 2–64 (UI enum same as MLPerf) | `{ value:8 }` | Yes — dropdown | `required` | 400 if <0 |
| `ramSize` | `ram_capacity` | int | `@IsInt @Min(0)` | ≥0 GB | `16` | Yes — number input | `min: 0` | FE shows error if <0 |
| `repetitionCount` | `retry_num` | int | `@IsInt @Min(0)` | ≥0 | `1` | Yes — number input | `min: 0` | FE shows error if <0 |
| `time` (Dayjs) | `started_at` | string (ISO8601) | `@IsString @IsNotEmpty` | any non-empty string | `dayjs()` (now) | Yes — DatePicker | none | 400 if empty |
| _(modal only, not in main form)_ | `n_train` | int | `@IsInt @Min(1)` | ≥1 | `1` (modal text input, hardcoded default) | Yes — text input in confirmation modal | none (modal has no FE rule) | **MISMATCH — see below**; FE allows 0 (falls back to 1 via `|| N_TRAIN_DEFAULT_VALUE`), backend enforces @Min(1) |
| _(not in form)_ | `device_type` | string (optional) | `@IsOptional @IsString @Length(1,10)` | e.g. `GPU` | not sent | No | — | silently omitted |
| _(not in form)_ | `status` | StatusEnum (optional) | `@IsOptional` | StatusEnum values | not sent | No | — | silently omitted |
| _(not in form)_ | `end_at` | string (optional) | `@IsOptional @IsString` | any string | not sent | No | — | silently omitted |
| _(not in form)_ | `error_log` | string (optional) | `@IsOptional @IsString` | any string | not sent | No | — | silently omitted |

---

## 3. RNGD NPU-Eval Create-Exam

**Frontend:** `web/src/pages/npu-eval/rngd/index.tsx` (inline form, no separate exam-form/ folder)
**API type sent:** `web/src/api/types/npu-eval.types.d.ts` (`NpuExamCreateBody`)
**Backend DTO:** `server/src/npu-eval/dto/create-npu-exam.dto.ts` (`CreateNpuExamDto`)

Note: This form uses plain MUI `TextField` with no react-hook-form `rules` — no frontend
validation beyond HTML5 `type="number"`. The `npu_type` field is hardcoded to `"RNGD"` in
`onSubmit` and displayed as a read-only disabled field.

### Field Table

| Frontend field | API body field | Type | Backend decorators | Valid range / allowed values | Default (form) | User-editable | FE validation rule | Out-of-range behavior |
|---|---|---|---|---|---|---|---|---|
| `name` | `name` | string | `@IsString @Length(1,100)` | 1–100 chars | `""` | Yes — text input | `required: true` (HTML) | 400 if >100 chars or empty |
| `description` | `description` | string | `@IsString @Length(0,500)` | 0–500 chars | `""` | Yes — text input | none | 400 if >500 chars |
| `benchmark` | `benchmark` | string | `@IsString @Length(1,20)` | UI: `mlperf` \| `mmlu`; backend: any ≤20 chars | `"mlperf"` | Yes — select | none | 400 if >20 chars; **no enum enforcement on backend** |
| `model` | `model` | string | `@IsString @Length(1,100)` | any string ≤100 chars | `"furiosa-ai/Llama-3.1-8B-Instruct"` | Yes — free text input | none | 400 if >100 chars or empty |
| `precision` | `precision` | string | `@IsString @Length(1,10)` | UI: `FP8` \| `BF16` \| `INT8` \| `INT4`; backend: any ≤10 chars | `"FP8"` | Yes — select | none | 400 if >10 chars; **no enum enforcement on backend** |
| `framework` | `framework` | string | `@IsString @Length(1,100)` | `"furiosa-llm"` (disabled, fixed) | `"furiosa-llm"` | No — disabled field | none | 400 if >100 chars |
| `batch_size` | `batch_size` | int | `@IsInt @Min(0)` | ≥0 | `1` | Yes — number input | none (HTML type=number only) | 400 if <0 or non-integer |
| `dataset` | `dataset` | string | `@IsString @Length(1,100)` | auto-set by benchmark (`CNN-DailyMail` / `MMLU-Pro`) | `"CNN-DailyMail"` | Yes — text input | none | 400 if >100 chars or empty |
| `data_number` | `data_number` | int | `@IsInt @Min(0)` | ≥0 (0 = full) | `0` | Yes — number input | none | 400 if <0 |
| _(read-only display)_ | `npu_type` | string | `@IsString @Length(1,100)` | hardcoded `"RNGD"` in onSubmit | `"RNGD"` | No — overridden in onSubmit | — | 400 if >100 chars |
| `npu_num` | `npu_num` | int | `@IsInt @Min(1)` | ≥1 | `1` | Yes — number input | none | **MISMATCH — see below**; FE has no min rule; backend @Min(1) |
| `cpu_core` | `cpu_core` | int | `@IsInt @Min(0)` | ≥0 | `8` | Yes — number input | none | 400 if <0 |
| `ram_capacity` | `ram_capacity` | int | `@IsInt @Min(0)` | ≥0 GB | `64` | Yes — number input | none | 400 if <0 |
| `retry_num` | `retry_num` | int | `@IsInt @Min(0)` | ≥0 | `3` | Yes — number input | none | 400 if <0 |
| `max_output_tokens` | `max_output_tokens` | int | `@IsInt @Min(0)` | ≥0 (0 = unlimited) | `0` | Yes — number input (label: "0=unlimited") | none | 400 if <0; **note: backend @Min(0) NOT @Min(16) unlike MP/MM** |
| `started_at` | `started_at` | string (ISO8601) | `@IsString @IsNotEmpty` | any non-empty string | `dayjs().format('YYYY-MM-DDTHH:mm')` | Yes — datetime-local input | none | 400 if empty |
| _(not in form)_ | `status` | StatusEnum (optional) | `@IsOptional` | StatusEnum values | not sent | No | — | silently omitted |
| _(not in form)_ | `error_log` | string (optional) | `@IsOptional @IsString` | any string | not sent | No | — | silently omitted |
| _(not in form)_ | `end_at` | string (optional) | `@IsString @IsOptional` | any string | not sent | No | — | silently omitted |

---

## 4. Atom+ NPU-Eval Create-Exam

**Frontend:** `web/src/pages/npu-eval/atomplus/index.tsx` (inline form, shares `NpuExamCreateBody`)
**API type sent:** `web/src/api/types/npu-eval.types.d.ts` (`NpuExamCreateBody`) — identical to RNGD
**Backend DTO:** `server/src/npu-eval/dto/create-npu-exam.dto.ts` (`CreateNpuExamDto`) — same DTO as RNGD

Note: Form structure is nearly identical to RNGD. Differences: `npu_type` hardcoded to `"ATOM"`,
default `model` is `"rebellions/Llama-3.1-8B-Instruct"`, default `precision` is `"fp8"` (lowercase),
default `framework` is `"optimum-rbln"`, default `data_number` is `100`, default `max_output_tokens` is `128`.
Precision choices are `fp8` \| `bf16` \| `int8` (lowercase, vs. RNGD uppercase `FP8`/`BF16`/`INT8`/`INT4`).
Form only shows when a `rebellions` device is in `ready` state — guarded by `hasReadyDevice`.

### Field Table

| Frontend field | API body field | Type | Backend decorators | Valid range / allowed values | Default (form) | User-editable | FE validation rule | Out-of-range behavior |
|---|---|---|---|---|---|---|---|---|
| `name` | `name` | string | `@IsString @Length(1,100)` | 1–100 chars | `""` | Yes — text input | `required: true` (HTML) | 400 if >100 chars or empty |
| `description` | `description` | string | `@IsString @Length(0,500)` | 0–500 chars | `""` | Yes — text input | none | 400 if >500 chars |
| `benchmark` | `benchmark` | string | `@IsString @Length(1,20)` | UI: `mlperf` \| `mmlu`; backend: any ≤20 chars | `"mlperf"` | Yes — select | none | 400 if >20 chars |
| `model` | `model` | string | `@IsString @Length(1,100)` | any HuggingFace path ≤100 chars | `"rebellions/Llama-3.1-8B-Instruct"` | Yes — free text input | none | 400 if >100 chars or empty |
| `precision` | `precision` | string | `@IsString @Length(1,10)` | UI: `fp8` \| `bf16` \| `int8` (lowercase); backend: any ≤10 chars | `"fp8"` | Yes — select | none | 400 if >10 chars; **case differs from RNGD** |
| `framework` | `framework` | string | `@IsString @Length(1,100)` | `"optimum-rbln"` (disabled, fixed) | `"optimum-rbln"` | No — disabled field | none | 400 if >100 chars |
| `batch_size` | `batch_size` | int | `@IsInt @Min(0)` | ≥0 | `1` | Yes — number input | none | 400 if <0 or non-integer |
| `dataset` | `dataset` | string | `@IsString @Length(1,100)` | auto-set by benchmark (`cnn_dailymail` / `MMLU-Pro`) | `"cnn_dailymail"` | Yes — text input | none | 400 if >100 chars or empty |
| `data_number` | `data_number` | int | `@IsInt @Min(0)` | ≥0 (0 = full) | `100` | Yes — number input | none | 400 if <0 |
| _(read-only display)_ | `npu_type` | string | `@IsString @Length(1,100)` | hardcoded `"ATOM"` in onSubmit | `"ATOM"` | No — overridden in onSubmit | — | 400 if >100 chars |
| `npu_num` | `npu_num` | int | `@IsInt @Min(1)` | ≥1 | `1` | Yes — number input | none | **MISMATCH** (same as RNGD): FE has no min rule; backend @Min(1) |
| `cpu_core` | `cpu_core` | int | `@IsInt @Min(0)` | ≥0 | `8` | Yes — number input | none | 400 if <0 |
| `ram_capacity` | `ram_capacity` | int | `@IsInt @Min(0)` | ≥0 GB | `64` | Yes — number input | none | 400 if <0 |
| `retry_num` | `retry_num` | int | `@IsInt @Min(0)` | ≥0 | `3` | Yes — number input | none | 400 if <0 |
| `max_output_tokens` | `max_output_tokens` | int | `@IsInt @Min(0)` | ≥0 (0 = unlimited) | `128` | Yes — number input (label: "0=unlimited") | none | 400 if <0; **backend @Min(0); FE has no max unlike MP/MM** |
| `started_at` | `started_at` | string (ISO8601) | `@IsString @IsNotEmpty` | any non-empty string | `dayjs().format('YYYY-MM-DDTHH:mm')` | Yes — datetime-local input | none | 400 if empty |
| _(not in form)_ | `status` | StatusEnum (optional) | `@IsOptional` | StatusEnum values | not sent | No | — | silently omitted |
| _(not in form)_ | `error_log` | string (optional) | `@IsOptional @IsString` | any string | not sent | No | — | silently omitted |
| _(not in form)_ | `end_at` | string (optional) | `@IsString @IsOptional` | any string | not sent | No | — | silently omitted |

---

## Validation Mismatches Found

### MISMATCH 1 — `max_output_tokens` (MP) / `max_tokens` (MM): FE max 2048, backend has no @Max

- **MLPerf:** FE `maxOutputTokens` → `max_output_tokens`: `rules: { min:16, max:2048 }`; backend `@IsOptional @IsInt @Min(16)` — **no `@Max`**.
- **MMLU:** FE `maxTokens` → `max_tokens`: `rules: { min:16, max:2048 }`; backend `@IsOptional @IsInt @Min(16)` — **no `@Max`**.
- **Effect:** A value >2048 is blocked by the frontend but accepted by the backend with no error. Any direct curl/API call can submit e.g. `max_output_tokens: 99999` and the backend will accept it.
- **RNGD/Atom+:** `max_output_tokens` has backend `@IsInt @Min(0)` (0=unlimited, minimum is 0, not 16). FE has no rule at all.

### MISMATCH 2 — `min_duration` (MP): auto-set to 600,000 ms for offline, no upper-bound validation anywhere

- **MLPerf:** `minDuration` → `min_duration`. On scenario change, a `useEffect` fires: `setValue('minDuration', selectedScenario.value === 'offline' ? 600_000 : 120_000)`. This auto-sets to **600,000** when in offline mode.
- FE rule: `min: 0` only. Backend: `@IsInt @Min(0)` only. No max, no sanity check against reasonable MLPerf durations.
- **Effect:** User sees a large integer (600,000) and may not understand it is in milliseconds (= 10 minutes). No label clarification that the unit is ms. A user who types a small number (e.g. 60) unknowingly sets 60ms minimum, which MLPerf will reject at runtime, not at submit time.
- **This was the bug that bit the user.** The form silently resets to 600,000 on every scenario toggle, and if the user manually overrides then switches scenario again, their value is overwritten.

### MISMATCH 3 — `npu_num` (RNGD and Atom+): FE has no min rule, backend enforces @Min(1)

- FE: plain `TextField type="number"`, no `rules`, default value `1`.
- Backend: `@IsInt @Min(1)`.
- **Effect:** A user who types `0` will get a 400 from the backend with no pre-submit FE warning.

### MISMATCH 4 — `n_train` (MMLU): FE modal text-input uses "|| fallback" pattern, backend @Min(1)

- FE modal: `n_train: Number(nTrain) || N_TRAIN_DEFAULT_VALUE` — if the user types `0`, `Number("0")` is falsy so it falls back to 1. But if the user types a negative number like `-5`, `Number("-5")` is truthy and `-5` is sent.
- Backend: `@IsInt @Min(1)`.
- **Effect:** Negative `n_train` sends 400. The falsy-coercion on 0 is safe by accident, but is fragile. Also: `n_train` is not present in the main exam form — it only appears in the `ExamConfirmationModal` as a secondary text input, making it easy to miss.

### MISMATCH 5 — `precision` enum: case and allowed values differ between forms

- MLPerf/MMLU FE: `bfloat16` | `float16` | `float32`. Backend: free string ≤10 chars — no enum enforcement.
- RNGD FE: `FP8` | `BF16` | `INT8` | `INT4` (uppercase). Backend: free string ≤10 chars.
- Atom+ FE: `fp8` | `bf16` | `int8` (lowercase). Backend: same DTO, free string ≤10 chars.
- **Effect:** RNGD and Atom+ send different precision case strings to the same backend entity. The backend operator/job runner must handle both cases or one will silently produce wrong behavior with no validation error.

### MISMATCH 6 — `max_output_tokens` semantics differ between MP and NPU forms

- MP/MM form: `max_output_tokens` / `max_tokens` is generation length, min 16, default 128. FE and backend both have @Min(16).
- RNGD/Atom+ form: `max_output_tokens`, min 0 (0 = unlimited). Backend `@Min(0)`. FE has no rule.
- **Effect:** If a user copies a value between forms, they may send `0` to an MP exam (which the backend accepts as 0 since @IsOptional — the default 128 is only a FE default, not a backend default) or send `16` to NPU (where 16 means "limit to 16 tokens" not "use minimum").

### MISMATCH 7 — `gpu_util` (MMLU): no upper bound anywhere

- FE: `rules: { min: 0 }`. Backend: `@IsNumber @Min(0)`. No maximum enforced.
- **Effect:** A user can submit `gpu_util: 999.0`. vLLM would fail at runtime (valid range is 0.0–1.0), but no validation error at submit time. This value has no semantic validation in the entire stack.

### MISMATCH 8 — `forbidNonWhitelisted: true` causes "property should not exist" 400 for any extra field

- The global ValidationPipe has `whitelist: true` and `forbidNonWhitelisted: true`.
- Any property not decorated in the DTO returns 400: `"property <name> should not exist"`.
- **This was the v24 bug pattern**: sending `max_tokens` to the MP endpoint (which expects `max_output_tokens`) produces `400 { message: ["property max_tokens should not exist"] }`.
- Both the ML and MM API types define the field differently: `MpExamCreateBody.max_output_tokens` vs `MmExamCreateBody.max_tokens`. If code accidentally sends the wrong key (e.g. copy-paste from MMLU handler to MLPerf), the backend rejects it.

---

## Notes on curl probing

The backend server was not running locally at the time of generation (ports 3000, 3001, 8080, 4000 all returned connection refused). All out-of-range behavior documented above is derived from:

1. NestJS `ValidationPipe` config (`whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, `enableImplicitConversion: true`) in `server/src/main.ts`.
2. `class-validator` decorator semantics (`@IsInt`, `@IsNumber`, `@IsString`, `@Length`, `@Min`, `@IsOptional`, `@IsNotEmpty`).
3. Standard NestJS behavior: validation failures return HTTP 400 with `{ statusCode: 400, message: string[], error: "Bad Request" }`.
