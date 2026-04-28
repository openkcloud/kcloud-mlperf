import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GpuSweep } from './entities/gpu-sweep.entity';
import { GpuSweepCell } from './entities/gpu-sweep-cell.entity';
import { GpuSweepService } from './gpu-sweep.service';
import { GpuSweepController } from './gpu-sweep.controller';

import { MpExamModule } from '../mp-exam/mp-exam.module';
import { MmExamModule } from '../mm-exam/mm-exam.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GpuSweep, GpuSweepCell]),
    MpExamModule,
    MmExamModule,
  ],
  controllers: [GpuSweepController],
  providers: [GpuSweepService],
  exports: [GpuSweepService],
})
export class GpuSweepModule {}
