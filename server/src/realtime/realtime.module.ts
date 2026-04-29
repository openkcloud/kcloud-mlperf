import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { RealtimeController } from './realtime.controller';
import { RealtimeService, GPU_SWEEP_SERVICE_TOKEN } from './realtime.service';
import { RealtimeGateway } from './realtime.gateway';
import { GpuSweepModule } from '../gpu-sweep/gpu-sweep.module';
import { GpuSweepService } from '../gpu-sweep/gpu-sweep.service';
import { DeviceRegistryModule } from '../device-registry/device-registry.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MpExam, MmExam, MpExamResult, NpuExam, NpuExamResult]),
    GpuSweepModule,
    DeviceRegistryModule,
  ],
  controllers: [RealtimeController],
  providers: [
    RealtimeService,
    RealtimeGateway,
    { provide: GPU_SWEEP_SERVICE_TOKEN, useExisting: GpuSweepService },
  ],
  exports: [RealtimeService, RealtimeGateway],
})
export class RealtimeModule {}
