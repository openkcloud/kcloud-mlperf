import {
  HttpException,
  HttpStatus,
  Injectable,
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

const TPS_BEST_VALUES: Record<TestScenarioEnum, number> = {
  [TestScenarioEnum.OFFLINE]: 146_960,
  [TestScenarioEnum.SERVER]: 128_794,
};

@Injectable()
export class MpExamResultService {
  constructor(
    @InjectRepository(MpExamResult)
    private readonly mpExamResultRepo: Repository<MpExamResult>,
  ) {}

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

        const existedExamResult = await this.mpExamResultRepo.findOne({
          where: {
            exam_id: params.examId,
            result_number: i,
          },
        });

        if (existedExamResult) {
          await this.update(existedExamResult.id, {
            ...summaryData,
            ...addedResultData,
          });
        } else {
          const result = this.mpExamResultRepo.create({
            ...summaryData,
            ...addedResultData,
            result_perf_tps_best: TPS_BEST_VALUES[params.testScenario],
          });

          const examResult = await this.mpExamResultRepo.save(result);
          response.push(examResult);
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
