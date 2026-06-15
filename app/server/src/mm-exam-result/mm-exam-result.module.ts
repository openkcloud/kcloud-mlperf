import { Module } from '@nestjs/common';
import { MmExamResultService } from './mm-exam-result.service';
import { MmExamResultController } from './mm-exam-result.controller';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MmExamResult } from 'src/entities/mm-exam-result.entity';
import { MmExam } from 'src/entities/mm-exam.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MmExamResult, MmExam])],
  providers: [MmExamResultService],
  controllers: [MmExamResultController],
  exports: [MmExamResultService],
})
export class MmExamResultModule {}
