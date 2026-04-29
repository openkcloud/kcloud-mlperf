import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MpExam } from 'src/entities/mp-exam.entity';
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

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

@Injectable()
export class MpExamService implements OnModuleInit {
  private grpcService: ExamServiceClient;
  private timezone: string = 'Asia/Seoul';
  private timestampFormat: string = 'YYYY-MM-DDTHH:mm:ssZ';
  private examBenchmark: 'mmlu' | 'mlperf' = 'mlperf';

  constructor(
    @InjectRepository(MpExam) private readonly mpExamRepo: Repository<MpExam>,
    @Inject('EXAM_PACKAGE') private client: ClientGrpc,
    private readonly lokiService: LokiService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly mpExamResultService: MpExamResultService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.grpcService =
      this.client.getService<ExamServiceClient>(EXAM_SERVICE_NAME);

    const pendingExams = await this.mpExamRepo.find({
      where: { status: StatusEnum.IDLE },
    });

    for (const exam of pendingExams) {
      await this.scheduleExam(exam);
    }
  }

  private generateScheduleExamId(id: number): string {
    return `${this.examBenchmark}-exam-${id}`;
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

    if (
      examStatus === StatusEnum.COMPLETED &&
      res.currentRepeatCount === data.retry_num.toString()
    ) {
      const now = dayjs().tz(this.timezone).format(this.timestampFormat);
      await this.update(data.id, { end_at: now.toString() });

      await this.mpExamResultService.create({
        examId: data.id,
        repeatCount: data.retry_num,
        testScenario: data.scenario as TestScenarioEnum,
        mode: data.mode as MpExamModeEnum,
      });
    }

    if (examStatus === StatusEnum.ERROR) {
      await this.update(data.id, {
        error_log: res.message,
      });
    }

    console.log(
      `🚀 Executing MLPerf exam ID=${data.id} at ${dayjs().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss')} status: ${examStatus}`,
    );

    return await this.update(data.id, { status: examStatus });
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
    try {
      // Check if started_at is in the past and replace with current time
      const currentTime = dayjs().tz(this.timezone);
      const startTime = dayjs(createMpExamDto.started_at).tz(this.timezone);

      if (startTime.isBefore(currentTime)) {
        createMpExamDto.started_at = currentTime.format(this.timestampFormat);
      }

      const mmExam = this.mpExamRepo.create(createMpExamDto);

      const rowData = await this.mpExamRepo.save(mmExam);

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

  // Get exam status
  async getMpExamStatus(id: number) {
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

    const mpExam = await this.update(id, {
      status: examStatus,
    });

    if (
      examStatus === StatusEnum.COMPLETED &&
      res.currentRepeatCount === mpExam.retry_num.toString()
    ) {
      const now = dayjs().tz(this.timezone).format(this.timestampFormat);

      const exam = await this.update(id, {
        end_at: now.toString(),
      });

      await this.mpExamResultService.create({
        examId: id,
        repeatCount: exam.retry_num,
        testScenario: exam.scenario as TestScenarioEnum,
        mode: exam.mode as MpExamModeEnum,
      });
    }

    if (examStatus === StatusEnum.ERROR) {
      await this.update(id, {
        error_log: res.message,
      });
    }

    return {
      ...res,
      status: examStatus,
      result: testResult,
      start_time: mpExam.started_at,
    };
  }

  // Get all MP Exam list
  async findAll(params: PaginationQueryDto) {
    const { page = 1, limit = 10 } = params;

    const [data, total] = await this.mpExamRepo.findAndCount({
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
    await this.mpExamRepo.update(id, updateMpExamDto);

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
