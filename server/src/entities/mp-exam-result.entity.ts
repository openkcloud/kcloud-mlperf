import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MpExam } from './mp-exam.entity';

@Entity()
export class MpExamResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: false })
  exam_id: number;

  @Column({ type: 'int' })
  result_number: number;

  @Column({ type: 'float8', nullable: true, default: null })
  result_acc_rg_1: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_acc_rg_2: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_acc_rg_l: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_acc_rg_lsum: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_sps: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_sps_best: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_tps: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_tps_best: number | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  result_perf_valid: string | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_latency: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_serv_ttft: number | null;

  @Column({ type: 'float8', nullable: true, default: null })
  result_perf_serv_tpot: number | null;

  @Column({ type: 'float', nullable: true })
  result_vram_peak: number | null;

  @Column({ type: 'float', nullable: true })
  result_gpu_util: number | null;

  @Column({ type: 'float', nullable: true })
  result_tt100t: number | null;

  // Test created time: timestamp value
  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @ManyToOne(() => MpExam, (exam) => exam.results, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exam_id' })
  exam: MpExam;
}
