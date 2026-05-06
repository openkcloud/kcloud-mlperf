import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import { InjectRepository } from '@nestjs/typeorm';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { Repository } from 'typeorm';
import * as path from 'path';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';
import { UpdateMmExamResultDto } from './dto/update-mm-exam-result.dto';
import { CreateMmExamResultDto } from './dto/create-mm-exam-result.dto';
import { MmExam } from '../entities/mm-exam.entity';
import { canonicalize } from '../comparison/config-fingerprint';

@Injectable()
export class MmExamResultService {
  private readonly logger = new Logger(MmExamResultService.name);

  constructor(
    @InjectRepository(MmExamResult)
    private readonly mmResultRepo: Repository<MmExamResult>,
  ) {}

  private async writeResultJson(params: {
    exam: MmExam;
    repeatCount: number;
    result: CreateMmExamResultDto;
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
        benchmark: 'mmlu',
        model: exam.model,
        dataset: exam.dataset,
        precision: exam.precision,
        batch_size: exam.batch_size,
        data_number: exam.data_number,
        decoding: { temperature: 1.0 },
        scenario: null,
        max_output_tokens: null,
      });

      const runId = `mmlu-${exam.id}-${repeatCount}`;
      const logsPath = path.join(
        'results',
        `mmlu-${exam.id}`,
        `${repeatCount}`,
      );

      const payload = {
        run_id: runId,
        hardware: exam.gpu_type,
        vendor: 'nvidia',
        benchmark: 'mmlu',
        model: exam.model,
        precision: exam.precision,
        started_at: startedAt,
        completed_at: endAt,
        status: 'completed',
        failure_reason: null,
        tt100t_seconds: null,
        elapsed_seconds: elapsed,
        throughput_tokens_per_sec: null,
        raw_metrics: {
          result_acc_total: result.result_acc_total ?? null,
          result_acc_physics: result.result_acc_physics ?? null,
          result_acc_chemistry: result.result_acc_chemistry ?? null,
          result_acc_law: result.result_acc_law ?? null,
          result_acc_engineering: result.result_acc_engineering ?? null,
          result_acc_other: result.result_acc_other ?? null,
          result_acc_economics: result.result_acc_economics ?? null,
          result_acc_health: result.result_acc_health ?? null,
          result_acc_psychology: result.result_acc_psychology ?? null,
          result_acc_business: result.result_acc_business ?? null,
          result_acc_biology: result.result_acc_biology ?? null,
          result_acc_philosophy: result.result_acc_philosophy ?? null,
          result_acc_cs: result.result_acc_cs ?? null,
          result_acc_math: result.result_acc_math ?? null,
          result_acc_history: result.result_acc_history ?? null,
        },
        logs_path: logsPath,
        artifact_path: logsPath,
        config_fingerprint: fingerprint,
      };

      const dir = path.join(process.cwd(), '..', 'results', `mmlu-${exam.id}`);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'result.json'),
        JSON.stringify(payload, null, 2),
        'utf8',
      );
      this.logger.log(
        `Wrote result.json for mmlu-${exam.id} repeat=${repeatCount}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to write result.json for mmlu-${exam.id}: ${(err as Error).message}`,
      );
    }
  }

  private parseSummary(raw: string) {
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const result = {
      result_acc_total: 0,
      result_acc_physics: 0,
      result_acc_chemistry: 0,
      result_acc_law: 0,
      result_acc_engineering: 0,
      result_acc_other: 0,
      result_acc_economics: 0,
      result_acc_health: 0,
      result_acc_psychology: 0,
      result_acc_business: 0,
      result_acc_biology: 0,
      result_acc_philosophy: 0,
      result_acc_cs: 0,
      result_acc_history: 0,
      result_acc_math: 0,
    };

    for (const line of lines) {
      // CATEGORY LINES:
      // "Average accuracy 0.7000 - biology"
      const categoryMatch = line.match(/Average accuracy ([0-9.]+) - (.+)/);
      if (categoryMatch) {
        const value = parseFloat(categoryMatch[1]);
        const category = categoryMatch[2].toLowerCase();

        switch (category) {
          case 'biology':
            result.result_acc_biology = value;
            break;
          case 'business':
            result.result_acc_business = value;
            break;
          case 'chemistry':
            result.result_acc_chemistry = value;
            break;
          case 'computer science':
            result.result_acc_cs = value;
            break;
          case 'economics':
            result.result_acc_economics = value;
            break;
          case 'engineering':
            result.result_acc_engineering = value;
            break;
          case 'health':
            result.result_acc_health = value;
            break;
          case 'history':
            result.result_acc_history = value;
            break;
          case 'law':
            result.result_acc_law = value;
            break;
          case 'math':
            result.result_acc_math = value;
            break;
          case 'other':
            result.result_acc_other = value;
            break;
          case 'philosophy':
            result.result_acc_philosophy = value;
            break;
          case 'physics':
            result.result_acc_physics = value;
            break;
          case 'psychology':
            result.result_acc_psychology = value;
            break;
        }

        continue;
      }

      // TOTAL LINE:
      // "Average accuracy: 0.4929"
      const totalMatch = line.match(/Average accuracy:\s*([0-9.]+)/);
      if (totalMatch) {
        result.result_acc_total = parseFloat(totalMatch[1]);
      }
    }

    return result;
  }

  private async insertSummary(
    examId: number,
    repeatCount: number,
  ): Promise<CreateMmExamResultDto> {
    if (process.env.IS_SUMMARY_FILE_TESTING === 'true') {
      examId = Number(process.env.MMLU_EXAM_ID_1);
    }

    const filePath = path.join(
      process.cwd(), // root folder of the project
      'mnt',
      'result',
      `mmlu-${examId}`,
      `${repeatCount}`,
      'summary',
      'summary.txt',
    );

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsedValue = this.parseSummary(raw);

      return {
        exam_id: examId,
        result_number: repeatCount,
        ...parsedValue,
      };
    } catch {
      throw new NotFoundException('summary.txt not found');
    }
  }

  // Create mmlu-exam test result
  async create(params: { examId: number; repeatCount: number; exam?: MmExam }) {
    try {
      const response: MmExamResult[] = [];
      for (let i = 1; i <= params.repeatCount; i++) {
        const summaryData = await this.insertSummary(params.examId, i);
        const existedExamResult = await this.mmResultRepo.findOne({
          where: {
            exam_id: params.examId,
            result_number: i,
          },
        });
        if (existedExamResult) {
          await this.update(existedExamResult.id, {
            ...summaryData,
          });
        } else {
          const result = this.mmResultRepo.create(summaryData);

          const data = await this.mmResultRepo.save(result);

          response.push(data);
        }

        if (params.exam) {
          await this.writeResultJson({
            exam: params.exam,
            repeatCount: i,
            result: summaryData,
            startedAt: params.exam.started_at ?? new Date().toISOString(),
            endAt: params.exam.end_at ?? new Date().toISOString(),
          });
        }
      }

      return response.length === 0
        ? {
            message: `The MMLU exam result ID=${params.examId} repeat_count=${params.repeatCount} successfully updated`,
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

  // Get all MMLU exam result list
  async findAll(params: PaginationQueryDto) {
    const { page = 1, limit = 10 } = params;

    const [data, total] = await this.mmResultRepo.findAndCount({
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

  // Get one MMLU Exam result by the id
  async findOne(id: number) {
    const item = await this.mmResultRepo.findOne({
      where: { id },
    });

    if (!item) {
      throw new NotFoundException(`MMLU Exam Result with id ${id} not found!`);
    }

    return item;
  }

  // Update MP Exam result info
  async update(id: number, updateMmExamDto: UpdateMmExamResultDto) {
    await this.mmResultRepo.update(id, updateMmExamDto);

    return this.findOne(id);
  }

  async remove(id: number) {
    await this.mmResultRepo.delete(id);

    return { deleted: true };
  }
}
