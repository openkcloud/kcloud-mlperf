import { Module } from '@nestjs/common';
import { MpExamResultService } from './mp-exam-result.service';
import { MpExamResultController } from './mp-exam-result.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MpExamResult } from 'src/entities/mp-exam-result.entity';
import { MpExam } from 'src/entities/mp-exam.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MpExamResult, MpExam])],
  providers: [MpExamResultService],
  controllers: [MpExamResultController],
  exports: [MpExamResultService],
})
export class MpExamResultModule {}
