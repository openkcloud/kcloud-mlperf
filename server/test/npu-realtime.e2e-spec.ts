import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RealtimeModule } from '../src/realtime/realtime.module';
import { GpuSweepModule } from '../src/gpu-sweep/gpu-sweep.module';
import { GpuSweep } from '../src/gpu-sweep/entities/gpu-sweep.entity';
import { GpuSweepCell } from '../src/gpu-sweep/entities/gpu-sweep-cell.entity';
import { NpuExam } from '../src/entities/npu-exam.entity';
import { NpuExamResult } from '../src/entities/npu-exam-result.entity';
import { MpExam } from '../src/entities/mp-exam.entity';
import { MmExam } from '../src/entities/mm-exam.entity';
import { MpExamResult } from '../src/entities/mp-exam-result.entity';
import { DeviceRegistryService } from '../src/device-registry/device-registry.service';
import { DeviceEntry } from '../src/device-registry/device-registry.types';
import { StatusEnum } from '../src/enums/status.enum';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

function makeRepoMock(rows: unknown[] = []) {
  return {
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  };
}

// Devices returned by a registry that has both GPU and NPU nodes (nominal)
const NOMINAL_DEVICES: DeviceEntry[] = [
  // GPU slots — node2, node3
  { node: 'node2', type: 'gpu', vendor: 'nvidia', model: 'NVIDIA-L40',       slot_id: 0, state: 'ready', k8s_node_status: 'Ready', allocatable_resource_name: 'nvidia.com/gpu', allocatable_count: 1, source: 'k8s' },
  { node: 'node2', type: 'gpu', vendor: 'nvidia', model: 'NVIDIA-A40',       slot_id: 1, state: 'ready', k8s_node_status: 'Ready', allocatable_resource_name: 'nvidia.com/gpu', allocatable_count: 1, source: 'k8s' },
  { node: 'node3', type: 'gpu', vendor: 'nvidia', model: 'NVIDIA-L40-44GiB', slot_id: 0, state: 'ready', k8s_node_status: 'Ready', allocatable_resource_name: 'nvidia.com/gpu', allocatable_count: 1, source: 'k8s' },
  { node: 'node3', type: 'gpu', vendor: 'nvidia', model: 'NVIDIA-A40-44GiB', slot_id: 1, state: 'ready', k8s_node_status: 'Ready', allocatable_resource_name: 'nvidia.com/gpu', allocatable_count: 1, source: 'k8s' },
  // NPU slot — node4, FuriosaAI RNGD
  { node: 'node4', type: 'npu', vendor: 'furiosa',    model: 'RNGD',  slot_id: 0, state: 'ready',       k8s_node_status: 'Ready',  allocatable_resource_name: 'furiosa.ai/npu',        allocatable_count: 1, source: 'k8s' },
  // NPU slot — node5, Rebellions Atom+ (pending_join until kubelet active)
  { node: 'node5', type: 'npu', vendor: 'rebellions', model: 'Atom+', slot_id: 0, state: 'pending_join', k8s_node_status: 'Absent', allocatable_resource_name: 'rebellions.ai/atomplus', allocatable_count: null, source: 'cluster_yaml' },
];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('NPU Realtime slots (e2e)', () => {
  let app: INestApplication<App>;

  const sweepRepoMock = { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]) };
  const cellRepoMock  = { find: jest.fn().mockResolvedValue([]) };
  const mpExamMock    = makeRepoMock();
  const mmExamMock    = makeRepoMock();
  const mpResultMock  = makeRepoMock();
  const npuExamMock   = makeRepoMock();
  const npuResultMock = makeRepoMock();

  const deviceRegistryMock = {
    getDevices: jest.fn().mockResolvedValue(NOMINAL_DEVICES),
    getNodes:   jest.fn().mockResolvedValue([]),
    getHealth:  jest.fn().mockResolvedValue({}),
    refresh:    jest.fn().mockResolvedValue({ devices: NOMINAL_DEVICES, nodes: [], health: {} }),
    onModuleInit: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    deviceRegistryMock.getDevices.mockResolvedValue(NOMINAL_DEVICES);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [RealtimeModule, GpuSweepModule],
    })
      .overrideProvider(getRepositoryToken(GpuSweep))     .useValue(sweepRepoMock)
      .overrideProvider(getRepositoryToken(GpuSweepCell)) .useValue(cellRepoMock)
      .overrideProvider(getRepositoryToken(MpExam))       .useValue(mpExamMock)
      .overrideProvider(getRepositoryToken(MmExam))       .useValue(mmExamMock)
      .overrideProvider(getRepositoryToken(MpExamResult)) .useValue(mpResultMock)
      .overrideProvider(getRepositoryToken(NpuExam))      .useValue(npuExamMock)
      .overrideProvider(getRepositoryToken(NpuExamResult)).useValue(npuResultMock)
      .overrideProvider(DeviceRegistryService)            .useValue(deviceRegistryMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Snapshot endpoint — slot shape
  // -------------------------------------------------------------------------

  describe('GET /realtime/exams/snapshot', () => {
    it('returns slots array containing NPU entries', async () => {
      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      expect(res.body).toHaveProperty('slots');
      expect(Array.isArray(res.body.slots)).toBe(true);

      const npuSlots = res.body.slots.filter(
        (s: { device_type: string }) => s.device_type === 'npu',
      );
      expect(npuSlots.length).toBeGreaterThanOrEqual(1);
    });

    it('RNGD slot on node4 is idle when no active NpuExam', async () => {
      npuExamMock.find.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      const rngdSlot = res.body.slots.find(
        (s: { vendor: string; model: string }) =>
          s.vendor === 'furiosa' && s.model === 'RNGD',
      );
      expect(rngdSlot).toBeDefined();
      expect(rngdSlot.node).toBe('node4');
      expect(rngdSlot.status).toBe('idle');
      expect(rngdSlot.current_exam).toBeNull();
      expect(rngdSlot.last_known_metric).toEqual({ tps: null, tt100t_seconds: null });
    });

    it('RNGD slot reflects running NpuExam with metrics', async () => {
      const fakeExam = {
        id: 77,
        name: 'RNGD-mlperf-run1',
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        started_at: new Date(Date.now() - 90_000).toISOString(),
      };
      const fakeResult = {
        id: 1,
        exam_id: 77,
        result_tps: 123.45,
        result_tt100t: 0.812,
        created_at: new Date(),
      };

      npuExamMock.find.mockResolvedValue([fakeExam]);
      npuResultMock.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([fakeResult]),
      });

      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      const rngdSlot = res.body.slots.find(
        (s: { vendor: string }) => s.vendor === 'furiosa',
      );
      expect(rngdSlot).toBeDefined();
      expect(rngdSlot.status).toBe('running');
      expect(rngdSlot.current_exam).toMatchObject({
        id: 77,
        kind: 'npu',
        exam_name: 'RNGD-mlperf-run1',
      });
      expect(rngdSlot.current_exam.elapsed_seconds).toBeGreaterThanOrEqual(89);
      expect(rngdSlot.last_known_metric.tps).toBeCloseTo(123.45);
      expect(rngdSlot.last_known_metric.tt100t_seconds).toBeCloseTo(0.812);
    });

    it('Atom+ slot on node5 has status=pending_join with reason', async () => {
      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      const atomSlot = res.body.slots.find(
        (s: { vendor: string }) => s.vendor === 'rebellions',
      );
      expect(atomSlot).toBeDefined();
      expect(atomSlot.node).toBe('node5');
      expect(atomSlot.status).toBe('pending_join');
      expect(atomSlot.pending_join_reason).toMatch(/node5/i);
      expect(atomSlot.current_exam).toBeNull();
      expect(atomSlot.last_known_metric).toEqual({ tps: null, tt100t_seconds: null });
    });

    it('each slot has required shape fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      for (const slot of res.body.slots) {
        expect(slot).toHaveProperty('device_type');
        expect(slot).toHaveProperty('vendor');
        expect(slot).toHaveProperty('model');
        expect(slot).toHaveProperty('node');
        expect(slot).toHaveProperty('slot_id');
        expect(slot).toHaveProperty('status');
        expect(slot).toHaveProperty('current_exam');
        expect(slot).toHaveProperty('last_known_metric');
      }
    });

    it('snapshot includes both GPU and NPU slots', async () => {
      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      const types: string[] = res.body.slots.map((s: { device_type: string }) => s.device_type);
      expect(types).toContain('gpu');
      expect(types).toContain('npu');
    });
  });

  // -------------------------------------------------------------------------
  // Registry fallback — if DeviceRegistryService throws, GPU hardcodes kick in
  // -------------------------------------------------------------------------

  describe('registry fallback', () => {
    it('falls back to 4 NVIDIA GPU slots when registry throws', async () => {
      deviceRegistryMock.getDevices.mockRejectedValue(new Error('registry unavailable'));

      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      const gpuSlots = res.body.slots.filter(
        (s: { device_type: string }) => s.device_type === 'gpu',
      );
      expect(gpuSlots.length).toBe(4);
      const models = gpuSlots.map((s: { model: string }) => s.model);
      expect(models).toContain('NVIDIA-L40');
      expect(models).toContain('NVIDIA-A40');
    });
  });
});
