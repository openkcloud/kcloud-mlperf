import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MpExamModule } from './mp-exam/mp-exam.module';
import { MpExamResultModule } from './mp-exam-result/mp-exam-result.module';
import { MmExamModule } from './mm-exam/mm-exam.module';
import { MmExamResultModule } from './mm-exam-result/mm-exam-result.module';

import { GrpcClientModule } from './grpc-client/grpc-client.module';
import { LokiModule } from './loki/loki.module';
import { ScheduleModule } from '@nestjs/schedule';
import { FilesModule } from './files/files.module';
import { MpExam } from './entities/mp-exam.entity';
import { MpExamResult } from './entities/mp-exam-result.entity';
import { MmExam } from './entities/mm-exam.entity';
import { MmExamResult } from './entities/mm-exam-result.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DATABASE_HOST'),
        port: configService.get('DATABASE_PORT') || 5432,
        username: configService.get('DATABASE_USER'),
        password: configService.get('DATABASE_PASSWORD'),
        database: configService.get('DATABASE_NAME'),
        entities: [MpExam, MpExamResult, MmExam, MmExamResult],
        synchronize: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    GrpcClientModule,
    MpExamModule,
    MpExamResultModule,
    MmExamModule,
    MmExamResultModule,
    LokiModule,
    FilesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
