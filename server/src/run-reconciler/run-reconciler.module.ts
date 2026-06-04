import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NpuExam } from 'src/entities/npu-exam.entity';
import { NpuExamResult } from 'src/entities/npu-exam-result.entity';
import { MpExamResult } from 'src/entities/mp-exam-result.entity';
import { MmExamResult } from 'src/entities/mm-exam-result.entity';
import { RunReconcilerService } from './run-reconciler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NpuExam,
      NpuExamResult,
      MpExamResult,
      MmExamResult,
    ]),
  ],
  providers: [RunReconcilerService],
  exports: [RunReconcilerService],
})
export class RunReconcilerModule {}
