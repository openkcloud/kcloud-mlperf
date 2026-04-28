import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  RealtimeService,
  IGpuSweepService,
  GPU_SWEEP_SERVICE_TOKEN,
} from './realtime.service';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { StatusEnum } from '../enums/status.enum';
import type { SweepStatusResponse } from '../gpu-sweep/dto/gpu-sweep.dto';

const mockRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
});

async function buildModule(gpuSweepService: IGpuSweepService | null = null) {
  const mpRepo = mockRepo();
  const mmRepo = mockRepo();
  const mpResultRepo = mockRepo();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RealtimeService,
      { provide: getRepositoryToken(MpExam), useValue: mpRepo },
      { provide: getRepositoryToken(MmExam), useValue: mmRepo },
      { provide: getRepositoryToken(MpExamResult), useValue: mpResultRepo },
      { provide: GPU_SWEEP_SERVICE_TOKEN, useValue: gpuSweepService },
    ],
  }).compile();

  return { service: module.get<RealtimeService>(RealtimeService), mpRepo, mmRepo };
}

describe('RealtimeService', () => {
  let service: RealtimeService;
  let mpRepo: ReturnType<typeof mockRepo>;
  let mmRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    ({ service, mpRepo, mmRepo } = await buildModule());
  });

  it('buildSnapshot returns 4 GPU slots when no exams are running', async () => {
    const snap = await service.buildSnapshot();
    expect(snap.slots).toHaveLength(4);
    snap.slots.forEach((s) => {
      expect(s.status).toBe('idle');
      expect(s.current_exam).toBeNull();
    });
  });

  it('buildSnapshot maps a running mp-exam onto the correct GPU slot', async () => {
    const runningExam: Partial<MpExam> = {
      id: 42,
      name: 'test-mp-exam',
      gpu_type: 'NVIDIA-L40',
      status: StatusEnum.RUNNING,
      started_at: new Date(Date.now() - 30_000).toISOString(),
    };
    mpRepo.find.mockResolvedValue([runningExam]);

    const snap = await service.buildSnapshot();
    const l40Slot = snap.slots.find((s) => s.gpu_type === 'NVIDIA-L40');
    expect(l40Slot?.status).toBe('running');
    expect(l40Slot?.current_exam?.id).toBe(42);
    expect(l40Slot?.current_exam?.kind).toBe('mp');
    expect(l40Slot?.current_exam?.elapsed_seconds).toBeGreaterThanOrEqual(29);
  });

  it('buildSnapshot maps a preparing mm-exam onto the correct GPU slot', async () => {
    const preparingExam: Partial<MmExam> = {
      id: 7,
      name: 'test-mm-exam',
      gpu_type: 'NVIDIA-A40',
      status: StatusEnum.PREPARING,
      started_at: new Date().toISOString(),
    };
    mmRepo.find.mockResolvedValue([preparingExam]);

    const snap = await service.buildSnapshot();
    const a40Slot = snap.slots.find((s) => s.gpu_type === 'NVIDIA-A40');
    expect(a40Slot?.status).toBe('preparing');
    expect(a40Slot?.current_exam?.kind).toBe('mm');
  });

  it('sweep_progress has zero counts when GpuSweepService is not injected', async () => {
    const snap = await service.buildSnapshot();
    expect(snap.sweep_progress.active_sweep_id).toBeNull();
    expect(snap.sweep_progress.completed).toBe(0);
    expect(snap.sweep_progress.total).toBe(0);
  });

  it('sweep_progress is populated when GpuSweepService is injected', async () => {
    const fakeStatus: SweepStatusResponse = {
      enabled: true,
      active_sweep: {
        id: 1,
        name: 'test-sweep',
        mode: 'full',
        status: 'Running',
        total_cells: 96,
        completed_cells: 10,
        started_at: new Date().toISOString(),
      },
      node_state: {
        node2: { busy: true, last_dispatch_at: null, current_cell_key: null },
        node3: { busy: false, last_dispatch_at: null, current_cell_key: null },
      },
    };

    const fakeSvc: IGpuSweepService = {
      getStatus: jest.fn().mockResolvedValue(fakeStatus),
    };

    const { service: svc } = await buildModule(fakeSvc);
    const snap = await svc.buildSnapshot();

    expect(snap.sweep_progress.active_sweep_id).toBe(1);
    expect(snap.sweep_progress.total).toBe(96);
    expect(snap.sweep_progress.completed).toBe(10);
    expect(snap.sweep_progress.paused).toBe(false);
  });

  it('sweep_progress paused=true when active_sweep status is Paused', async () => {
    const fakeStatus: SweepStatusResponse = {
      enabled: true,
      active_sweep: {
        id: 2,
        name: 'paused-sweep',
        mode: 'full',
        status: 'Paused',
        total_cells: 96,
        completed_cells: 20,
        started_at: new Date().toISOString(),
      },
      node_state: {
        node2: { busy: false, last_dispatch_at: null, current_cell_key: null },
        node3: { busy: false, last_dispatch_at: null, current_cell_key: null },
      },
    };

    const { service: svc } = await buildModule({
      getStatus: jest.fn().mockResolvedValue(fakeStatus),
    });
    const snap = await svc.buildSnapshot();
    expect(snap.sweep_progress.paused).toBe(true);
  });

  it('sweep_progress has null active_sweep_id when active_sweep is null', async () => {
    const fakeStatus: SweepStatusResponse = {
      enabled: false,
      active_sweep: null,
      node_state: {
        node2: { busy: false, last_dispatch_at: null, current_cell_key: null },
        node3: { busy: false, last_dispatch_at: null, current_cell_key: null },
      },
    };

    const { service: svc } = await buildModule({
      getStatus: jest.fn().mockResolvedValue(fakeStatus),
    });
    const snap = await svc.buildSnapshot();
    expect(snap.sweep_progress.active_sweep_id).toBeNull();
  });

  it('operator_race_alerts counts events after recordOperatorRaceFailed()', async () => {
    service.recordOperatorRaceFailed();
    service.recordOperatorRaceFailed();

    const snap = await service.buildSnapshot();
    expect(snap.operator_race_alerts).toBeGreaterThanOrEqual(2);
  });

  it('timestamp is a valid ISO8601 string', async () => {
    const snap = await service.buildSnapshot();
    expect(() => new Date(snap.timestamp)).not.toThrow();
    expect(new Date(snap.timestamp).toISOString()).toBe(snap.timestamp);
  });
});
