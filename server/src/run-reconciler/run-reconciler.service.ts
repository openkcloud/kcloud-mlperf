import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NpuExam } from 'src/entities/npu-exam.entity';
import { NpuExamResult } from 'src/entities/npu-exam-result.entity';
import { MpExamResult } from 'src/entities/mp-exam-result.entity';
import { MmExamResult } from 'src/entities/mm-exam-result.entity';
import { StatusEnum } from 'src/enums/status.enum';
import { FailureReason } from 'src/enums/failure-reason.enum';
import {
  inferFailureReason,
  PodStatusForHeuristics,
} from './failure-heuristics';

/**
 * Optional diagnostic snapshot fetched only when failure_reason ∈ UNKNOWN_*
 * (WS-C04 — auto-attach diagnostics). Producers should pass DescribePod,
 * the last 100 events, and DaemonSet status; the watcher integration story
 * (NPU informer wiring) is deferred — see WS-C01-followup in the migration
 * ledger.
 */
export interface DiagnosticDumpInput {
  describe_pod?: unknown;
  events?: unknown[];
  daemonset_status?: unknown;
}

/**
 * Inputs the Job-watcher (or a manual reconciliation call) provides when a
 * benchmark Job transitions to Failed. `benchmarkKind` selects the result
 * table; `resultId` is the row PK.
 */
export interface JobFailurePayload {
  benchmarkKind: 'mp' | 'mm' | 'npu';
  resultId: number;
  podStatus: PodStatusForHeuristics;
  stderrTail: string;
  diagnostics?: DiagnosticDumpInput;
}

@Injectable()
export class RunReconcilerService {
  private readonly logger = new Logger(RunReconcilerService.name);

  constructor(
    @InjectRepository(NpuExam)
    private readonly npuExamRepo: Repository<NpuExam>,
    @InjectRepository(NpuExamResult)
    private readonly npuResultRepo: Repository<NpuExamResult>,
    @InjectRepository(MpExamResult)
    private readonly mpResultRepo: Repository<MpExamResult>,
    @InjectRepository(MmExamResult)
    private readonly mmResultRepo: Repository<MmExamResult>,
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

  /**
   * WS-C01 + WS-C04 — record a failed Job into the matching result row.
   *
   * Caller (Job-watcher OR manual /admin call) supplies the benchmark kind,
   * the result row id, the pod's status snapshot and the last 200 lines of
   * stderr. We classify via `inferFailureReason()` and persist:
   *   failure_reason   ← classified bucket
   *   last_stderr_200  ← raw stderr tail (best effort)
   *   diagnostic_dump  ← only when bucket is UNKNOWN_* AND a dump was supplied
   *
   * The watcher implementation (NPU/GPU informer subscription, kubectl/Loki
   * stderr pull, DescribePod/events fetch) is intentionally external — this
   * method is the integration seam so different deployment surfaces can wire
   * it however they prefer. See WS-C01-followup in the migration ledger.
   */
  async recordJobFailure(payload: JobFailurePayload): Promise<FailureReason> {
    const reason = inferFailureReason(payload.podStatus, payload.stderrTail);
    const tail = (payload.stderrTail || '').slice(0, 64 * 1024); // 64 KiB hard cap
    const isUnknown =
      reason === FailureReason.UNKNOWN_WITH_LOGS ||
      reason === FailureReason.UNKNOWN_NO_LOGS;
    const dump =
      isUnknown && payload.diagnostics
        ? (payload.diagnostics as unknown as Record<string, unknown>)
        : null;

    const repo = this.repoFor(payload.benchmarkKind);
    await repo.update(payload.resultId, {
      failure_reason: reason,
      last_stderr_200: tail || null,
      diagnostic_dump: dump,
    } as never);

    this.logger.warn(
      `Recorded ${payload.benchmarkKind}_exam_result id=${payload.resultId} failure_reason=${reason}` +
        (isUnknown && dump ? ' (diagnostics attached)' : ''),
    );
    return reason;
  }

  private repoFor(
    kind: 'mp' | 'mm' | 'npu',
  ): Repository<MpExamResult | MmExamResult | NpuExamResult> {
    switch (kind) {
      case 'mp':
        return this.mpResultRepo as unknown as Repository<
          MpExamResult | MmExamResult | NpuExamResult
        >;
      case 'mm':
        return this.mmResultRepo as unknown as Repository<
          MpExamResult | MmExamResult | NpuExamResult
        >;
      case 'npu':
        return this.npuResultRepo as unknown as Repository<
          MpExamResult | MmExamResult | NpuExamResult
        >;
    }
  }
}
