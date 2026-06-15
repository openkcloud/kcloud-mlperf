import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import { MpExamResultService } from './mp-exam-result.service';
import { PowerCaptureService } from '../prometheus/power-capture.service';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { TestScenarioEnum } from '../enums/test-scenario.enum';
import { MpExamModeEnum } from '../enums/mp-exam-mode.enum';

function uniqueColumnSetsFor(target: any): string[][] {
  const args = getMetadataArgsStorage();
  const out: string[][] = [];
  const normalize = (cols: unknown): string[] => {
    if (Array.isArray(cols)) return cols.map(String);
    if (typeof cols === 'function') {
      try {
        const ret = (cols as () => any)();
        if (Array.isArray(ret)) return ret.map(String);
        if (ret && typeof ret === 'object') return Object.keys(ret);
      } catch {
        return [];
      }
    }
    return [];
  };
  for (const u of args.uniques) {
    if (u.target === target) out.push(normalize(u.columns));
  }
  for (const i of args.indices) {
    if (i.target === target && i.unique) out.push(normalize(i.columns));
  }
  return out;
}

function hasUniqueOnExamIdResultNumber(target: any): boolean {
  const sets = uniqueColumnSetsFor(target);
  return sets.some(
    (cols) =>
      cols.length === 2 &&
      cols.includes('exam_id') &&
      cols.includes('result_number'),
  );
}

describe('Result entities — UNIQUE (exam_id, result_number) constraint', () => {
  test('MpExamResult declares unique on (exam_id, result_number)', () => {
    expect(hasUniqueOnExamIdResultNumber(MpExamResult)).toBe(true);
  });
  test('MmExamResult declares unique on (exam_id, result_number)', () => {
    expect(hasUniqueOnExamIdResultNumber(MmExamResult)).toBe(true);
  });
  test('NpuExamResult declares unique on (exam_id, result_number)', () => {
    expect(hasUniqueOnExamIdResultNumber(NpuExamResult)).toBe(true);
  });
});

describe('MpExamResultService — DB unique-violation surfaces as HTTP 409', () => {
  let service: MpExamResultService;
  let mockRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => x),
      save: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MpExamResultService,
        {
          provide: getRepositoryToken(MpExamResult),
          useValue: mockRepo,
        },
        {
          provide: PowerCaptureService,
          useValue: { captureAvgPower: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<MpExamResultService>(MpExamResultService);

    // Stub the file-reading helpers so create() doesn't touch the filesystem.
    jest.spyOn(service as any, 'extractSummaryData').mockResolvedValue({
      result_perf_sps: 1,
      result_perf_tps: 2,
      result_perf_valid: 'VALID',
      result_perf_latency: 3,
      result_perf_serv_ttft: null,
      result_perf_serv_tpot: null,
      result_acc_rg_1: null,
      result_acc_rg_2: null,
      result_acc_rg_l: null,
      result_acc_rg_lsum: null,
    });
    jest.spyOn(service as any, 'extractAddedResultData').mockResolvedValue({});
  });

  it('throws HttpException with status 409 on Postgres unique violation (code 23505)', async () => {
    const violation: Error & { code?: string; driverError?: { code: string } } =
      new Error(
        'duplicate key value violates unique constraint "uniq_mp_exam_result_exam_id_result_number"',
      );
    violation.code = '23505';
    violation.driverError = { code: '23505' };
    mockRepo.save.mockRejectedValue(violation);

    await expect(
      service.create({
        examId: 42,
        repeatCount: 1,
        testScenario: TestScenarioEnum.OFFLINE,
        mode: MpExamModeEnum.PERFORMANCE,
      }),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it('throws HttpException with status 409 when QueryFailedError-style detail message is present', async () => {
    const violation = new Error(
      'duplicate key value violates unique constraint "any_name"',
    );
    mockRepo.save.mockRejectedValue(violation);

    await expect(
      service.create({
        examId: 99,
        repeatCount: 1,
        testScenario: TestScenarioEnum.OFFLINE,
        mode: MpExamModeEnum.PERFORMANCE,
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
