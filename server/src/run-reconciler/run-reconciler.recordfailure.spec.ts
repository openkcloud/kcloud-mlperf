/**
 * WS-C01 + WS-C04 — verify RunReconcilerService.recordJobFailure() classifies
 * via the heuristics, persists to the correct result repo, and only attaches
 * a diagnostic_dump when failure_reason is UNKNOWN_*.
 */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RunReconcilerService } from './run-reconciler.service';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { MmExamResult } from '../entities/mm-exam-result.entity';
import { FailureReason } from '../enums/failure-reason.enum';

type MockRepo<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function mockRepo<T>(): MockRepo<T> {
  return {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(),
  };
}

describe('RunReconcilerService.recordJobFailure (WS-C01 + WS-C04)', () => {
  let svc: RunReconcilerService;
  let mp: MockRepo<MpExamResult>;
  let mm: MockRepo<MmExamResult>;
  let npu: MockRepo<NpuExamResult>;

  beforeEach(async () => {
    mp = mockRepo<MpExamResult>();
    mm = mockRepo<MmExamResult>();
    npu = mockRepo<NpuExamResult>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RunReconcilerService,
        { provide: getRepositoryToken(NpuExam), useValue: mockRepo<NpuExam>() },
        { provide: getRepositoryToken(NpuExamResult), useValue: npu },
        { provide: getRepositoryToken(MpExamResult), useValue: mp },
        { provide: getRepositoryToken(MmExamResult), useValue: mm },
      ],
    }).compile();

    svc = moduleRef.get(RunReconcilerService);
  });

  it('routes mp failures to MpExamResult repo with classified reason', async () => {
    const reason = await svc.recordJobFailure({
      benchmarkKind: 'mp',
      resultId: 42,
      podStatus: { phase: 'Failed', reason: 'OOMKilled', exitCode: 137 },
      stderrTail: 'killed',
    });
    expect(reason).toBe(FailureReason.POD_OOM);
    expect(mp.update).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        failure_reason: FailureReason.POD_OOM,
        last_stderr_200: 'killed',
        diagnostic_dump: null,
      }),
    );
    expect(mm.update).not.toHaveBeenCalled();
    expect(npu.update).not.toHaveBeenCalled();
  });

  it('routes mm failures to MmExamResult repo and persists null stderr when empty', async () => {
    const reason = await svc.recordJobFailure({
      benchmarkKind: 'mm',
      resultId: 7,
      podStatus: {
        phase: 'Pending',
        reason: 'ImagePullBackOff',
        exitCode: null,
      },
      stderrTail: '',
    });
    expect(reason).toBe(FailureReason.POD_IMAGE_PULL);
    expect(mm.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        failure_reason: FailureReason.POD_IMAGE_PULL,
        last_stderr_200: null,
        diagnostic_dump: null,
      }),
    );
  });

  it('routes npu failures to NpuExamResult repo', async () => {
    const reason = await svc.recordJobFailure({
      benchmarkKind: 'npu',
      resultId: 99,
      podStatus: { phase: 'Failed', reason: null, exitCode: 1 },
      stderrTail: 'inference timeout after 600s',
    });
    expect(reason).toBe(FailureReason.INFERENCE_TIMEOUT);
    expect(npu.update).toHaveBeenCalledWith(
      99,
      expect.objectContaining({
        failure_reason: FailureReason.INFERENCE_TIMEOUT,
        last_stderr_200: 'inference timeout after 600s',
      }),
    );
  });

  it('attaches diagnostic_dump when failure_reason is UNKNOWN_NO_LOGS (WS-C04)', async () => {
    const dump = {
      describe_pod: { name: 'foo' },
      events: [{ reason: 'BackOff' }],
      daemonset_status: { ready: 0 },
    };
    const reason = await svc.recordJobFailure({
      benchmarkKind: 'npu',
      resultId: 1,
      podStatus: { phase: 'Failed', reason: null, exitCode: 1 },
      stderrTail: '',
      diagnostics: dump,
    });
    expect(reason).toBe(FailureReason.UNKNOWN_NO_LOGS);
    expect(npu.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        failure_reason: FailureReason.UNKNOWN_NO_LOGS,
        diagnostic_dump: dump,
      }),
    );
  });

  it('attaches diagnostic_dump for UNKNOWN_WITH_LOGS too', async () => {
    const dump = { describe_pod: {}, events: [], daemonset_status: {} };
    const reason = await svc.recordJobFailure({
      benchmarkKind: 'mp',
      resultId: 5,
      podStatus: { phase: 'Failed', reason: null, exitCode: 1 },
      stderrTail: 'unrecognized error string',
      diagnostics: dump,
    });
    expect(reason).toBe(FailureReason.UNKNOWN_WITH_LOGS);
    expect(mp.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        failure_reason: FailureReason.UNKNOWN_WITH_LOGS,
        diagnostic_dump: dump,
      }),
    );
  });

  it('does NOT attach diagnostic_dump for non-UNKNOWN reasons even when supplied', async () => {
    await svc.recordJobFailure({
      benchmarkKind: 'mp',
      resultId: 5,
      podStatus: { phase: 'Failed', reason: 'OOMKilled', exitCode: 137 },
      stderrTail: 'killed',
      diagnostics: { describe_pod: {}, events: [], daemonset_status: {} },
    });
    expect(mp.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        failure_reason: FailureReason.POD_OOM,
        diagnostic_dump: null,
      }),
    );
  });
});
