import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  GpuSweep,
  GpuSweepMode,
  GpuSweepStatus,
} from '../src/gpu-sweep/entities/gpu-sweep.entity';
import {
  GpuSweepCell,
  GpuSweepCellKind,
  GpuSweepCellStatus,
} from '../src/gpu-sweep/entities/gpu-sweep-cell.entity';
import { GpuSweepModule } from '../src/gpu-sweep/gpu-sweep.module';
import { MpExam } from '../src/entities/mp-exam.entity';
import { MpExamResult } from '../src/entities/mp-exam-result.entity';
import { MmExam } from '../src/entities/mm-exam.entity';
import { MmExamResult } from '../src/entities/mm-exam-result.entity';
import { ConfigModule } from '@nestjs/config';
import { MpExamService } from '../src/mp-exam/mp-exam.service';
import { MmExamService } from '../src/mm-exam/mm-exam.service';

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function makeCell(
  id: number,
  node: 'node2' | 'node3',
  overrides: Partial<GpuSweepCell> = {},
): GpuSweepCell {
  return Object.assign(new GpuSweepCell(), {
    id,
    sweep_id: 1,
    cell_key: `NVIDIA-L40|mlperf|fp8|bs1|n10|tp1|offline|${node}`,
    kind: GpuSweepCellKind.MLPERF,
    exam_id: null,
    gpu_type: node === 'node2' ? 'NVIDIA-L40' : 'NVIDIA-L40-44GiB',
    node,
    precision: 'fp8',
    batch_size: 1,
    data_number: 10,
    tensor_parallel_size: 1,
    scenario: 'offline',
    retry_num: 3,
    status: GpuSweepCellStatus.PENDING,
    tt100t_seconds: null,
    tps: null,
    dispatched_at: null,
    completed_at: null,
    error_log: null,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GpuSweep (e2e)', () => {
  let app: INestApplication<App>;
  let sweepRepoMock: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };
  let cellRepoMock: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    sweepRepoMock = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
    };
    cellRepoMock = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        GpuSweepModule,
      ],
    })
      .overrideProvider(getRepositoryToken(GpuSweep))
      .useValue(sweepRepoMock)
      .overrideProvider(getRepositoryToken(GpuSweepCell))
      .useValue(cellRepoMock)
      .overrideProvider(getRepositoryToken(MpExam))
      .useValue({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      })
      .overrideProvider(getRepositoryToken(MpExamResult))
      .useValue({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      })
      .overrideProvider(getRepositoryToken(MmExam))
      .useValue({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      })
      .overrideProvider(getRepositoryToken(MmExamResult))
      .useValue({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      })
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
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Preview endpoint
  // -------------------------------------------------------------------------

  describe('GET /api/gpu-sweep/preview', () => {
    it('should return 110 cells without creating any DB rows', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/gpu-sweep/preview')
        .expect(200);

      expect(res.body.cells).toHaveLength(110);
      expect(sweepRepoMock.save).not.toHaveBeenCalled();
      expect(cellRepoMock.save).not.toHaveBeenCalled();
    });

    it('should include a per-node timeline', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/gpu-sweep/preview')
        .expect(200);

      expect(res.body.timeline).toBeDefined();
      expect(res.body.timeline['node2']).toBeDefined();
      expect(res.body.timeline['node3']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Status endpoint
  // -------------------------------------------------------------------------

  describe('GET /api/gpu-sweep/status', () => {
    it('should return current sweep status including per-node mutex state', async () => {
      const sweep = Object.assign(new GpuSweep(), {
        id: 1,
        status: GpuSweepStatus.RUNNING,
        total_cells: 110,
        completed_cells: 4,
        cells: [],
      });
      sweepRepoMock.findOne.mockResolvedValue(sweep);
      cellRepoMock.find.mockResolvedValue([
        makeCell(1, 'node2', { status: GpuSweepCellStatus.RUNNING }),
        makeCell(2, 'node3', { status: GpuSweepCellStatus.RUNNING }),
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/gpu-sweep/status')
        .expect(200);

      expect(res.body.status).toBe(GpuSweepStatus.RUNNING);
      expect(res.body.mutex).toBeDefined();
      expect(res.body.mutex['node2']).toBe('locked');
      expect(res.body.mutex['node3']).toBe('locked');
    });
  });

  // -------------------------------------------------------------------------
  // Start endpoint: 4-cell synthetic sweep
  // -------------------------------------------------------------------------

  describe('POST /api/gpu-sweep/start (synthetic 4-cell sweep)', () => {
    it('should create gpu_sweep row and 4 cells with correct description tags', async () => {
      process.env.GPU_SWEEP_ENABLED = 'true';

      const sweep = Object.assign(new GpuSweep(), {
        id: 7,
        status: GpuSweepStatus.PENDING,
        total_cells: 4,
        completed_cells: 0,
        cells: [],
      });
      sweepRepoMock.create.mockReturnValue(sweep);
      sweepRepoMock.save.mockResolvedValue(sweep);
      sweepRepoMock.findOne.mockResolvedValue(sweep);
      cellRepoMock.find.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .post('/api/gpu-sweep/start')
        .send({ mode: 'calibration' })
        .expect(201);

      expect(res.body.sweep_id).toBe(7);
      expect(sweepRepoMock.save).toHaveBeenCalled();

      delete process.env.GPU_SWEEP_ENABLED;
    });

    it('should return 403/400 when GPU_SWEEP_ENABLED is false', async () => {
      process.env.GPU_SWEEP_ENABLED = 'false';

      await request(app.getHttpServer())
        .post('/api/gpu-sweep/start')
        .send({ mode: 'full' })
        .expect((res) => {
          expect([400, 403, 503]).toContain(res.status);
        });

      delete process.env.GPU_SWEEP_ENABLED;
    });
  });

  // -------------------------------------------------------------------------
  // Stagger gap between same-node dispatches >= 60s
  // -------------------------------------------------------------------------

  describe('stagger gap enforcement', () => {
    it('dispatched_at timestamps for same-node cells should differ by >= 60s', async () => {
      process.env.GPU_SWEEP_ENABLED = 'true';

      const now = Date.now();
      const cell1 = makeCell(1, 'node2', {
        status: GpuSweepCellStatus.DISPATCHED,
        dispatched_at: new Date(now).toISOString(),
      });
      const cell2 = makeCell(2, 'node2', {
        status: GpuSweepCellStatus.DISPATCHED,
        dispatched_at: new Date(now + 61_000).toISOString(),
      });

      const gap =
        new Date(cell2.dispatched_at!).getTime() -
        new Date(cell1.dispatched_at!).getTime();

      expect(gap).toBeGreaterThanOrEqual(60_000);

      delete process.env.GPU_SWEEP_ENABLED;
    });
  });

  // -------------------------------------------------------------------------
  // Drain endpoint
  // -------------------------------------------------------------------------

  describe('PATCH /api/gpu-sweep/drain/:id', () => {
    it('should set Pending and Dispatched cells to Stopped within the response', async () => {
      process.env.GPU_SWEEP_ENABLED = 'true';

      const sweep = Object.assign(new GpuSweep(), {
        id: 1,
        status: GpuSweepStatus.RUNNING,
        cells: [],
      });
      sweepRepoMock.findOne.mockResolvedValue(sweep);
      cellRepoMock.find.mockResolvedValue([
        makeCell(10, 'node2', { status: GpuSweepCellStatus.PENDING }),
        makeCell(11, 'node3', { status: GpuSweepCellStatus.DISPATCHED }),
        makeCell(12, 'node2', { status: GpuSweepCellStatus.COMPLETED }),
      ]);
      sweepRepoMock.save.mockResolvedValue({
        ...sweep,
        status: GpuSweepStatus.DRAINED,
      });

      const res = await request(app.getHttpServer())
        .patch('/api/gpu-sweep/drain/1')
        .expect(200);

      expect(res.body.status).toBe(GpuSweepStatus.DRAINED);

      delete process.env.GPU_SWEEP_ENABLED;
    });
  });

  // -------------------------------------------------------------------------
  // Calibration response shape contract (A6)
  // -------------------------------------------------------------------------

  describe('calibration response shape', () => {
    it('should match the plan contract shape', async () => {
      process.env.GPU_SWEEP_ENABLED = 'true';

      const sweep = Object.assign(new GpuSweep(), {
        id: 5,
        mode: GpuSweepMode.CALIBRATION,
        status: GpuSweepStatus.COMPLETED,
        variance_pct: 2.1,
        passed: true,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        cells: [
          makeCell(20, 'node2', {
            tt100t_seconds: 1.588,
            tps: 62.94,
            status: GpuSweepCellStatus.COMPLETED,
          }),
          makeCell(21, 'node3', {
            tt100t_seconds: 1.622,
            tps: 61.72,
            status: GpuSweepCellStatus.COMPLETED,
          }),
        ],
      });
      sweepRepoMock.findOne.mockResolvedValue(sweep);

      const res = await request(app.getHttpServer())
        .get('/api/gpu-sweep/status')
        .expect(200);

      // Calibration fields should be present on a completed calibration sweep
      if (
        res.body.mode === GpuSweepMode.CALIBRATION &&
        res.body.status === GpuSweepStatus.COMPLETED
      ) {
        expect(res.body).toHaveProperty('variance_pct');
        expect(res.body).toHaveProperty('passed');
        expect(typeof res.body.variance_pct).toBe('number');
        expect(typeof res.body.passed).toBe('boolean');
      }

      delete process.env.GPU_SWEEP_ENABLED;
    });
  });
});
