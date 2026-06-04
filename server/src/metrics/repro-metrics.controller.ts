import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { NpuExam } from '../entities/npu-exam.entity';

/**
 * WS-D04: Prometheus-format reproducibility coverage metrics.
 *
 * GET /metrics/repro-coverage returns Prometheus text format counters for
 * each exam type showing how many rows have all 11 canonical reproducibility
 * columns non-null (complete) vs total rows.
 *
 * Consumed by Prometheus scrape → Grafana dashboard (repro-coverage.json).
 */

/** The 11 canonical reproducibility columns from US-0.5. */
const REPRO_COLUMNS = [
  'platform_commit_sha',
  'image_digest',
  'k8s_pod_name',
  'k8s_node_name',
  'runtime_versions',
  'result_schema_version',
  'tokenizer_sha',
  'model_sha',
  'dataset_sha',
  'seed_value',
  'fairness_assessment',
] as const;

function buildIsCompleteCondition(alias: string): string {
  return REPRO_COLUMNS.map((col) => `${alias}.${col} IS NOT NULL`).join(
    ' AND ',
  );
}

@Controller('metrics')
export class ReproMetricsController {
  constructor(
    @InjectRepository(MpExam)
    private readonly mpExamRepo: Repository<MpExam>,
    @InjectRepository(MmExam)
    private readonly mmExamRepo: Repository<MmExam>,
    @InjectRepository(NpuExam)
    private readonly npuExamRepo: Repository<NpuExam>,
  ) {}

  @Get('repro-coverage')
  async getReproCoverage(): Promise<string> {
    const [mpComplete, mpTotal] = await this.countCoverage(
      this.mpExamRepo,
      'mp',
    );
    const [mmComplete, mmTotal] = await this.countCoverage(
      this.mmExamRepo,
      'mm',
    );
    const [npuComplete, npuTotal] = await this.countCoverage(
      this.npuExamRepo,
      'npu',
    );

    const lines: string[] = [
      '# HELP reproducibility_columns_complete Number of exam rows with all 11 reproducibility columns non-null',
      '# TYPE reproducibility_columns_complete gauge',
      `reproducibility_columns_complete{exam_type="mp"} ${mpComplete}`,
      `reproducibility_columns_complete{exam_type="mm"} ${mmComplete}`,
      `reproducibility_columns_complete{exam_type="npu"} ${npuComplete}`,
      '',
      '# HELP reproducibility_columns_total Total number of exam rows',
      '# TYPE reproducibility_columns_total gauge',
      `reproducibility_columns_total{exam_type="mp"} ${mpTotal}`,
      `reproducibility_columns_total{exam_type="mm"} ${mmTotal}`,
      `reproducibility_columns_total{exam_type="npu"} ${npuTotal}`,
      '',
    ];

    return lines.join('\n');
  }

  private async countCoverage(
    repo: Repository<any>,
    alias: string,
  ): Promise<[number, number]> {
    const total = await repo.count();

    if (total === 0) {
      return [0, 0];
    }

    const completeCondition = buildIsCompleteCondition(alias);

    const completeResult = await repo
      .createQueryBuilder(alias)
      .where(completeCondition)
      .getCount();

    return [completeResult, total];
  }
}
