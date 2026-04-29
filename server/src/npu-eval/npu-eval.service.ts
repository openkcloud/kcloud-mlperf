import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';
import { NpuExam } from 'src/entities/npu-exam.entity';
import { NpuExamResult } from 'src/entities/npu-exam-result.entity';
import { Repository } from 'typeorm';
import { CreateNpuExamDto } from './dto/create-npu-exam.dto';
import { UpdateNpuExamDto } from './dto/update-npu-exam.dto';
import { CreateNpuExamResultDto } from './dto/create-npu-exam-result.dto';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { StatusEnum } from '../enums/status.enum';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

dayjs.extend(utc);
dayjs.extend(timezone);

// Configurable inference server URL — set via env var or defaults to node4 IP
const NPU_INFERENCE_URL =
  process.env.NPU_INFERENCE_URL || 'http://10.254.202.114:8000';

// Dataset base path inside the backend pod (NFS mount)
const DATASET_BASE_PATH =
  process.env.DATASET_PATH || path.join(process.cwd(), 'mnt', 'datasets');

// Default prompts used when dataset files are not available
const DEFAULT_PROMPTS = [
  'Explain the theory of relativity in detail, covering special and general relativity.',
  'Describe the process of photosynthesis and its importance in ecosystems.',
  'Discuss the causes and effects of climate change on global ecosystems.',
  'Explain how neural networks work in machine learning applications.',
  'Describe the history and evolution of the Internet from ARPANET to today.',
  'Write a comprehensive analysis of the economic impacts of artificial intelligence on labor markets.',
  'Explain quantum computing concepts including qubits, superposition, and entanglement.',
  'Discuss the major breakthroughs in medicine over the past century and their impact on human health.',
  'Analyze the geopolitical implications of renewable energy adoption worldwide.',
  'Explain the principles of distributed systems and the CAP theorem.',
];

@Injectable()
export class NpuEvalService implements OnModuleInit {
  private readonly logger = new Logger(NpuEvalService.name);
  private timezone: string = 'Asia/Seoul';
  private timestampFormat: string = 'YYYY-MM-DDTHH:mm:ssZ';

  // Track running benchmarks for cancellation
  private runningBenchmarks = new Map<number, AbortController>();

  constructor(
    @InjectRepository(NpuExam)
    private readonly npuExamRepo: Repository<NpuExam>,
    @InjectRepository(NpuExamResult)
    private readonly npuExamResultRepo: Repository<NpuExamResult>,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    // Resume any pending/preparing exams on server restart
    const pendingExams = await this.npuExamRepo.find({
      where: [{ status: StatusEnum.PENDING }, { status: StatusEnum.PREPARING }],
    });

    for (const exam of pendingExams) {
      this.logger.log(
        `Resuming NPU exam ${exam.id} from status=${exam.status}`,
      );
      await this.scheduleBenchmark(exam);
    }
  }

  // =====================================================================
  // Public API
  // =====================================================================

  async getAvailableNpuList() {
    return {
      npus: [
        {
          npu_model: 'RNGD',
          npu_count: 1,
          memory_gb: 48,
          compute_tflops: 256,
        },
      ],
    };
  }

  async create(createNpuExamDto: CreateNpuExamDto) {
    try {
      const currentTime = dayjs().tz(this.timezone);
      const startTime = dayjs(createNpuExamDto.started_at).tz(this.timezone);

      if (startTime.isBefore(currentTime)) {
        createNpuExamDto.started_at = currentTime.format(this.timestampFormat);
      }

      const npuExam = this.npuExamRepo.create({
        ...createNpuExamDto,
        status: StatusEnum.PENDING,
      });
      const rowData = await this.npuExamRepo.save(npuExam);

      // Schedule the benchmark execution
      await this.scheduleBenchmark(rowData);

      return rowData;
    } catch (error) {
      throw new HttpException(
        (error?.message as string) || 'Failed to create NPU exam',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getNpuExamStatus(id: number) {
    const exam = await this.findOne(id);
    const results = await this.findAllResults(id);

    return {
      status: exam.status,
      message: exam.error_log || '',
      currentRepeatCount: results.length.toString(),
      result: [],
      start_time: exam.started_at,
    };
  }

  async updateNpuExamStartTime(id: number) {
    try {
      const currentTime = dayjs()
        .tz(this.timezone)
        .format(this.timestampFormat);

      await this.update(id, {
        started_at: currentTime.toString(),
        status: StatusEnum.RUNNING,
      });

      return { message: 'Start time updated' };
    } catch (error) {
      throw new HttpException(
        (error?.message as string) || 'Updating Error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll(params: PaginationQueryDto) {
    const { page = 1, limit = 10 } = params;

    const [data, total] = await this.npuExamRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
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
    const item = await this.npuExamRepo.findOne({
      where: { id },
      relations: ['results'],
      order: {
        results: {
          result_number: 'ASC',
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`NPU Exam with id ${id} not found!`);
    }

    return item;
  }

  async update(id: number, updateNpuExamDto: UpdateNpuExamDto) {
    await this.npuExamRepo.update(id, updateNpuExamDto);
    return this.findOne(id);
  }

  async stopNpuExam(id: number) {
    try {
      // Abort running benchmark if active
      const controller = this.runningBenchmarks.get(id);
      if (controller) {
        controller.abort();
        this.runningBenchmarks.delete(id);
        this.logger.log(`NPU exam ${id}: Benchmark aborted by user`);
      }

      // Cancel any pending scheduled timeout
      try {
        this.schedulerRegistry.deleteTimeout(`npu-exam-${id}`);
      } catch {}

      const now = dayjs().tz(this.timezone).format(this.timestampFormat);

      return await this.update(id, {
        status: StatusEnum.STOPPED,
        end_at: now.toString(),
      });
    } catch (error) {
      throw new HttpException(
        (error?.message as string) || 'Failed to stop NPU exam',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async remove(id: number) {
    // Abort running benchmark if active
    const controller = this.runningBenchmarks.get(id);
    if (controller) {
      controller.abort();
      this.runningBenchmarks.delete(id);
    }

    // Cancel any pending scheduled timeout
    try {
      this.schedulerRegistry.deleteTimeout(`npu-exam-${id}`);
    } catch {}

    await this.npuExamRepo.delete(id);
    return { deleted: true };
  }

  // =====================================================================
  // Result Management
  // =====================================================================

  async createResult(dto: CreateNpuExamResultDto) {
    const result = this.npuExamResultRepo.create({
      exam_id: dto.examId,
      result_number: dto.resultNumber,
      result_ttft: dto.ttft,
      result_tt100t: dto.tt100t,
      result_tps: dto.tps,
      result_tps_best: dto.tpsBest,
      result_sps: dto.sps,
      result_latency: dto.latency,
      result_tpot: dto.tpot,
      result_accuracy: dto.accuracy,
      result_npu_mem_peak: dto.npuMemPeak,
      result_npu_util: dto.npuUtil,
      result_npu_power: dto.npuPower,
      result_valid: dto.valid,
    });

    return await this.npuExamResultRepo.save(result);
  }

  async findAllResults(examId: number) {
    return await this.npuExamResultRepo.find({
      where: { exam_id: examId },
      order: { result_number: 'ASC' },
    });
  }

  // =====================================================================
  // Cross-device comparison
  // =====================================================================

  async getComparisonData(
    npuExamId: number,
    gpuExamId: number,
    gpuBenchmark: 'mlperf' | 'mmlu',
  ) {
    const npuExam = await this.findOne(npuExamId);
    const npuResults = await this.findAllResults(npuExamId);

    return {
      npu: {
        exam: npuExam,
        results: npuResults,
        device_type: 'NPU',
        device_model: npuExam.npu_type,
      },
      gpu: {
        exam_id: gpuExamId,
        benchmark: gpuBenchmark,
        device_type: 'GPU',
      },
    };
  }

  // =====================================================================
  // Benchmark Orchestration (CORE)
  // =====================================================================

  private async scheduleBenchmark(exam: NpuExam) {
    const currentTime = dayjs().tz(this.timezone);
    const startTime = dayjs(exam.started_at).tz(this.timezone);
    const delay = Math.max(startTime.diff(currentTime), 3000); // min 3s delay

    const scheduleId = `npu-exam-${exam.id}`;

    // Clear any existing timeout for this exam
    try {
      this.schedulerRegistry.deleteTimeout(scheduleId);
    } catch {}

    const timeout = setTimeout(async () => {
      try {
        this.schedulerRegistry.deleteTimeout(scheduleId);
      } catch {}
      await this.executeBenchmark(exam.id);
    }, delay);

    this.schedulerRegistry.addTimeout(scheduleId, timeout);
    this.logger.log(`NPU exam ${exam.id} scheduled to start in ${delay}ms`);
  }

  private async executeBenchmark(examId: number) {
    const abortController = new AbortController();
    this.runningBenchmarks.set(examId, abortController);

    try {
      // --- PREPARING ---
      await this.npuExamRepo.update(examId, {
        status: StatusEnum.PREPARING,
        error_log: '',
      });

      const exam = await this.findOne(examId);
      this.logger.log(
        `NPU exam ${examId}: PREPARING — checking inference server at ${NPU_INFERENCE_URL}`,
      );

      // Check inference server health
      const healthy = await this.checkServerHealth(NPU_INFERENCE_URL);
      if (!healthy) {
        const msg =
          `Inference server not available at ${NPU_INFERENCE_URL}. ` +
          `Please start it on node4: furiosa-llm serve ${exam.model} ` +
          `--host=0.0.0.0 --port=8000 --device=npu:0:*`;
        await this.npuExamRepo.update(examId, {
          status: StatusEnum.ERROR,
          error_log: msg,
        });
        this.runningBenchmarks.delete(examId);
        this.logger.error(`NPU exam ${examId}: ${msg}`);
        return;
      }

      // --- RUNNING ---
      const now = dayjs().tz(this.timezone).format(this.timestampFormat);
      await this.npuExamRepo.update(examId, {
        status: StatusEnum.RUNNING,
        started_at: now,
      });

      // Load dataset samples
      const samples = this.loadDatasetSamples(exam.benchmark);
      const numSamples =
        exam.data_number === 0
          ? samples.length
          : Math.min(exam.data_number, samples.length);
      const activeSamples = samples.slice(0, numSamples);
      const effectiveMaxTokens =
        exam.max_output_tokens === 0 ? 4096 : exam.max_output_tokens;

      this.logger.log(
        `NPU exam ${examId}: RUNNING — ${activeSamples.length} samples, ` +
          `max_tokens=${effectiveMaxTokens}, ${exam.retry_num} runs`,
      );

      // --- Execute benchmark runs ---
      let bestTpsOverall = 0;

      for (let run = 1; run <= exam.retry_num; run++) {
        if (abortController.signal.aborted) {
          this.logger.log(`NPU exam ${examId}: Aborted at run ${run}`);
          break;
        }

        this.logger.log(
          `NPU exam ${examId}: Starting run ${run}/${exam.retry_num}`,
        );

        const runResult = await this.executeSingleRun(
          NPU_INFERENCE_URL,
          exam.model,
          activeSamples,
          effectiveMaxTokens,
          abortController.signal,
        );

        if (abortController.signal.aborted) break;

        if (runResult.tps > bestTpsOverall) {
          bestTpsOverall = runResult.tps;
        }

        // Store result
        await this.createResult({
          examId,
          resultNumber: run,
          ttft: runResult.avgTtft,
          tt100t: runResult.avgTt100t,
          tps: runResult.tps,
          tpsBest: bestTpsOverall,
          sps: runResult.sps,
          latency: runResult.latency,
          tpot: runResult.avgTpot,
          accuracy: 0,
          npuMemPeak: 0,
          npuUtil: 0,
          npuPower: 0,
          valid: runResult.errors === 0 ? 'true' : 'false',
        });

        this.logger.log(
          `NPU exam ${examId}: Run ${run} — ` +
            `TT100T=${runResult.avgTt100t?.toFixed(4) ?? 'N/A'}s ` +
            `TPS=${runResult.tps.toFixed(2)} ` +
            `TTFT=${runResult.avgTtft ? (runResult.avgTtft * 1000).toFixed(1) : 'N/A'}ms ` +
            `TPOT=${runResult.avgTpot ? (runResult.avgTpot * 1000).toFixed(2) : 'N/A'}ms ` +
            `samples=${runResult.samplesCompleted}/${activeSamples.length} ` +
            `errors=${runResult.errors}`,
        );
      }

      // --- COMPLETED ---
      if (!abortController.signal.aborted) {
        const endTime = dayjs().tz(this.timezone).format(this.timestampFormat);
        await this.npuExamRepo.update(examId, {
          status: StatusEnum.COMPLETED,
          end_at: endTime,
        });
        this.logger.log(`NPU exam ${examId}: COMPLETED`);
      }
    } catch (error) {
      this.logger.error(
        `NPU exam ${examId}: ERROR — ${error.message}`,
        error.stack,
      );
      await this.npuExamRepo.update(examId, {
        status: StatusEnum.ERROR,
        error_log: error.message || 'Benchmark execution failed',
      });
    } finally {
      this.runningBenchmarks.delete(examId);
    }
  }

  // =====================================================================
  // Single Benchmark Run
  // =====================================================================

  private async executeSingleRun(
    serverUrl: string,
    model: string,
    samples: string[],
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<{
    avgTtft: number | null;
    avgTt100t: number | null;
    tps: number;
    sps: number;
    latency: number;
    avgTpot: number | null;
    samplesCompleted: number;
    errors: number;
    bestTt100t: number | null;
  }> {
    const runStart = performance.now();
    let totalTokens = 0;
    let totalTtft = 0;
    let totalTpotSum = 0;
    const tt100tValues: number[] = [];
    let samplesCompleted = 0;
    let errors = 0;

    for (let idx = 0; idx < samples.length; idx++) {
      if (signal.aborted) break;

      try {
        const result = await this.streamCompletion(
          serverUrl,
          model,
          samples[idx],
          maxTokens,
          signal,
        );

        if (signal.aborted) break;

        if (result.firstTokenTime !== null) {
          const ttft = (result.firstTokenTime - result.startTime) / 1000;
          totalTtft += ttft;

          if (result.tokenCount > 1) {
            const tpot =
              (result.endTime - result.firstTokenTime) /
              1000 /
              (result.tokenCount - 1);
            totalTpotSum += tpot;
          }
        }

        if (result.token100Time !== null) {
          const tt100t = (result.token100Time - result.startTime) / 1000;
          tt100tValues.push(tt100t);
        }

        totalTokens += result.tokenCount;
        samplesCompleted++;

        // Progress log every 50 samples
        if ((idx + 1) % 50 === 0 || idx + 1 === samples.length) {
          const elapsed = (performance.now() - runStart) / 1000;
          this.logger.debug(
            `  Progress: ${idx + 1}/${samples.length} samples, ` +
              `${totalTokens} tokens, ${elapsed.toFixed(1)}s elapsed`,
          );
        }
      } catch (err) {
        if (signal.aborted) break;
        errors++;
        this.logger.warn(`  Sample ${idx + 1}: ERROR — ${err.message}`);
      }
    }

    const runEnd = performance.now();
    const runTime = (runEnd - runStart) / 1000;

    return {
      avgTtft: samplesCompleted > 0 ? totalTtft / samplesCompleted : null,
      avgTt100t:
        tt100tValues.length > 0
          ? tt100tValues.reduce((a, b) => a + b, 0) / tt100tValues.length
          : null,
      tps: runTime > 0 ? totalTokens / runTime : 0,
      sps: runTime > 0 ? samplesCompleted / runTime : 0,
      latency: runTime,
      avgTpot: samplesCompleted > 0 ? totalTpotSum / samplesCompleted : null,
      samplesCompleted,
      errors,
      bestTt100t: tt100tValues.length > 0 ? Math.min(...tt100tValues) : null,
    };
  }

  // =====================================================================
  // Streaming HTTP Completion (SSE token counting)
  // =====================================================================

  private streamCompletion(
    serverUrl: string,
    model: string,
    prompt: string,
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<{
    tokenCount: number;
    firstTokenTime: number | null;
    token100Time: number | null;
    startTime: number;
    endTime: number;
  }> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const url = new URL(`${serverUrl}/v1/chat/completions`);
      const body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.0,
        stream: true,
      });

      const startTime = performance.now();
      let firstTokenTime: number | null = null;
      let token100Time: number | null = null;
      let tokenCount = 0;

      const onAbort = () => {
        req.destroy();
        reject(new Error('Aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 300000, // 5 minute timeout per sample
      };

      const req = http.request(options, (res) => {
        if (res.statusCode !== 200) {
          signal.removeEventListener('abort', onAbort);
          reject(new Error(`Server returned status ${res.statusCode}`));
          return;
        }

        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              tokenCount++;
              if (firstTokenTime === null) {
                firstTokenTime = performance.now();
              }
              if (tokenCount === 100 && token100Time === null) {
                token100Time = performance.now();
              }
            }
          }
        });

        res.on('end', () => {
          signal.removeEventListener('abort', onAbort);
          resolve({
            tokenCount,
            firstTokenTime,
            token100Time,
            startTime,
            endTime: performance.now(),
          });
        });

        res.on('error', (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        });
      });

      req.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        if (err.message.includes('ECONNREFUSED')) {
          reject(
            new Error(`Cannot connect to inference server at ${serverUrl}`),
          );
        } else {
          reject(err);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Request timed out after 300s'));
      });

      req.write(body);
      req.end();
    });
  }

  // =====================================================================
  // Server Health Check
  // =====================================================================

  private checkServerHealth(serverUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      const url = new URL(`${serverUrl}/health`);
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'GET',
        timeout: 10000,
      };

      const req = http.request(options, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  // =====================================================================
  // Dataset Loading
  // =====================================================================

  private loadDatasetSamples(benchmark: string): string[] {
    const samples: string[] = [];

    try {
      if (benchmark === 'mlperf') {
        // CNN-DailyMail dataset
        const datasetPath = path.join(DATASET_BASE_PATH, 'cnn_eval.json');
        if (fs.existsSync(datasetPath)) {
          const raw = fs.readFileSync(datasetPath, 'utf-8');
          const data = JSON.parse(raw);

          if (Array.isArray(data)) {
            for (const item of data) {
              const text = item.article || item.text || item.input || '';
              if (text) {
                samples.push(
                  `Summarize the following article:\n\n${text.slice(0, 2000)}`,
                );
              }
            }
          } else if (typeof data === 'object') {
            for (const [, val] of Object.entries(data)) {
              if (typeof val === 'string' && val.length > 50) {
                samples.push(
                  `Summarize the following article:\n\n${val.slice(0, 2000)}`,
                );
                if (samples.length >= 50000) break;
              }
            }
          }

          this.logger.log(
            `Loaded ${samples.length} CNN-DailyMail samples from ${datasetPath}`,
          );
        }
      } else if (benchmark === 'mmlu') {
        // MMLU-Pro dataset
        const datasetDir = path.join(DATASET_BASE_PATH, 'mmlu-pro');
        if (
          fs.existsSync(datasetDir) &&
          fs.statSync(datasetDir).isDirectory()
        ) {
          const files = fs.readdirSync(datasetDir).sort();
          for (const fname of files) {
            const fpath = path.join(datasetDir, fname);
            if (fname.endsWith('.json') || fname.endsWith('.jsonl')) {
              const raw = fs.readFileSync(fpath, 'utf-8');
              if (fname.endsWith('.jsonl')) {
                for (const line of raw.split('\n')) {
                  if (!line.trim()) continue;
                  try {
                    const item = JSON.parse(line.trim());
                    const q = item.question || item.input || '';
                    if (q) samples.push(q);
                  } catch {}
                }
              } else {
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                  for (const item of data) {
                    const q = item.question || item.input || '';
                    if (q) samples.push(q);
                  }
                }
              }
            }
          }

          this.logger.log(
            `Loaded ${samples.length} MMLU-Pro samples from ${datasetDir}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load dataset for ${benchmark}: ${err.message}`,
      );
    }

    // Fallback to default prompts if no dataset was loaded
    if (samples.length === 0) {
      this.logger.warn(
        `No dataset samples found for ${benchmark}. Using ${DEFAULT_PROMPTS.length} default prompts.`,
      );
      return [...DEFAULT_PROMPTS];
    }

    return samples;
  }
}
