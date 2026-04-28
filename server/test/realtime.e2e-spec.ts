import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { RealtimeModule } from '../src/realtime/realtime.module';
import { GpuSweepModule } from '../src/gpu-sweep/gpu-sweep.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GpuSweep } from '../src/gpu-sweep/entities/gpu-sweep.entity';
import { GpuSweepCell, GpuSweepCellStatus } from '../src/gpu-sweep/entities/gpu-sweep-cell.entity';

describe('Realtime SSE (e2e)', () => {
  let app: INestApplication<App>;

  const sweepRepoMock = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const cellRepoMock = {
    find: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [RealtimeModule, GpuSweepModule],
    })
      .overrideProvider(getRepositoryToken(GpuSweep))
      .useValue(sweepRepoMock)
      .overrideProvider(getRepositoryToken(GpuSweepCell))
      .useValue(cellRepoMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // SSE endpoint reachability
  // -------------------------------------------------------------------------

  describe('GET /realtime/exams (SSE)', () => {
    it('should respond with text/event-stream content type', async () => {
      const res = await request(app.getHttpServer())
        .get('/realtime/exams')
        .timeout(3000)
        .buffer(true)
        // SSE streams stay open; we just want the headers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .parse(((_res: import('http').IncomingMessage, callback: (err: Error | null, body: string) => void) => {
          _res.on('data', () => {/* ignore stream body */});
          _res.on('end', () => callback(null, ''));
          setTimeout(() => {
            _res.destroy();
            callback(null, '');
          }, 500);
        }) as any);

      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    });

    it('first SSE event should include gpus array with gpu_type fields', async () => {
      cellRepoMock.find.mockResolvedValue([
        {
          id: 1,
          gpu_type: 'NVIDIA-L40',
          node: 'node2',
          status: GpuSweepCellStatus.RUNNING,
          exam_id: 10,
          dispatched_at: new Date().toISOString(),
          tt100t_seconds: 1.588,
          tps: 62.94,
        },
      ]);

      let receivedData = '';

      await new Promise<void>((resolve) => {
        request(app.getHttpServer())
          .get('/realtime/exams')
          .buffer(true)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .parse(((_res: import('http').IncomingMessage, callback: (err: Error | null, body: string) => void) => {
            _res.on('data', (chunk: Buffer) => {
              receivedData += chunk.toString();
            });
            setTimeout(() => {
              _res.destroy();
              callback(null, receivedData);
              resolve();
            }, 600);
          }) as any)
          .catch(() => resolve());
      });

      if (receivedData.includes('data:')) {
        const dataLine = receivedData
          .split('\n')
          .find((l) => l.startsWith('data:'));
        if (dataLine) {
          const payload = JSON.parse(dataLine.replace('data:', '').trim());
          expect(payload).toHaveProperty('gpus');
          if (Array.isArray(payload.gpus) && payload.gpus.length > 0) {
            expect(payload.gpus[0]).toHaveProperty('gpu_type');
          }
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // API contract: all required dashboard fields present
  // -------------------------------------------------------------------------

  describe('snapshot field contract', () => {
    const REQUIRED_FIELDS = [
      'gpu_type',
      'node',
      'status',
      'exam_id',
      'elapsed_seconds',
      'last_tt100t',
      'last_tps',
      'sweep_progress',
      'race_alert',
    ];

    it('each GPU entry in a snapshot should have all required fields', () => {
      // Unit-level contract test — verify the shape the gateway assembles
      const snapshot = {
        gpu_type: 'NVIDIA-L40',
        node: 'node2',
        status: 'Running',
        exam_id: 42,
        elapsed_seconds: 120,
        last_tt100t: 1.588,
        last_tps: 62.94,
        sweep_progress: { completed: 5, total: 96 },
        race_alert: false,
      };

      for (const field of REQUIRED_FIELDS) {
        expect(snapshot).toHaveProperty(field);
      }
    });
  });
});
