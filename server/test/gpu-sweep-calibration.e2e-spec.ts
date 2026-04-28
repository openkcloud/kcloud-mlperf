import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GpuSweep, GpuSweepMode, GpuSweepStatus } from '../src/gpu-sweep/entities/gpu-sweep.entity';
import { GpuSweepCell, GpuSweepCellKind, GpuSweepCellStatus } from '../src/gpu-sweep/entities/gpu-sweep-cell.entity';
import { GpuSweepModule } from '../src/gpu-sweep/gpu-sweep.module';

function makeCanonicalCell(id: number, node: 'node2' | 'node3'): GpuSweepCell {
  const gpuType = node === 'node2' ? 'NVIDIA-L40' : 'NVIDIA-L40-44GiB';
  return Object.assign(new GpuSweepCell(), {
    id,
    sweep_id: 1,
    cell_key: `${gpuType}|mlperf|fp8|bs1|n500|tp1|offline|${node}`,
    kind: GpuSweepCellKind.MLPERF,
    exam_id: null,
    gpu_type: gpuType,
    node,
    precision: 'fp8',
    batch_size: 1,
    data_number: 500,
    tensor_parallel_size: 1,
    scenario: 'offline',
    retry_num: 3,
    status: GpuSweepCellStatus.PENDING,
    tt100t_seconds: null,
    tps: null,
    dispatched_at: null,
    completed_at: null,
    error_log: null,
  });
}

describe('GpuSweep Calibration (e2e)', () => {
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
      imports: [GpuSweepModule],
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

  describe('POST /api/gpu-sweep/start (calibration mode)', () => {
    it('creates exactly 2 canonical cells — one per node', async () => {
      process.env.GPU_SWEEP_ENABLED = 'true';

      const savedSweep = Object.assign(new GpuSweep(), {
        id: 42,
        name: 'calibration-test',
        mode: GpuSweepMode.CALIBRATION,
        status: GpuSweepStatus.RUNNING,
        total_cells: 2,
        completed_cells: 0,
        started_at: new Date().toISOString(),
        matrix_config: {},
      });

      sweepRepoMock.create.mockReturnValue(savedSweep);
      sweepRepoMock.save.mockResolvedValue(savedSweep);

      const node2Cell = makeCanonicalCell(1, 'node2');
      const node3Cell = makeCanonicalCell(2, 'node3');
      cellRepoMock.create
        .mockReturnValueOnce(node2Cell)
        .mockReturnValueOnce(node3Cell);
      cellRepoMock.save.mockResolvedValue([node2Cell, node3Cell]);
      cellRepoMock.find.mockResolvedValue([node2Cell, node3Cell]);

      const res = await request(app.getHttpServer())
        .post('/api/gpu-sweep/start')
        .send({ mode: 'calibration' })
        .expect(201);

      expect(res.body.total_cells).toBe(2);
      expect(cellRepoMock.create).toHaveBeenCalledTimes(2);

      const calls = cellRepoMock.create.mock.calls;
      const nodes = calls.map((c: [Partial<GpuSweepCell>]) => c[0].node);
      expect(nodes).toContain('node2');
      expect(nodes).toContain('node3');
    });

    it('calibration cells use the canonical fp8/bs1/n500/tp1 spec', async () => {
      process.env.GPU_SWEEP_ENABLED = 'true';

      const savedSweep = Object.assign(new GpuSweep(), {
        id: 43,
        name: 'calibration-spec-check',
        mode: GpuSweepMode.CALIBRATION,
        status: GpuSweepStatus.RUNNING,
        total_cells: 2,
        completed_cells: 0,
        started_at: new Date().toISOString(),
        matrix_config: {},
      });

      sweepRepoMock.create.mockReturnValue(savedSweep);
      sweepRepoMock.save.mockResolvedValue(savedSweep);
      cellRepoMock.create.mockImplementation((dto: Partial<GpuSweepCell>) =>
        Object.assign(new GpuSweepCell(), dto),
      );
      cellRepoMock.save.mockResolvedValue([]);
      cellRepoMock.find.mockResolvedValue([]);

      await request(app.getHttpServer())
        .post('/api/gpu-sweep/start')
        .send({ mode: 'calibration' })
        .expect(201);

      const calls = cellRepoMock.create.mock.calls as [Partial<GpuSweepCell>][];
      for (const [dto] of calls) {
        expect(dto.precision).toBe('fp8');
        expect(dto.batch_size).toBe(1);
        expect(dto.data_number).toBe(500);
        expect(dto.tensor_parallel_size).toBe(1);
        expect(dto.kind).toBe(GpuSweepCellKind.MLPERF);
      }
    });
  });

  describe('GET /api/gpu-sweep/calibration', () => {
    it('returns 404 when no calibration sweep exists', async () => {
      sweepRepoMock.findOne.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get('/api/gpu-sweep/calibration')
        .expect(404);
    });

    it('returns calibration result with both node runs when sweep completed', async () => {
      const sweep = Object.assign(new GpuSweep(), {
        id: 1,
        mode: GpuSweepMode.CALIBRATION,
        status: GpuSweepStatus.COMPLETED,
        total_cells: 2,
        completed_cells: 2,
        started_at: new Date().toISOString(),
        matrix_config: {},
      });
      sweepRepoMock.findOne.mockResolvedValue(sweep);

      const node2Cell = Object.assign(makeCanonicalCell(1, 'node2'), {
        status: GpuSweepCellStatus.COMPLETED,
        exam_id: 200,
        tt100t_seconds: 1.588,
        tps: 62.94,
        dispatched_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      const node3Cell = Object.assign(makeCanonicalCell(2, 'node3'), {
        status: GpuSweepCellStatus.COMPLETED,
        exam_id: 201,
        tt100t_seconds: 1.602,
        tps: 62.42,
        dispatched_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      cellRepoMock.find.mockResolvedValue([node2Cell, node3Cell]);

      const res = await request(app.getHttpServer())
        .get('/api/gpu-sweep/calibration')
        .expect(200);

      expect(res.body.runs).toHaveLength(2);
      expect(res.body.runs.map((r: { node: string }) => r.node)).toContain('node2');
      expect(res.body.runs.map((r: { node: string }) => r.node)).toContain('node3');
      expect(res.body.passed).toBeDefined();
      expect(res.body.variance_pct).toBeDefined();
    });

    it('reports passed=false when node variance exceeds 5%', async () => {
      const sweep = Object.assign(new GpuSweep(), {
        id: 2,
        mode: GpuSweepMode.CALIBRATION,
        status: GpuSweepStatus.COMPLETED,
        total_cells: 2,
        completed_cells: 2,
        started_at: new Date().toISOString(),
        matrix_config: {},
      });
      sweepRepoMock.findOne.mockResolvedValue(sweep);

      const node2Cell = Object.assign(makeCanonicalCell(3, 'node2'), {
        status: GpuSweepCellStatus.COMPLETED,
        exam_id: 202,
        tt100t_seconds: 1.0,
        tps: 100.0,
        dispatched_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      const node3Cell = Object.assign(makeCanonicalCell(4, 'node3'), {
        status: GpuSweepCellStatus.COMPLETED,
        exam_id: 203,
        tt100t_seconds: 1.2,
        tps: 83.33,
        dispatched_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      cellRepoMock.find.mockResolvedValue([node2Cell, node3Cell]);

      const res = await request(app.getHttpServer())
        .get('/api/gpu-sweep/calibration')
        .expect(200);

      expect(res.body.passed).toBe(false);
      expect(res.body.variance_pct).toBeGreaterThan(5);
    });
  });

  describe('GET /api/gpu-sweep/status (quiet window)', () => {
    it('reports paused=false and reason=null by default', async () => {
      sweepRepoMock.findOne.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/api/gpu-sweep/status')
        .expect(200);

      expect(res.body.paused).toBe(false);
      expect(res.body.reason).toBeNull();
    });
  });
});
