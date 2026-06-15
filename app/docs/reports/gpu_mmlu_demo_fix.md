# GPU MMLU-Pro Demo Fix — Evidence Report

**Date:** 2026-05-06  
**Worker:** w-gpu-bench-pages  
**REDEPLOY REQUIRED: yes** — affected image: `etri-llm-frontend` (web/src changes)

---

## Deliverable 1: LiveBenchDashboard (replace PrometheusIframeDashboard)

### Files changed

| File | Lines changed | Description |
|------|---------------|-------------|
| `web/src/pages/mmlu/main/MMLUPage.tsx` | 18, 260–264 | Import swapped; dashboard component replaced |

### Before
```tsx
import { PrometheusIframeDashboard } from '@/components/benchmark-page';
// ...
<PrometheusIframeDashboard title="Live GPU Dashboard (MMLU-Pro)" />
```

### After
```tsx
import { LiveBenchDashboard, getGpuPrometheusUrl } from '@/components/benchmark-page';
// ...
<LiveBenchDashboard
  title="Live GPU Dashboard (MMLU-Pro — L40)"
  src={getGpuPrometheusUrl()}
  height={900}
/>
```

**Contract compliance:**
- `Paper sx={{ p: 2, mt: 3 }}` — provided by `LiveBenchDashboard` component (unchanged)
- `height={900}` — matches RNGD call site (contract §2)
- `bgcolor: '#0e1117'` — provided by component
- `"open in new tab ↗"` link in `#3aa3ff` — provided by component
- `src` passed verbatim from `getGpuPrometheusUrl()` (env var `VITE__APP_GPU_PROMETHEUS_URL`) — matches contract §2 pattern

---

## Deliverable 2: FP8 Model Option

### Files changed

| File | Lines changed | Description |
|------|---------------|-------------|
| `web/src/constants/dataset-mapping.constants.ts` | 16–17 | FP8 entry added to MMLU_DATASET_MAP |
| `web/src/pages/mmlu/main/exam-form/index.tsx` | 58, 112–119 | FP8_MODEL constant; models derivation updated |

### Model constant
```tsx
const FP8_MODEL = { label: 'Llama-3.1-8B-Instruct (FP8)', value: 'Llama-3.1-8B-Instruct-FP8' };
```

### Models derivation (always includes FP8)
```tsx
const models = useMemo(() => {
  const base = settings?.mmlu
    ? Object.keys(settings.mmlu).map(name => ({ label: name, value: name }))
    : apiModels;
  const hasFp8 = base.some(m => m.value === FP8_MODEL.value);
  return hasFp8 ? base : [...base, FP8_MODEL];
}, [settings?.mmlu, apiModels]);
```

### Dataset mapping (so FP8 model resolves mmlu-pro automatically)
```ts
export const MMLU_DATASET_MAP: Record<string, string[]> = {
  'Llama-3.1-8B-Instruct': ['mmlu-pro'],
  'Llama-3.1-8B-Instruct-FP8': ['mmlu-pro']
};
```

### Sample payload sent to POST /api/mm-exam
```json
{
  "name": "Llama-3.1-8B-Instruct-FP8-mmlu-pro",
  "model": "Llama-3.1-8B-Instruct-FP8",
  "precision": "bfloat16",
  "dataset": "mmlu-pro",
  "max_tokens": 128,
  "batch_size": 1,
  "data_number": 100,
  "framework": "vllm",
  "subject": "all",
  "gpu_util": 0.8,
  "gpu_type": "NVIDIA-L40",
  "gpu_num": 1,
  "cpu_core": 8,
  "ram_capacity": 16,
  "retry_num": 1,
  "started_at": "2026-05-06T07:00+09:00"
}
```

The `model` field value `"Llama-3.1-8B-Instruct-FP8"` matches the directory name under `/mnt/models/Llama-3.1-8B-Instruct-FP8/` that the backend runner concatenates with the base path.

**Backend schema note:** `max_tokens` is added as optional field to `MmExamCreateBody`. If backend does not yet consume it, the field is ignored. No backend code change required for the frontend to send it.

---

## Deliverable 3: max_tokens configurable field

### Files changed

| File | Lines changed | Description |
|------|---------------|-------------|
| `web/src/pages/mmlu/main/exam-form/form.type.d.ts` | 19 | `maxTokens: number` added |
| `web/src/pages/mmlu/main/exam-form/index.tsx` | 72, 382–402 | Default 128; TextInput field added to Benchmark Settings section |
| `web/src/api/types/mm-exam.types.d.ts` | 13 | `max_tokens?: number` added |
| `web/src/pages/mmlu/main/MMLUPage.tsx` | 71, 97 | Destructured + included in setModalData payload |

### Form field
- Label: "Max Tokens"
- Type: number
- Default: 128
- Validation: min 16, max 2048
- Location: Benchmark Settings section, after GPU Utilization

---

## Verification

- `tsc --noEmit`: **0 errors** (clean)
- `npx vitest run`: **52/52 tests pass** (7 test files)
- No device-comparison pages touched
- No dashboard/gpu-realtime/ touched
- No server/src/ touched
