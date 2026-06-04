import {
  BadRequestException,
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
import { captureReproducibilityMetadata } from '../reproducibility/reproducibility.metadata';
import { formatSeed } from '../reproducibility/seed-format';
import {
  scoreMmluRun,
  isMmluLetter,
  type MmluLetter,
} from '../mm-exam/mmlu-scoring';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { StatusEnum } from '../enums/status.enum';
import { selfFairnessSnapshot } from '../comparison/fairness-assessment';
import { type HardwareVendor } from '../comparison/comparison.service';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';
import { validateDevicePrecision } from '../common-validation/device-precision';
import { PowerCaptureService } from '../prometheus/power-capture.service';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

dayjs.extend(utc);
dayjs.extend(timezone);

// Per-vendor inference server URLs.  Different NPUs run different SDKs and
// must hit their own server — RNGD uses furiosa-llm on node4, Atom+ uses
// vllm-rbln on node5.  Before the per-vendor split, both paths shared one
// URL and Atom+ exams were silently served by the RNGD silicon, breaking
// any cross-vendor comparison.
//
// v37 Fix #(new): cross-node Calico VXLAN to node5 is currently broken
// (admin issue), but pod → node5-underlay-IP:NodePort works fine. Default
// the ATOM URL to the node5 NodePort `10.254.202.111:30093` so the
// backend → Atom+ inference path works without VXLAN. Override via
// NPU_INFERENCE_URL_ATOM (e.g. back to vllm-atomplus.npu Service DNS)
// once networking is repaired — no rebuild needed.
const NPU_INFERENCE_URLS: Record<string, string> = {
  RNGD: process.env.NPU_INFERENCE_URL_RNGD || 'http://10.254.202.114:8000',
  ATOM: process.env.NPU_INFERENCE_URL_ATOM || 'http://10.254.202.111:30093',
};

const FALLBACK_NPU_INFERENCE_URL =
  process.env.NPU_INFERENCE_URL || NPU_INFERENCE_URLS.RNGD;

/** Resolve the inference URL by canonical npu_type label. */
function inferenceUrlForNpuType(npuType: string | null | undefined): string {
  if (!npuType) return FALLBACK_NPU_INFERENCE_URL;
  const upper = npuType.toUpperCase().trim();
  // Tolerate both 'ATOM' and 'Atom+' family names — anything starting with ATOM
  // routes to the Rebellions server.
  if (upper.startsWith('ATOM')) return NPU_INFERENCE_URLS.ATOM;
  if (upper.startsWith('RNGD')) return NPU_INFERENCE_URLS.RNGD;
  return FALLBACK_NPU_INFERENCE_URL;
}

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
    private readonly powerCapture: PowerCaptureService,
  ) {}

  // R8: map an npu_type label to the power-metric vendor used by
  // PowerCaptureService (RNGD → furiosa, Atom+ → rebellions).
  private powerVendorForNpuType(
    npuType: string | null | undefined,
  ): 'furiosa' | 'rebellions' | null {
    const upper = (npuType ?? '').toUpperCase().trim();
    if (upper.startsWith('RNGD')) return 'furiosa';
    if (upper.startsWith('ATOM')) return 'rebellions';
    return null;
  }

  async onModuleInit() {
    // v37 Fix #4: relax failure_reason to nullable so successful npu-eval runs
    // can clear the default UNKNOWN_NO_LOGS classification. Idempotent ALTER
    // — safe to run on every boot. Mirrors the mm-exam pattern at
    // mm-exam.service.ts:ensureResultAccMathColumn.
    await this.ensureFailureReasonNullable();

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

  /** v37 Fix #4: drop NOT NULL on failure_reason for npu_exam_result so a
   * successful run can write `NULL` instead of the bogus UNKNOWN_NO_LOGS
   * default. Idempotent — only ALTERs when the column is still NOT NULL. */
  private async ensureFailureReasonNullable(): Promise<void> {
    const tables = [
      'npu_exam_result',
      'mp_exam_result',
      'mm_exam_result',
    ];
    for (const table of tables) {
      try {
        const queryRunner =
          this.npuExamRepo.manager.connection.createQueryRunner();
        try {
          const hasTable = await queryRunner.hasTable(table);
          if (!hasTable) continue;
          const rows = await queryRunner.query(
            `SELECT is_nullable FROM information_schema.columns
             WHERE table_name = $1 AND column_name = 'failure_reason'`,
            [table],
          );
          const isNullable = rows?.[0]?.is_nullable === 'YES';
          if (!isNullable) {
            await queryRunner.query(
              `ALTER TABLE ${table} ALTER COLUMN failure_reason DROP NOT NULL`,
            );
            this.logger.log(
              `Dropped NOT NULL on ${table}.failure_reason (v37 Fix #4)`,
            );
          }
        } finally {
          await queryRunner.release();
        }
      } catch (err) {
        this.logger.warn(
          `Failed to ensure failure_reason nullable on ${table}: ${(err as Error).message}`,
        );
      }
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
        // B1: Atom+ (Rebellions RBLN-CA22) surfaced for /api/npu-eval/npu-list
        // so the frontend NPU picker can offer the second vendor. FP16 only —
        // see validateDevicePrecision() for the runtime guard.
        {
          npu_model: 'Atom+',
          npu_count: 2,
          memory_gb: 32,
          compute_tflops: 128,
        },
      ],
    };
  }

  // B2 lives in src/common-validation/device-precision.ts and is invoked at
  // the top of create() so the 400 isn't laundered to a 500 by the try/catch.

  async create(createNpuExamDto: CreateNpuExamDto) {
    // B2: validate (device, precision) BEFORE the try/catch so the 400 isn't
    // swallowed and re-thrown as a 500 by the catch arm below.
    validateDevicePrecision(
      'npu',
      createNpuExamDto.npu_type,
      createNpuExamDto.precision,
    );
    // B3 defense-in-depth: class-validator already enforces @Min(1) on
    // data_number / max_output_tokens in CreateNpuExamDto, but if a caller
    // bypasses the global ValidationPipe (e.g., gRPC path), explicitly reject
    // values <= 0 here so we never enqueue an exam that will issue 8000+
    // HTTP-400 inference errors (see run id 103 "tt").
    if (
      createNpuExamDto.data_number !== undefined &&
      createNpuExamDto.data_number !== null &&
      createNpuExamDto.data_number < 1
    ) {
      throw new HttpException(
        'data_number must be >= 1 (0 is not "use default"; the benchmark needs at least one sample).',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      createNpuExamDto.max_output_tokens !== undefined &&
      createNpuExamDto.max_output_tokens !== null &&
      createNpuExamDto.max_output_tokens < 1
    ) {
      throw new HttpException(
        'max_output_tokens must be >= 1.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const currentTime = dayjs().tz(this.timezone);
      const startTime = dayjs(createNpuExamDto.started_at).tz(this.timezone);

      if (startTime.isBefore(currentTime)) {
        createNpuExamDto.started_at = currentTime.format(this.timestampFormat);
      }

      const reproMeta = captureReproducibilityMetadata();
      const seedValue = formatSeed(
        createNpuExamDto.seed,
        process.env.BENCHMARK_DETERMINISTIC === '1',
      );
      const { seed: _dtoSeed, ...npuExamData } = createNpuExamDto;
      // US-NEXT-1: persist a self-fairness snapshot so the jsonb
      // `fairness_assessment` column is populated at create-time. NPU runs
      // capture latency server-side via the SSE token stream, and vendor is
      // derived from the npu_type label (RNGD → furiosa, Atom+ → rebellions).
      const npuTypeUpper = (createNpuExamDto.npu_type ?? '')
        .toUpperCase()
        .trim();
      let vendor: HardwareVendor = 'unknown';
      if (npuTypeUpper.startsWith('ATOM')) {
        vendor = 'rebellions';
      } else if (npuTypeUpper.startsWith('RNGD')) {
        vendor = 'furiosa';
      }
      const fairnessAssessment = selfFairnessSnapshot({
        vendor,
        precision: createNpuExamDto.precision ?? null,
        latency_measurement_context:
          LatencyMeasurementContext.SERVER_TOKEN_STREAM,
      });
      const examPayload: Partial<NpuExam> = {
        ...npuExamData,
        ...reproMeta,
        status: StatusEnum.PENDING,
        fairness_assessment: fairnessAssessment as unknown as Record<
          string,
          unknown
        >,
      };
      if (seedValue !== null) examPayload.seed_value = seedValue;
      const npuExam = this.npuExamRepo.create(examPayload);
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
    const { seed: _s, ...updateData } = updateNpuExamDto;
    await this.npuExamRepo.update(id, updateData);
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

      // US-NEXT-5: purge partial result rows BEFORE marking the exam stopped so
      // a re-submitted exam under the same exam_id (or new exam reusing the
      // logical name) does not inherit stale rows that latestResult() would
      // pick up via max(result_number).
      try {
        await this.npuExamResultRepo.delete({ exam_id: id });
      } catch (purgeError) {
        this.logger.error(
          `Failed to purge npu_exam_result rows for exam ${id} on stop: ${purgeError?.message ?? purgeError}`,
        );
      }

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
      result_perf_p50_latency_s: dto.p50LatencyS ?? null,
      result_perf_p90_latency_s: dto.p90LatencyS ?? null,
      result_perf_p99_latency_s: dto.p99LatencyS ?? null,
      avg_power_w: dto.avgPowerW ?? null,
      result_valid: dto.valid,
    });

    const saved = await this.npuExamResultRepo.save(result);

    // Fix #4 (FINAL-SUMMARY flag): on a successful run, clear the default
    // UNKNOWN_NO_LOGS failure_reason so the row reflects "OK" rather than a
    // bogus failure classification. The Job-watcher only writes failure_reason
    // for failed Jobs, so successful npu-eval rows otherwise inherit the
    // entity-default forever.
    if (dto.valid === 'true') {
      await this.npuExamResultRepo.update(
        { id: saved.id },
        { failure_reason: null },
      );
      saved.failure_reason = null;
    }

    return saved;
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
      const inferenceUrl = inferenceUrlForNpuType(exam.npu_type);
      this.logger.log(
        `NPU exam ${examId} (npu_type=${exam.npu_type}): PREPARING — checking inference server at ${inferenceUrl}`,
      );

      // Check inference server health
      const healthy = await this.checkServerHealth(inferenceUrl);
      if (!healthy) {
        const msg =
          `Inference server not available at ${inferenceUrl} ` +
          `for npu_type=${exam.npu_type}. RNGD path serves furiosa-llm on ` +
          `node4:8000; Atom+ path serves vllm-rbln via ` +
          `vllm-atomplus.npu.svc.cluster.local:8000 (node5).`;
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

      // Fix #21: cap cpu_core ≤7 to preserve 1-core headroom on shared nodes
      // (matches mm-exam.service.ts:156 `Math.min(data.cpu_core, 7)`). Without
      // this, an in-process MMLU loop on a maxed-out cpu_core starves the
      // event loop and the run hangs indefinitely. cpu_core is currently only
      // used as documentation on the in-process path, but we cap it at read
      // time and log so any future thread-pool / k8s-resource consumer of
      // exam.cpu_core inherits the guard.
      const cappedCpuCore = Math.min(exam.cpu_core ?? 7, 7);
      if (cappedCpuCore !== exam.cpu_core) {
        this.logger.log(
          `NPU exam ${examId}: cpu_core capped ${exam.cpu_core} → ${cappedCpuCore} ` +
            `(7-core ceiling for shared node3 headroom)`,
        );
      }

      // Optional MMLU-Pro subject filter via dataset "mmlu-pro:<subject>" so an
      // NPU run can match a GPU mm-exam's subject for strict apples-to-apples
      // accuracy. Plain "mmlu-pro" (no suffix) keeps the full multi-subject set.
      const dsParts = String(exam.dataset ?? '').split(':');
      this.mmluSubjectFilter =
        exam.benchmark === 'mmlu' && dsParts.length > 1 && dsParts[1].trim()
          ? dsParts[1].trim().toLowerCase()
          : null;

      // Load dataset samples
      const samples = this.loadDatasetSamples(exam.benchmark);

      // Fix #21: for MMLU, error out hard if the real MMLU-Pro dataset was not
      // loaded (fell back to DEFAULT_PROMPTS). Silently running on 10 generic
      // prompts produces useless accuracy numbers and the user cannot tell
      // from /status that the dataset was missing.
      if (
        exam.benchmark === 'mmlu' &&
        (samples.length === 0 || this.lastLoadFellBackToDefaults)
      ) {
        throw new BadRequestException(
          'MMLU dataset not loaded; expected /mnt/datasets/mmlu-pro to be available',
        );
      }

      const numSamples =
        exam.data_number === 0
          ? samples.length
          : Math.min(exam.data_number, samples.length);
      const activeSamples = samples.slice(0, numSamples);

      // Cap max_tokens to fit within the model's context window. Without this,
      // vllm-rbln on Atom+ (max_model_len=4096) rejects every request with
      // HTTP 400 when max_output_tokens=0 falls back to 4096 — input tokens
      // plus 4096 output exceeds the window. Reserve INPUT_TOKEN_BUDGET for
      // the prompt (CNN-DailyMail summarization tops out near 700 tokens at
      // 2000-char slice; MMLU-Pro is smaller). Furiosa RNGD reports 32768.
      const modelMaxLen = await this.fetchModelMaxLen(inferenceUrl);
      const INPUT_TOKEN_BUDGET = 1024;
      const safeUpperBound = Math.max(128, modelMaxLen - INPUT_TOKEN_BUDGET);
      const requestedMaxTokens =
        exam.max_output_tokens === 0 ? safeUpperBound : exam.max_output_tokens;
      const effectiveMaxTokens = Math.min(requestedMaxTokens, safeUpperBound);

      this.logger.log(
        `NPU exam ${examId}: RUNNING — ${activeSamples.length} samples, ` +
          `max_tokens=${effectiveMaxTokens} (model_max_len=${modelMaxLen}, ` +
          `requested=${requestedMaxTokens}), ${exam.retry_num} runs`,
      );

      // --- Execute benchmark runs ---
      let bestTpsOverall = 0;

      // US-004: load expected MMLU letters once (not per-run) so accuracy
      // can be computed from each run's collected completions. For mlperf
      // benchmarks this stays null and accuracy passes through as 0.
      const mmluExpected =
        exam.benchmark === 'mmlu' ? this.loadMmluExpectedLetters() : null;

      for (let run = 1; run <= exam.retry_num; run++) {
        if (abortController.signal.aborted) {
          this.logger.log(`NPU exam ${examId}: Aborted at run ${run}`);
          break;
        }

        this.logger.log(
          `NPU exam ${examId}: Starting run ${run}/${exam.retry_num}`,
        );

        const runResult = await this.executeSingleRun(
          inferenceUrl,
          exam.model,
          activeSamples,
          effectiveMaxTokens,
          abortController.signal,
        );

        if (abortController.signal.aborted) break;

        if (runResult.tps > bestTpsOverall) {
          bestTpsOverall = runResult.tps;
        }

        // US-004: score MMLU completions when expected letters are available.
        // Truncate expected to the activeSamples slice we actually ran so
        // partial / data_number-limited runs score correctly.
        let accuracyPct = 0;
        if (mmluExpected && exam.benchmark === 'mmlu') {
          const sliced = mmluExpected.slice(0, activeSamples.length);
          if (sliced.length === runResult.completions.length) {
            accuracyPct = scoreMmluRun(
              runResult.completions,
              sliced,
            ).accuracy_pct;
          }
        }

        // BB-3: per-run latency percentiles (seconds) from the run's
        // per-sample wall latencies (nearest-rank). Null when the run
        // collected no per-sample latencies (e.g. every sample errored).
        const p50 = this.percentile(runResult.sampleLatencies, 50);
        const p90 = this.percentile(runResult.sampleLatencies, 90);
        const p99 = this.percentile(runResult.sampleLatencies, 99);

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
          accuracy: accuracyPct,
          npuMemPeak: 0,
          npuUtil: 0,
          npuPower: 0,
          p50LatencyS: p50,
          p90LatencyS: p90,
          p99LatencyS: p99,
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

        // R8 (perf/Watt): now that end_at is known, capture the mean device
        // power over the run window [started_at..end_at] and write it onto
        // every result row of this exam. Best-effort — wrapped so a Prometheus
        // failure/empty result never affects the completed run. Cannot be
        // backfilled (Prometheus retention); only future runs get a value.
        try {
          const finalExam = await this.npuExamRepo.findOne({
            where: { id: examId },
          });
          const vendor = this.powerVendorForNpuType(finalExam?.npu_type);
          if (vendor && finalExam) {
            const avgPowerW = await this.powerCapture.captureAvgPower(
              vendor,
              finalExam.k8s_node_name,
              finalExam.started_at,
              finalExam.end_at,
            );
            if (avgPowerW != null) {
              await this.npuExamResultRepo.update(
                { exam_id: examId },
                { avg_power_w: avgPowerW },
              );
              this.logger.log(
                `NPU exam ${examId}: avg_power_w=${avgPowerW.toFixed(2)}W (${vendor})`,
              );
            }
          }
        } catch (powerErr) {
          this.logger.warn(
            `NPU exam ${examId}: avg power capture failed (best-effort): ${(powerErr as Error).message}`,
          );
        }
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
    /** US-004: collected completion bodies, in sample order. Empty string for
     * samples that errored, so the array length equals samples.length. */
    completions: string[];
    /** BB-3: per-sample wall latency in SECONDS (one entry per completed
     * sample). Used to compute p50/p90/p99 at result-write time. */
    sampleLatencies: number[];
  }> {
    const runStart = performance.now();
    let totalTokens = 0;
    let totalTtft = 0;
    let totalTpotSum = 0;
    const tt100tValues: number[] = [];
    const completions: string[] = [];
    const sampleLatencies: number[] = [];
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

        // BB-3: per-sample wall latency (end-to-end) in seconds.
        sampleLatencies.push((result.endTime - result.startTime) / 1000);

        totalTokens += result.tokenCount;
        completions.push(result.body ?? '');
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
        completions.push(''); // keep array aligned with samples for scoring
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
      completions,
      sampleLatencies,
    };
  }

  // BB-3: nearest-rank percentile over a list of values (seconds). Returns
  // null when the list is empty. Nearest-rank: sort ascending, take the
  // ceil(p/100 * n)-th value (1-indexed), clamped to the array bounds.
  private percentile(values: number[], p: number): number | null {
    const xs = values
      .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      .sort((a, b) => a - b);
    if (xs.length === 0) return null;
    const rank = Math.ceil((p / 100) * xs.length);
    const idx = Math.min(Math.max(rank, 1), xs.length) - 1;
    return xs[idx];
  }

  // US-004: load MMLU expected-letter answers in the same order as
  // loadDatasetSamples('mmlu') returns prompts. Reads MMLU-Pro JSON/JSONL
  // files from DATASET_BASE_PATH/mmlu-pro and extracts the `answer` field.
  // Returns null if the dataset is unavailable (e.g., dev box without NFS),
  // in which case accuracy stays 0 because expected answers are unknown.
  // Optional MMLU-Pro subject filter (e.g. "biology"). Set from the exam's
  // dataset field ("mmlu-pro:<subject>") so an NPU MMLU run can be restricted
  // to the SAME category a GPU mm-exam used → strictly comparable accuracy.
  // Single-flight is safe: benchmark execution is serialized per the same
  // assumption as lastLoadFellBackToDefaults.
  private mmluSubjectFilter: string | null = null;
  private mmluItemMatchesSubject(item: { category?: unknown }): boolean {
    if (!this.mmluSubjectFilter) return true;
    return String(item?.category ?? '').toLowerCase() === this.mmluSubjectFilter;
  }

  private loadMmluExpectedLetters(): MmluLetter[] | null {
    try {
      const datasetDir = path.join(DATASET_BASE_PATH, 'mmlu-pro');
      if (!fs.existsSync(datasetDir) || !fs.statSync(datasetDir).isDirectory())
        return null;
      const files = fs.readdirSync(datasetDir).sort();
      const answers: MmluLetter[] = [];
      for (const fname of files) {
        const fpath = path.join(datasetDir, fname);
        if (fname.endsWith('.jsonl')) {
          const raw = fs.readFileSync(fpath, 'utf-8');
          for (const line of raw.split('\n')) {
            if (!line.trim()) continue;
            try {
              const item = JSON.parse(line.trim());
              if (!this.mmluItemMatchesSubject(item)) continue;
              const a = String(item.answer ?? '').toUpperCase();
              // MMLU-Pro is 10-option (A–J). Push the real letter; keep array
              // aligned with prompts by using an 'A' placeholder for the rare
              // unparseable answer (scoring then marks that sample wrong).
              answers.push(isMmluLetter(a) ? a : 'A');
            } catch {
              /* skip malformed line */
            }
          }
        } else if (fname.endsWith('.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(fpath, 'utf-8'));
            if (Array.isArray(data)) {
              for (const item of data) {
                if (!this.mmluItemMatchesSubject(item)) continue;
                const a = String(item.answer ?? '').toUpperCase();
                answers.push(isMmluLetter(a) ? a : 'A');
              }
            }
          } catch {
            /* skip */
          }
        }
      }
      return answers.length > 0 ? answers : null;
    } catch {
      return null;
    }
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
    /** Accumulated completion text (US-004 — required for MMLU scoring). */
    body: string;
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
      let accumulatedBody = '';

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
              // US-004: accumulate the OpenAI-stream delta.content so the
              // caller can score MMLU answers. Tolerant of malformed JSON
              // (some servers emit non-OpenAI shapes for first/last frames).
              try {
                const payload = JSON.parse(trimmed.slice(6));
                const delta = payload?.choices?.[0]?.delta?.content;
                if (typeof delta === 'string') accumulatedBody += delta;
              } catch {
                /* ignore non-OpenAI frames */
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
            body: accumulatedBody,
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

  /**
   * Fetch the model's max context length from the OpenAI-compatible
   * `/v1/models` endpoint. Used to safely cap `max_tokens` so requests
   * never exceed the server's context window (which produces HTTP 400 for
   * every sample). Tolerates vllm-style (`max_model_len`) and Furiosa-style
   * (`max_context_len`) fields. Falls back to 4096 if probe fails — matches
   * the most restrictive deployed model so we never overshoot.
   */
  private fetchModelMaxLen(serverUrl: string): Promise<number> {
    const SAFE_FALLBACK = 4096;
    return new Promise((resolve) => {
      const url = new URL(`${serverUrl}/v1/models`);
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'GET',
        timeout: 10000,
      };
      const req = http.request(options, (res) => {
        if (res.statusCode !== 200) {
          resolve(SAFE_FALLBACK);
          return;
        }
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString();
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const m = json?.data?.[0] ?? {};
            const len = Number(
              m.max_model_len ?? m.max_context_len ?? SAFE_FALLBACK,
            );
            resolve(Number.isFinite(len) && len > 0 ? len : SAFE_FALLBACK);
          } catch {
            resolve(SAFE_FALLBACK);
          }
        });
        res.on('error', () => resolve(SAFE_FALLBACK));
      });
      req.on('error', () => resolve(SAFE_FALLBACK));
      req.on('timeout', () => {
        req.destroy();
        resolve(SAFE_FALLBACK);
      });
      req.end();
    });
  }

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

  /**
   * Fix #21: indicates whether the most recent `loadDatasetSamples()` call
   * fell back to DEFAULT_PROMPTS (no real dataset on disk). `executeBenchmark`
   * inspects this for MMLU to fail hard rather than silently scoring against
   * generic prompts. Single-shot flag is fine because benchmark execution
   * is serialized per-exam.
   */
  private lastLoadFellBackToDefaults = false;

  private loadDatasetSamples(benchmark: string): string[] {
    this.lastLoadFellBackToDefaults = false;
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
                    if (!this.mmluItemMatchesSubject(item)) continue;
                    const q = item.question || item.input || '';
                    if (q) samples.push(q);
                  } catch {}
                }
              } else {
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                  for (const item of data) {
                    if (!this.mmluItemMatchesSubject(item)) continue;
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
      this.lastLoadFellBackToDefaults = true;
      return [...DEFAULT_PROMPTS];
    }

    return samples;
  }
}
