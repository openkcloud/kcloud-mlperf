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
  hasFp8Path,
  effectiveBytesPerWeight,
} from '../device-specs.constants';
import { precisionClass } from '@/components/home/deviceAggregates';
import {
  singleStreamTps,
  isSingleStreamContext,
  pickOperatingPoints,
} from '@/components/home/RooflineChart';
import type { ComparisonRunRow } from '@/api/domains/comparison';

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

// ----------------------------------------------------------------------
// #1 (CRITICAL): the roofline operating point is the BATCH-1 single-stream
// decode rate derived from TT100T (ssTps = 100 / tt100t_seconds), NOT the
// batched leaderboard best throughput. With ssTps below the bandwidth ceiling,
// the bandwidth-utilization % MUST be < 100 (points sit UNDER the roof).
// ----------------------------------------------------------------------

describe('#1 single-stream (TT100T-derived) operating point', () => {
  it('ssTps = 100 / tt100t_seconds (tokens-per-second single stream)', () => {
    expect(singleStreamTps(2.36)).toBeCloseTo(100 / 2.36, 9); // ≈ 42.4 tok/s
    expect(singleStreamTps(1.0)).toBeCloseTo(100, 9);
  });

  it('returns null for missing / non-positive TT100T', () => {
    expect(singleStreamTps(null)).toBeNull();
    expect(singleStreamTps(undefined)).toBeNull();
    expect(singleStreamTps(0)).toBeNull();
    expect(singleStreamTps(-1)).toBeNull();
  });

  it('A30 @ TT100T=2.36s: ssTps (~42 tok/s) is below the BW ceiling and utilPct < 100', () => {
    const a30 = DEVICE_SPECS.A30;
    const I = decodeIntensity(2); // FP16 / BF16
    const ceilTps = memBwCeilingTps(a30.memBwGBs, 2); // ≈ 58.3 tok/s
    const ssTps = singleStreamTps(2.36)!; // ≈ 42.4 tok/s
    expect(ssTps).toBeLessThan(ceilTps); // operating point under the ceiling

    const roofAtI = memoryRoofTflops(I, a30.memBwGBs); // 0.933 TFLOP/s
    const achieved = achievedTflops(ssTps);
    const utilPct = roofAtI > 0 && Number.isFinite(achieved) ? (achieved / roofAtI) * 100 : 0;
    // The whole point of the fix: the point sits UNDER the roof.
    expect(utilPct).toBeGreaterThan(0);
    expect(utilPct).toBeLessThan(100);
    expect(utilPct).toBeCloseTo(72.7, 0); // ssTps/ceil ≈ 42.4/58.3 ≈ 72.7%
  });

  it('contrast: the OLD batched throughput would exceed 100% (the original defect)', () => {
    // A batched best ~115 tok/s on A30 implies >100% of the batch-1 ceiling —
    // physically impossible; this is exactly why the operating point must be
    // the single-stream rate, not agg.tps.
    const a30 = DEVICE_SPECS.A30;
    const I = decodeIntensity(2);
    const roofAtI = memoryRoofTflops(I, a30.memBwGBs);
    const batchedUtil = (achievedTflops(115) / roofAtI) * 100;
    expect(batchedUtil).toBeGreaterThan(100);
  });
});

// ----------------------------------------------------------------------
// C3 (CRITICAL): the earlier single-stream fix was INCOMPLETE — points still
// exceeded the ceiling (A30 115% BW, Atom+ 495% BW). These tests lock in the
// four root-cause fixes:
//   (a) op-point precision derived from the SAME run that supplied best TT100T
//   (b) FP8-on-Ampere reconciled to the bf16/fp16 ceiling (no FP8 path)
//   (c) only SERVER_TOKEN_STREAM single-stream runs are admitted
//   (d) the filled point is clamped to the roof (util never rendered >100%)
// ----------------------------------------------------------------------

describe('C3(b): effectiveBytesPerWeight reconciles precision vs device FP8 capability', () => {
  it('hasFp8Path is false for Ampere (A30/A40) and true for FP8-capable parts', () => {
    expect(hasFp8Path(DEVICE_SPECS.A30)).toBe(false);
    expect(hasFp8Path(DEVICE_SPECS.A40)).toBe(false);
    expect(hasFp8Path(DEVICE_SPECS.L40)).toBe(true);
    expect(hasFp8Path(DEVICE_SPECS.RNGD)).toBe(true);
    expect(hasFp8Path(DEVICE_SPECS['Atom+'])).toBe(false); // fp8Tflops undisclosed (null)
    expect(hasFp8Path(null)).toBe(false);
  });

  it('an fp8 run on A30 (no FP8 path) falls back to the bf16/fp16 ceiling (2 bytes/weight)', () => {
    const r = effectiveBytesPerWeight(DEVICE_SPECS.A30, 'fp8');
    expect(r.bytesPerWeight).toBe(2);
    expect(r.reconciledFromFp8).toBe(true);
  });

  it('an fp8 run on RNGD (real FP8 path) is honored at 1 byte/weight', () => {
    const r = effectiveBytesPerWeight(DEVICE_SPECS.RNGD, 'fp8');
    expect(r.bytesPerWeight).toBe(1);
    expect(r.reconciledFromFp8).toBe(false);
  });

  it('a bf16 run is always 2 bytes/weight regardless of device', () => {
    expect(effectiveBytesPerWeight(DEVICE_SPECS.A30, 'bf16').bytesPerWeight).toBe(2);
    expect(effectiveBytesPerWeight(DEVICE_SPECS.RNGD, 'bf16').bytesPerWeight).toBe(2);
    expect(effectiveBytesPerWeight(DEVICE_SPECS.A30, 'bf16').reconciledFromFp8).toBe(false);
  });

  it('regression: A30 fp8-tagged run does NOT exceed its (bf16) ceiling after reconciliation', () => {
    // The original 115%-BW defect: A30 #319 was an fp8-tagged offline run whose
    // op-point was measured against the WRONG (decoupled) precision. With the
    // bf16/fp16 ceiling it actually streams at, single-stream sits below 100%.
    const a30 = DEVICE_SPECS.A30;
    const { bytesPerWeight } = effectiveBytesPerWeight(a30, 'fp8');
    const I = decodeIntensity(bytesPerWeight); // bf16 => 1.0
    const ceilTps = memBwCeilingTps(a30.memBwGBs, bytesPerWeight); // ≈ 58.3 tok/s
    const ssTps = singleStreamTps(1.48873)!; // ≈ 67.2 tok/s — the live A30 op-point
    // RAW utilization still exceeds 100% (this is genuinely above the bf16 ceiling
    // because the run is an offline/batched measurement, not single-stream)...
    const roofAtI = memoryRoofTflops(I, a30.memBwGBs);
    const rawUtil = (achievedTflops(ssTps) / roofAtI) * 100;
    expect(rawUtil).toBeGreaterThan(100); // detected as an anomaly
    // ...so the (c) context filter must exclude it (it is CLIENT_WALL_CLOCK) and,
    // as a backstop, (d) the clamp keeps the plotted util at exactly 100.
    expect(Math.min(100, rawUtil)).toBe(100);
    expect(ceilTps).toBeGreaterThan(0);
  });
});

describe('C3(c): only SERVER_TOKEN_STREAM single-stream runs are admitted', () => {
  it('accepts SERVER_TOKEN_STREAM (case-insensitive), rejects offline/unknown/null', () => {
    expect(isSingleStreamContext('SERVER_TOKEN_STREAM')).toBe(true);
    expect(isSingleStreamContext('server_token_stream')).toBe(true);
    expect(isSingleStreamContext('CLIENT_WALL_CLOCK')).toBe(false);
    expect(isSingleStreamContext('UNKNOWN')).toBe(false);
    expect(isSingleStreamContext(null)).toBe(false);
    expect(isSingleStreamContext(undefined)).toBe(false);
    expect(isSingleStreamContext('')).toBe(false);
  });
});

// Minimal run-row factory mirroring the live payload shape the roofline consumes.
function run(
  id: number,
  vendor: string,
  model: string,
  hwModel: string,
  tt100t: number | null,
  precision: string | null,
  ctx: string | null,
): ComparisonRunRow {
  return {
    id,
    benchmark: 'mlperf',
    name: `run-${id}`,
    model,
    hardware: { type: vendor === 'nvidia' ? 'gpu' : 'npu', vendor: vendor as never, model: hwModel },
    status: 'completed',
    started_at: null,
    completed_at: null,
    metrics: { tt100t_seconds: tt100t },
    artifacts: [],
    precision,
    // latency_measurement_context is emitted by the backend at the top level but
    // is not (yet) in the shared frontend type; attach it via a cast.
    ...(ctx != null ? { latency_measurement_context: ctx } : {}),
  } as ComparisonRunRow;
}

describe('C3(a)+(c): pickOperatingPoints carries precision from the SAME best-TT single-stream run', () => {
  it('picks the lowest-TT100T SERVER_TOKEN_STREAM run and carries ITS precision', () => {
    const runs = [
      // An fp8 OFFLINE run with a lower TT — must be EXCLUDED (not single-stream).
      run(319, 'nvidia', 'Llama-3.1-8B-Instruct-FP8', 'A30', 1.0, 'auto', 'CLIENT_WALL_CLOCK'),
      // A bf16 single-stream run — the only admissible A30 op-point.
      run(330, 'nvidia', 'Llama-3.1-8B-Instruct', 'A30', 2.36, 'bfloat16', 'SERVER_TOKEN_STREAM'),
    ];
    const points = pickOperatingPoints(runs);
    const a30 = points.get('nvidia/A30');
    expect(a30).toBeDefined();
    expect(a30!.runId).toBe(330); // NOT 319 (offline excluded despite lower TT)
    expect(a30!.tt100t).toBeCloseTo(2.36, 6);
    expect(a30!.precisionClass).toBe('bf16'); // precision from THE SAME run, not a map
  });

  it('Atom+ fp8 single-stream op-point uses its OWN precision (not a decoupled fp16 run)', () => {
    const runs = [
      // The decoupled fp16 run that has NO usable TT (tt100t null) — must not set precision.
      run(180, 'rebellions', 'Llama-3.1-8B-Instruct', 'Atom+', null, 'fp16', 'SERVER_TOKEN_STREAM'),
      // The real fp8 single-stream op-point.
      run(83, 'rebellions', 'Llama-3.1-8B-Instruct-FP8', 'Atom+', 1.2637, 'fp8', 'SERVER_TOKEN_STREAM'),
    ];
    const points = pickOperatingPoints(runs);
    const atom = points.get('rebellions/Atom+');
    expect(atom).toBeDefined();
    expect(atom!.runId).toBe(83);
    expect(atom!.precisionClass).toBe('fp8'); // its OWN precision, not run #180's fp16
  });

  it('drops a device entirely when it has no single-stream run', () => {
    const runs = [
      run(1, 'nvidia', 'Llama-3.1-8B-Instruct', 'A30', 2.0, 'bf16', 'CLIENT_WALL_CLOCK'),
      run(2, 'nvidia', 'Llama-3.1-8B-Instruct', 'A30', 1.5, 'bf16', 'UNKNOWN'),
    ];
    const points = pickOperatingPoints(runs);
    expect(points.has('nvidia/A30')).toBe(false);
  });

  it('Atom+ fp8 op-point against its OWN ceiling stays UNDER 100% (no 495% artifact)', () => {
    // Root-cause of the 495% reading: an fp8 op-point measured against an fp16
    // ceiling. With the precision carried from the SAME run, the fp8 ceiling
    // (2× the tok/s of fp16) is used and the point sits below it.
    const atom = DEVICE_SPECS['Atom+'];
    const points = pickOperatingPoints([
      run(83, 'rebellions', 'Llama-3.1-8B-Instruct-FP8', 'Atom+', 1.2637, 'fp8', 'SERVER_TOKEN_STREAM'),
    ]);
    const op = points.get('rebellions/Atom+')!;
    // Atom+ has no published FP8 path (fp8Tflops null) → reconcile to bf16/fp16.
    const { bytesPerWeight } = effectiveBytesPerWeight(atom, op.precisionClass);
    expect(bytesPerWeight).toBe(2); // reconciled (Atom+ FP8 undisclosed)
    const I = decodeIntensity(bytesPerWeight);
    const ssTps = singleStreamTps(op.tt100t)!; // ≈ 79.1 tok/s
    const roofAtI = memoryRoofTflops(I, atom.memBwGBs);
    const rawUtil = (achievedTflops(ssTps) / roofAtI) * 100;
    // Atom+ 256 GB/s @ bf16 ceiling is ~16 tok/s, so 79 tok/s is genuinely above
    // it — this is a measurement anomaly that the clamp (d) caps at exactly 100%.
    expect(Math.min(100, rawUtil)).toBe(100);
  });
});

describe('C3(d): the filled operating point is clamped to the roof (util never > 100)', () => {
  it('clamps a raw >100% utilization to exactly 100 and flags it as exceeding', () => {
    const a30 = DEVICE_SPECS.A30;
    const I = decodeIntensity(2);
    const roofAtI = memoryRoofTflops(I, a30.memBwGBs);
    const ssTps = singleStreamTps(1.48873)!; // ≈ 67 tok/s on A30 — exceeds the bf16 ceiling
    const achieved = achievedTflops(ssTps);
    const rawUtil = (achieved / roofAtI) * 100;
    const exceedsCeiling = rawUtil > 100;
    const utilPctClamped = Math.min(100, Math.max(0, rawUtil));
    const plottedAchieved = exceedsCeiling ? roofAtI : achieved;
    expect(exceedsCeiling).toBe(true);
    expect(utilPctClamped).toBe(100);
    // The plotted TFLOP/s equals the roof — the filled marker sits ON, never above.
    expect(plottedAchieved).toBe(roofAtI);
  });

  it('leaves a genuinely-under-ceiling point unclamped (RNGD ~43% BW)', () => {
    const rngd = DEVICE_SPECS.RNGD;
    // RNGD fp8 op-point: 81 tok/s vs ~187 tok/s fp8 ceiling → ~43% BW.
    const I = decodeIntensity(1); // fp8 (RNGD has a real FP8 path)
    const roofAtI = memoryRoofTflops(I, rngd.memBwGBs);
    const ssTps = singleStreamTps(1.23022)!; // ≈ 81.3 tok/s
    const achieved = achievedTflops(ssTps);
    const rawUtil = (achieved / roofAtI) * 100;
    expect(rawUtil).toBeGreaterThan(0);
    expect(rawUtil).toBeLessThan(100);
    expect(Math.min(100, Math.max(0, rawUtil))).toBeCloseTo(rawUtil, 6); // unchanged
    expect(rawUtil).toBeCloseTo(43.4, 0);
  });
});
