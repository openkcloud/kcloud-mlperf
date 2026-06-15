export const HomePaths = {
  ROOT_PATH: '/'
} as const;

// ----------------------------------------------------------------------

export const AdminPaths = {
  ROOT_PATH: '/admin',
  SWEEP_CONTROL_PATH: 'sweep-control'
} as const;

// ----------------------------------------------------------------------

export const DashboardPaths = {
  ROOT_PATH: '/dashboard',
  GPU_REALTIME_PATH: 'gpu-realtime',
  NPU_REALTIME_PATH: 'npu-realtime',
  SWEEP_CONTROL_PATH: 'sweep-control'
} as const;

// ----------------------------------------------------------------------

export const MlPerfPaths = {
  ROOT_PATH: '/ml-perf',

  COMPARISON_PATH: 'test-comparison/:firstId/:secondId',
  RESULT_PATH: 'test-result/:id',
  DEVICE_COMPARISON_PATH: 'device-comparison'
} as const;

// ----------------------------------------------------------------------

export const MmluPaths = {
  ROOT_PATH: '/mmlu',

  RESULT_PATH: 'test-result/:id',
  COMPARISON_PATH: 'test-comparison/:firstId/:secondId',
  DEVICE_COMPARISON_PATH: 'device-comparison'
} as const;

// ----------------------------------------------------------------------

export const NpuEvalPaths = {
  ROOT_PATH: '/npu-eval',

  RESULT_PATH: 'test-result/:id',
  COMPARISON_PATH: 'test-comparison/:firstId/:secondId',
  DEVICE_COMPARISON_PATH: 'device-comparison'
} as const;

// ----------------------------------------------------------------------

export const NpuEvalRngdPaths = {
  ROOT_PATH: '/npu-eval/rngd',

  DEVICE_COMPARISON_PATH: 'device-comparison'
} as const;

// ----------------------------------------------------------------------

export const NpuEvalAtomPlusPaths = {
  ROOT_PATH: '/npu-eval/atomplus',

  DEVICE_COMPARISON_PATH: 'device-comparison'
} as const;

// ----------------------------------------------------------------------

export const MethodologyPaths = {
  ROOT_PATH: '/methodology'
} as const;
