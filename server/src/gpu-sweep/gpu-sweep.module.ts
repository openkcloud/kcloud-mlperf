import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GpuSweep } from './entities/gpu-sweep.entity';
import { GpuSweepCell } from './entities/gpu-sweep-cell.entity';
import { GpuSweepService } from './gpu-sweep.service';
import { GpuSweepController } from './gpu-sweep.controller';

import { MpExamModule } from '../mp-exam/mp-exam.module';
import { MmExamModule } from '../mm-exam/mm-exam.module';
import { NpuEvalModule } from '../npu-eval/npu-eval.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GpuSweep, GpuSweepCell]),
    MpExamModule,
    MmExamModule,
    // WS-E US-NEXT-2: NpuEvalModule wired so node4 (Furiosa RNGD) and node5
    // (Rebellions Atom+) cells route to NpuEvalService.create rather than
    // silently creating GPU exams via MpExamService/MmExamService.
    NpuEvalModule,
  ],
  controllers: [GpuSweepController],
  providers: [GpuSweepService],
  exports: [GpuSweepService],
})
export class GpuSweepModule {}
