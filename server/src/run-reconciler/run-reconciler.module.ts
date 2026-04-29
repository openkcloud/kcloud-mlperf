import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NpuExam } from 'src/entities/npu-exam.entity';
import { RunReconcilerService } from './run-reconciler.service';

@Module({
  imports: [TypeOrmModule.forFeature([NpuExam])],
  providers: [RunReconcilerService],
})
export class RunReconcilerModule {}
