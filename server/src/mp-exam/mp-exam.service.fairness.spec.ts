import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';

import { MpExamService } from './mp-exam.service';
import { MpExam } from '../entities/mp-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { CreateMpExamDto } from './dto/create-mp-exam.dto';
import { LokiService } from '../loki/loki.service';
import { MpExamResultService } from '../mp-exam-result/mp-exam-result.service';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';

// US-NEXT-1 — verify selfFairnessSnapshot() is wired into MpExamService.create()
// so the jsonb fairness_assessment column on mp_exam is populated at create-time.
// Without this wiring the column stays NULL forever and the comparison page
// cannot render a per-row fairness verdict for newly created GPU exams.

describe('MpExamService.create — fairness_assessment wiring (US-NEXT-1)', () => {
  let service: MpExamService;
  let mockRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };

  const baseDto: CreateMpExamDto = {
    name: 'fairness-test',
    description: '',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    precision: 'FP8',
    mode: 'PERFORMANCE',
    framework: 'pytorch(vllm)',
    batch_size: 1,
    min_duration: 600,
    dataset: 'cnn_eval',
    data_number: 0,
    scenario: 'Offline',
    target_qps: 1,
    num_workers: 1,
    tensor_parallel_size: 1,
    device_type: 'GPU',
    gpu_type: 'L40',
    gpu_num: 1,
    cpu_core: 7,
    ram_capacity: 32,
    retry_num: 1,
    started_at: '2099-01-01T00:00:00Z',
    status: undefined as any,
    error_log: '',
    end_at: '',
  };

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 1, ...x })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MpExamService,
        { provide: getRepositoryToken(MpExam), useValue: mockRepo },
        {
          provide: getRepositoryToken(MpExamResult),
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
        { provide: MpExamResultService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<MpExamService>(MpExamService);

    // Skip the gRPC call and scheduling so create() resolves cleanly under unit-test conditions.
    jest.spyOn(service as any, 'createGrpcExam').mockResolvedValue({ id: '1' });
    jest.spyOn(service as any, 'scheduleExam').mockResolvedValue(undefined);
  });

  it('persists fairness_assessment with precision_class="matched" when DTO precision is set', async () => {
    await service.create({ ...baseDto, precision: 'FP8' });

    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    const payload = mockRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment).toBeDefined();
    expect(payload.fairness_assessment.precision_class).toBe('matched');
  });

  it('records latency_context="matched" because GPU jobs default to CLIENT_WALL_CLOCK', async () => {
    await service.create({ ...baseDto });

    const payload = mockRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment.latency_context).toBe('matched');
  });

  it('records vendor_match=false (single-run rows have no peer) and tokenizer_match="unknown"', async () => {
    await service.create({ ...baseDto });

    const payload = mockRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment.vendor_match).toBe(false);
    expect(payload.fairness_assessment.tokenizer_match).toBe('unknown');
    expect(payload.fairness_assessment.incompatibility_reasons).toEqual([]);
    expect(typeof payload.fairness_assessment.computed_at).toBe('string');
  });

  it('marks precision_class="unknown" when the per-service default of CLIENT_WALL_CLOCK is unchanged but precision is empty', async () => {
    // Empty precision still goes through validation, but we simulate the
    // upstream-degenerate case here to confirm selfFairnessSnapshot's
    // unknown-classification path is reached via wiring.
    await service.create({ ...baseDto, precision: '' });

    const payload = mockRepo.create.mock.calls[0][0];
    expect(payload.fairness_assessment.precision_class).toBe('unknown');
    // Latency context is still matched — wiring uses LatencyMeasurementContext.CLIENT_WALL_CLOCK.
    expect(payload.fairness_assessment.latency_context).toBe('matched');
    // Sanity check the wiring uses the per-service default by reading the enum back.
    expect(LatencyMeasurementContext.CLIENT_WALL_CLOCK).toBe(
      'CLIENT_WALL_CLOCK',
    );
  });
});
