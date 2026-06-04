import { describe, it, expect } from 'vitest';
import {
  DEVICE_SPECS,
  deviceSpec,
  MODEL_PARAMS,
  FLOPS_PER_TOKEN,
  decodeIntensity,
  ridgePoint,
  achievedTflops,
  memoryRoofTflops,
  memBwCeilingTps,
} from '../device-specs.constants';
import { precisionClass } from '@/components/home/deviceAggregates';

// ----------------------------------------------------------------------
// Roofline math sanity. These assertions are the credibility gate for BB-4:
// ridge points must land ~125-215 FLOP/byte, decode intensity must be ~1 (FP16)
// / ~2 (FP8), and a measured ~80 tok/s must imply an achieved compute WAY below
// any compute roof (the whole "decode is memory-bound" point).
// ----------------------------------------------------------------------

describe('deviceSpec resolver', () => {
  it('resolves exact canonical keys', () => {
    expect(deviceSpec('A30')?.fp16Tflops).toBe(165);
    expect(deviceSpec('RNGD')?.memBwGBs).toBe(1500);
    expect(deviceSpec('Atom+')?.confidence).toBe('partial');
  });
  it('resolves SKU variants case-insensitively by substring', () => {
    expect(deviceSpec('NVIDIA-L40')?.hwModel).toBe('L40');
    expect(deviceSpec('FURIOSA-RNGD')?.hwModel).toBe('RNGD');
    expect(deviceSpec('REBELLIONS-Atom+')?.hwModel).toBe('Atom+');
  });
  it('returns null for unknown / empty', () => {
    expect(deviceSpec('TPUv5')).toBeNull();
    expect(deviceSpec(null)).toBeNull();
    expect(deviceSpec(undefined)).toBeNull();
  });
  it('marks Ampere parts (A30, A40) as having no FP8 path', () => {
    expect(DEVICE_SPECS.A30.fp8Tflops).toBeNull();
    expect(DEVICE_SPECS.A40.fp8Tflops).toBeNull();
    expect(DEVICE_SPECS.L40.fp8Tflops).toBe(362);
    expect(DEVICE_SPECS.RNGD.fp8Tflops).toBe(512);
  });
});

describe('decode arithmetic intensity', () => {
  it('is ~1.0 for FP16 (2 bytes/weight) and ~2.0 for FP8 (1 byte/weight)', () => {
    expect(decodeIntensity(2)).toBeCloseTo(1.0, 6);
    expect(decodeIntensity(1)).toBeCloseTo(2.0, 6);
  });
  it('uses 2*N FLOP/token for an 8B model = 16 GFLOP', () => {
    expect(MODEL_PARAMS).toBe(8e9);
    expect(FLOPS_PER_TOKEN).toBe(16e9);
  });
});

describe('ridge points (peakTFLOPS / memBW(TB/s))', () => {
  // Expected from the datasheet specs; all must land in the ~125-215 band.
  const expected: Record<string, number> = {
    A30: 177, // 165 / 0.933
    L40: 209, // 181 / 0.864
    A40: 215, // 150 / 0.696
    RNGD: 171, // 256 / 1.500
    'Atom+': 125, // 32 / 0.256
  };
  for (const [key, val] of Object.entries(expected)) {
    it(`${key} ridge ≈ ${val} (±2)`, () => {
      const s = DEVICE_SPECS[key];
      const ridge = ridgePoint(s.fp16Tflops, s.memBwGBs);
      expect(ridge).toBeGreaterThan(val - 2);
      expect(ridge).toBeLessThan(val + 2);
      // And every ridge sits in the documented credibility band.
      expect(ridge).toBeGreaterThanOrEqual(125);
      expect(ridge).toBeLessThanOrEqual(216);
    });
  }
});

describe('operating points are below the compute roof and below the BW ceiling', () => {
  it('80 tok/s => 1.28 TFLOP/s achieved (= 80 * 16e9 / 1e12)', () => {
    // 80 tok/s * 16 GFLOP/tok = 1.28e12 FLOP/s = 1.28 TFLOP/s.
    expect(achievedTflops(80)).toBeCloseTo(1.28, 6);
  });

  it('measured point is strictly BELOW the memory-bandwidth ceiling (not on the roof)', () => {
    // RNGD@80 tok/s: ceiling is 93.8 tok/s (1.5 TB/s / 16 GB/token).
    // Achieved 1.28 TFLOP/s < roof 1.50 TFLOP/s at I=1.0.
    const rngd = DEVICE_SPECS.RNGD;
    const I = decodeIntensity(2); // FP16
    const roof = memoryRoofTflops(I, rngd.memBwGBs); // 1.500 TFLOP/s
    const achieved = achievedTflops(80);
    expect(achieved).toBeLessThan(roof);
    // Utilization is in (0, 1) — between 0% and 100%.
    const util = achieved / roof;
    expect(util).toBeGreaterThan(0);
    expect(util).toBeLessThan(1);
    // And far below the compute roof: 1.28 << 256 / 50 = 5.12.
    expect(achieved).toBeLessThan(rngd.fp16Tflops / 50);
  });

  it('A30@44 tok/s sits at ~75% of its BW ceiling — below but not at the roof', () => {
    const a30 = DEVICE_SPECS.A30;
    const I = decodeIntensity(2); // FP16
    const roof = memoryRoofTflops(I, a30.memBwGBs); // 0.933 TFLOP/s
    const achieved = achievedTflops(44); // 0.704 TFLOP/s
    expect(achieved).toBeLessThan(roof);
    const utilPct = (achieved / roof) * 100;
    // Expected ~75%; allow ±5 pp for sample tps variation.
    expect(utilPct).toBeGreaterThan(70);
    expect(utilPct).toBeLessThan(80);
  });

  it('bandwidth ceiling tok/s = memBwCeilingTps and its achieved equals the roof', () => {
    // This is a definitional identity: if tps == ceiling, achieved == roof.
    // It is tested here as a correctness check of the two helper functions
    // being mutually consistent (not as a claim about measured data).
    const a30 = DEVICE_SPECS.A30;
    const ceilTps = memBwCeilingTps(a30.memBwGBs, 2);
    const roof = memoryRoofTflops(decodeIntensity(2), a30.memBwGBs);
    expect(achievedTflops(ceilTps)).toBeCloseTo(roof, 6);
  });
});

describe('FIX-#2: precision resolution via precisionClass (auto+FP8-model => fp8)', () => {
  it("precision='auto' with model='...-FP8' resolves to fp8 and intensity 2.0", () => {
    const cls = precisionClass('auto', 'Llama-3.1-8B-Instruct-FP8');
    expect(cls).toBe('fp8');
    const bytesPerWeight = cls === 'fp8' ? 1 : 2;
    expect(decodeIntensity(bytesPerWeight)).toBeCloseTo(2.0, 6);
  });

  it("precision='fp16' gives intensity 1.0", () => {
    const cls = precisionClass('fp16', 'Llama-3.1-8B-Instruct');
    expect(cls).toBe('fp16');
    expect(decodeIntensity(2)).toBeCloseTo(1.0, 6);
  });

  it("precision='auto' with plain model (no FP8 suffix) resolves to bf16 => intensity 1.0", () => {
    const cls = precisionClass('auto', 'Llama-3.1-8B-Instruct');
    expect(cls).toBe('bf16');
    const bytesPerWeight = cls === 'fp8' ? 1 : 2;
    expect(decodeIntensity(bytesPerWeight)).toBeCloseTo(1.0, 6);
  });
});
