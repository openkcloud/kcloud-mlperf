import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MmExam } from '../entities/mm-exam.entity';
import { MmExamController } from './mm-exam.controller';
import { MmExamService } from './mm-exam.service';
import { LokiModule } from '../loki/loki.module';
import { MmExamResultModule } from '../mm-exam-result/mm-exam-result.module';
import { MmExamResult } from '../entities/mm-exam-result.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([MmExam, MmExamResult]),
    LokiModule,
    MmExamResultModule,
  ],
  controllers: [MmExamController],
  providers: [MmExamService],
  exports: [MmExamService],
})
export class MmExamModule {}
