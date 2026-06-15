import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RealtimeModule } from '../src/realtime/realtime.module';
import { GpuSweepModule } from '../src/gpu-sweep/gpu-sweep.module';
import { GpuSweep } from '../src/gpu-sweep/entities/gpu-sweep.entity';
import { GpuSweepCell } from '../src/gpu-sweep/entities/gpu-sweep-cell.entity';
import { MpExam } from '../src/entities/mp-exam.entity';
import { MmExam } from '../src/entities/mm-exam.entity';
import { MpExamResult } from '../src/entities/mp-exam-result.entity';
import { MmExamResult } from '../src/entities/mm-exam-result.entity';
import { NpuExam } from '../src/entities/npu-exam.entity';
import { NpuExamResult } from '../src/entities/npu-exam-result.entity';
import { DeviceRegistryService } from '../src/device-registry/device-registry.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { DeviceEntry } from '../src/device-registry/device-registry.types';
import { ConfigModule } from '@nestjs/config';
import { MpExamService } from '../src/mp-exam/mp-exam.service';
import { MmExamService } from '../src/mm-exam/mm-exam.service';

// ---------------------------------------------------------------------------
// Regression test: @Inject(DeviceRegistryService) wiring in RealtimeService
//
// Prior to the fix, RealtimeService used @Inject(DeviceRegistryService) with
// @Optional(), but DeviceRegistryModule exported the service under a factory
// provider rather than the class token, causing the injection to resolve as
// null even when DeviceRegistryModule was imported. This suite proves that:
//   1. DeviceRegistryService is non-null inside RealtimeService when the module
//      is properly wired.
//   2. The snapshot reflects device data from the registry (not hardcoded fallback).
//   3. When DeviceRegistryService throws, the service gracefully falls back.
// ---------------------------------------------------------------------------

const MOCK_DEVICES: DeviceEntry[] = [
  {
    node: 'node2',
    type: 'gpu',
    vendor: 'nvidia',
    model: 'NVIDIA-L40',
    slot_id: 0,
    state: 'ready',
    k8s_node_status: 'Ready',
    allocatable_resource_name: 'nvidia.com/gpu',
    allocatable_count: 1,
    source: 'k8s',
  },
  {
    node: 'node4',
    type: 'npu',
    vendor: 'furiosa',
    model: 'RNGD',
    slot_id: 0,
    state: 'ready',
    k8s_node_status: 'Ready',
    allocatable_resource_name: 'furiosa.ai/npu',
    allocatable_count: 1,
    source: 'k8s',
  },
];

function makeRepoMock() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  };
}

describe('DeviceRegistryService DI wiring regression (e2e)', () => {
  let app: INestApplication<App>;
  let realtimeService: RealtimeService;
  let deviceRegistryMock: {
    getDevices: jest.Mock;
    getNodes: jest.Mock;
    getHealth: jest.Mock;
    onModuleInit: jest.Mock;
  };

  async function bootApp() {
    deviceRegistryMock = {
      getDevices: jest.fn().mockResolvedValue(MOCK_DEVICES),
      getNodes: jest.fn().mockResolvedValue([]),
      getHealth: jest.fn().mockResolvedValue({}),
      onModuleInit: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        RealtimeModule,
        GpuSweepModule,
      ],
    })
      .overrideProvider(getRepositoryToken(GpuSweep))
      .useValue(makeRepoMock())
      .overrideProvider(getRepositoryToken(GpuSweepCell))
      .useValue(makeRepoMock())
      .overrideProvider(getRepositoryToken(MpExam))
      .useValue(makeRepoMock())
      .overrideProvider(getRepositoryToken(MmExam))
      .useValue(makeRepoMock())
      .overrideProvider(getRepositoryToken(MpExamResult))
      .useValue(makeRepoMock())
      .overrideProvider(getRepositoryToken(MmExamResult))
      .useValue(makeRepoMock())
      .overrideProvider(getRepositoryToken(NpuExam))
      .useValue(makeRepoMock())
      .overrideProvider(getRepositoryToken(NpuExamResult))
      .useValue(makeRepoMock())
      .overrideProvider(DeviceRegistryService)
      .useValue(deviceRegistryMock)
      .overrideProvider(MpExamService)
      .useValue({
        findAll: jest.fn().mockResolvedValue([]),
        scheduleExam: jest.fn(),
      })
      .overrideProvider(MmExamService)
      .useValue({
        findAll: jest.fn().mockResolvedValue([]),
        scheduleExam: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    realtimeService = moduleFixture.get(RealtimeService);
    await app.init();
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------
  // Core DI wiring assertions
  // -------------------------------------------------------------------------

  it('RealtimeService is resolvable from the module (basic DI sanity)', async () => {
    await bootApp();
    expect(realtimeService).toBeDefined();
    expect(realtimeService).toBeInstanceOf(RealtimeService);
  });

  it('DeviceRegistryService mock is called when building snapshot (injection is live)', async () => {
    await bootApp();

    await request(app.getHttpServer())
      .get('/realtime/exams/snapshot')
      .expect(200);

    // If DeviceRegistryService was NOT injected (resolved as null), the service
    // would fall back to hardcoded GPU-only slots and never call getDevices().
    expect(deviceRegistryMock.getDevices).toHaveBeenCalled();
  });

  it('snapshot slots reflect registry devices, not hardcoded fallback', async () => {
    await bootApp();

    const res = await request(app.getHttpServer())
      .get('/realtime/exams/snapshot')
      .expect(200);

    const slots: Array<{
      device_type: string;
      vendor: string;
      model: string;
      node: string;
    }> = res.body.slots;

    // Registry returns 1 GPU (NVIDIA-L40 on node2) + 1 NPU (RNGD on node4).
    // The hardcoded fallback returns 4 GPUs on node2+node3 with no NPU.
    // Presence of an npu slot proves registry was used, not the fallback.
    const npuSlots = slots.filter((s) => s.device_type === 'npu');
    expect(npuSlots.length).toBeGreaterThanOrEqual(1);

    const rngdSlot = npuSlots.find((s) => s.model === 'RNGD');
    expect(rngdSlot).toBeDefined();
    expect(rngdSlot!.vendor).toBe('furiosa');
    expect(rngdSlot!.node).toBe('node4');
  });

  it('snapshot does NOT include 4-GPU hardcoded fallback when registry is wired', async () => {
    await bootApp();

    const res = await request(app.getHttpServer())
      .get('/realtime/exams/snapshot')
      .expect(200);

    const slots: Array<{ device_type: string; model: string; node: string }> =
      res.body.slots;

    // Hardcoded fallback uses node3 (NVIDIA-L40-44GiB, NVIDIA-A40-44GiB).
    // Our mock registry does NOT include node3, so these should be absent.
    const node3Slots = slots.filter((s) => s.node === 'node3');
    expect(node3Slots).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Graceful degradation: registry throws → hardcoded GPU fallback
  // -------------------------------------------------------------------------

  it('falls back to 4 hardcoded GPU slots when DeviceRegistryService.getDevices() throws', async () => {
    await bootApp();
    deviceRegistryMock.getDevices.mockRejectedValueOnce(
      new Error('registry down'),
    );

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
    expect(models).toContain('NVIDIA-L40-44GiB');
    expect(models).toContain('NVIDIA-A40-44GiB');
  });

  it('snapshot is still 200 when registry throws (no crash)', async () => {
    await bootApp();
    deviceRegistryMock.getDevices.mockRejectedValueOnce(new Error('timeout'));

    await request(app.getHttpServer())
      .get('/realtime/exams/snapshot')
      .expect(200);
  });
});
