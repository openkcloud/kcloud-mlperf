import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MpExam } from '../entities/mp-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { ComparisonController } from './comparison.controller';
import { ComparisonService } from './comparison.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MpExam,
      MpExamResult,
      MmExam,
      MmExamResult,
      NpuExam,
      NpuExamResult,
    ]),
  ],
  controllers: [ComparisonController],
  providers: [ComparisonService],
  exports: [ComparisonService],
})
export class ComparisonModule {}
