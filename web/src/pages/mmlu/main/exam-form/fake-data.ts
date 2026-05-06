export const mlExamPrecisionList = [
  // 'auto' label is FP8 (auto). Backend translates 'auto' -> 'bfloat16'
  // before the gRPC call because the MMLU image rejects 'auto', but vLLM
  // still loads FP8 weights via compressed-tensors auto-detection.
  { value: 'auto', label: 'FP8 (auto)' },
  { value: 'bfloat16', label: 'bfloat16' },
  { value: 'float16', label: 'float16' },
  { value: 'float32', label: 'float32' }
];

// ----------------------------------------------------------------------

export const mlExamFrameworkList = [{ value: 'vllm', label: 'vllm' }];
