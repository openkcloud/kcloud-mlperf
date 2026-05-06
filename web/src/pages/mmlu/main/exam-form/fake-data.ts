export const mlExamPrecisionList = [
  // MMLU image's evaluate_from_local.py argparse rejects 'auto' (choices=
  // float16/bfloat16/float32). bfloat16 still loads FP8 weights via
  // compressed-tensors auto-detection, so FP8 hardware path is preserved.
  { value: 'bfloat16', label: 'bfloat16' },
  { value: 'float16', label: 'float16' },
  { value: 'float32', label: 'float32' }
];

// ----------------------------------------------------------------------

export const mlExamFrameworkList = [{ value: 'vllm', label: 'vllm' }];
