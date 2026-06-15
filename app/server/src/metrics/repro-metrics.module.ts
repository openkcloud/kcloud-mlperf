import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { ReproMetricsController } from './repro-metrics.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MpExam, MmExam, NpuExam])],
  controllers: [ReproMetricsController],
})
export class ReproMetricsModule {}
