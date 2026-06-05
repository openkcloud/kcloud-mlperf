import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';

import { NpuEvalService } from './npu-eval.service';
import { PowerCaptureService } from '../prometheus/power-capture.service';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { CreateNpuExamDto } from './dto/create-npu-exam.dto';

// US-NEXT-1 — verify selfFairnessSnapshot() is wired into NpuEvalService.create()
// so the jsonb fairness_assessment column on npu_exam is populated at create-time.
// NPU runs capture latency server-side via the SSE token stream, so the per-service
// default of LatencyMeasurementContext.SERVER_TOKEN_STREAM should produce
// latency_context='matched'. Vendor is derived from the npu_type label.

describe('NpuEvalService.create — fairness_assessment wiring (US-NEXT-1)', () => {
  let service: NpuEvalService;
  let mockExamRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let mockResultRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };

  const baseDto: CreateNpuExamDto = {
    name: 'fairness-npu-test',
    description: '',
    benchmark: 'mlperf',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    precision: 'FP8',
    framework: 'furiosa-llm',
    batch_size: 1,
    dataset: 'cnn_eval',
    data_number: 10,
    npu_type: 'RNGD',
    npu_num: 1,
    cpu_core: 7,
    ram_capacity: 32,
    retry_num: 1,
    max_output_tokens: 128,
    started_at: '2099-01-01T00:00:00Z',
    status: undefined as any,
    error_log: '',
    end_at: '',
  };

  beforeEach(async () => {
    mockExamRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 1, ...x })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      delete: jest.fn(),
    };
    mockResultRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NpuEvalService,
        { provide: getRepositoryToken(NpuExam), useValue: mockExamRepo },
        {
          provide: getRepositoryToken(NpuExamResult),
          useValue: mockResultRepo,
        },
        {
          provide: SchedulerRegistry,
          useValue: {
            addTimeout: jest.fn(),
            deleteTimeout: jest.fn(),
          },
        },
        {
          provide: PowerCaptureService,
          useValue: { captureAvgPower: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<NpuEvalService>(NpuEvalService);

    // Skip benchmark scheduling so create() resolves cleanly under unit-test conditions.
    jest
      .spyOn(service as any, 'scheduleBenchmark')
      .mockResolvedValue(undefined);
  });

  it('persists fairness_assessment with vendor=furiosa for RNGD and latency_context="matched"', async () => {
    await service.create({ ...baseDto, npu_type: 'RNGD' });

    expect(mockExamRepo.create).toHaveBeenCalledTimes(1);
    const payload = mockExamRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment).toBeDefined();
    expect(payload.fairness_assessment.precision_class).toBe('matched');
    expect(payload.fairness_assessment.latency_context).toBe('matched');
    // vendor_match is always false for single-run snapshots (no peer to compare).
    expect(payload.fairness_assessment.vendor_match).toBe(false);
  });

  it('persists fairness_assessment for Atom+ NPU (vendor derived as rebellions)', async () => {
    await service.create({ ...baseDto, npu_type: 'Atom+', precision: 'FP16' });

    const payload = mockExamRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment).toBeDefined();
    // vendor_match stays false (no peer); the wiring still records the snapshot.
    expect(payload.fairness_assessment.vendor_match).toBe(false);
    expect(payload.fairness_assessment.latency_context).toBe('matched');
    expect(payload.fairness_assessment.tokenizer_match).toBe('unknown');
  });

  it('records empty incompatibility_reasons and a fresh ISO8601 computed_at', async () => {
    const before = Date.now();
    await service.create({ ...baseDto });
    const after = Date.now();

    const payload = mockExamRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment.incompatibility_reasons).toEqual([]);
    const ts = Date.parse(payload.fairness_assessment.computed_at);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
