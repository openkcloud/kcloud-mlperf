import { Module } from '@nestjs/common';
import { MpExamController } from './mp-exam.controller';
import { MpExamService } from './mp-exam.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MpExam } from 'src/entities/mp-exam.entity';
import { LokiModule } from '../loki/loki.module';
import { MpExamResultModule } from '../mp-exam-result/mp-exam-result.module';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { GrpcClientModule } from '../grpc-client/grpc-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MpExam, MpExamResult]),
    GrpcClientModule,
    LokiModule,
    MpExamResultModule,
  ],
  controllers: [MpExamController],
  providers: [MpExamService],
  exports: [MpExamService],
})
export class MpExamModule {}
