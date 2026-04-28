import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StatusEnum } from 'src/enums/status.enum';
import { NpuExamResult } from './npu-exam-result.entity';

@Entity()
export class NpuExam {
  @PrimaryGeneratedColumn()
  id: number;

  // Test name
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  // Test description
  @Column({ type: 'varchar', length: 500 })
  description: string;

  // Benchmark type: mlperf | mmlu
  @Column({ type: 'varchar', length: 20, nullable: false })
  benchmark: string;

  // Test model: e.g. meta-llama/Llama-3.1-8B-Instruct
  @Column({ type: 'varchar', length: 100 })
  model: string;

  // Test precision: FP8, BF16, INT8, INT4
  @Column({ type: 'varchar', length: 10, nullable: false })
  precision: string;

  // Test framework: furiosa-llm
  @Column({ type: 'varchar', length: 100, default: 'furiosa-llm' })
  framework: string;

  // Test batch size
  @Column({ type: 'int' })
  batch_size: number;

  // Test datasets
  @Column({ type: 'varchar', length: 100 })
  dataset: string;

  // Number of data samples: 0 = full dataset
  @Column({ type: 'int' })
  data_number: number;

  // NPU type: RNGD
  @Column({ type: 'varchar', length: 100, default: 'RNGD' })
  npu_type: string;

  // Number of NPUs to use
  @Column({ type: 'int', default: 1 })
  npu_num: number;

  // CPU cores
  @Column({ type: 'int' })
  cpu_core: number;

  // RAM capacity in GB
  @Column({ type: 'int' })
  ram_capacity: number;

  // Number of repetitions
  @Column({ type: 'int' })
  retry_num: number;

  // Max output tokens for benchmark
  // 0 = unlimited/full output
  @Column({ type: 'int', default: 0 })
  max_output_tokens: number;

  // Test status
  @Column({
    type: 'enum',
    enum: StatusEnum,
    default: StatusEnum.IDLE,
  })
  status: string;

  @Column({ type: 'varchar', nullable: true, default: null })
  error_log: string;

  // Test starting time
  @Column({ type: 'varchar', nullable: true, default: null })
  started_at: string;

  // Test end time
  @Column({ type: 'varchar', nullable: true, default: null })
  end_at: string;

  // Test created time
  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  // Test modified time
  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  modified_at: Date;

  // Relationship with results
  @OneToMany(() => NpuExamResult, (result) => result.exam, {
    cascade: true,
  })
  results: NpuExamResult[];
}
