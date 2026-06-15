import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReproMetricsController } from './repro-metrics.controller';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { NpuExam } from '../entities/npu-exam.entity';

/**
 * WS-D04: Unit tests for ReproMetricsController.
 *
 * Scenario: 10 mp_exam rows where 9 have all 11 repro columns non-null,
 * 1 has a NULL column. Coverage should be 90% (9/10).
 */

/** Build a minimal exam-like object with all 11 repro columns non-null. */
function makeCompleteRow(): Partial<MpExam> {
  return {
    platform_commit_sha: 'abc1234',
    image_digest: 'sha256:deadbeef',
    k8s_pod_name: 'pod-1',
    k8s_node_name: 'node-1',
    runtime_versions: '{"node":"22"}',
    result_schema_version: 'v1',
    tokenizer_sha: 'tok123',
    model_sha: 'mod456',
    dataset_sha: 'dat789',
    seed_value: '42',
    fairness_assessment: { score: 1 },
  };
}

function makeMockRepo(total: number, complete: number) {
  return {
    count: jest.fn().mockResolvedValue(total),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(complete),
    }),
  };
}

describe('ReproMetricsController (WS-D04)', () => {
  let controller: ReproMetricsController;
  let mpRepo: ReturnType<typeof makeMockRepo>;
  let mmRepo: ReturnType<typeof makeMockRepo>;
  let npuRepo: ReturnType<typeof makeMockRepo>;

  beforeEach(async () => {
    // 10 mp rows, 9 complete; 5 mm rows, 5 complete; 3 npu rows, 2 complete
    mpRepo = makeMockRepo(10, 9);
    mmRepo = makeMockRepo(5, 5);
    npuRepo = makeMockRepo(3, 2);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReproMetricsController],
      providers: [
        { provide: getRepositoryToken(MpExam), useValue: mpRepo },
        { provide: getRepositoryToken(MmExam), useValue: mmRepo },
        { provide: getRepositoryToken(NpuExam), useValue: npuRepo },
      ],
    }).compile();

    controller = module.get<ReproMetricsController>(ReproMetricsController);
  });

  it('returns Prometheus text format with correct mp coverage (9/10)', async () => {
    const result = await controller.getReproCoverage();

    expect(result).toContain(
      'reproducibility_columns_complete{exam_type="mp"} 9',
    );
    expect(result).toContain(
      'reproducibility_columns_total{exam_type="mp"} 10',
    );
  });

  it('returns Prometheus text format with correct mm coverage (5/5)', async () => {
    const result = await controller.getReproCoverage();

    expect(result).toContain(
      'reproducibility_columns_complete{exam_type="mm"} 5',
    );
    expect(result).toContain('reproducibility_columns_total{exam_type="mm"} 5');
  });

  it('returns Prometheus text format with correct npu coverage (2/3)', async () => {
    const result = await controller.getReproCoverage();

    expect(result).toContain(
      'reproducibility_columns_complete{exam_type="npu"} 2',
    );
    expect(result).toContain(
      'reproducibility_columns_total{exam_type="npu"} 3',
    );
  });

  it('output includes HELP and TYPE comment lines for both metrics', async () => {
    const result = await controller.getReproCoverage();

    expect(result).toContain('# HELP reproducibility_columns_complete');
    expect(result).toContain('# TYPE reproducibility_columns_complete gauge');
    expect(result).toContain('# HELP reproducibility_columns_total');
    expect(result).toContain('# TYPE reproducibility_columns_total gauge');
  });

  it('handles zero-row tables (returns 0 complete and 0 total)', async () => {
    const emptyMpRepo = makeMockRepo(0, 0);
    const emptyMmRepo = makeMockRepo(0, 0);
    const emptyNpuRepo = makeMockRepo(0, 0);

    const emptyModule: TestingModule = await Test.createTestingModule({
      controllers: [ReproMetricsController],
      providers: [
        { provide: getRepositoryToken(MpExam), useValue: emptyMpRepo },
        { provide: getRepositoryToken(MmExam), useValue: emptyMmRepo },
        { provide: getRepositoryToken(NpuExam), useValue: emptyNpuRepo },
      ],
    }).compile();

    const emptyController = emptyModule.get<ReproMetricsController>(
      ReproMetricsController,
    );
    const result = await emptyController.getReproCoverage();

    expect(result).toContain(
      'reproducibility_columns_complete{exam_type="mp"} 0',
    );
    expect(result).toContain('reproducibility_columns_total{exam_type="mp"} 0');
  });
});
