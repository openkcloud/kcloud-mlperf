import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Repository } from 'typeorm';
import { lastValueFrom, Observable } from 'rxjs';
import { SchedulerRegistry } from '@nestjs/schedule';

import { MmExam } from '../entities/mm-exam.entity';
import { CreateMmExamDto } from './dto/create-mm-exam.dto';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';
import { UpdateMmExamDto } from './dto/update-mm-exam.dto';
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
import { Empty } from '../../proto-types/google/protobuf/empty';
import { LokiService } from '../loki/loki.service';
import { clampLokiValuesToCap } from '../loki/clamp-loki-values';
import { LokiInstantQueryResponseDto } from '../loki/dto/loki-instant-query-response.dto';
import { StatusEnum } from '../enums/status.enum';
import { MmExamResultService } from '../mm-exam-result/mm-exam-result.service';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

@Injectable()
export class MmExamService implements OnModuleInit {
  private grpcService: ExamServiceClient;
  private timezone: string = 'Asia/Seoul';
  private timestampFormat: string = 'YYYY-MM-DDTHH:mm:ssZ';
  private examBenchmark: 'mmlu' | 'mlperf' = 'mmlu';

  constructor(
    @InjectRepository(MmExam) private readonly mmExamRepo: Repository<MmExam>,
    @Inject('EXAM_PACKAGE') private client: ClientGrpc,
    private readonly lokiService: LokiService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly mmExamResultService: MmExamResultService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.grpcService =
      this.client.getService<ExamServiceClient>(EXAM_SERVICE_NAME);

    // Check and add result_acc_math column if it doesn't exist
    await this.ensureResultAccMathColumn();

    const pendingExams = await this.mmExamRepo.find({
      where: { status: StatusEnum.IDLE },
    });

    for (const exam of pendingExams) {
      await this.scheduleExam(exam);
    }
  }

  private generateScheduleExamId(id: number): string {
    return `${this.examBenchmark}-exam-${id}`;
  }

  // Exam schedule caller
  private async scheduleExam(exam: MmExam) {
    try {
      const now = dayjs().tz(this.timezone);
      const startTime = dayjs(exam.started_at).tz(this.timezone);

      const mmDelay = startTime.diff(now);

      console.log(`MM Exam ID=${exam.id} delay: ${mmDelay}`);

      if (mmDelay <= 0) {
        // Use a 30s minimum delay so the operator has time to initialize the CRD
        // before gRPC status is queried. Without this, the gRPC returns empty
        // and the exam is permanently marked as Undefined.
        const minDelay = 30_000;
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
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

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      const timeout = setTimeout(async () => {
        await this.executeCreateGrpcExam(exam);
        this.schedulerRegistry.deleteTimeout(
          this.generateScheduleExamId(exam.id),
        );
      }, mmDelay);

      this.schedulerRegistry.addTimeout(
        this.generateScheduleExamId(exam.id),
        timeout,
      );

      console.log(
        `⏳ Scheduled MM exam ID=${exam.id} at ${dayjs(exam.started_at).tz(this.timezone).format('YYYY-MM-DD HH:mm:ss')}`,
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

  // Create an exam with grpc protocol
  private async createGrpcExam(data: MmExam): Promise<CreateExamRes> {
    const grpcExam: Observable<CreateExamRes> = this.grpcService.createExam({
      id: data.id.toString(),
      benchmark: this.examBenchmark,
      resource: {
        cpu: Math.min(data.cpu_core, 7), // cap at 7 to preserve 1-core headroom on node3 (15900m allocatable, daemons ~500m)
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
        gpuUtil: `${data.gpu_util}`,
        maxTestSamples: `${data.data_number === 0 ? '' : data.data_number}`, // 0 = all samples (empty string = no limit)
        modelName: data.model,
        nTrain: `${data.n_train}`, // default value
        precision: data.precision,
        selectedSubjects: data.subject,
        mode: '',
        totalSampleCount: '', // mlperf data number
        scenario: '',
        serverTargetQps: '',
        numWorkers: '',
        extraArg: '',
        minDuration: '',
        tensorParallelSize: '',
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

  // Execute create grpc exam
  private async executeCreateGrpcExam(data: MmExam) {
    const res = await lastValueFrom(
      this.getGrpcExamStatus({
        benchmark: this.examBenchmark,
        id: data.id.toString(),
      }),
    );

    const examStatus = (res.status || StatusEnum.UNDEFINED) as StatusEnum;

    if (
      examStatus === StatusEnum.COMPLETED &&
      res.currentRepeatCount === data.retry_num.toString()
    ) {
      const now = dayjs().tz(this.timezone).format(this.timestampFormat);
      await this.update(data.id, { end_at: now.toString() });

      await this.mmExamResultService.create({
        examId: data.id,
        repeatCount: data.retry_num,
        exam: data,
      });
    }

    if (examStatus === StatusEnum.ERROR) {
      await this.update(data.id, {
        error_log: res.message,
      });
    }

    console.log(
      `🚀 Executing MMLU exam ID=${data.id} at ${dayjs().tz(this.timezone).format()} status: ${examStatus}`,
    );

    return await this.update(data.id, { status: examStatus });
  }

  // Get the exam status by the given exam_id with grpc protocol
  private getGrpcExamStatus(
    params: GetExamStatusReq,
  ): Observable<GetExamStatusRes> {
    return this.grpcService.getExamStatus(params);
  }

  async updateExamStartTime(id: number) {
    try {
      const now = dayjs().tz(this.timezone).format(this.timestampFormat);

      const res = await lastValueFrom(
        this.updateGrpcExamStartTime({
          id: id.toString(),
          benchmark: this.examBenchmark,
          startTime: now.toString(),
        }),
      );

      this.schedulerRegistry.deleteTimeout(this.generateScheduleExamId(id));

      await this.update(id, { started_at: now.toString() });

      return res;
    } catch (error) {
      throw new HttpException(
        (error?.message as string) || 'Updating Error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Create MMLU exam
  async create(createMmExamDto: CreateMmExamDto) {
    try {
      // Check if started_at is in the past and replace with current time
      const currentTime = dayjs().tz(this.timezone);
      const startTime = dayjs(createMmExamDto.started_at).tz(this.timezone);

      if (startTime.isBefore(currentTime)) {
        createMmExamDto.started_at = currentTime.format(this.timestampFormat);
      }

      const mmExam = this.mmExamRepo.create(createMmExamDto);

      const rowData = await this.mmExamRepo.save(mmExam);

      await this.createGrpcExam(rowData);

      await this.scheduleExam(rowData);

      return rowData;
    } catch (error) {
      throw new RpcException({
        code: error?.code,
        message: error?.message,
      });
    }
  }

  // Get available gpu list from grpc protocol
  async getAvailableGpuList() {
    return await lastValueFrom(this.getGrpcAvailableGpuList({}));
  }

  // Get exam status
  async getExamStatus(id: number) {
    const res = await lastValueFrom(
      this.getGrpcExamStatus({
        benchmark: this.examBenchmark,
        id: id.toString(),
      }),
    );
    let testResult: LokiInstantQueryResponseDto['data']['result'] = [];
    const examStatus = (res.status || StatusEnum.UNDEFINED) as StatusEnum;

    if (examStatus === StatusEnum.RUNNING) {
      const lokiRes = await this.lokiService.instantQuery({
        id,
        benchmark: this.examBenchmark,
      });

      testResult = lokiRes.data.result;
    }

    const examRes = await this.update(id, {
      status: examStatus,
    });

    if (examStatus === StatusEnum.RUNNING) {
      testResult = clampLokiValuesToCap(testResult, examRes.data_number);
    }

    if (
      examStatus === StatusEnum.COMPLETED &&
      res.currentRepeatCount === examRes.retry_num.toString()
    ) {
      const now = dayjs().format(this.timestampFormat);

      const exam = await this.update(id, {
        end_at: now.toString(),
      });

      await this.mmExamResultService.create({
        examId: id,
        repeatCount: exam.retry_num,
        exam,
      });
    }

    if (examStatus === StatusEnum.ERROR) {
      await this.update(id, { error_log: res.message });
    }

    return {
      ...res,
      result: testResult,
      status: examStatus,
      start_time: examRes.started_at,
    };
  }

  // Get all MMLU exam list
  async findAll(params: PaginationQueryDto) {
    const { page = 1, limit = 10 } = params;

    let [data, total] = await this.mmExamRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' }, // or ASC
    });

    // Auto-refresh DB for Running rows by polling gRPC status (symmetric with
    // mp-exam fix). Without this, a Running row stays Running in the DB until
    // someone polls /api/mm-exam/status/{id} explicitly. Capped at 5 grpc calls.
    const running = data.filter((r) => r.status === StatusEnum.RUNNING).slice(0, 5);
    if (running.length > 0) {
      await Promise.all(running.map((r) => this.getExamStatus(r.id).catch(() => null)));
      [data, total] = await this.mmExamRepo.findAndCount({
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

  // Get one MMLU Exam result by the id
  async findOne(id: number) {
    const item = await this.mmExamRepo.findOne({
      where: { id },
      relations: ['results'],
      order: {
        results: {
          result_number: 'ASC', // or 'DESC'
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`MMLU Exam with id ${id} not found!`);
    }

    return item;
  }

  // Update MP Exam info
  async update(id: number, updateMmExamDto: UpdateMmExamDto) {
    await this.mmExamRepo.update(id, updateMmExamDto);

    return this.findOne(id);
  }

  // stop the running exam
  async stop(id: number) {
    try {
      const stopRes = await lastValueFrom(
        this.deleteGrpcExam({
          id: id.toString(),
          benchmark: this.examBenchmark,
        }),
      );

      console.log({ stopRes });

      // const res = await lastValueFrom(
      //   this.getGrpcExamStatus({
      //     benchmark: 'mmlu',
      //     id: id.toString(),
      //   }),
      // );

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
    await this.mmExamRepo.delete(id);

    return { deleted: true };
  }

  // Ensure result_acc_math column exists in mm_exam_result table
  private async ensureResultAccMathColumn(): Promise<void> {
    try {
      const queryRunner =
        this.mmExamRepo.manager.connection.createQueryRunner();

      // Check if column exists
      const tableExists = await queryRunner.hasTable('mm_exam_result');

      if (tableExists) {
        const columnExists = await queryRunner.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'mm_exam_result' 
            AND column_name = 'result_acc_math'
          );
        `);

        if (!columnExists[0].exists) {
          console.log(
            'Adding result_acc_math column to mm_exam_result table...',
          );
          await queryRunner.query(`
            ALTER TABLE mm_exam_result
            ADD COLUMN result_acc_math float8 DEFAULT 0
          `);
          console.log('Successfully added result_acc_math column');
        } else {
          console.log('result_acc_math column already exists');
        }
      }

      await queryRunner.release();
    } catch (error) {
      console.error('Error ensuring result_acc_math column:', error);
    }
  }
}
