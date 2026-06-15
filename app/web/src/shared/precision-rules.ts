/**
 * Device-aware precision truth table.
 *
 * Single source of truth for which precision options are valid for each
 * physical device. Used by the MLPerf, MMLU, and NPU exam-creation forms
 * to filter the precision dropdown so users cannot pick hardware-impossible
 * combinations (e.g. FP8 on Atom+ which has no FP8 silicon).
 *
 * Keep IDs canonical (lowercase, underscore-free) — case-insensitive lookup
 * is performed in deviceKey().
 */

// ----------------------------------------------------------------------

export type PrecisionOption = {
  value: string;
  label: string;
  /** Optional info-chip text rendered next to the option (e.g. "FP8 weights, BF16 compute"). */
  info?: string;
};

export type DeviceKey =
  | 'nvidia-gpu'
  | 'furiosa-rngd'
  | 'rebellions-atomplus'
  | 'unknown';

// ----------------------------------------------------------------------

const NVIDIA_PRECISIONS: PrecisionOption[] = [
  { value: 'bfloat16', label: 'bfloat16' },
  { value: 'float16', label: 'float16' },
  // L40/A40 don't have FP8 cores, but model weights can still be FP8-quantised
  // (compressed-tensors). vLLM uses 'auto' to detect FP8 and run mixed BF16
  // compute via Marlin. We surface this with the info chip so users know.
  { value: 'auto', label: 'FP8 (auto)', info: 'FP8 weights, BF16 compute' }
];

// RNGD (Furiosa) silicon truth-table: fp8, fp16, bf16, int8, int4.
// Most-used in practice: fp8 + bf16. v41 backend (device-precision.ts)
// accepts fp8/fp16/bf16 today; int8/int4 still surface in the dropdown
// but currently get rejected at create-time until the worker is wired
// for them.
const RNGD_PRECISIONS: PrecisionOption[] = [
  { value: 'FP8', label: 'FP8' },
  { value: 'FP16', label: 'FP16' },
  { value: 'BF16', label: 'BF16' },
  { value: 'INT8', label: 'INT8' },
  { value: 'INT4', label: 'INT4' }
];

const ATOMPLUS_PRECISIONS: PrecisionOption[] = [
  { value: 'fp16', label: 'FP16' }
];

const ATOMPLUS_INFO =
  'Atom+ supports FP16 / INT8 / INT4 (FP8 is REBEL-Quad-only).';

// ----------------------------------------------------------------------

/**
 * Map a device identifier string (from the form's selected device) to a
 * canonical DeviceKey. Accepts gpu_type / npu_type values used across forms.
 *
 * Treats anything containing "atom" as Atom+, "rngd" as RNGD, anything
 * matching the NVIDIA GPU model list (L40, A40, etc.) as nvidia-gpu.
 */
export const deviceKey = (raw: string | undefined | null): DeviceKey => {
  if (!raw) return 'unknown';
  const v = raw.toLowerCase();
  if (v.includes('atom')) return 'rebellions-atomplus';
  if (v.includes('rngd') || v.includes('furiosa')) return 'furiosa-rngd';
  if (
    v.includes('l40') ||
    v.includes('a40') ||
    v.includes('h100') ||
    v.includes('a100') ||
    v.includes('h200') ||
    v.includes('nvidia') ||
    v.includes('gpu')
  ) {
    return 'nvidia-gpu';
  }
  return 'unknown';
};

// ----------------------------------------------------------------------

/**
 * Return the allowed precision options for a given device.
 *
 * `unknown` devices fall through to the NVIDIA defaults so the dropdown
 * stays populated until the user picks a real device.
 */
export const precisionOptionsFor = (
  device: DeviceKey | string | null | undefined
): PrecisionOption[] => {
  const key: DeviceKey =
    device === 'nvidia-gpu' ||
    device === 'furiosa-rngd' ||
    device === 'rebellions-atomplus' ||
    device === 'unknown'
      ? (device as DeviceKey)
      : deviceKey(device as string | null | undefined);

  switch (key) {
    case 'furiosa-rngd':
      return RNGD_PRECISIONS;
    case 'rebellions-atomplus':
      return ATOMPLUS_PRECISIONS;
    case 'nvidia-gpu':
    case 'unknown':
    default:
      return NVIDIA_PRECISIONS;
  }
};

// ----------------------------------------------------------------------

/**
 * Info-chip text describing precision limitations for a device, or null if
 * none should be shown.
 */
export const precisionInfoFor = (
  device: DeviceKey | string | null | undefined
): string | null => {
  const key = deviceKey(typeof device === 'string' ? device : '');
  if (key === 'rebellions-atomplus') return ATOMPLUS_INFO;
  return null;
};
