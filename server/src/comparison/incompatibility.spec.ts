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

const baseRun = (over: Partial<NormalizedRun> = {}): NormalizedRun => ({
  id: 1,
  benchmark: 'mlperf',
  name: 'r1',
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  hardware: {
    type: 'gpu',
    vendor: 'nvidia',
    model: 'NVIDIA-L40',
    canonical: 'L40',
    node: 'node2',
  },
  status: StatusEnum.COMPLETED,
  started_at: null,
  completed_at: null,
  elapsed_seconds: null,
  metrics: {
    tt100t_seconds: 1.5,
    tps: 70,
    accuracy_pct: null,
    throughput: null,
  },
  artifacts: [],
  precision: 'FP8',
  scenario: 'Offline',
  batch_size: 1,
  dataset: 'cnn_eval',
  data_number: 13368,
  max_output_tokens: 128,
  source_table: 'mp_exam',
  failure_reason: null,
  config_fingerprint: 'fp-1',
  drift_flag: false,
  is_canonical: true,
  precision_mismatch: false,
  ...over,
});

describe('computeIncompatibilityReasons (US-002)', () => {
  it('returns [] for two identical runs', () => {
    const a = baseRun();
    const b = baseRun({ id: 2 });
    expect(computeIncompatibilityReasons(a, b)).toEqual([]);
  });

  it('returns ["precision_mismatch"] when precisions differ', () => {
    const a = baseRun({ precision: 'FP8' });
    const b = baseRun({ id: 2, precision: 'BF16' });
    expect(computeIncompatibilityReasons(a, b)).toEqual(['precision_mismatch']);
  });

  it('returns ["data_number_mismatch"] when N differs (1000 vs 13368)', () => {
    const a = baseRun({ data_number: 13368 });
    const b = baseRun({ id: 2, data_number: 1000 });
    expect(computeIncompatibilityReasons(a, b)).toEqual([
      'data_number_mismatch',
    ]);
  });

  it('returns ["model_mismatch"] when models differ even after normalization', () => {
    const a = baseRun({ model: 'meta-llama/Llama-3.1-8B-Instruct' });
    const b = baseRun({ id: 2, model: 'mistralai/Mistral-7B-v0.3' });
    const reasons = computeIncompatibilityReasons(a, b);
    expect(reasons).toContain('model_mismatch');
  });

  it('returns ["dataset_mismatch"] when datasets differ', () => {
    const a = baseRun({ dataset: 'cnn_eval' });
    const b = baseRun({ id: 2, dataset: 'open-orca' });
    expect(computeIncompatibilityReasons(a, b)).toEqual(['dataset_mismatch']);
  });

  it('returns ["max_output_tokens_mismatch"] when max_output_tokens differs', () => {
    const a = baseRun({ max_output_tokens: 128 });
    const b = baseRun({ id: 2, max_output_tokens: 512 });
    expect(computeIncompatibilityReasons(a, b)).toEqual([
      'max_output_tokens_mismatch',
    ]);
  });

  it('appends "tokenizer_unverified" when vendors differ (cross-vendor pair)', () => {
    const a = baseRun({
      hardware: {
        type: 'gpu',
        vendor: 'nvidia',
        model: 'NVIDIA-L40',
        canonical: 'L40',
        node: 'node2',
      },
    });
    const b = baseRun({
      id: 2,
      hardware: {
        type: 'npu',
        vendor: 'furiosa',
        model: 'RNGD',
        canonical: 'RNGD',
        node: 'node4',
      },
    });
    const reasons = computeIncompatibilityReasons(a, b);
    expect(reasons).toContain('tokenizer_unverified');
  });

  it('handles multiple mismatches in a single call (cross-vendor + precision + data_number)', () => {
    const a = baseRun({
      hardware: {
        type: 'gpu',
        vendor: 'nvidia',
        model: 'L40',
        canonical: 'L40',
        node: 'node2',
      },
      precision: 'FP8',
      data_number: 13368,
    });
    const b = baseRun({
      id: 2,
      hardware: {
        type: 'npu',
        vendor: 'rebellions',
        model: 'Atom+',
        canonical: 'Atom+',
        node: 'node5',
      },
      precision: 'INT4',
      data_number: 1000,
    });
    const reasons = computeIncompatibilityReasons(a, b);
    expect(reasons).toEqual(
      expect.arrayContaining([
        'precision_mismatch',
        'data_number_mismatch',
        'tokenizer_unverified',
      ]),
    );
  });
});

describe('ComparisonService.pair (US-002 — incompatibility_reasons)', () => {
  let service: ComparisonService;

  const buildPair = async (aOver: Partial<MpExam>, bOver: Partial<NpuExam>) => {
    const mpRow: Partial<MpExam> = {
      id: 100,
      name: 'gpu-l40',
      gpu_type: 'NVIDIA-L40',
      device_type: 'GPU',
      status: StatusEnum.COMPLETED,
      model: 'meta-llama/Llama-3.1-8B-Instruct',
      dataset: 'cnn_eval',
      precision: 'FP8',
      batch_size: 1,
      data_number: 13368,
      scenario: 'Offline' as any,
      retry_num: 1,
      results: [
        {
          id: 1000,
          exam_id: 100,
          result_number: 1,
          result_perf_tps: 70,
          result_tt100t: 1500,
        } as MpExamResult,
      ],
      ...aOver,
    };

    const npuRow: Partial<NpuExam> = {
      id: 200,
      name: 'npu-atom',
      npu_type: 'Atom+',
      benchmark: 'mlperf',
      status: StatusEnum.COMPLETED,
      model: 'Llama-3.1-8B-Instruct',
      dataset: 'cnn_eval',
      precision: 'INT4',
      batch_size: 1,
      data_number: 1000,
      max_output_tokens: 128,
      results: [
        {
          id: 2000,
          exam_id: 200,
          result_number: 1,
          result_tps: 30,
          result_tt100t: 1.2,
        } as NpuExamResult,
      ],
      ...bOver,
    };

    const matchById =
      <T extends { id?: number }>(row: T) =>
      (opts: any): T | null => {
        const wantedId = opts?.where?.id;
        if (wantedId == null || row.id === wantedId) return row;
        return null;
      };

    const mpRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(matchById(mpRow as { id: number })),
    };
    const mmRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const npuRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(matchById(npuRow as { id: number })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComparisonService,
        { provide: getRepositoryToken(MpExam), useValue: mpRepo },
        { provide: getRepositoryToken(MpExamResult), useValue: {} },
        { provide: getRepositoryToken(MmExam), useValue: mmRepo },
        { provide: getRepositoryToken(MmExamResult), useValue: {} },
        { provide: getRepositoryToken(NpuExam), useValue: npuRepo },
        { provide: getRepositoryToken(NpuExamResult), useValue: {} },
      ],
    }).compile();

    return module.get<ComparisonService>(ComparisonService);
  };

  it('pair() response includes incompatibility_reasons array', async () => {
    service = await buildPair({}, {});
    const result = await service.pair('mlperf', 100, 200);
    expect(result).toHaveProperty('incompatibility_reasons');
    expect(Array.isArray(result.incompatibility_reasons)).toBe(true);
  });

  it('pair() flags GPU FP8 (n=13368) vs NPU INT4 (n=1000) cross-vendor as multi-axis incompatible', async () => {
    service = await buildPair({}, {});
    const result = await service.pair('mlperf', 100, 200);
    expect(result.incompatibility_reasons).toEqual(
      expect.arrayContaining([
        'precision_mismatch',
        'data_number_mismatch',
        'tokenizer_unverified',
      ]),
    );
  });
});
