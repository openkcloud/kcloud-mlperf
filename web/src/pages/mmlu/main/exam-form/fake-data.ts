export const mlExamPrecisionList = [
  // FP8 weights + auto compute. See mlperf fake-data.ts comment.
  { value: 'auto', label: 'FP8 (auto)' },
  { value: 'bfloat16', label: 'bfloat16' },
  { value: 'float16', label: 'float16' },
  { value: 'float32', label: 'float32' }
];

// ----------------------------------------------------------------------

export const mlExamFrameworkList = [{ value: 'vllm', label: 'vllm' }];
