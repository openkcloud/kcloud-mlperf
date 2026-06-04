// ----------------------------------------------------------------------
// VERIFIED hardware specs for the roofline model (BB-4).
//
// These are DENSE (non-sparsity) peak figures from vendor datasheets, used to
// draw each device's compute roof and memory roof and to place its measured
// batch-1 decode operating point. Numbers are load-bearing for the chart's
// credibility, so every value carries a source and a `confidence` flag; any
// value the vendor does not publish is `null` and called out as unverified.
//
// Sources (captured 2026-06):
//   A30   — NVIDIA A30 datasheet: 165 TFLOP/s FP16 (dense TensorCore), 933 GB/s
//           HBM2. Ampere has NO FP8 path; INT8 is 330 TOPS (dense). 165 W TDP.
//   L40   — NVIDIA L40 datasheet: 181.05 TFLOP/s FP16 (dense), 362.05 TFLOP/s
//           FP8 (dense, Ada FP8 TensorCore), 864 GB/s GDDR6. 300 W TDP.
//   A40   — NVIDIA A40 datasheet: 149.7 TFLOP/s FP16 (dense), 696 GB/s GDDR6.
//           No FP8 path; INT8 is 599 TOPS (dense). 300 W TDP.
//   RNGD  — FuriosaAI RNGD datasheet (furiosa.ai): 256 TFLOP/s BF16, 512 TFLOP/s
//           FP8, 1.5 TB/s HBM3, 256 MB on-chip SRAM. 180 W TDP.
//   Atom+ — Rebellions Atom+ (rebellions.ai): 128 TOPS INT8, 64 MB SRAM, ~256
//           GB/s, ~90 W. BF16/FP16 and FP8 peaks are NOT published by
//           Rebellions; the 32 TFLOP/s BF16 figure is an UNVERIFIED estimate
//           (confidence 'partial'). Mark as such wherever shown.
//
// All TFLOP/s are DENSE peaks (no 2:1 structured-sparsity doubling).
// ----------------------------------------------------------------------

export type SpecConfidence = 'confirmed' | 'partial';

export type DeviceSpec = {
  /** Canonical hardware-model key (matches leaderboard hwModel). */
  hwModel: string;
  /** Dense BF16/FP16 peak in TFLOP/s. Used as the compute roof. */
  fp16Tflops: number;
  /** Dense FP8 peak in TFLOP/s, or null if the device has no FP8 path / it is undisclosed. */
  fp8Tflops: number | null;
  /** Peak memory bandwidth in GB/s. */
  memBwGBs: number;
  /** On-chip SRAM in MB, or null if not applicable / not disclosed. */
  sramMB: number | null;
  /** Board TDP in watts. */
  tdpW: number;
  /** 'confirmed' = from a vendor datasheet; 'partial' = some figures are unverified estimates. */
  confidence: SpecConfidence;
  /** Human-readable note for unverified figures (rendered in the UI). */
  note?: string;
};

// Keyed by the leaderboard's hwModel string ('A30','L40','A40','RNGD','Atom+').
export const DEVICE_SPECS: Record<string, DeviceSpec> = {
  A30: {
    hwModel: 'A30',
    fp16Tflops: 165,
    fp8Tflops: null, // Ampere has no FP8 path; INT8 is 330 TOPS.
    memBwGBs: 933,
    sramMB: null,
    tdpW: 165,
    confidence: 'confirmed',
  },
  L40: {
    hwModel: 'L40',
    fp16Tflops: 181,
    fp8Tflops: 362,
    memBwGBs: 864,
    sramMB: null,
    tdpW: 300,
    confidence: 'confirmed',
  },
  A40: {
    hwModel: 'A40',
    fp16Tflops: 150,
    fp8Tflops: null, // No FP8 path; INT8 is 599 TOPS.
    memBwGBs: 696,
    sramMB: null,
    tdpW: 300,
    confidence: 'confirmed',
  },
  RNGD: {
    hwModel: 'RNGD',
    fp16Tflops: 256, // BF16
    fp8Tflops: 512,
    memBwGBs: 1500, // 1.5 TB/s HBM3
    sramMB: 256,
    tdpW: 180,
    confidence: 'confirmed',
  },
  'Atom+': {
    hwModel: 'Atom+',
    fp16Tflops: 32, // UNVERIFIED estimate — Rebellions does not publish BF16/FP16 peak.
    fp8Tflops: null, // Not disclosed; INT8 is 128 TOPS.
    memBwGBs: 256,
    sramMB: 64,
    tdpW: 90,
    confidence: 'partial',
    note: 'Atom+ BF16/FP16 and FP8 peaks are not published by Rebellions; BF16 figure is an unverified estimate.',
  },
};

/**
 * Resolve the hardware spec for a model string. Exact canonical key first
 * ('A30','L40','A40','RNGD','Atom+'), then a case-insensitive substring
 * heuristic for SKU variants ('NVIDIA-L40', 'FURIOSA-RNGD', 'REBELLIONS-Atom+'),
 * mirroring `getVendorColor` / `deviceUsdPerHr`. Returns null when nothing matches
 * so the UI can omit the device rather than guess.
 */
export function deviceSpec(hwModel: string | null | undefined): DeviceSpec | null {
  if (!hwModel) return null;
  // Exact match first (canonical keys).
  if (hwModel in DEVICE_SPECS) return DEVICE_SPECS[hwModel];
  const upper = hwModel.toUpperCase();
  if (upper.includes('RNGD') || upper.includes('FURIOSA')) return DEVICE_SPECS.RNGD;
  if (upper.includes('ATOM') || upper.includes('REBELLIONS')) return DEVICE_SPECS['Atom+'];
  if (upper.includes('L40')) return DEVICE_SPECS.L40;
  if (upper.includes('A40')) return DEVICE_SPECS.A40;
  if (upper.includes('A30')) return DEVICE_SPECS.A30;
  return null;
}

// ----------------------------------------------------------------------
// Batch-1 autoregressive-decode roofline model (Llama-3.1-8B, dense).
//
// Standard approximations for ONE output token during decode:
//   - FLOPs/token  = 2 * N  (one multiply + one add per weight)         [N = params]
//   - bytes/token  = N * bytesPerWeight  (every weight is streamed once from HBM)
//   - intensity I  = FLOPs/byte = (2*N) / (N*bytesPerWeight) = 2/bytesPerWeight
//       -> FP16 (2 B/weight) => I ~ 1.0      ;  FP8 (1 B/weight) => I ~ 2.0
//
// Because I is ~1-2 FLOP/byte while every device's ridge point (peakTFLOPS /
// memBW) is ~125-215 FLOP/byte, decode sits ~100x to the LEFT of the ridge:
// it is firmly MEMORY-bandwidth bound, never compute bound. The device with the
// most memory bandwidth (RNGD, 1.5 TB/s) therefore leads, not the one with the
// most TFLOP/s.
// ----------------------------------------------------------------------

/** Llama-3.1-8B dense parameter count. */
export const MODEL_PARAMS = 8e9;

/** FLOPs to produce one output token during decode = 2 * params = 16 GFLOP. */
export const FLOPS_PER_TOKEN = 2 * MODEL_PARAMS;

/** Bytes streamed (whole weight set) to produce one output token at a given precision. */
export function bytesPerToken(bytesPerWeight: number): number {
  return MODEL_PARAMS * bytesPerWeight;
}

/** Decode arithmetic intensity (FLOP/byte) = 2 / bytesPerWeight. FP16 -> 1.0, FP8 -> 2.0. */
export function decodeIntensity(bytesPerWeight: number): number {
  return FLOPS_PER_TOKEN / bytesPerToken(bytesPerWeight);
}

/** Bytes per weight for a coarse precision class. FP8/int8 -> 1, everything else -> 2 (FP16/BF16). */
export function bytesPerWeightFor(precisionClass: string | null | undefined): number {
  return (precisionClass ?? '').toLowerCase().includes('fp8') ? 1 : 2;
}

/** Ridge-point intensity (FLOP/byte) where the memory roof meets the compute roof. */
export function ridgePoint(peakTflops: number, memBwGBs: number): number {
  // memBW in TB/s = GB/s / 1000; ridge = peakTFLOPS / memBW(TB/s).
  return peakTflops / (memBwGBs / 1000);
}

/** Memory roof: achievable TFLOP/s at intensity I = I * memBW(TB/s). */
export function memoryRoofTflops(intensity: number, memBwGBs: number): number {
  return intensity * (memBwGBs / 1000);
}

/** Achieved compute (TFLOP/s) implied by a MEASURED decode throughput (tok/s). */
export function achievedTflops(tps: number): number {
  return (tps * FLOPS_PER_TOKEN) / 1e12;
}

/** Theoretical max decode throughput (tok/s) at the memory-bandwidth ceiling for a precision. */
export function memBwCeilingTps(memBwGBs: number, bytesPerWeight: number): number {
  // (GB/s -> bytes/s) / (bytes/token) = tok/s.
  return (memBwGBs * 1e9) / bytesPerToken(bytesPerWeight);
}
