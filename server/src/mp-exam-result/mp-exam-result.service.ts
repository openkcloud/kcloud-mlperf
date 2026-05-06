import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MpExamResult } from 'src/entities/mp-exam-result.entity';
import { Repository } from 'typeorm';
import path from 'path';
import fsPromise from 'fs/promises';

import { CreateMpExamResultDto } from './dto/create-mp-exam-result.dto';
import { TestScenarioEnum } from '../enums/test-scenario.enum';
import { UpdateMpExamResultDto } from './dto/update-mp-exam-result.dto';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';
import { MpExamModeEnum } from 'src/enums/mp-exam-mode.enum';
import { MpExam } from '../entities/mp-exam.entity';
import { canonicalize } from '../comparison/config-fingerprint';

const TPS_BEST_VALUES: Record<TestScenarioEnum, number> = {
  [TestScenarioEnum.OFFLINE]: 146_960,
  [TestScenarioEnum.SERVER]: 128_794,
};

@Injectable()
export class MpExamResultService {
  private readonly logger = new Logger(MpExamResultService.name);

  constructor(
    @InjectRepository(MpExamResult)
    private readonly mpExamResultRepo: Repository<MpExamResult>,
  ) {}

  private async writeResultJson(params: {
    exam: MpExam;
    repeatCount: number;
    result: CreateMpExamResultDto & {
      result_vram_peak?: number | null;
      result_gpu_util?: number | null;
      result_tt100t?: number | null;
    };
    startedAt: string;
    endAt: string;
  }): Promise<void> {
    const { exam, repeatCount, result, startedAt, endAt } = params;
    try {
      const start = new Date(startedAt).getTime();
      const end = new Date(endAt).getTime();
      const elapsed =
        isNaN(start) || isNaN(end) ? 0 : Math.max(0, (end - start) / 1000);

      const fingerprint = canonicalize({
        benchmark: 'mlperf',
        model: exam.model,
        dataset: exam.dataset,
        precision: exam.precision,
        batch_size: exam.batch_size,
        data_number: exam.data_number,
        decoding: { temperature: 1.0 },
        scenario: exam.scenario,
        max_output_tokens: null,
      });

      const runId = `mlperf-${exam.id}-${repeatCount}`;
      const logsPath = path.join(
        'results',
        `mlperf-${exam.id}`,
        `${repeatCount}`,
      );
      const artifactPath = path.join(logsPath, 'exam_result.zip');

      const payload = {
        run_id: runId,
        hardware: exam.gpu_type,
        vendor: 'nvidia',
        benchmark: 'mlperf',
        model: exam.model,
        precision: exam.precision,
        started_at: startedAt,
        completed_at: endAt,
        status: 'completed',
        failure_reason: null,
        tt100t_seconds: result.result_tt100t ?? null,
        elapsed_seconds: elapsed,
        throughput_tokens_per_sec: result.result_perf_tps ?? null,
        raw_metrics: {
          result_perf_tps: result.result_perf_tps ?? null,
          result_perf_sps: result.result_perf_sps ?? null,
          result_perf_tps_best: result.result_perf_tps_best ?? null,
          result_perf_sps_best: result.result_perf_sps_best ?? null,
          result_perf_valid: result.result_perf_valid ?? null,
          result_perf_latency: result.result_perf_latency ?? null,
          result_perf_serv_ttft: result.result_perf_serv_ttft ?? null,
          result_perf_serv_tpot: result.result_perf_serv_tpot ?? null,
          result_acc_rg_1: result.result_acc_rg_1 ?? null,
          result_acc_rg_2: result.result_acc_rg_2 ?? null,
          result_acc_rg_l: result.result_acc_rg_l ?? null,
          result_acc_rg_lsum: result.result_acc_rg_lsum ?? null,
          result_vram_peak: result.result_vram_peak ?? null,
          result_gpu_util: result.result_gpu_util ?? null,
        },
        logs_path: logsPath,
        artifact_path: artifactPath,
        config_fingerprint: fingerprint,
      };

      const dir = path.join(
        process.cwd(),
        '..',
        'results',
        `mlperf-${exam.id}`,
      );
      await fsPromise.mkdir(dir, { recursive: true });
      await fsPromise.writeFile(
        path.join(dir, 'result.json'),
        JSON.stringify(payload, null, 2),
        'utf8',
      );
      this.logger.log(
        `Wrote result.json for mlperf-${exam.id} repeat=${repeatCount}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to write result.json for mlperf-${exam.id}: ${(err as Error).message}`,
      );
    }
  }

  private getNumber(regex: RegExp, text: string): number | null {
    const match = text.match(regex);
    return match ? Number(match[1]) : null;
  }

  private getString(regex: RegExp, text: string): string | null {
    const match = text.match(regex);
    return match ? match[1] : null;
  }

  private parseSummaryData(
    text: string,
    mode: MpExamModeEnum,
    testScenario: TestScenarioEnum,
  ): Omit<
    CreateMpExamResultDto,
    | 'exam_id'
    | 'result_number'
    | 'error_log'
    | 'result_perf_tps_best'
    | 'result_perf_sps_best'
    | 'result_vram_peak'
    | 'result_tt100t'
    | 'result_gpu_util'
  > {
    try {
      let accuracyObj: {
        rouge1: string;
        rouge2: string;
        rougeL: string;
        rougeLsum: string;
      } = {
        rouge1: '',
        rouge2: '',
        rougeL: '',
        rougeLsum: '',
      };

      if (mode === MpExamModeEnum.ACCURACY) {
        // Convert Python dict → JSON
        const jsonString = text
          .replace(/'/g, '"') // replace ' with "
          .replace(/(\w+):/g, '"$1":'); // wrap keys with quotes

        accuracyObj = JSON.parse(jsonString);
      }

      return {
        result_perf_sps:
          testScenario === TestScenarioEnum.OFFLINE
            ? this.getNumber(/Samples per second\s*:\s*([0-9.]+)/, text)
            : this.getNumber(
                /Completed samples per second\s*:\s*([0-9.]+)/,
                text,
              ),
        result_perf_tps:
          testScenario === TestScenarioEnum.OFFLINE
            ? this.getNumber(/Tokens per second\s*:\s*([0-9.]+)/, text)
            : this.getNumber(
                /Completed tokens per second\s*:\s*([0-9.]+)/,
                text,
              ),
        result_perf_valid: this.getString(/Result is\s*:\s*([A-Z]+)/, text),
        result_perf_latency: this.getNumber(
          /Mean latency \(ns\)\s*:\s*([0-9]+)/,
          text,
        ),
        result_perf_serv_ttft:
          testScenario === TestScenarioEnum.SERVER
            ? this.getNumber(
                /Mean First Token latency \(ns\)\s*:\s*([0-9]+)/,
                text,
              )
            : null,
        result_perf_serv_tpot:
          testScenario === TestScenarioEnum.SERVER
            ? this.getNumber(
                /Mean Time per Output Token \(ns\)\s*:\s*([0-9]+)/,
                text,
              )
            : null,

        // Accuracy (ROUGE)
        result_acc_rg_1: accuracyObj.rouge1 ? Number(accuracyObj.rouge1) : null,
        result_acc_rg_2: accuracyObj.rouge2 ? Number(accuracyObj.rouge2) : null,
        result_acc_rg_l: accuracyObj.rougeL ? Number(accuracyObj.rougeL) : null,
        result_acc_rg_lsum: accuracyObj.rougeLsum
          ? Number(accuracyObj.rougeLsum)
          : null,
      };
    } catch (error) {
      throw new Error(error as string);
    }
  }

  private parseAddedResultData(text: string) {
    text = text.trim();

    // Convert Python-like dict → JSON
    const jsonText = text
      .replace(/'/g, '"') // replace single quotes → double
      .replace(/,\s*}/g, '}'); // clean trailing commas

    const obj = JSON.parse(jsonText);

    return {
      result_vram_peak: obj.vram_peak ? Number(obj.vram_peak) : null,
      result_gpu_util: obj.gpu_util ? Number(obj.gpu_util) : null,
      result_tt100t: obj.tt100t ? Number(obj.tt100t) : null,
    };
  }

  private async extractSummaryData(params: {
    examId: number;
    repeatCount: number;
    mode: MpExamModeEnum;
    testScenario: TestScenarioEnum;
  }) {
    const { examId, repeatCount, mode, testScenario } = params;

    const filePath = path.join(
      process.cwd(), // root folder of the project
      'mnt',
      'result',
      `mlperf-${examId}`,
      `${repeatCount}`,
      'mlperf_log_summary.txt',
    );

    const raw = await fsPromise.readFile(filePath, 'utf8');
    const parsedValue = this.parseSummaryData(raw, mode, testScenario);

    return {
      exam_id: examId,
      result_number: repeatCount,
      ...parsedValue,
    };
  }

  private async extractAddedResultData(
    examId: number,
    repeatCount: number,
  ): Promise<
    Pick<
      CreateMpExamResultDto,
      'result_vram_peak' | 'result_gpu_util' | 'result_tt100t'
    >
  > {
    const filePath = path.join(
      process.cwd(), // root folder of the project
      'mnt',
      'result',
      `mlperf-${examId}`,
      `${repeatCount}`,
      'added-result.txt',
    );

    const raw = await fsPromise.readFile(filePath, 'utf8');
    return this.parseAddedResultData(raw);
  }

  // Create mlperf-exam test result
  async create(params: {
    examId: number;
    repeatCount: number;
    testScenario: TestScenarioEnum;
    mode: MpExamModeEnum;
    exam?: MpExam;
  }) {
    try {
      const response: MpExamResult[] = [];
      for (let i = 1; i <= params.repeatCount; i++) {
        const summaryData = await this.extractSummaryData({
          examId: params.examId,
          mode: params.mode,
          repeatCount: i,
          testScenario: params.testScenario,
        });
        const addedResultData = await this.extractAddedResultData(
          params.examId,
          i,
        );

        const merged = {
          ...summaryData,
          ...addedResultData,
          result_perf_tps_best: TPS_BEST_VALUES[params.testScenario],
          result_perf_sps_best:
            (summaryData as { result_perf_sps_best?: number | null })
              .result_perf_sps_best ?? null,
        };

        const existedExamResult = await this.mpExamResultRepo.findOne({
          where: {
            exam_id: params.examId,
            result_number: i,
          },
        });

        if (existedExamResult) {
          await this.update(existedExamResult.id, merged);
        } else {
          const result = this.mpExamResultRepo.create(merged);
          const examResult = await this.mpExamResultRepo.save(result);
          response.push(examResult);
        }

        if (params.exam) {
          await this.writeResultJson({
            exam: params.exam,
            repeatCount: i,
            result: merged,
            startedAt: params.exam.started_at ?? new Date().toISOString(),
            endAt: params.exam.end_at ?? new Date().toISOString(),
          });
        }
      }

      return response.length === 0
        ? {
            message: `The MLPerf exam result ID=${params.examId} repeat_count=${params.repeatCount} successfully updated`,
          }
        : response;
    } catch (error) {
      console.error(error);
      throw new HttpException(
        (error?.message as string) || 'Creating error',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // Get all MLPerf exam result list
  async findAll(params: PaginationQueryDto) {
    const { page = 1, limit = 10 } = params;

    const [data, total] = await this.mpExamResultRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' }, // or ASC
    });

    return {
      list: data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }

  async findOne(id: number) {
    const item = await this.mpExamResultRepo.findOne({
      where: { id },
    });

    if (!item) {
      throw new NotFoundException(
        `MLPerf Exam result with id ${id} not found!`,
      );
    }

    return item;
  }

  async update(id: number, updateMpExamResultDto: UpdateMpExamResultDto) {
    await this.mpExamResultRepo.update(id, updateMpExamResultDto);

    return this.findOne(id);
  }

  getExamResultPath(examId: number, repeatCount: number) {
    try {
      if (process.env.IS_SUMMARY_FILE_TESTING === 'true') {
        examId = 49;
      }

      return path.join(
        process.cwd(), // root folder of the project
        'mnt',
        'result',
        `mlperf-${examId}`,
        `${repeatCount}`,
        'exam_result.zip',
      );
    } catch (error) {
      throw new HttpException(
        (error?.message as string) || 'Creating error',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  getSubmissionReportPath(examId: number, repeatCount: number) {
    try {
      if (process.env.IS_SUMMARY_FILE_TESTING === 'true') {
        examId = 49;
      }

      return path.join(
        process.cwd(), // root folder of the project
        'mnt',
        'result',
        `mlperf-${examId}`,
        `${repeatCount}`,
        'submission_report.zip',
      );
    } catch (error) {
      throw new HttpException(
        (error?.message as string) || 'Creating error',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
