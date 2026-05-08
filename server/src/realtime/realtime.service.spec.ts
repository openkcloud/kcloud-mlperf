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
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { DeviceRegistryService } from '../device-registry/device-registry.service';
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

// Null deviceRegistry → falls back to 4 hardcoded GPU slots
async function buildModule(
  gpuSweepService: IGpuSweepService | null = null,
  deviceRegistry: Partial<DeviceRegistryService> | null = null,
) {
  const mpRepo = mockRepo();
  const mmRepo = mockRepo();
  const mpResultRepo = mockRepo();
  const npuExamRepo = mockRepo();
  const npuResultRepo = mockRepo();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RealtimeService,
      { provide: getRepositoryToken(MpExam), useValue: mpRepo },
      { provide: getRepositoryToken(MmExam), useValue: mmRepo },
      { provide: getRepositoryToken(MpExamResult), useValue: mpResultRepo },
      { provide: getRepositoryToken(NpuExam), useValue: npuExamRepo },
      { provide: getRepositoryToken(NpuExamResult), useValue: npuResultRepo },
      { provide: GPU_SWEEP_SERVICE_TOKEN, useValue: gpuSweepService },
      { provide: DeviceRegistryService, useValue: deviceRegistry },
    ],
  }).compile();

  return {
    service: module.get<RealtimeService>(RealtimeService),
    mpRepo,
    mmRepo,
    npuExamRepo,
    npuResultRepo,
  };
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
      // Idle slots must explicitly mark metrics as unavailable so the UI
      // never renders blank.
      expect(s.metrics_status).toBe('unavailable');
      expect(s.last_metric_timestamp).toBeNull();
      expect(s.last_known_metric.tps).toBeNull();
      expect(s.last_known_metric.tt100t_seconds).toBeNull();
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
    const l40Slot = snap.slots.find((s) => s.model === 'NVIDIA-L40');
    expect(l40Slot?.status).toBe('running');
    expect(l40Slot?.current_exam?.id).toBe(42);
    expect(l40Slot?.current_exam?.kind).toBe('mp');
    expect(l40Slot?.current_exam?.elapsed_seconds).toBeGreaterThanOrEqual(29);
    // Running mp-exam with no result rows yet — should be 'pending', not faked
    // and not 'unavailable'.
    expect(l40Slot?.metrics_status).toBe('pending');
    expect(l40Slot?.last_known_metric.tps).toBeNull();
    expect(l40Slot?.last_known_metric.tt100t_seconds).toBeNull();
    expect(l40Slot?.last_metric_timestamp).toBeNull();
  });

  it('buildSnapshot surfaces tps/tt100t and metric timestamp when a result row exists', async () => {
    const runningExam: Partial<MpExam> = {
      id: 99,
      name: 'mlperf-llama',
      gpu_type: 'NVIDIA-L40',
      status: StatusEnum.RUNNING,
      started_at: new Date(Date.now() - 5_000).toISOString(),
    };
    const resultRow: Partial<MpExamResult> = {
      exam_id: 99,
      result_perf_tps: 62.94,
      result_tt100t: 1588,
      created_at: new Date('2026-04-28T08:30:00Z'),
    };

    const mpRepoLocal = {
      find: jest.fn().mockResolvedValue([runningExam]),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    const mmRepoLocal = mockRepo();
    const mpResultRepoLocal = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([resultRow]),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeService,
        { provide: getRepositoryToken(MpExam), useValue: mpRepoLocal },
        { provide: getRepositoryToken(MmExam), useValue: mmRepoLocal },
        {
          provide: getRepositoryToken(MpExamResult),
          useValue: mpResultRepoLocal,
        },
        { provide: getRepositoryToken(NpuExam), useValue: mockRepo() },
        { provide: getRepositoryToken(NpuExamResult), useValue: mockRepo() },
        { provide: GPU_SWEEP_SERVICE_TOKEN, useValue: null },
        { provide: DeviceRegistryService, useValue: null },
      ],
    }).compile();

    const svc = module.get<RealtimeService>(RealtimeService);
    const snap = await svc.buildSnapshot();
    const l40 = snap.slots.find((s) => s.model === 'NVIDIA-L40');
    expect(l40?.metrics_status).toBe('available');
    expect(l40?.last_known_metric.tps).toBe(62.94);
    expect(l40?.last_known_metric.tt100t_seconds).toBe(1.588);
    expect(l40?.last_metric_timestamp).toBe('2026-04-28T08:30:00.000Z');
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
    const a40Slot = snap.slots.find((s) => s.model === 'NVIDIA-A40');
    expect(a40Slot?.status).toBe('preparing');
    expect(a40Slot?.current_exam?.kind).toBe('mm');
    // mm exams have no streaming perf metrics — surface 'unavailable' so the
    // UI labels it explicitly instead of rendering blank cells.
    expect(a40Slot?.metrics_status).toBe('unavailable');
    expect(a40Slot?.last_known_metric.tps).toBeNull();
    expect(a40Slot?.last_known_metric.tt100t_seconds).toBeNull();
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
