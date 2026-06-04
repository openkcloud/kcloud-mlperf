import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';

import { NpuEvalService } from './npu-eval.service';
import { PowerCaptureService } from '../prometheus/power-capture.service';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';

// US-NEXT-5 — cancel-and-purge integrity gap.
// When a user stops an NPU exam mid-run, partial result rows must be purged
// from npu_exam_result BEFORE the exam row is marked STOPPED. Otherwise a
// re-submission under the same exam_id (or a new exam reusing the logical
// name) inherits stale rows that latestResult() picks up via max(result_number).

describe('NpuEvalService.stopNpuExam — cancel-and-purge (US-NEXT-5)', () => {
  let service: NpuEvalService;
  let mockExamRepo: {
    update: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let mockResultRepo: { delete: jest.Mock; find: jest.Mock };
  let callOrder: string[];

  beforeEach(async () => {
    callOrder = [];
    mockExamRepo = {
      update: jest.fn(() => {
        callOrder.push('exam.update');
        return Promise.resolve({ affected: 1 });
      }),
      findOne: jest.fn().mockResolvedValue({ id: 13, status: 'Stopped' }),
      find: jest.fn().mockResolvedValue([]),
    };
    mockResultRepo = {
      delete: jest.fn(() => {
        callOrder.push('result.delete');
        return Promise.resolve({ affected: 2 });
      }),
      find: jest.fn().mockResolvedValue([
        { id: 1, exam_id: 13, result_number: 1 },
        { id: 2, exam_id: 13, result_number: 2 },
      ]),
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
  });

  it('happy path: purges npu_exam_result rows by exam_id then marks exam STOPPED', async () => {
    await service.stopNpuExam(13);

    expect(mockResultRepo.delete).toHaveBeenCalledTimes(1);
    expect(mockResultRepo.delete).toHaveBeenCalledWith({ exam_id: 13 });
    expect(mockExamRepo.update).toHaveBeenCalled();

    const deleteIdx = callOrder.indexOf('result.delete');
    const updateIdx = callOrder.indexOf('exam.update');
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(deleteIdx);
  });

  it('still marks the exam STOPPED when the result purge fails (logs and continues)', async () => {
    const purgeError = new Error('database unreachable');
    mockResultRepo.delete.mockImplementationOnce(() => {
      callOrder.push('result.delete');
      return Promise.reject(purgeError);
    });

    await service.stopNpuExam(13);

    expect(mockResultRepo.delete).toHaveBeenCalledWith({ exam_id: 13 });
    expect(mockExamRepo.update).toHaveBeenCalled();
  });

  it('idempotent when no rows exist: still calls delete and marks exam STOPPED', async () => {
    mockResultRepo.find.mockResolvedValueOnce([]);
    mockResultRepo.delete.mockImplementationOnce(() => {
      callOrder.push('result.delete');
      return Promise.resolve({ affected: 0 });
    });

    await service.stopNpuExam(13);

    expect(mockResultRepo.delete).toHaveBeenCalledWith({ exam_id: 13 });
    expect(mockExamRepo.update).toHaveBeenCalled();
    const deleteIdx = callOrder.indexOf('result.delete');
    const updateIdx = callOrder.indexOf('exam.update');
    expect(updateIdx).toBeGreaterThan(deleteIdx);
  });
});
