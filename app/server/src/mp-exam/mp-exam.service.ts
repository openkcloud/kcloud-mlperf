import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MpExam } from 'src/entities/mp-exam.entity';
import { MpExamResult } from 'src/entities/mp-exam-result.entity';
import { Repository } from 'typeorm';
import { CreateMpExamDto } from './dto/create-mp-exam.dto';
import { UpdateMpExamDto } from './dto/update-mp-exam.dto';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';
import {
  CreateExamRes,
  DeleteExamReq,
  DeleteExamRes,
  EXAM_SERVICE_NAME,
  ExamServiceClient,
  GetAvailableGPUsRes,
  GetExamStatusReq,
  GetExamStatusRes,
  UpdateExamStartTimeReq,
  UpdateExamStartTimeRes,
} from '../../proto-types/exam';
import { type ClientGrpc, RpcException } from '@nestjs/microservices';
import { LokiService } from '../loki/loki.service';
import { captureReproducibilityMetadata } from '../reproducibility/reproducibility.metadata';
import { formatSeed } from '../reproducibility/seed-format';
import {
  clampLokiValuesToCap,
  capLokiValuesByMinDuration,
} from '../loki/clamp-loki-values';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Empty } from 'proto-types/google/protobuf/empty';
import { lastValueFrom, Observable } from 'rxjs';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { StatusEnum } from '../enums/status.enum';
import { LokiInstantQueryResponseDto } from '../loki/dto/loki-instant-query-response.dto';
import { MpExamResultService } from '../mp-exam-result/mp-exam-result.service';
import { TestScenarioEnum } from '../enums/test-scenario.enum';
import { MpExamModeEnum } from 'src/enums/mp-exam-mode.enum';
import { selfFairnessSnapshot } from '../comparison/fairness-assessment';
import { LatencyMeasurementContext } from '../enums/latency-measurement-context.enum';
import { validateDevicePrecision } from '../common-validation/device-precision';
import * as k8s from '@kubernetes/client-node';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

// MLPerf worker image per framework. The operator hardcodes the vllm image as the
// default; for `framework=pytorch` runs we patch the Exam CRD's spec.image right
// after gRPC creation so the operator-spawned Job picks up the pytorch worker.
const FRAMEWORK_IMAGE_MAP: Record<string, string> = {
  vllm: 'mondrianai/etri-llm-mlperf:v0.2',
  pytorch: 'jungwooshim/etri-llm-mlperf-pytorch:v1',
};
const EXAM_CRD_GROUP = 'resources.etri.llm';
const EXAM_CRD_VERSION = 'v1';
const EXAM_CRD_PLURAL = 'exams';
const EXAM_CRD_NAMESPACE = process.env.OPERATOR_NAMESPACE || 'llm-evaluation';

@Injectable()
export class MpExamService implements OnModuleInit {
  private grpcService: ExamServiceClient;
  private timezone: string = 'Asia/Seoul';
  private timestampFormat: string = 'YYYY-MM-DDTHH:mm:ssZ';
  private examBenchmark: 'mmlu' | 'mlperf' = 'mlperf';
  private k8sCustomObjects: k8s.CustomObjectsApi | null = null;

  constructor(
    @InjectRepository(MpExam) private readonly mpExamRepo: Repository<MpExam>,
    @InjectRepository(MpExamResult)
    private readonly mpExamResultRepo: Repository<MpExamResult>,
    @Inject('EXAM_PACKAGE') private client: ClientGrpc,
    private readonly lokiService: LokiService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly mpExamResultService: MpExamResultService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.grpcService =
      this.client.getService<ExamServiceClient>(EXAM_SERVICE_NAME);

    // Build a CustomObjects client so we can patch Exam CRD spec.image for
    // framework=pytorch runs. Soft-fail: if cluster auth is missing (local dev)
    // we log and continue without the patch capability.
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromDefault();
      this.k8sCustomObjects = kc.makeApiClient(k8s.CustomObjectsApi);
    } catch (err) {
      console.warn(
        `[MpExamService] k8s client init failed; framework-image patching disabled: ${(err as Error)?.message}`,
      );
      this.k8sCustomObjects = null;
    }

    const pendingExams = await this.mpExamRepo.find({
      where: { status: StatusEnum.IDLE },
    });

    for (const exam of pendingExams) {
      await this.scheduleExam(exam);
    }
  }

  /**
   * Patch the Exam CRD's spec.image so the operator-spawned Job uses the worker
   * matching `framework`. Best-effort: retries briefly while the CRD is created,
   * then applies a JSON-Merge-Patch to spec.image.
   */
  private async patchExamImageForFramework(
    examId: number,
    framework: string,
  ): Promise<void> {
    const image = FRAMEWORK_IMAGE_MAP[framework?.toLowerCase?.()];
    if (!image) {
      console.log(
        `[MpExamService] Unknown framework='${framework}'; leaving operator default image.`,
      );
      return;
    }
    if (!this.k8sCustomObjects) {
      console.warn(
        `[MpExamService] k8s client unavailable; cannot route framework=${framework} (exam=${examId}).`,
      );
      return;
    }

    const name = `mlperf-${examId}`;
    const maxAttempts = 10;
    let lastErr: unknown = null;
    // The default content-type for patchNamespacedCustomObject in
    // @kubernetes/client-node v1 is application/json-patch+json, which expects
    // an array of {op,path,value} ops at the JSON-Pointer path.
    const jsonPatchBody = [
      { op: 'replace', path: '/spec/image', value: image },
    ];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Workaround: the v1 client throws when it sees `headers` in the params
        // typebox, so for cross-version safety we also pass `body` as the
        // JSON-Patch array; CR apiserver accepts both shapes when content-type
        // is application/json-patch+json (the default for this method).
        await this.k8sCustomObjects.patchNamespacedCustomObject({
          group: EXAM_CRD_GROUP,
          version: EXAM_CRD_VERSION,
          namespace: EXAM_CRD_NAMESPACE,
          plural: EXAM_CRD_PLURAL,
          name,
          body: jsonPatchBody,
        } as any);
        console.log(
          `[MpExamService] Patched Exam ${name} spec.image=${image} (framework=${framework}, attempt=${attempt}).`,
        );
        return;
      } catch (err) {
        lastErr = err;
        // Likely 404 until the operator finishes creating the CRD via gRPC,
        // or a transient apiserver error; retry briefly.
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    console.error(
      `[MpExamService] Failed to patch Exam ${name} after ${maxAttempts} attempts: ${(lastErr as Error)?.message}`,
    );
  }

  private generateScheduleExamId(id: number): string {
    return `${this.examBenchmark}-exam-${id}`;
  }

  /**
   * v42 Defect #39 fix: read the worker's actual completion timestamp from the
   * Exam CR (set by the operator on the `Completed` phase transition) rather
   * than using server-side wall-clock at status-poll time.
   *
   * The operator may lag gRPC by several seconds after the worker finishes, so
   * we retry up to 12× with 5 s gaps (≤60 s total) waiting for the CR phase
   * to transition to Completed. Falls back to wall-clock if the client is
   * unavailable or the CR never shows Completed within the retry window.
   */
  /**
   * R8 Bug-2 fix: extract the actual GPU worker node from the Exam CR status
   * conditions. The operator sets a condition with reason "ExamRunning" and a
   * message like "Exam job created and running on node jw2". We parse the node
   * name from that message. Returns null on any failure so the caller can fall
   * back to exam.k8s_node_name (best-effort; never throws).
   */
  private async resolveWorkerNode(examId: number): Promise<string | null> {
    if (!this.k8sCustomObjects) return null;
    try {
      const cr = (await this.k8sCustomObjects.getNamespacedCustomObject({
        group: EXAM_CRD_GROUP,
        version: EXAM_CRD_VERSION,
        namespace: EXAM_CRD_NAMESPACE,
        plural: EXAM_CRD_PLURAL,
        name: `mlperf-${examId}`,
      } as any)) as {
        status?: {
          conditions?: Array<{ reason?: string; message?: string }>;
        };
      };
      const conditions = cr?.status?.conditions ?? [];
      for (const cond of conditions) {
        if (!cond.message) continue;
        // e.g. "Exam job created and running on node jw2"
        const m = /running on node (\S+)/i.exec(cond.message);
        if (m?.[1]) {
          console.log(
            `[MpExamService] Exam CR mlperf-${examId}: worker node resolved to "${m[1]}" from condition message.`,
          );
          return m[1];
        }
      }
    } catch (err) {
      console.debug(
        `[MpExamService] resolveWorkerNode for mlperf-${examId} failed (best-effort): ${(err as Error)?.message}`,
      );
    }
    return null;
  }

  private async resolveExamCompletionTime(examId: number): Promise<string> {
    const fallback = dayjs().tz(this.timezone).format(this.timestampFormat);
    if (!this.k8sCustomObjects) return fallback;
    const maxAttempts = 12;
    const delayMs = 5_000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const cr = (await this.k8sCustomObjects.getNamespacedCustomObject({
          group: EXAM_CRD_GROUP,
          version: EXAM_CRD_VERSION,
          namespace: EXAM_CRD_NAMESPACE,
          plural: EXAM_CRD_PLURAL,
          name: `mlperf-${examId}`,
        } as any)) as { status?: { phase?: { type?: string; lastTransitionTime?: string } } };
        const phase = cr?.status?.phase;
        if (phase?.type === 'Completed' && phase.lastTransitionTime) {
          console.log(
            `[MpExamService] Exam CR mlperf-${examId} Completed phase found on attempt ${attempt}: ${phase.lastTransitionTime}`,
          );
          return dayjs(phase.lastTransitionTime)
            .tz(this.timezone)
            .format(this.timestampFormat);
        }
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      } catch (err) {
        console.warn(
          `[MpExamService] Could not read Exam CR mlperf-${examId} (attempt ${attempt}): ${(err as Error)?.message}`,
        );
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    console.warn(
      `[MpExamService] Exam CR mlperf-${examId} did not show Completed phase after ${maxAttempts} attempts; falling back to wall-clock end_at.`,
    );
    return fallback;
  }

  private async scheduleExam(exam: MpExam) {
    try {
      const currentTime = dayjs().tz(this.timezone);
      const startTime = dayjs(exam.started_at).tz(this.timezone);

      const mpDelay = startTime.diff(currentTime);

      console.log(`MP Exam ID=${exam.id} delay: ${mpDelay}`);

      if (mpDelay <= 0) {
        // Use a 30s minimum delay so the operator has time to initialize the CRD
        // before gRPC status is queried. Without this, the gRPC returns empty
        // and the exam is permanently marked as Undefined.
        const minDelay = 30_000;

        const timeout = setTimeout(async () => {
          await this.executeCreateGrpcExam(exam);
          this.schedulerRegistry.deleteTimeout(
            this.generateScheduleExamId(exam.id),
          );
        }, minDelay);
        this.schedulerRegistry.addTimeout(
          this.generateScheduleExamId(exam.id),
          timeout,
        );
        return;
      }

      const timeout = setTimeout(async () => {
        await this.executeCreateGrpcExam(exam);
        this.schedulerRegistry.deleteTimeout(
          this.generateScheduleExamId(exam.id),
        );
      }, mpDelay);

      this.schedulerRegistry.addTimeout(
        this.generateScheduleExamId(exam.id),
        timeout,
      );

      console.log(
        `⏳ Scheduled exam MP ID=${exam.id} at ${dayjs(exam.started_at).tz(this.timezone).format('YYYY-MM-DD HH:mm:ss')}`,
      );
    } catch (error) {
      console.error(error);
      throw new RpcException({
        code: error?.code,
        message: error?.message,
      });
    }
  }

  // Get available gpu
  private getGrpcAvailableGpuList(
    data: Empty,
  ): Observable<GetAvailableGPUsRes> {
    return this.grpcService.getAvailableGpUs(data);
  }

  private async createGrpcExam(data: MpExam): Promise<CreateExamRes> {
    const grpcExam: Observable<CreateExamRes> = this.grpcService.createExam({
      id: data.id.toString(),
      benchmark: this.examBenchmark,
      resource: {
        cpu: data.cpu_core,
        gpuCount: data.gpu_num,
        gpuModel: data.gpu_type,
        memory: data.ram_capacity,
      },
      scenario: {
        repeatCount: data.retry_num,
        startTime: data.started_at, // 2025-11-06T15:31:45+09:00
      },
      settings: {
        batchSize: `${data.batch_size}`,
        datasetName: data.dataset,
        framework: data.framework,
        modelName: data.model,
        nTrain: '1', // default value
        precision: data.precision,
        mode: data.mode,
        totalSampleCount: `${data.data_number === 0 ? 13368 : data.data_number}`, // 0 = full dataset (CNN-DailyMail has 13368 samples)
        scenario: data.scenario,
        serverTargetQps: `${data.target_qps}`,
        numWorkers: `${data.num_workers}`,
        minDuration: `${data.min_duration}`,
        tensorParallelSize: `${data.tensor_parallel_size}`,
        gpuUtil: '',
        maxTestSamples: '',
        selectedSubjects: '',
        extraArg: '',
      },
    });

    return await lastValueFrom(grpcExam);
  }

  // Update exam start time with grpc protocol
  private updateGrpcExamStartTime(
    data: UpdateExamStartTimeReq,
  ): Observable<UpdateExamStartTimeRes> {
    return this.grpcService.updateExamStartTime(data);
  }

  // Delete created exam
  private deleteGrpcExam(data: DeleteExamReq): Observable<DeleteExamRes> {
    return this.grpcService.deleteExam(data);
  }

  // Get the exam status by the given exam_id with grpc protocol
  private getMpGrpcExamStatus(
    params: GetExamStatusReq,
  ): Observable<GetExamStatusRes> {
    return this.grpcService.getExamStatus(params);
  }

  // Execute create grpc exam
  private async executeCreateGrpcExam(data: MpExam) {
    const res = await lastValueFrom(
      this.getMpGrpcExamStatus({
        benchmark: this.examBenchmark,
        id: data.id.toString(),
      }),
    );

    const examStatus = (res.status || StatusEnum.UNDEFINED) as StatusEnum;

    let resolvedStatus: StatusEnum = examStatus;
    let safetyGateLog: string | null = null;
    if (
      examStatus === StatusEnum.COMPLETED &&
      res.currentRepeatCount === data.retry_num.toString()
    ) {
      // v42 Defect #39: use worker's actual finish timestamp (from Exam CR)
      // instead of the server's wall-clock at status-poll time.
      const completionTs = await this.resolveExamCompletionTime(data.id);
      await this.update(data.id, { end_at: completionTs });

      // R8 Bug-2: resolve the actual GPU worker node (e.g. jw2/jw3) from the
      // Exam CR conditions — falls back to null so captureAvgPower uses the
      // exam's k8s_node_name as a last resort.
      const workerNode = await this.resolveWorkerNode(data.id);

      // v42 Defect #38: catch result-service exceptions (e.g. ENOENT when
      // the worker crashed before writing mlperf_log_detail.txt). A thrown
      // exception here means zero results — treat it as a safety-gate trigger.
      try {
        await this.mpExamResultService.create({
          examId: data.id,
          repeatCount: data.retry_num,
          testScenario: data.scenario as TestScenarioEnum,
          mode: data.mode as MpExamModeEnum,
          exam: data,
          workerNode: workerNode ?? undefined,
        });
      } catch (createErr) {
        console.error(
          `[MpExamService] result create failed for exam ${data.id}: ${(createErr as Error)?.message}`,
        );
        resolvedStatus = StatusEnum.ERROR;
        safetyGateLog =
          `Worker exited cleanly but result extraction failed (${(createErr as Error)?.message}) — likely worker-internal crash (check pod logs). Marked Error by backend safety gate.`;
      }

      // Safety gate: also fire when create() succeeds but produces zero rows
      // (e.g. result file present but empty — no exception thrown).
      if (resolvedStatus !== StatusEnum.ERROR) {
        const after = await this.findOne(data.id);
        if (!after.results || after.results.length === 0) {
          resolvedStatus = StatusEnum.ERROR;
          safetyGateLog =
            'Worker exited cleanly but produced no result rows — likely worker-internal crash (check pod logs). Marked Error by backend safety gate.';
        }
      }
    }

    if (examStatus === StatusEnum.ERROR) {
      await this.update(data.id, {
        error_log: res.message,
      });
    }

    if (safetyGateLog) {
      await this.update(data.id, { error_log: safetyGateLog });
    }

    console.log(
      `🚀 Executing MLPerf exam ID=${data.id} at ${dayjs().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss')} status: ${resolvedStatus}`,
    );

    return await this.update(data.id, { status: resolvedStatus });
  }

  async updateMpExamStartTime(id: number) {
    try {
      const currentTime = dayjs()
        .tz(this.timezone)
        .format(this.timestampFormat);

      const res = await lastValueFrom(
        this.updateGrpcExamStartTime({
          id: id.toString(),
          benchmark: this.examBenchmark,
          startTime: currentTime.toString(),
        }),
      );

      this.schedulerRegistry.deleteTimeout(this.generateScheduleExamId(id));

      await this.update(id, { started_at: currentTime.toString() });

      return res;
    } catch (error) {
      throw new HttpException(
        (error?.message as string) || 'Updating Error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Get available gpu list from grpc protocol
  async getAvailableGpuList() {
    try {
      return await lastValueFrom(this.getGrpcAvailableGpuList({}));
    } catch (error) {
      throw new HttpException(
        (error?.message as string) || 'Failed to get available GPU list',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Create MP Exam
  async create(createMpExamDto: CreateMpExamDto) {
    // B2: validate (device, precision) BEFORE the try/catch so the 400 isn't
    // swallowed and re-thrown as an RpcException by the catch arm below.
    // MP exams are GPU-only (gpu_type populated from NVIDIA-* SKUs).
    validateDevicePrecision(
      'gpu',
      createMpExamDto.gpu_type,
      createMpExamDto.precision,
    );
    // B3 defense-in-depth — see DTO @Min(1) on data_number.
    if (
      createMpExamDto.data_number !== undefined &&
      createMpExamDto.data_number !== null &&
      createMpExamDto.data_number < 1
    ) {
      throw new HttpException(
        'data_number must be >= 1.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      createMpExamDto.max_output_tokens !== undefined &&
      createMpExamDto.max_output_tokens !== null &&
      createMpExamDto.max_output_tokens < 1
    ) {
      throw new HttpException(
        'max_output_tokens must be >= 1.',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Multi-GPU feasibility guard (audit: silent late failure). Every GPU node
    // in the cluster exposes exactly one GPU and every MLPerf job template
    // requests nvidia.com/gpu:"1", so multi-GPU runs cannot be honored: without
    // this guard a tensor_parallel_size>1 / gpu_num>1 request passes
    // validation, schedules a 1-GPU pod, then aborts inside vLLM at runtime
    // (minutes later) instead of failing fast. Reject at create with an
    // actionable 400. Lift this once a >=2-GPU node exists AND the
    // operator/template requests gpu_num GPUs.
    {
      const tp = createMpExamDto.tensor_parallel_size;
      const gpuNum = createMpExamDto.gpu_num;
      if (gpuNum !== undefined && gpuNum !== null && gpuNum < 1) {
        throw new HttpException(
          'gpu_num must be >= 1 for a GPU exam.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        tp !== undefined &&
        tp !== null &&
        gpuNum !== undefined &&
        gpuNum !== null &&
        tp > gpuNum
      ) {
        throw new HttpException(
          `tensor_parallel_size (${tp}) cannot exceed gpu_num (${gpuNum}).`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if ((tp ?? 1) > 1 || (gpuNum ?? 1) > 1) {
        throw new HttpException(
          `Multi-GPU is not available on this cluster: every GPU node exposes a ` +
            `single GPU, so MLPerf runs are single-GPU (use tensor_parallel_size=1, ` +
            `gpu_num=1). Requested tensor_parallel_size=${tp ?? 1}, gpu_num=${gpuNum ?? 1}.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    try {
      // Check if started_at is in the past and replace with current time
      const currentTime = dayjs().tz(this.timezone);
      const startTime = dayjs(createMpExamDto.started_at).tz(this.timezone);

      if (startTime.isBefore(currentTime)) {
        createMpExamDto.started_at = currentTime.format(this.timestampFormat);
      }

      const reproMeta = captureReproducibilityMetadata();
      const seedValue = formatSeed(
        createMpExamDto.seed,
        process.env.BENCHMARK_DETERMINISTIC === '1',
      );
      // Destructure seed out so the number|string DTO field doesn't conflict
      // with the entity's bigint seed column when TypeORM creates the record.
      const { seed: _dtoSeed, ...mpExamData } = createMpExamDto;
      // US-NEXT-1: persist a self-fairness snapshot so the jsonb
      // `fairness_assessment` column is populated at create-time.
      const fairnessAssessment = selfFairnessSnapshot({
        vendor: 'nvidia',
        precision: createMpExamDto.precision ?? null,
        latency_measurement_context:
          LatencyMeasurementContext.CLIENT_WALL_CLOCK,
      });
      const examPayload: Partial<MpExam> = {
        ...mpExamData,
        ...reproMeta,
        fairness_assessment: fairnessAssessment as unknown as Record<
          string,
          unknown
        >,
      };
      if (seedValue !== null) examPayload.seed_value = seedValue;
      const mmExam = this.mpExamRepo.create(examPayload);

      const rowData = await this.mpExamRepo.save(mmExam);

      await this.createGrpcExam(rowData);

      // Phase B routing: if framework=pytorch, override the operator's default
      // worker image by patching the freshly-created Exam CRD's spec.image.
      // Runs in parallel with the gRPC-create race so the patch lands before
      // the operator's first Job spawn at startTime.
      void this.patchExamImageForFramework(rowData.id, rowData.framework);

      await this.scheduleExam(rowData);

      return rowData;
    } catch (error) {
      throw new RpcException({
        code: error?.code,
        message: error?.message,
      });
    }
  }

  // Get exam status
  async getMpExamStatus(id: number) {
    // Short-circuit on unknown id so /status/:id returns 404 (not 500 from gRPC).
    const exists = await this.mpExamRepo.findOne({
      where: { id },
      select: ['id'],
    });
    if (!exists) {
      throw new NotFoundException(`MP Exam with id ${id} not found!`);
    }

    const res = await lastValueFrom(
      this.getMpGrpcExamStatus({
        benchmark: this.examBenchmark,
        id: id.toString(),
      }),
    );
    const examStatus = (res.status || StatusEnum.UNDEFINED) as StatusEnum;
    let testResult: LokiInstantQueryResponseDto['data']['result'] = [];

    if (examStatus === StatusEnum.RUNNING) {
      const lokiRes = await this.lokiService.instantQuery({
        id,
        benchmark: this.examBenchmark,
      });

      testResult = lokiRes.data.result;
    }

    // Read the current DB state BEFORE updating status, so we can guard
    // against re-running the COMPLETED processing block on concurrent polls.
    const prevExam = await this.findOne(id);
    const alreadyTerminal =
      prevExam.status === StatusEnum.ERROR ||
      prevExam.status === StatusEnum.STOPPED;
    const alreadyHasResults = prevExam.results && prevExam.results.length > 0;

    // Only write the new gRPC status if we're not preserving a terminal state.
    const mpExam = alreadyTerminal
      ? prevExam
      : await this.update(id, { status: examStatus });

    if (examStatus === StatusEnum.RUNNING) {
      testResult = clampLokiValuesToCap(testResult, mpExam.data_number);
      testResult = capLokiValuesByMinDuration(
        testResult,
        mpExam.started_at,
        mpExam.min_duration,
      );
    }

    let resolvedStatus: StatusEnum = alreadyTerminal
      ? (prevExam.status as StatusEnum)
      : examStatus;
    let safetyGateLog: string | null = null;

    if (
      examStatus === StatusEnum.COMPLETED &&
      res.currentRepeatCount === mpExam.retry_num.toString() &&
      !alreadyTerminal &&
      !alreadyHasResults
    ) {
      // v42 Defect #39: use worker's actual finish timestamp (from Exam CR)
      // instead of the server's wall-clock at status-poll time.
      const completionTs = await this.resolveExamCompletionTime(id);

      const exam = await this.update(id, {
        end_at: completionTs,
      });

      // R8 Bug-2: resolve the actual GPU worker node from the Exam CR.
      const workerNode = await this.resolveWorkerNode(id);

      // v42 Defect #38: catch result-service exceptions (see executeCreateGrpcExam).
      try {
        await this.mpExamResultService.create({
          examId: id,
          repeatCount: exam.retry_num,
          testScenario: exam.scenario as TestScenarioEnum,
          mode: exam.mode as MpExamModeEnum,
          exam,
          workerNode: workerNode ?? undefined,
        });
      } catch (createErr) {
        console.error(
          `[MpExamService] result create failed for exam ${id}: ${(createErr as Error)?.message}`,
        );
        resolvedStatus = StatusEnum.ERROR;
        safetyGateLog =
          `Worker exited cleanly but result extraction failed (${(createErr as Error)?.message}) — likely worker-internal crash (check pod logs). Marked Error by backend safety gate.`;
      }

      // Safety gate: also fire when create() succeeds but produces zero rows.
      if (resolvedStatus !== StatusEnum.ERROR) {
        const after = await this.findOne(id);
        if (!after.results || after.results.length === 0) {
          resolvedStatus = StatusEnum.ERROR;
          safetyGateLog =
            'Worker exited cleanly but produced no result rows — likely worker-internal crash (check pod logs). Marked Error by backend safety gate.';
        }
      }
    }

    if (examStatus === StatusEnum.ERROR && !alreadyTerminal) {
      await this.update(id, {
        error_log: res.message,
      });
    }

    if (safetyGateLog) {
      await this.update(id, {
        status: resolvedStatus,
        error_log: safetyGateLog,
      });
    }

    return {
      ...res,
      status: resolvedStatus,
      result: testResult,
      start_time: mpExam.started_at,
    };
  }

  // Get all MP Exam list
  // Periodic auto-ingestion (durability). Without this, mp_exam_result rows are
  // only written when the UI hits /list or /status. This 30s cron calls findAll,
  // which refreshes in-flight exams via gRPC and lazily ingests finished results
  // from NFS — so results appear even when nobody is viewing the page.
  private mpIngestPollRunning = false;
  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollInFlightIngestion(): Promise<void> {
    if (this.mpIngestPollRunning) return;
    this.mpIngestPollRunning = true;
    try {
      await this.findAll({ page: 1, limit: 25 } as PaginationQueryDto);
    } catch {
      /* best-effort; never throw from a scheduled job */
    } finally {
      this.mpIngestPollRunning = false;
    }
  }

  async findAll(params: PaginationQueryDto) {
    const { page = 1, limit = 10 } = params;

    let [data, total] = await this.mpExamRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' }, // or ASC
    });

    // Auto-refresh DB for any non-terminal row by polling gRPC status. Covers
    // both Idle→Running (new submission, ~5min delay otherwise from cron) AND
    // Running→Completed (k8s job finished, frontend hasn't polled per-row).
    // Capped at 5 concurrent grpc calls to bound list latency.
    const inFlightStatuses = [
      StatusEnum.UNDEFINED,
      StatusEnum.IDLE,
      StatusEnum.PENDING,
      StatusEnum.PREPARING,
      StatusEnum.RUNNING,
    ];
    const inFlight = data
      .filter((r) => inFlightStatuses.includes(r.status as StatusEnum))
      .slice(0, 5);
    if (inFlight.length > 0) {
      await Promise.all(
        inFlight.map((r) => this.getMpExamStatus(r.id).catch(() => null)),
      );
      // Re-read the refreshed rows
      [data, total] = await this.mpExamRepo.findAndCount({
        skip: (page - 1) * limit,
        take: limit,
        order: { created_at: 'DESC' },
      });
    }

    return {
      list: data,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }

  // Get one MP Exam result by the id
  async findOne(id: number) {
    const item = await this.mpExamRepo.findOne({
      where: { id },
      relations: ['results'],
      order: {
        results: {
          result_number: 'ASC', // or 'DESC'
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`MP Exam with id ${id} not found!`);
    }

    return item;
  }

  // Update MP Exam info
  async update(id: number, updateMpExamDto: UpdateMpExamDto) {
    // Default a missing/null body to {} so an empty PATCH no-ops instead of
    // throwing a TypeError-masked-500 on destructure (M3 hardening).
    const { seed: _s, ...updateData } = updateMpExamDto ?? {};
    await this.mpExamRepo.update(id, updateData);

    return this.findOne(id);
  }

  // stop the running exam
  async stopMpExam(id: number) {
    try {
      const stopMpRes = await lastValueFrom(
        this.deleteGrpcExam({
          id: id.toString(),
          benchmark: this.examBenchmark,
        }),
      );

      console.log({ stopMpRes });

      // const res = await lastValueFrom(
      //   this.getGrpcExamStatus({
      //     benchmark: 'mmlu',
      //     id: id.toString(),
      //   }),
      // );

      // US-NEXT-5: purge partial result rows BEFORE marking the exam stopped so
      // a re-submitted exam under the same exam_id (or new exam reusing the
      // logical name) does not inherit stale rows that latestResult() would
      // pick up via max(result_number).
      try {
        await this.mpExamResultRepo.delete({ exam_id: id });
      } catch (purgeError) {
        console.error(
          `Failed to purge mp_exam_result rows for exam ${id} on stop:`,
          purgeError,
        );
      }

      const now = dayjs().tz(this.timezone).format(this.timestampFormat);

      return await this.update(id, {
        status: StatusEnum.STOPPED,
        end_at: now.toString(),
      });
    } catch (error) {
      throw new RpcException({
        code: error?.code,
        message: error?.message,
      });
    }
  }

  // Delete an MP Exam from the list by id
  async remove(id: number) {
    try {
      // Delete from gRPC service first
      const deleteRes = await lastValueFrom(
        this.deleteGrpcExam({
          id: id.toString(),
          benchmark: this.examBenchmark,
        }),
      );

      console.log({ deleteRes });
    } catch (error) {
      console.error('Failed to delete exam from gRPC service:', error);
      // Continue with database deletion even if gRPC fails
    }

    // Delete from database
    await this.mpExamRepo.delete(id);

    return { deleted: true };
  }
}
