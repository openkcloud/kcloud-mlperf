import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NpuExam } from 'src/entities/npu-exam.entity';
import { NpuExamResult } from 'src/entities/npu-exam-result.entity';
import { NpuEvalController } from './npu-eval.controller';
import { NpuEvalService } from './npu-eval.service';

@Module({
  imports: [TypeOrmModule.forFeature([NpuExam, NpuExamResult])],
  controllers: [NpuEvalController],
  providers: [NpuEvalService],
  exports: [NpuEvalService],
})
export class NpuEvalModule {}
