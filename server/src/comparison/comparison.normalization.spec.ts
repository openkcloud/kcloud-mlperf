import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ComparisonService,
  computeIncompatibilityReasons,
  type NormalizedRun,
} from './comparison.service';
import { MpExam } from '../entities/mp-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { StatusEnum } from '../enums/status.enum';

// ----------------------------------------------------------------------
// Shared fixtures
// ----------------------------------------------------------------------

const mmExam = (
  over: Partial<MmExam> = {},
  accFraction: number | null = 0.4929,
): Partial<MmExam> & { results: Partial<MmExamResult>[] } => ({
  id: 1,
  name: 'mmlu-gpu',
  gpu_type: 'NVIDIA-A30',
  device_type: 'GPU',
  status: StatusEnum.COMPLETED,
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  dataset: 'mmlu-pro',
  precision: 'BF16',
  results:
    accFraction == null
      ? []
      : [
          {
            id: 10,
            exam_id: 1,
            result_number: 1,
            result_acc_total: accFraction,
          } as MmExamResult,
        ],
  ...over,
});

const npuExam = (
  over: Partial<NpuExam> = {},
  accPercent: number | null = 45,
): Partial<NpuExam> & { results: Partial<NpuExamResult>[] } => ({
  id: 1,
  name: 'mmlu-npu',
  npu_type: 'RNGD',
  benchmark: 'mmlu',
  status: StatusEnum.COMPLETED,
  model: 'Llama-3.1-8B-Instruct',
  dataset: 'mmlu-pro',
  precision: 'FP8',
  results:
    accPercent == null
      ? []
      : [
          {
            id: 20,
            exam_id: 1,
            result_number: 1,
            result_accuracy: accPercent,
          } as NpuExamResult,
        ],
  ...over,
});

async function buildService(opts: {
  mp?: Partial<MpExam>[];
  mm?: Partial<MmExam>[];
  npu?: Partial<NpuExam>[];
}): Promise<ComparisonService> {
  const mp = opts.mp ?? [];
  const mm = opts.mm ?? [];
  const npu = opts.npu ?? [];

  const matchById =
    <T extends { id?: number; benchmark?: string }>(rows: T[]) =>
    (query: any): T | null => {
      const wantId = query?.where?.id;
      const wantBench = query?.where?.benchmark;
      return (
        rows.find(
          (r) =>
            (wantId == null || r.id === wantId) &&
            (wantBench == null || r.benchmark === wantBench),
        ) ?? null
      );
    };

  const mkRepo = <T extends { id?: number; benchmark?: string }>(rows: T[]) => ({
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn(matchById(rows)),
  });

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ComparisonService,
      { provide: getRepositoryToken(MpExam), useValue: mkRepo(mp as any) },
      { provide: getRepositoryToken(MpExamResult), useValue: {} },
      { provide: getRepositoryToken(MmExam), useValue: mkRepo(mm as any) },
      { provide: getRepositoryToken(MmExamResult), useValue: {} },
      { provide: getRepositoryToken(NpuExam), useValue: mkRepo(npu as any) },
      { provide: getRepositoryToken(NpuExamResult), useValue: {} },
    ],
  }).compile();

  return module.get<ComparisonService>(ComparisonService);
}

const listRuns = async (svc: ComparisonService): Promise<NormalizedRun[]> => {
  const res = (await svc.list({
    benchmark: 'all',
    hardware: 'all',
    node: null,
  })) as { empty: false; runs: NormalizedRun[] };
  return res.runs;
};

// ----------------------------------------------------------------------
// C2 — accuracy_pct unit normalization (mm_exam fraction → percent; NPU stays)
// ----------------------------------------------------------------------

describe('C2 — accuracy_pct is a percent in [0,100] for every source path', () => {
  it('mm_exam fraction 0.4929 is normalized to ~49.29 percent', async () => {
    const svc = await buildService({ mm: [mmExam({}, 0.4929)] });
    const runs = await listRuns(svc);
    expect(runs).toHaveLength(1);
    expect(runs[0].source_table).toBe('mm_exam');
    expect(runs[0].metrics.accuracy_pct).toBeCloseTo(49.29, 2);
  });

  it('mm_exam 0 stays 0 (not null)', async () => {
    const svc = await buildService({ mm: [mmExam({}, 0)] });
    const runs = await listRuns(svc);
    expect(runs[0].metrics.accuracy_pct).toBe(0);
  });

  it('npu mmlu percent 45 passes through unchanged', async () => {
    const svc = await buildService({ npu: [npuExam({}, 45)] });
    const runs = await listRuns(svc);
    expect(runs[0].source_table).toBe('npu_exam');
    expect(runs[0].metrics.accuracy_pct).toBe(45);
  });

  it('a mixed GPU(mm)+NPU MMLU set lands on one [0,100] scale (no 100x split)', async () => {
    const svc = await buildService({
      mm: [mmExam({ id: 1 }, 0.5)],
      npu: [npuExam({ id: 2 }, 50)],
    });
    const runs = await listRuns(svc);
    const accs = runs
      .map((r) => r.metrics.accuracy_pct)
      .filter((v): v is number => v != null);
    expect(accs).toHaveLength(2);
    // Both ~50 — within the same order of magnitude, not 0.5 vs 50.
    expect(Math.max(...accs) / Math.min(...accs)).toBeLessThan(2);
  });

  it('INVARIANT: every accuracy_pct across both paths is null or within [0,100]', async () => {
    const svc = await buildService({
      mm: [
        mmExam({ id: 1 }, 0),
        mmExam({ id: 2 }, 0.4929),
        mmExam({ id: 3 }, 0.65),
        mmExam({ id: 4 }, 1.0),
      ],
      npu: [
        npuExam({ id: 1 }, 0),
        npuExam({ id: 2 }, 21),
        npuExam({ id: 3 }, 70),
        npuExam({ id: 4 }, 100),
      ],
    });
    const runs = await listRuns(svc);
    for (const run of runs) {
      const acc = run.metrics.accuracy_pct;
      if (acc != null) {
        expect(acc).toBeGreaterThanOrEqual(0);
        expect(acc).toBeLessThanOrEqual(100);
      }
    }
  });

  it('GUARD: a malformed NPU percent >100 is clamped into [0,100]', async () => {
    const svc = await buildService({ npu: [npuExam({}, 250)] });
    const runs = await listRuns(svc);
    expect(runs[0].metrics.accuracy_pct).toBe(100);
  });
});

// ----------------------------------------------------------------------
// C4 — scenario_mismatch for MLPerf server-vs-offline pairs
// ----------------------------------------------------------------------

const mlperfRun = (over: Partial<NormalizedRun> = {}): NormalizedRun => ({
  id: 1,
  benchmark: 'mlperf',
  name: 'r',
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  hardware: {
    type: 'gpu',
    vendor: 'nvidia',
    model: 'NVIDIA-A30',
    canonical: 'A30',
    node: 'jw2',
  },
  status: StatusEnum.COMPLETED,
  started_at: null,
  completed_at: null,
  elapsed_seconds: null,
  metrics: { tt100t_seconds: 2.3, tps: 60, accuracy_pct: null, throughput: null },
  artifacts: [],
  precision: 'BF16',
  scenario: 'Server',
  batch_size: 1,
  dataset: 'cnn-dailymail',
  data_number: 13368,
  max_output_tokens: 128,
  source_table: 'mp_exam',
  failure_reason: null,
  config_fingerprint: 'fp',
  drift_flag: false,
  is_canonical: true,
  precision_mismatch: false,
  latency_measurement_context: undefined as any,
  ...over,
});

describe('C4 — scenario_mismatch incompatibility reason', () => {
  it('flags Server vs Offline MLPerf (everything else equal)', () => {
    const a = mlperfRun({ scenario: 'Server' });
    const b = mlperfRun({ id: 2, scenario: 'Offline' });
    expect(computeIncompatibilityReasons(a, b)).toContain('scenario_mismatch');
  });

  it('case-insensitive: "server" vs "SERVER" is NOT a mismatch', () => {
    const a = mlperfRun({ scenario: 'server' });
    const b = mlperfRun({ id: 2, scenario: 'SERVER' });
    expect(computeIncompatibilityReasons(a, b)).not.toContain(
      'scenario_mismatch',
    );
  });

  it('skips when either scenario is null (MMLU rows carry no scenario)', () => {
    const a = mlperfRun({ scenario: null });
    const b = mlperfRun({ id: 2, scenario: 'Offline' });
    expect(computeIncompatibilityReasons(a, b)).not.toContain(
      'scenario_mismatch',
    );
  });

  it('does not flag scenario for non-mlperf pairs', () => {
    const a = mlperfRun({ benchmark: 'mmlu', scenario: 'Server' });
    const b = mlperfRun({ id: 2, benchmark: 'mmlu', scenario: 'Offline' });
    expect(computeIncompatibilityReasons(a, b)).not.toContain(
      'scenario_mismatch',
    );
  });

  it('adds it only once (no duplicate)', () => {
    const a = mlperfRun({ scenario: 'Server' });
    const b = mlperfRun({ id: 2, scenario: 'Offline' });
    const reasons = computeIncompatibilityReasons(a, b);
    expect(reasons.filter((r) => r === 'scenario_mismatch')).toHaveLength(1);
  });

  it('pair() surfaces scenario_mismatch in both the legacy list and fairness_assessment', async () => {
    const svc = await buildService({
      mp: [
        {
          id: 328,
          name: 'A30-server',
          gpu_type: 'NVIDIA-A30',
          device_type: 'GPU',
          status: StatusEnum.COMPLETED,
          model: 'meta-llama/Llama-3.1-8B-Instruct',
          dataset: 'cnn_eval.json',
          precision: 'BF16',
          batch_size: 1,
          data_number: 13368,
          scenario: 'Server' as any,
          retry_num: 1,
          results: [
            {
              id: 1,
              exam_id: 328,
              result_number: 1,
              result_perf_tps: 60,
              result_tt100t: 2300,
            } as MpExamResult,
          ],
        },
        {
          id: 329,
          name: 'A30-offline',
          gpu_type: 'NVIDIA-A30',
          device_type: 'GPU',
          status: StatusEnum.COMPLETED,
          model: 'meta-llama/Llama-3.1-8B-Instruct',
          dataset: 'cnn_eval.json',
          precision: 'BF16',
          batch_size: 1,
          data_number: 13368,
          scenario: 'Offline' as any,
          retry_num: 1,
          results: [
            {
              id: 2,
              exam_id: 329,
              result_number: 1,
              result_perf_tps: 63,
              result_tt100t: 2384,
            } as MpExamResult,
          ],
        },
      ],
    });
    const result = await svc.pair('mlperf', 'mp:328', 'mp:329');
    expect(result.incompatibility_reasons).toContain('scenario_mismatch');
    expect(
      result.fairness_assessment.incompatibility_reasons,
    ).toContain('scenario_mismatch');
  });
});

// ----------------------------------------------------------------------
// C1 — id-collision disambiguation via namespaced run refs
// ----------------------------------------------------------------------

describe('C1 — pair() resolves the correct table on id collision', () => {
  const collidingService = async () =>
    buildService({
      mp: [
        {
          id: 178,
          name: 'C03-L40-mlperf',
          gpu_type: 'NVIDIA-L40',
          device_type: 'GPU',
          status: StatusEnum.COMPLETED,
          model: 'meta-llama/Llama-3.1-8B-Instruct',
          dataset: 'cnn_eval.json',
          precision: 'bfloat16',
          batch_size: 1,
          data_number: 13368,
          scenario: 'Offline' as any,
          retry_num: 1,
          results: [
            {
              id: 1,
              exam_id: 178,
              result_number: 1,
              result_perf_tps: 50,
              result_tt100t: 2302,
            } as MpExamResult,
          ],
        },
      ],
      npu: [
        {
          id: 178,
          name: 'verify-RNGD-mlperf-fp8',
          npu_type: 'RNGD',
          benchmark: 'mlperf',
          status: StatusEnum.COMPLETED,
          model: 'Llama-3.1-8B-Instruct',
          dataset: 'cnn_eval.json',
          precision: 'FP8',
          batch_size: 1,
          data_number: 13368,
          max_output_tokens: 128,
          results: [
            {
              id: 2,
              exam_id: 178,
              result_number: 1,
              result_tps: 80,
              result_tt100t: 1.4,
            } as NpuExamResult,
          ],
        },
      ],
    });

  it('"npu:178" resolves the RNGD npu_exam run, not the colliding L40 mp_exam', async () => {
    const svc = await collidingService();
    // A = the L40 GPU run (mp:178), B = the RNGD NPU run (npu:178).
    const result = await svc.pair('mlperf', 'mp:178', 'npu:178');
    expect(result.a.source_table).toBe('mp_exam');
    expect(result.a.hardware.vendor).toBe('nvidia');
    expect(result.b.source_table).toBe('npu_exam');
    expect(result.b.hardware.vendor).toBe('furiosa');
    // The cross-vendor pair must NOT be reported as a vendor match.
    expect(result.fairness_assessment.vendor_match).toBe(false);
    expect(result.incompatibility_reasons).toContain('tokenizer_unverified');
  });

  it('bare numeric "178" preserves legacy mp-first precedence (backward compat)', async () => {
    const svc = await collidingService();
    const result = await svc.pair('mlperf', 178, 178);
    // Legacy ambiguous path still prefers mp_exam.
    expect(result.a.source_table).toBe('mp_exam');
    expect(result.b.source_table).toBe('mp_exam');
  });

  it('"npu_exam:178" full table-name form also resolves the npu run', async () => {
    const svc = await collidingService();
    const result = await svc.pair('mlperf', 'mp:178', 'npu_exam:178');
    expect(result.b.source_table).toBe('npu_exam');
    expect(result.b.hardware.vendor).toBe('furiosa');
  });
});
