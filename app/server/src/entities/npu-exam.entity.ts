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

  // --- Reproducibility metadata (US-003). All nullable — captured at
  // create-time from process.env so unwired deployments degrade gracefully.
  @Column({ type: 'varchar', length: 40, nullable: true, default: null })
  platform_commit_sha: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true, default: null })
  image_digest: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  k8s_pod_name: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  k8s_node_name: string | null;

  @Column({ type: 'bigint', nullable: true, default: null })
  seed: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  runtime_versions: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, default: null })
  result_schema_version: string | null;

  // --- US-0.5 canonical N=11 additions (mega-plan v2.2). All nullable.
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tokenizer_sha: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  model_sha: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  dataset_sha: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true, default: null })
  seed_value: string | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  fairness_assessment: Record<string, unknown> | null;

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
