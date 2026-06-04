import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  RealtimeService,
  IGpuSweepService,
  GPU_SWEEP_SERVICE_TOKEN,
  computeSlotStatus,
} from './realtime.service';
import { MpExam } from '../entities/mp-exam.entity';
import { MmExam } from '../entities/mm-exam.entity';
import { MpExamResult } from '../entities/mp-exam-result.entity';
import { NpuExam } from '../entities/npu-exam.entity';
import { NpuExamResult } from '../entities/npu-exam-result.entity';
import { DeviceRegistryService } from '../device-registry/device-registry.service';
import { DeviceTelemetryService } from './device-telemetry.service';
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
      // DeviceTelemetryService was added to RealtimeService's constructor;
      // existing tests pre-date the addition, so we stub it here. The
      // resolvers all return null so slot.telemetry stays undefined and
      // existing assertions are unaffected.
      {
        provide: DeviceTelemetryService,
        useValue: {
          getGpuTelemetry: jest.fn().mockResolvedValue(null),
          getNpuTelemetry: jest.fn().mockResolvedValue(null),
          getVllmTelemetry: jest.fn().mockResolvedValue(null),
        },
      },
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
    // Snapshot includes 4 GPU slots (node2 L40+A40, node3 L40-44+A40-44)
    // and 2 NPU slots (node4 RNGD, node5 Atom+). Filter to GPU for this
    // test's intent.
    const gpuSlots = snap.slots.filter((s) => s.device_type === 'gpu');
    expect(gpuSlots).toHaveLength(4);
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
        {
          provide: DeviceTelemetryService,
          useValue: {
            getGpuTelemetry: jest.fn().mockResolvedValue(null),
            getNpuTelemetry: jest.fn().mockResolvedValue(null),
            getVllmTelemetry: jest.fn().mockResolvedValue(null),
          },
        },
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
        // WS-E: NPU nodes added to SweepStatusResponse contract.
        node4: { busy: false, last_dispatch_at: null, current_cell_key: null },
        node5: { busy: false, last_dispatch_at: null, current_cell_key: null },
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
        // WS-E: NPU nodes added to SweepStatusResponse contract.
        node4: { busy: false, last_dispatch_at: null, current_cell_key: null },
        node5: { busy: false, last_dispatch_at: null, current_cell_key: null },
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
        // WS-E: NPU nodes added to SweepStatusResponse contract.
        node4: { busy: false, last_dispatch_at: null, current_cell_key: null },
        node5: { busy: false, last_dispatch_at: null, current_cell_key: null },
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

/**
 * Regression for the node-aware GPU matcher (Bug 6, 2026-05-18 audit):
 * when k8s schedules `gpu_type=NVIDIA-A40` onto node3 (which actually has
 * A40-44GiB SKU), the realtime snapshot must attribute the exam to
 * node3's A40-44GiB slot, NOT node2's A40 slot. The old matcher used
 * strict SKU match only, so the exam was painted on the wrong host's
 * slot and the dashboard misled the demo audience about which GPU was
 * doing the work.
 */
describe('GPU slot matcher — cross-node refusal + family fallback', () => {
  it('attributes an A40 exam scheduled on node3 to node3 A40-44GiB, not node2 A40', async () => {
    const a40Node2: import('../device-registry/device-registry.types').DeviceEntry = {
      node: 'node2',
      type: 'gpu',
      vendor: 'nvidia',
      model: 'NVIDIA-A40',
      slot_id: 1,
      state: 'ready',
      k8s_node_status: 'Ready',
      allocatable_resource_name: 'nvidia.com/gpu',
      allocatable_count: 2,
      source: 'k8s',
    };
    const a40Node3: import('../device-registry/device-registry.types').DeviceEntry = {
      node: 'node3',
      type: 'gpu',
      vendor: 'nvidia',
      model: 'NVIDIA-A40-44GiB',
      slot_id: 1,
      state: 'ready',
      k8s_node_status: 'Ready',
      allocatable_resource_name: 'nvidia.com/gpu',
      allocatable_count: 2,
      source: 'k8s',
    };
    const deviceRegistry: Partial<DeviceRegistryService> = {
      getDevices: jest.fn().mockResolvedValue([a40Node2, a40Node3]),
    };
    const { service: svc, mpRepo } = await buildModule(null, deviceRegistry);
    const exam: Partial<MpExam> = {
      id: 281,
      name: 'FULL-A40-mlperf-full',
      gpu_type: 'NVIDIA-A40',
      // k8s scheduled the worker onto node3 even though the request named
      // the bare 'NVIDIA-A40' SKU (node2's SKU). Without the cross-node
      // refusal fix, the snapshot would attribute it to node2's A40 slot.
      k8s_node_name: 'node3',
      status: StatusEnum.RUNNING,
      started_at: new Date(Date.now() - 60_000).toISOString(),
    };
    mpRepo.find.mockResolvedValue([exam]);
    const snap = await svc.buildSnapshot();
    const n2A40 = snap.slots.find((s) => s.node === 'node2' && s.model === 'NVIDIA-A40');
    const n3A40 = snap.slots.find((s) => s.node === 'node3' && s.model === 'NVIDIA-A40-44GiB');
    expect(n2A40?.current_exam).toBeNull();
    expect(n3A40?.current_exam?.id).toBe(281);
  });
});

/**
 * Regression for computeSlotStatus: full-MLPerf demo runs (n=13368) showed
 * status="stale" within 2 min during model load because no heartbeat was
 * emitted yet. The grace window keeps healthy warmup phases on "running"
 * and only flips to "stale" if the worker truly never heartbeats.
 */
describe('computeSlotStatus — heartbeat-aware slot state', () => {
  const NOW = new Date('2026-05-18T05:00:00Z').getTime();
  const MIN = 60 * 1000;

  it('returns "running" when last_seen is recent', () => {
    expect(
      computeSlotStatus(
        StatusEnum.RUNNING,
        new Date(NOW - 5 * MIN).toISOString(),
        new Date(NOW - 30 * 1000).toISOString(),
        NOW,
      ),
    ).toBe('running');
  });

  it('returns "stale" when last_seen is older than STALE_THRESHOLD (2 min)', () => {
    expect(
      computeSlotStatus(
        StatusEnum.RUNNING,
        new Date(NOW - 10 * MIN).toISOString(),
        new Date(NOW - 5 * MIN).toISOString(),
        NOW,
      ),
    ).toBe('stale');
  });

  it('returns "running" when no heartbeat yet but exam started recently (pre-first-heartbeat grace)', () => {
    expect(
      computeSlotStatus(
        StatusEnum.RUNNING,
        new Date(NOW - 90 * 1000).toISOString(),
        null,
        NOW,
      ),
    ).toBe('running');
  });

  it('returns "running" when started 5 min ago but never heartbeat — within grace window', () => {
    expect(
      computeSlotStatus(
        StatusEnum.RUNNING,
        new Date(NOW - 5 * MIN).toISOString(),
        null,
        NOW,
      ),
    ).toBe('running');
  });

  it('returns "stale" when never-heartbeat exceeds NEVER_HEARTBEAT_THRESHOLD (30 min)', () => {
    expect(
      computeSlotStatus(
        StatusEnum.RUNNING,
        new Date(NOW - 31 * MIN).toISOString(),
        null,
        NOW,
      ),
    ).toBe('stale');
  });

  it('maps PREPARING → "preparing"', () => {
    expect(computeSlotStatus(StatusEnum.PREPARING, null, null, NOW)).toBe(
      'preparing',
    );
  });

  it('maps ERROR → "error"', () => {
    expect(computeSlotStatus(StatusEnum.ERROR, null, null, NOW)).toBe('error');
  });

  it('maps COMPLETED → "idle"', () => {
    expect(computeSlotStatus(StatusEnum.COMPLETED, null, null, NOW)).toBe(
      'idle',
    );
  });
});

/**
 * Regression for Atom+ per-card telemetry (QA m-rt1):
 * node5 exposes TWO Rebellions Atom+ cards (slot_id=0 → rbln0, slot_id=1 →
 * rbln1).  buildNpuSlotWithTelemetry() must call getNpuTelemetry with the
 * per-card name for each slot so a future refactor cannot silently re-merge
 * the two cards back into a single node-aggregate query.
 *
 * The test registers two ATOM+ DeviceEntries (slot 0 + slot 1), lets
 * buildSnapshot run, and asserts that getNpuTelemetry was called twice — once
 * with cardName='rbln0' and once with cardName='rbln1'.
 */
describe('Atom+ per-card telemetry wiring (QA m-rt1 regression)', () => {
  /** Build a module with two node5 Atom+ devices (slot 0 and slot 1). */
  async function buildAtomModule() {
    const atomSlot0: import('../device-registry/device-registry.types').DeviceEntry =
      {
        node: 'node5',
        type: 'npu',
        vendor: 'rebellions',
        model: 'Atom+',
        slot_id: 0,
        state: 'ready',
        k8s_node_status: 'Ready',
        allocatable_resource_name: 'rebellions.ai/atomplus',
        allocatable_count: 2,
        source: 'cluster_yaml',
      };
    const atomSlot1: import('../device-registry/device-registry.types').DeviceEntry =
      {
        node: 'node5',
        type: 'npu',
        vendor: 'rebellions',
        model: 'Atom+',
        slot_id: 1,
        state: 'ready',
        k8s_node_status: 'Ready',
        allocatable_resource_name: 'rebellions.ai/atomplus',
        allocatable_count: 2,
        source: 'cluster_yaml',
      };

    const getNpuTelemetry = jest.fn().mockResolvedValue({
      source: 'prometheus' as const,
      exporter_status: 'ok' as const,
      util_pct: 50,
      power_w: 80,
      temp_c: 40,
      dram_used_gb: 4,
      dram_total_gb: 8,
    });

    const deviceRegistry: Partial<DeviceRegistryService> = {
      getDevices: jest.fn().mockResolvedValue([atomSlot0, atomSlot1]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeService,
        { provide: getRepositoryToken(MpExam), useValue: mockRepo() },
        { provide: getRepositoryToken(MmExam), useValue: mockRepo() },
        { provide: getRepositoryToken(MpExamResult), useValue: mockRepo() },
        { provide: getRepositoryToken(NpuExam), useValue: mockRepo() },
        { provide: getRepositoryToken(NpuExamResult), useValue: mockRepo() },
        { provide: GPU_SWEEP_SERVICE_TOKEN, useValue: null },
        { provide: DeviceRegistryService, useValue: deviceRegistry },
        {
          provide: DeviceTelemetryService,
          useValue: {
            getGpuTelemetry: jest.fn().mockResolvedValue(null),
            getNpuTelemetry,
            getVllmTelemetry: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    return {
      service: module.get<RealtimeService>(RealtimeService),
      getNpuTelemetry,
    };
  }

  it('getNpuTelemetry is called with cardName="rbln0" for slot_id=0', async () => {
    const { service: svc, getNpuTelemetry } = await buildAtomModule();
    await svc.buildSnapshot();

    const calls = getNpuTelemetry.mock.calls as [string, string, string?][];
    const rbln0Call = calls.find(([_v, _n, cn]) => cn === 'rbln0');
    expect(rbln0Call).toBeDefined();
    expect(rbln0Call![0]).toBe('rebellions');
    expect(rbln0Call![1]).toBe('node5');
  });

  it('getNpuTelemetry is called with cardName="rbln1" for slot_id=1', async () => {
    const { service: svc, getNpuTelemetry } = await buildAtomModule();
    await svc.buildSnapshot();

    const calls = getNpuTelemetry.mock.calls as [string, string, string?][];
    const rbln1Call = calls.find(([_v, _n, cn]) => cn === 'rbln1');
    expect(rbln1Call).toBeDefined();
    expect(rbln1Call![0]).toBe('rebellions');
    expect(rbln1Call![1]).toBe('node5');
  });

  it('getNpuTelemetry is called exactly twice — once per Atom+ card', async () => {
    const { service: svc, getNpuTelemetry } = await buildAtomModule();
    await svc.buildSnapshot();

    // Two Atom+ slots → two calls, each with a distinct cardName.
    const calls = getNpuTelemetry.mock.calls as [string, string, string?][];
    expect(calls).toHaveLength(2);

    const cardNames = calls.map(([, , cn]) => cn);
    expect(cardNames).toContain('rbln0');
    expect(cardNames).toContain('rbln1');
    // Must be different — no duplicate card names.
    expect(new Set(cardNames).size).toBe(2);
  });

  it('each Atom+ slot receives its own telemetry (not the other slot\'s data)', async () => {
    // Use distinct per-card telemetry values to verify the wiring.
    const getNpuTelemetry = jest
      .fn()
      .mockImplementation(
        (_vendor: string, _node: string, cardName?: string) => {
          if (cardName === 'rbln0') {
            return Promise.resolve({
              source: 'prometheus' as const,
              exporter_status: 'ok' as const,
              power_w: 70,
              temp_c: 38,
            });
          }
          // rbln1
          return Promise.resolve({
            source: 'prometheus' as const,
            exporter_status: 'ok' as const,
            power_w: 95,
            temp_c: 52,
          });
        },
      );

    const atomSlot0: import('../device-registry/device-registry.types').DeviceEntry =
      {
        node: 'node5',
        type: 'npu',
        vendor: 'rebellions',
        model: 'Atom+',
        slot_id: 0,
        state: 'ready',
        k8s_node_status: 'Ready',
        allocatable_resource_name: 'rebellions.ai/atomplus',
        allocatable_count: 2,
        source: 'cluster_yaml',
      };
    const atomSlot1: import('../device-registry/device-registry.types').DeviceEntry =
      {
        ...atomSlot0,
        slot_id: 1,
      };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeService,
        { provide: getRepositoryToken(MpExam), useValue: mockRepo() },
        { provide: getRepositoryToken(MmExam), useValue: mockRepo() },
        { provide: getRepositoryToken(MpExamResult), useValue: mockRepo() },
        { provide: getRepositoryToken(NpuExam), useValue: mockRepo() },
        { provide: getRepositoryToken(NpuExamResult), useValue: mockRepo() },
        { provide: GPU_SWEEP_SERVICE_TOKEN, useValue: null },
        {
          provide: DeviceRegistryService,
          useValue: {
            getDevices: jest.fn().mockResolvedValue([atomSlot0, atomSlot1]),
          },
        },
        {
          provide: DeviceTelemetryService,
          useValue: {
            getGpuTelemetry: jest.fn().mockResolvedValue(null),
            getNpuTelemetry,
            getVllmTelemetry: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    const svc = module.get<RealtimeService>(RealtimeService);
    const snap = await svc.buildSnapshot();

    const slot0 = snap.slots.find((s) => s.slot_id === 0 && s.vendor === 'rebellions');
    const slot1 = snap.slots.find((s) => s.slot_id === 1 && s.vendor === 'rebellions');

    expect(slot0?.telemetry?.power_w).toBe(70);
    expect(slot0?.telemetry?.temp_c).toBe(38);
    expect(slot1?.telemetry?.power_w).toBe(95);
    expect(slot1?.telemetry?.temp_c).toBe(52);

    // Cross-check: the two slots must NOT share the same telemetry object values.
    expect(slot0?.telemetry?.power_w).not.toBe(slot1?.telemetry?.power_w);
    expect(slot0?.telemetry?.temp_c).not.toBe(slot1?.telemetry?.temp_c);
  });
});
