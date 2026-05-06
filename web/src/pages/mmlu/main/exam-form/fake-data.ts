export const mlExamPrecisionList = [
  // 'auto' is the dtype path for FP8 weights — see mlperf fake-data.ts.
  { value: 'auto', label: 'FP8 (auto)' },
  { value: 'bfloat16', label: 'bfloat16' },
  { value: 'float16', label: 'float16' },
  { value: 'float32', label: 'float32' }
];

// ----------------------------------------------------------------------

export const mlExamFrameworkList = [{ value: 'vllm', label: 'vllm' }];
