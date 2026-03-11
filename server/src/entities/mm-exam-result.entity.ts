import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { MmExam } from './mm-exam.entity';

@Entity()
export class MmExamResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: false })
  exam_id: number;

  @Column({ type: 'int' })
  result_number: number;

  @Column({ type: 'float8' })
  result_acc_total: number;

  @Column({ type: 'float8' })
  result_acc_physics: number;

  @Column({ type: 'float8' })
  result_acc_chemistry: number;

  @Column({ type: 'float8' })
  result_acc_law: number;

  @Column({ type: 'float8' })
  result_acc_engineering: number;

  @Column({ type: 'float8' })
  result_acc_other: number;

  @Column({ type: 'float8' })
  result_acc_economics: number;

  @Column({ type: 'float8' })
  result_acc_health: number;

  @Column({ type: 'float8' })
  result_acc_psychology: number;

  @Column({ type: 'float8' })
  result_acc_business: number;

  @Column({ type: 'float8' })
  result_acc_biology: number;

  @Column({ type: 'float8' })
  result_acc_philosophy: number;

  @Column({ type: 'float8' })
  result_acc_cs: number;

  @Column({ type: 'float8' })
  result_acc_math: number;

  @Column({ type: 'float8' })
  result_acc_history: number;

  // Test created time: timestamp value
  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @ManyToOne(() => MmExam, (exam) => exam.results, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'exam_id' })
  exam: MmExam;
}
