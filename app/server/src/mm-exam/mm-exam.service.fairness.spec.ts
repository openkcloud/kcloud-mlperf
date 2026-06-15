import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';

import { MmExamService } from './mm-exam.service';
import { MmExam } from '../entities/mm-exam.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { CreateMmExamDto } from './dto/create-mm-exam.dto';
import { LokiService } from '../loki/loki.service';
import { MmExamResultService } from '../mm-exam-result/mm-exam-result.service';

// US-NEXT-1 — verify selfFairnessSnapshot() is wired into MmExamService.create()
// so the jsonb fairness_assessment column on mm_exam is populated at create-time.
// MMLU rows have no per-request latency capture, so the per-service default of
// LatencyMeasurementContext.UNKNOWN should produce latency_context='unknown'.

describe('MmExamService.create — fairness_assessment wiring (US-NEXT-1)', () => {
  let service: MmExamService;
  let mockRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    manager: { connection: { createQueryRunner: jest.Mock } };
  };

  const baseDto: CreateMmExamDto = {
    name: 'fairness-mm-test',
    description: '',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    precision: 'BF16',
    framework: 'pytorch(vllm)',
    subject: 'all',
    dataset: 'mmlu-pro',
    data_number: 0,
    batch_size: 1,
    gpu_util: 0.9,
    device_type: 'GPU',
    gpu_type: 'L40',
    gpu_num: 1,
    cpu_core: 7,
    ram_capacity: 32,
    n_train: 1,
    retry_num: 1,
    started_at: '2099-01-01T00:00:00Z',
    status: undefined as any,
    end_at: '',
    error_log: '',
  };

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 1, ...x })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      manager: {
        connection: {
          createQueryRunner: jest.fn(() => ({
            hasTable: jest.fn().mockResolvedValue(false),
            query: jest.fn(),
            release: jest.fn(),
          })),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MmExamService,
        { provide: getRepositoryToken(MmExam), useValue: mockRepo },
        {
          provide: getRepositoryToken(MmExamResult),
          useValue: { delete: jest.fn() },
        },
        {
          provide: 'EXAM_PACKAGE',
          useValue: { getService: () => ({}) },
        },
        { provide: LokiService, useValue: {} },
        {
          provide: SchedulerRegistry,
          useValue: {
            addTimeout: jest.fn(),
            deleteTimeout: jest.fn(),
          },
        },
        { provide: MmExamResultService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<MmExamService>(MmExamService);

    jest.spyOn(service as any, 'createGrpcExam').mockResolvedValue({ id: '1' });
    jest.spyOn(service as any, 'scheduleExam').mockResolvedValue(undefined);
  });

  it('persists fairness_assessment with precision_class="matched" when DTO precision is set', async () => {
    await service.create({ ...baseDto, precision: 'BF16' });

    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    const payload = mockRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment).toBeDefined();
    expect(payload.fairness_assessment.precision_class).toBe('matched');
  });

  it('records latency_context="unknown" because MMLU jobs default to LatencyMeasurementContext.UNKNOWN', async () => {
    await service.create({ ...baseDto });

    const payload = mockRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment.latency_context).toBe('unknown');
  });

  it('records vendor_match=false (single-run rows have no peer) and tokenizer_match="unknown"', async () => {
    await service.create({ ...baseDto });

    const payload = mockRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment.vendor_match).toBe(false);
    expect(payload.fairness_assessment.tokenizer_match).toBe('unknown');
    expect(payload.fairness_assessment.incompatibility_reasons).toEqual([]);
    expect(typeof payload.fairness_assessment.computed_at).toBe('string');
  });
});
