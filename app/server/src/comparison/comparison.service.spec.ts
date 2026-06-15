import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ComparisonService } from './comparison.service';
import { MpExam } from '../entities/mp-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { StatusEnum } from '../enums/status.enum';

const emptyRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
});

async function buildService(mpExams: Partial<MpExam>[]) {
  const mpRepo = {
    ...emptyRepo(),
    find: jest.fn().mockResolvedValue(mpExams),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ComparisonService,
      { provide: getRepositoryToken(MpExam), useValue: mpRepo },
      { provide: getRepositoryToken(MpExamResult), useValue: emptyRepo() },
      { provide: getRepositoryToken(MmExam), useValue: emptyRepo() },
      { provide: getRepositoryToken(MmExamResult), useValue: emptyRepo() },
      { provide: getRepositoryToken(NpuExam), useValue: emptyRepo() },
      { provide: getRepositoryToken(NpuExamResult), useValue: emptyRepo() },
    ],
  }).compile();

  return module.get<ComparisonService>(ComparisonService);
}

function makeMpExam(
  resultTt100t: number | null,
): Partial<MpExam> & { results: Partial<MpExamResult>[] } {
  return {
    id: 1,
    name: 'mlperf-test',
    gpu_type: 'NVIDIA-L40',
    status: StatusEnum.COMPLETED,
    model: 'Llama-3.1-8B-Instruct',
    dataset: 'cnn_eval.json',
    precision: 'BF16',
    results: [
      {
        id: 10,
        exam_id: 1,
        result_number: 1,
        result_perf_tps: 62.94,
        result_tt100t: resultTt100t,
      } as MpExamResult,
    ],
  };
}

describe('ComparisonService — normalizeMpExam ms→s conversion', () => {
  it('converts result_tt100t from ms to seconds (1584.17 → 1.58417)', async () => {
    const svc = await buildService([makeMpExam(1584.17)]);
    const response = (await svc.list({
      benchmark: 'all',
      hardware: 'all',
      node: null,
    })) as { runs: Array<{ metrics: { tt100t_seconds: number | null } }> };

    expect(response.runs).toHaveLength(1);
    expect(response.runs[0].metrics.tt100t_seconds).toBeCloseTo(1.58417, 5);
  });

  it('returns null for tt100t_seconds when result_tt100t is null', async () => {
    const svc = await buildService([makeMpExam(null)]);
    const response = (await svc.list({
      benchmark: 'all',
      hardware: 'all',
      node: null,
    })) as { runs: Array<{ metrics: { tt100t_seconds: number | null } }> };

    expect(response.runs).toHaveLength(1);
    expect(response.runs[0].metrics.tt100t_seconds).toBeNull();
  });

  it('preserves measured zero: result_tt100t 0 → tt100t_seconds 0', async () => {
    const svc = await buildService([makeMpExam(0)]);
    const response = (await svc.list({
      benchmark: 'all',
      hardware: 'all',
      node: null,
    })) as { runs: Array<{ metrics: { tt100t_seconds: number | null } }> };

    expect(response.runs).toHaveLength(1);
    expect(response.runs[0].metrics.tt100t_seconds).toBe(0);
  });
});
