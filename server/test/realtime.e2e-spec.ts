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

const REQUIRED_SLOT_FIELDS = [
  'device_type',
  'vendor',
  'model',
  'node',
  'slot_id',
  'status',
  'current_exam',
  'last_known_metric',
  'last_metric_timestamp',
  'metrics_status',
];

describe('Realtime SSE (e2e)', () => {
  let app: INestApplication<App>;

  const repoMock = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [RealtimeModule, GpuSweepModule],
    })
      .overrideProvider(getRepositoryToken(GpuSweep))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(GpuSweepCell))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(MpExam))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(MmExam))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(MpExamResult))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(MmExamResult))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(NpuExam))
      .useValue(repoMock())
      .overrideProvider(getRepositoryToken(NpuExamResult))
      .useValue(repoMock())
      .overrideProvider(DeviceRegistryService)
      .useValue({ getDevices: jest.fn().mockResolvedValue([]) })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------
  // Snapshot endpoint contract — fields the GPU realtime dashboard depends on
  // -------------------------------------------------------------------------

  describe('GET /realtime/exams/snapshot', () => {
    it('returns a snapshot with the documented top-level fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('slots');
      expect(res.body).toHaveProperty('sweep_progress');
      expect(res.body).toHaveProperty('operator_race_alerts');
      expect(Array.isArray(res.body.slots)).toBe(true);
    });

    it('every slot includes metrics_status and last_metric_timestamp (never blank)', async () => {
      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      for (const slot of res.body.slots) {
        for (const field of REQUIRED_SLOT_FIELDS) {
          expect(slot).toHaveProperty(field);
        }
        // metrics_status must always be one of the documented enum values —
        // never undefined, never blank.
        expect(['available', 'unavailable', 'pending']).toContain(
          slot.metrics_status,
        );
      }
    });

    it('idle slots explicitly mark metrics as unavailable rather than leaving them blank', async () => {
      const res = await request(app.getHttpServer())
        .get('/realtime/exams/snapshot')
        .expect(200);

      const idle = res.body.slots.filter(
        (s: { status: string }) => s.status === 'idle',
      );
      for (const slot of idle) {
        expect(slot.metrics_status).toBe('unavailable');
        expect(slot.last_known_metric.tps).toBeNull();
        expect(slot.last_known_metric.tt100t_seconds).toBeNull();
        expect(slot.last_metric_timestamp).toBeNull();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Health endpoint
  // -------------------------------------------------------------------------

  describe('GET /realtime/exams/health', () => {
    it('returns ok status with subscriber count', async () => {
      const res = await request(app.getHttpServer())
        .get('/realtime/exams/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(typeof res.body.subscribers).toBe('number');
      expect(res.body).toHaveProperty('timestamp');
    });
  });
});
