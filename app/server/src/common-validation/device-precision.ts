import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * B2: Validate (device_type, device_model, precision) at create-time.
 *
 * Truth table (mirrors the docs and the operator-job allow-list):
 *   - Atom+ (Rebellions RBLN-CA22) → fp16 ONLY (no FP8 / FP32 / BF16 path).
 *     FP8 specifically rejected with the operator-friendly hint:
 *       "Atom+ hardware (RBLN-CA22) does not support FP8. Use FP16."
 *   - RNGD (Furiosa) → fp8, fp16, bf16/bfloat16, int8, int4 — we currently
 *     allow fp8/fp16/bf16 (int8/int4 not surfaced yet).
 *   - NVIDIA-* GPUs                → bfloat16/bf16, fp16, fp8.
 *                                    (fp8 is silicon-gated to Ada+/H100, but
 *                                    accept across the family — the operator
 *                                    job fails loudly on older silicon.)
 *
 * Thrown as `HttpException(BAD_REQUEST=400)` so the frontend can surface the
 * message verbatim.  Throwers MUST call this BEFORE any `try { … } catch`
 * that wraps everything to 500 / RpcException.
 */
export function validateDevicePrecision(
  deviceType: 'npu' | 'gpu',
  deviceModel: string | null | undefined,
  precision: string | null | undefined,
): void {
  if (!precision) {
    throw new HttpException('precision is required', HttpStatus.BAD_REQUEST);
  }
  const p = precision.toLowerCase().trim();
  const model = (deviceModel ?? '').toLowerCase().trim();

  if (deviceType === 'npu') {
    if (model.startsWith('atom')) {
      if (p !== 'fp16') {
        throw new HttpException(
          p === 'fp8'
            ? 'Atom+ hardware (RBLN-CA22) does not support FP8. Use FP16.'
            : `Atom+ hardware (RBLN-CA22) supports only FP16, got ${precision}.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      return;
    }
    if (model.startsWith('rngd')) {
      // RNGD silicon supports BF16, FP8, INT4, INT8 per Furiosa docs.
      // v41: surface fp8/fp16/bf16 (bfloat16 alias); int8/int4 not surfaced
      // yet until the npu-eval worker exposes a dropdown for them.
      if (p !== 'fp8' && p !== 'fp16' && p !== 'bf16' && p !== 'bfloat16') {
        throw new HttpException(
          `RNGD hardware supports FP8, FP16, or BF16, got ${precision}.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      return;
    }
    if (p !== 'fp8' && p !== 'fp16') {
      throw new HttpException(
        `Unknown NPU '${deviceModel}' precision '${precision}' rejected; expected fp8 or fp16.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return;
  }

  // 'auto' restored 2026-05-22 — the working FP8 path on L40 (exam #167 on
  // 2026-05-11) was precision='auto'. vllm with dtype='auto' detects FP8
  // from the pre-quantized model file; passing dtype='fp8' directly
  // raises ValueError('Unknown dtype: fp8'). This validator had narrowed
  // the allow-list and unintentionally broke the FP8 demo path.
  const ok =
    p === 'fp8' ||
    p === 'fp16' ||
    p === 'bf16' ||
    p === 'bfloat16' ||
    p === 'auto';
  if (!ok) {
    throw new HttpException(
      `GPU '${deviceModel}' precision '${precision}' rejected; expected bfloat16, fp16, fp8, or auto.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
