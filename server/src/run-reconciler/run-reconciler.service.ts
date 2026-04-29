import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NpuExam } from 'src/entities/npu-exam.entity';
import { StatusEnum } from 'src/enums/status.enum';

@Injectable()
export class RunReconcilerService {
  private readonly logger = new Logger(RunReconcilerService.name);

  constructor(
    @InjectRepository(NpuExam)
    private readonly npuExamRepo: Repository<NpuExam>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileStuckRuns(): Promise<void> {
    await this.reconcileStuckRunning();
    await this.reconcileStuckIdle();
  }

  // Reconcile Running runs where started_at == end_at (immediate crash, never updated)
  private async reconcileStuckRunning(): Promise<void> {
    const stuck = await this.npuExamRepo
      .createQueryBuilder('exam')
      .where('exam.status = :status', { status: StatusEnum.RUNNING })
      .andWhere('exam.started_at IS NOT NULL')
      .andWhere('exam.started_at = exam.end_at')
      .getMany();

    for (const exam of stuck) {
      const auditMsg = `Auto-reconciled by RunReconcilerService: status=Running with started_at=end_at, no live workload detected.`;
      await this.npuExamRepo.update(exam.id, {
        status: StatusEnum.ERROR,
        error_log: auditMsg,
      });
      this.logger.warn(
        `Reconciled stuck Running run id=${exam.id} name="${exam.name}" -> Error`,
      );
    }
  }

  // Reconcile Idle runs that are more than 4 hours old (stale, never dispatched)
  private async reconcileStuckIdle(): Promise<void> {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const stale = await this.npuExamRepo
      .createQueryBuilder('exam')
      .where('exam.status = :status', { status: StatusEnum.IDLE })
      .andWhere('exam.created_at < :cutoff', { cutoff: fourHoursAgo })
      .getMany();

    for (const exam of stale) {
      const auditMsg = `Auto-reconciled by RunReconcilerService: status=Idle for >4h, considered stale and abandoned.`;
      await this.npuExamRepo.update(exam.id, {
        status: StatusEnum.ERROR,
        error_log: auditMsg,
      });
      this.logger.warn(
        `Reconciled stale Idle run id=${exam.id} name="${exam.name}" -> Error`,
      );
    }
  }
}
