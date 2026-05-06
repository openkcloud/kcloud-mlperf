# GPU MLPerf Demo Fix — Evidence Report

**Date:** 2026-05-06  
**Worker:** w-gpu-bench-pages  
**REDEPLOY REQUIRED: yes** — affected image: `etri-llm-frontend` (web/src changes)

---

## Deliverable 1: LiveBenchDashboard (replace PrometheusIframeDashboard)

### Files changed

| File | Lines changed | Description |
|------|---------------|-------------|
| `web/src/pages/mlperf/main/MLPerfPage.tsx` | 18, 269–273 | Import swapped; dashboard component replaced |

### Before
```tsx
import { PrometheusIframeDashboard } from '@/components/benchmark-page';
// ...
<PrometheusIframeDashboard title="Live GPU Dashboard (MLPerf)" />
```

### After
```tsx
import { LiveBenchDashboard, getGpuPrometheusUrl } from '@/components/benchmark-page';
// ...
<LiveBenchDashboard
  title="Live GPU Dashboard (MLPerf — L40)"
  src={getGpuPrometheusUrl()}
  height={900}
/>
```

**Contract compliance:**
- `Paper sx={{ p: 2, mt: 3 }}` — provided by `LiveBenchDashboard` component (unchanged)
- `height={900}` — matches RNGD call site (contract §2)
- `bgcolor: '#0e1117'` — provided by component
- `"open in new tab ↗"` link in `#3aa3ff` — provided by component
- `src` passed verbatim from `getGpuPrometheusUrl()` (env var `VITE__APP_GPU_PROMETHEUS_URL`) — matches contract §2 pattern of passing full URL as prop, not constructing inside component

---

## Deliverable 2: FP8 Model Option

### Files changed

| File | Lines changed | Description |
|------|---------------|-------------|
| `web/src/constants/dataset-mapping.constants.ts` | 12–13 | FP8 entry added to MLPERF_DATASET_MAP |
| `web/src/pages/mlperf/main/exam-form/index.tsx` | 61, 127–134 | FP8_MODEL constant; models derivation updated |

### Model constant
```tsx
const FP8_MODEL = { label: 'Llama-3.1-8B-Instruct (FP8)', value: 'Llama-3.1-8B-Instruct-FP8' };
```

### Models derivation (always includes FP8)
```tsx
const models = useMemo(() => {
  const base = settings?.mlperf
    ? Object.keys(settings.mlperf).map(name => ({ label: name, value: name }))
    : apiModels;
  const hasFp8 = base.some(m => m.value === FP8_MODEL.value);
  return hasFp8 ? base : [...base, FP8_MODEL];
}, [settings?.mlperf, apiModels]);
```

### Dataset mapping (so FP8 model resolves cnn_eval.json automatically)
```ts
export const MLPERF_DATASET_MAP: Record<string, string[]> = {
  'Llama-3.1-8B-Instruct': ['cnn_eval.json'],
  'Llama-3.1-8B-Instruct-FP8': ['cnn_eval.json']
};
```

### Sample payload sent to POST /api/mp-exam
```json
{
  "name": "Llama-3.1-8B-Instruct-FP8-cnn_eval.json",
  "model": "Llama-3.1-8B-Instruct-FP8",
  "precision": "bfloat16",
  "dataset": "cnn_eval.json",
  "max_output_tokens": 128,
  "batch_size": 1,
  "data_number": 100,
  "framework": "vllm",
  "mode": "accuracy",
  "scenario": "offline",
  "gpu_type": "NVIDIA-L40",
  "gpu_num": 1,
  "cpu_core": 8,
  "ram_capacity": 16,
  "retry_num": 1,
  "tensor_parallel_size": 1,
  "target_qps": 0.5,
  "min_duration": 600000,
  "num_workers": 1,
  "started_at": "2026-05-06T07:00+09:00"
}
```

The `model` field value `"Llama-3.1-8B-Instruct-FP8"` matches the directory name under `/mnt/models/Llama-3.1-8B-Instruct-FP8/` that the backend runner concatenates with the base path.

**Backend schema note:** `max_output_tokens` is added as optional field to `MpExamCreateBody`. If backend does not yet consume it, the field is ignored (extra JSON properties are typically dropped by NestJS DTOs with `whitelist: true`). No backend change required for the frontend to send it.

---

## Deliverable 3: max_output_tokens configurable field

### Files changed

| File | Lines changed | Description |
|------|---------------|-------------|
| `web/src/pages/mlperf/main/exam-form/form.type.d.ts` | 20 | `maxOutputTokens: number` added |
| `web/src/pages/mlperf/main/exam-form/index.tsx` | 93, 505–525 | Default 128; TextInput field added to Benchmark Settings section |
| `web/src/api/types/mp-exam.types.d.ts` | 20 | `max_output_tokens?: number` added |
| `web/src/pages/mlperf/main/MLPerfPage.tsx` | 72, 102 | Destructured + included in setModalData payload |

### Form field
- Label: "Max Output Tokens"
- Type: number
- Default: 128
- Validation: min 16, max 2048
- Location: Benchmark Settings section, after Tensor Parallel Size

---

## Verification

- `tsc --noEmit`: **0 errors** (clean)
- `npx vitest run`: **52/52 tests pass** (7 test files)
- No device-comparison pages touched
- No dashboard/gpu-realtime/ touched
- No server/src/ touched
