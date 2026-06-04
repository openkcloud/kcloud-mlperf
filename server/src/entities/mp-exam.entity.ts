import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MpExamResult } from './mp-exam-result.entity';
import { StatusEnum } from 'src/enums/status.enum';
import { TestScenarioEnum } from 'src/enums/test-scenario.enum';
import { MpExamModeEnum } from 'src/enums/mp-exam-mode.enum';

@Entity()
export class MpExam {
  @PrimaryGeneratedColumn()
  id: number;

  // Test name
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  // Test description
  @Column({ type: 'varchar', length: 500 })
  description: string;

  // Test model (dynamic type): Llama 3.1 8B
  @Column({ type: 'varchar', length: 100 })
  model: string;

  // Test precision | accuracy: FP16
  @Column({ type: 'varchar', length: 10, nullable: false })
  precision: string;

  // Test mode type: Performance
  @Column({
    type: 'enum',
    enum: MpExamModeEnum,
    default: MpExamModeEnum.ACCURACY,
  })
  mode: string;

  // Test framework: pytorch(vllm)
  @Column({ type: 'varchar', length: 100 })
  framework: string;

  // Test batch size: 1
  @Column({ type: 'int' })
  batch_size: number;

  // Test minimum duration: 1
  @Column({ type: 'int' })
  min_duration: number;

  // Test datasets (dynamic type): CNN-DailyMail
  @Column({ type: 'varchar', length: 100 })
  dataset: string;

  // Number of data: 100. 0 is the full number of the data
  @Column({ type: 'int' })
  data_number: number;

  // Test scenario type: online | offline
  @Column({
    type: 'enum',
    enum: TestScenarioEnum,
    default: TestScenarioEnum.OFFLINE,
  })
  scenario: string;

  // Test target QPS (Server scenario): 0.5
  @Column({ type: 'float8' })
  target_qps: number;

  // Test number of workers: 1
  @Column({ type: 'int' })
  num_workers: number;

  // Tensor parallel size: 8
  @Column({ type: 'int' })
  tensor_parallel_size: number;

  // Test status, default value: "Waiting for start"
  @Column({
    type: 'enum',
    enum: StatusEnum,
    default: StatusEnum.IDLE,
  })
  status: string;

  // Device type: GPU or NPU
  @Column({ type: 'varchar', length: 10, default: 'GPU' })
  device_type: string;

  // Test GPU/NPU type: A6000, L40, A40, RNGD
  @Column({ type: 'varchar', length: 100 })
  gpu_type: string;

  // Test GPU number: 1
  @Column({ type: 'int' })
  gpu_num: number;

  // Test CPU core: 8
  @Column({ type: 'int' })
  cpu_core: number;

  // Ram Capacity: 2 GB
  @Column({ type: 'int' })
  ram_capacity: number;

  // Test number of repetitions: 1
  @Column({ type: 'int' })
  retry_num: number;

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

  // Test starting time: timestamp value
  @Column({ type: 'varchar', nullable: true, default: null })
  started_at: string;

  // Test end time: timestamp value
  @Column({ type: 'varchar', nullable: true, default: null })
  end_at: string;

  // Test created time: timestamp value
  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  // Test modified time: timestamp value
  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  modified_at: Date;

  // Relationship between test_result entity
  @OneToMany(() => MpExamResult, (result) => result.exam, {
    cascade: true,
  })
  results: MpExamResult[];
}
