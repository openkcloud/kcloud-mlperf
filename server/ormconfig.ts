import { type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { MpExam } from 'src/entities/mp-exam.entity';
import { MpExamResult } from 'src/entities/mp-exam-result.entity';
import { MmExam } from 'src/entities/mm-exam.entity';
import { MmExamResult } from 'src/entities/mm-exam-result.entity';

const config: TypeOrmModuleOptions = {
  type: 'postgres',
  database: `${process.env.DATABASE_NAME}`,
  host: `${process.env.DATABASE_HOST}`,
  port: Number(process.env.DATABASE_PORT) || 5432,
  username: `${process.env.DATABASE_USER}`,
  password: `${process.env.DATABASE_PASSWORD}`,
  entities: [MpExam, MpExamResult, MmExam, MmExamResult],
  synchronize: process.env.NODE_ENV === 'development', // this is for only dev mode
};

export default config;
