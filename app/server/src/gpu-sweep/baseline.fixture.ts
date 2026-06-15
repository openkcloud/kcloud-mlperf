// Phase 0 — read-only references for the dashboard. These IDs are pre-existing
// rows in the production DB that the sweep MUST NOT alter. The dashboard uses
// them as the demo baseline.
export interface BaselineRef {
  id: number;
  kind: 'mp-exam' | 'mm-exam' | 'npu-eval';
  label: string;
  gpu_type: string;
  precision: string;
  scenario: string;
  notes: string;
}

export const BASELINE_REFS: BaselineRef[] = [
  {
    id: 129,
    kind: 'mp-exam',
    label: 'L40 FP8 full',
    gpu_type: 'NVIDIA-L40',
    precision: 'fp8',
    scenario: 'offline',
    notes: 'TT100T 1.588s, TPS 62.94. Demo baseline.',
  },
  {
    id: 126,
    kind: 'mp-exam',
    label: 'L40 TP2 FP8',
    gpu_type: 'NVIDIA-L40',
    precision: 'fp8',
    scenario: 'offline',
    notes: 'Tensor-parallel size 2.',
  },
  {
    id: 131,
    kind: 'mp-exam',
    label: 'A40 FP8 full',
    gpu_type: 'NVIDIA-A40',
    precision: 'fp8',
    scenario: 'offline',
    notes: 'Currently Running on demo cluster (Apr 27).',
  },
  {
    id: 27,
    kind: 'npu-eval',
    label: 'RNGD NPU baseline',
    gpu_type: 'RNGD',
    precision: 'fp8',
    scenario: 'offline',
    notes: 'TT100T 1.802s. Used for cross-device comparison.',
  },
];
