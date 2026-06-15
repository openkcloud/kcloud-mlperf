import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import { GpuSweepService } from './gpu-sweep.service';
import {
  GpuSweep,
  GpuSweepMode,
  GpuSweepStatus,
} from './entities/gpu-sweep.entity';
import {
  GpuSweepCell,
  GpuSweepCellKind,
  GpuSweepCellStatus,
} from './entities/gpu-sweep-cell.entity';
import { MpExamService } from '../mp-exam/mp-exam.service';
import { MmExamService } from '../mm-exam/mm-exam.service';
import { NpuEvalService } from '../npu-eval/npu-eval.service';
import { FIXTURE_CELL_COUNT } from './matrix.fixture';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockSweepRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  increment: jest.fn(),
});

const mockCellRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
});

const mockMpExamService = () => ({
  create: jest.fn().mockResolvedValue({ id: 100 }),
  stopMpExam: jest.fn().mockResolvedValue({}),
});

const mockMmExamService = () => ({
  create: jest.fn().mockResolvedValue({ id: 200 }),
  stopMmExam: jest.fn().mockResolvedValue({}),
});

const mockNpuEvalService = () => ({
  create: jest.fn().mockResolvedValue({ id: 300 }),
  stopNpuExam: jest.fn().mockResolvedValue({}),
});

// ---------------------------------------------------------------------------

describe('GpuSweepService', () => {
  let service: GpuSweepService;
  let sweepRepo: ReturnType<typeof mockSweepRepo>;
  let cellRepo: ReturnType<typeof mockCellRepo>;
  let mpExamService: ReturnType<typeof mockMpExamService>;
  let mmExamService: ReturnType<typeof mockMmExamService>;
  let npuEvalService: ReturnType<typeof mockNpuEvalService>;
  let configService: { get: jest.Mock };

  function buildModule(enabled: boolean, staggerSeconds = 60) {
    sweepRepo = mockSweepRepo();
    cellRepo = mockCellRepo();
    mpExamService = mockMpExamService();
    mmExamService = mockMmExamService();
    npuEvalService = mockNpuEvalService();
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'GPU_SWEEP_ENABLED') return enabled ? 'true' : 'false';
        if (key === 'GPU_SWEEP_MIN_STAGGER_SECONDS')
          return String(staggerSeconds);
        return undefined;
      }),
    };

    return Test.createTestingModule({
      providers: [
        GpuSweepService,
        { provide: getRepositoryToken(GpuSweep), useValue: sweepRepo },
        { provide: getRepositoryToken(GpuSweepCell), useValue: cellRepo },
        { provide: MpExamService, useValue: mpExamService },
        { provide: MmExamService, useValue: mmExamService },
        { provide: NpuEvalService, useValue: npuEvalService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
  }

  // -------------------------------------------------------------------------
  // Feature flag
  // -------------------------------------------------------------------------

  describe('isEnabled()', () => {
    it('returns false when GPU_SWEEP_ENABLED is not "true"', async () => {
      const module = await buildModule(false);
      service = module.get<GpuSweepService>(GpuSweepService);
      expect(service.isEnabled()).toBe(false);
    });

    it('returns true when GPU_SWEEP_ENABLED is "true"', async () => {
      const module = await buildModule(true);
      service = module.get<GpuSweepService>(GpuSweepService);
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('startSweep() when disabled', () => {
    it('throws ServiceUnavailableException', async () => {
      const module = await buildModule(false);
      service = module.get<GpuSweepService>(GpuSweepService);
      await expect(
        service.startSweep({ mode: GpuSweepMode.FULL }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // -------------------------------------------------------------------------
  // preview() — never touches the DB
  // -------------------------------------------------------------------------

  describe('preview()', () => {
    beforeEach(async () => {
      const module = await buildModule(false); // enabled doesn't matter for preview
      service = module.get<GpuSweepService>(GpuSweepService);
    });

    it(`returns ${FIXTURE_CELL_COUNT} cells`, () => {
      const result = service.preview();
      expect(result.total_cells).toBe(FIXTURE_CELL_COUNT);
      expect(result.cells).toHaveLength(FIXTURE_CELL_COUNT);
    });

    it('includes timeline with node2 and node3 entries', () => {
      const result = service.preview();
      expect(result.timeline.node2.length).toBeGreaterThan(0);
      expect(result.timeline.node3.length).toBeGreaterThan(0);
    });

    it('does NOT write to the database', () => {
      service.preview();
      expect(sweepRepo.save).not.toHaveBeenCalled();
      expect(cellRepo.save).not.toHaveBeenCalled();
    });

    it('includes dedup_keys_excluded array with 20 entries', () => {
      const result = service.preview();
      expect(result.dedup_keys_excluded).toHaveLength(20);
    });
  });

  // -------------------------------------------------------------------------
  // Per-node mutex via _testCanDispatchOn / _testReleaseNode
  // -------------------------------------------------------------------------

  describe('per-node mutex', () => {
    beforeEach(async () => {
      const module = await buildModule(true, 60);
      service = module.get<GpuSweepService>(GpuSweepService);
    });

    it('node is free initially', () => {
      expect(service._testCanDispatchOn('node2')).toBe(true);
      expect(service._testCanDispatchOn('node3')).toBe(true);
    });

    it('busy node blocks dispatch on the same node', () => {
      // Simulate node2 busy
      service._testGetMutex().node2.busy = true;
      expect(service._testCanDispatchOn('node2')).toBe(false);
      expect(service._testCanDispatchOn('node3')).toBe(true);
    });

    it('releasing a busy node allows dispatch again', () => {
      service._testGetMutex().node2.busy = true;
      service._testReleaseNode('node2');
      expect(service._testCanDispatchOn('node2')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Stagger enforcement via _testSetLastDispatch / _testSetStaggerSeconds
  // -------------------------------------------------------------------------

  describe('stagger enforcement', () => {
    beforeEach(async () => {
      const module = await buildModule(true, 60);
      service = module.get<GpuSweepService>(GpuSweepService);
    });

    it('blocks dispatch when last_dispatch_at is < 60s ago', () => {
      service._testSetLastDispatch('node2', Date.now() - 30_000); // 30s ago
      expect(service._testCanDispatchOn('node2')).toBe(false);
    });

    it('allows dispatch when last_dispatch_at is >= 60s ago', () => {
      service._testSetLastDispatch('node2', Date.now() - 61_000); // 61s ago
      expect(service._testCanDispatchOn('node2')).toBe(true);
    });

    it('stagger does not affect the other node', () => {
      service._testSetLastDispatch('node2', Date.now() - 10_000);
      expect(service._testCanDispatchOn('node3')).toBe(true);
    });

    it('custom stagger seconds from config are respected', async () => {
      const module = await buildModule(true, 120);
      service = module.get<GpuSweepService>(GpuSweepService);
      service._testSetLastDispatch('node2', Date.now() - 61_000); // 61s ago, < 120s
      expect(service._testCanDispatchOn('node2')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // drain() — idempotent, stops inflight cells
  // -------------------------------------------------------------------------

  describe('drain()', () => {
    beforeEach(async () => {
      const module = await buildModule(true);
      service = module.get<GpuSweepService>(GpuSweepService);
    });

    it('marks Pending, Dispatched, and Running cells as Stopped', async () => {
      const sweep = Object.assign(new GpuSweep(), {
        id: 1,
        status: GpuSweepStatus.RUNNING,
      });
      sweepRepo.findOne.mockResolvedValue(sweep);

      const makeCell = (id: number, status: GpuSweepCellStatus) =>
        Object.assign(new GpuSweepCell(), {
          id,
          sweep_id: 1,
          kind: 'mlperf',
          exam_id: null,
          node: 'node2',
          status,
        });

      // drain() queries WHERE status IN (DISPATCHED, RUNNING, PENDING) —
      // the mock returns only those; COMPLETED is excluded by the WHERE clause.
      cellRepo.find.mockResolvedValue([
        makeCell(10, GpuSweepCellStatus.PENDING),
        makeCell(11, GpuSweepCellStatus.DISPATCHED),
        makeCell(12, GpuSweepCellStatus.RUNNING),
      ]);
      sweepRepo.findOne
        .mockResolvedValueOnce(sweep)
        .mockResolvedValue({ ...sweep, status: GpuSweepStatus.DRAINED });

      await service.drain(1);

      const stopCalls = cellRepo.update.mock.calls.filter(
        (args: [number, { status: GpuSweepCellStatus }]) =>
          args[1].status === GpuSweepCellStatus.STOPPED,
      );
      const stoppedIds = stopCalls.map((args: [number, unknown]) => args[0]);
      expect(stoppedIds).toContain(10);
      expect(stoppedIds).toContain(11);
      expect(stoppedIds).toContain(12);
    });

    it('is idempotent when sweep is already Drained', async () => {
      const sweep = Object.assign(new GpuSweep(), {
        id: 1,
        status: GpuSweepStatus.DRAINED,
      });
      sweepRepo.findOne.mockResolvedValue(sweep);
      cellRepo.find.mockResolvedValue([]);
      sweepRepo.findOne.mockResolvedValue({
        ...sweep,
        status: GpuSweepStatus.DRAINED,
      });

      await expect(service.drain(1)).resolves.not.toThrow();
    });

    it('resets node mutex after drain', async () => {
      const sweep = Object.assign(new GpuSweep(), {
        id: 1,
        status: GpuSweepStatus.RUNNING,
      });
      sweepRepo.findOne.mockResolvedValue(sweep);
      cellRepo.find.mockResolvedValue([]);
      sweepRepo.findOne.mockResolvedValue({
        ...sweep,
        status: GpuSweepStatus.DRAINED,
      });

      service._testGetMutex().node2.busy = true;
      service._testGetMutex().node2.current_cell_key = 'some-key';

      await service.drain(1);

      expect(service._testGetMutex().node2.busy).toBe(false);
      expect(service._testGetMutex().node2.current_cell_key).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getStatus() — node_state reflects in-memory mutex
  // -------------------------------------------------------------------------

  describe('getStatus()', () => {
    beforeEach(async () => {
      const module = await buildModule(true);
      service = module.get<GpuSweepService>(GpuSweepService);
    });

    it('returns enabled=true when flag is set', async () => {
      const status = await service.getStatus();
      expect(status.enabled).toBe(true);
    });

    it('returns active_sweep=null when no sweep has been started', async () => {
      const status = await service.getStatus();
      expect(status.active_sweep).toBeNull();
    });

    it('node_state reflects busy mutex', async () => {
      service._testGetMutex().node2.busy = true;
      service._testGetMutex().node2.current_cell_key = 'test-key';

      const status = await service.getStatus();
      expect(status.node_state.node2.busy).toBe(true);
      expect(status.node_state.node2.current_cell_key).toBe('test-key');
      expect(status.node_state.node3.busy).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // markCellComplete() — releases mutex, updates metrics
  // -------------------------------------------------------------------------

  describe('markCellComplete()', () => {
    beforeEach(async () => {
      const module = await buildModule(true);
      service = module.get<GpuSweepService>(GpuSweepService);
    });

    it('releases node mutex after completion', async () => {
      const cell = Object.assign(new GpuSweepCell(), {
        id: 5,
        sweep_id: 1,
        node: 'node2',
        status: GpuSweepCellStatus.RUNNING,
      });
      cellRepo.findOne
        .mockResolvedValueOnce(cell)
        .mockResolvedValue({ ...cell, status: GpuSweepCellStatus.COMPLETED });
      sweepRepo.increment = jest.fn().mockResolvedValue(undefined);
      service._testGetMutex().node2.busy = true;
      service._testGetMutex().node2.current_cell_key = 'some|key';

      await service.markCellComplete(5, { tt100t_seconds: 1.588, tps: 62.94 });

      expect(service._testGetMutex().node2.busy).toBe(false);
      expect(service._testGetMutex().node2.current_cell_key).toBeNull();
    });

    it('saves tt100t_seconds and tps in the update call', async () => {
      const cell = Object.assign(new GpuSweepCell(), {
        id: 5,
        sweep_id: 1,
        node: 'node2',
        status: GpuSweepCellStatus.RUNNING,
      });
      cellRepo.findOne
        .mockResolvedValueOnce(cell)
        .mockResolvedValue({ ...cell, status: GpuSweepCellStatus.COMPLETED });
      sweepRepo.increment = jest.fn().mockResolvedValue(undefined);

      await service.markCellComplete(5, { tt100t_seconds: 1.588, tps: 62.94 });

      const updateCall = cellRepo.update.mock.calls[0];
      expect(updateCall[1].tt100t_seconds).toBe(1.588);
      expect(updateCall[1].tps).toBe(62.94);
      expect(updateCall[1].status).toBe(GpuSweepCellStatus.COMPLETED);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchCell() — WS-E US-NEXT-2 vendor branch.
  // Asserts that node4 (Furiosa RNGD) and node5 (Rebellions Atom+) cells
  // route to NpuEvalService.create instead of silently creating GPU exams
  // via Mp/MmExamService. node2/node3 (NVIDIA) cells must keep the existing
  // GPU dispatch path — no regression.
  // -------------------------------------------------------------------------

  describe('dispatchCell() — vendor branch', () => {
    const sweep = Object.assign(new GpuSweep(), {
      id: 7,
      status: GpuSweepStatus.RUNNING,
    });

    function makeCell(
      overrides: Partial<GpuSweepCell> & {
        node: 'node2' | 'node3' | 'node4' | 'node5';
        kind: GpuSweepCellKind;
        gpu_type: string;
      },
    ): GpuSweepCell {
      return Object.assign(new GpuSweepCell(), {
        id: 99,
        sweep_id: 7,
        cell_key: 'test|cell|key',
        precision: 'fp8',
        batch_size: 1,
        data_number: 500,
        tensor_parallel_size: 1,
        scenario: 'offline',
        retry_num: 3,
        status: GpuSweepCellStatus.PENDING,
        ...overrides,
      });
    }

    beforeEach(async () => {
      const module = await buildModule(true);
      service = module.get<GpuSweepService>(GpuSweepService);
      // dispatchCell calls cellRepo.update on success
      cellRepo.update.mockResolvedValue({});
    });

    it('routes a node4 (vendor=furiosa) mlperf cell to NpuEvalService.create with npu_type=RNGD', async () => {
      const cell = makeCell({
        node: 'node4',
        kind: GpuSweepCellKind.MLPERF,
        gpu_type: 'RNGD',
      });

      // dispatchCell is private — access via bracket notation in test only.
      await (
        service as unknown as {
          dispatchCell: (s: GpuSweep, c: GpuSweepCell) => Promise<void>;
        }
      ).dispatchCell(sweep, cell);

      expect(npuEvalService.create).toHaveBeenCalledTimes(1);
      expect(mpExamService.create).not.toHaveBeenCalled();
      expect(mmExamService.create).not.toHaveBeenCalled();
      const dto = npuEvalService.create.mock.calls[0][0];
      expect(dto.npu_type).toBe('RNGD');
      expect(dto.benchmark).toBe('mlperf');
      expect(dto.framework).toBe('furiosa-llm');
      expect(dto.model).toBe('Llama-3.1-8B-Instruct');
      expect(dto.precision).toBe('fp8');
      // CRITICAL: NPU dispatch must NOT carry device_type='GPU'.
      expect((dto as Record<string, unknown>).device_type).toBeUndefined();
    });

    it('routes a node5 (vendor=rebellions) mmlu cell to NpuEvalService.create with npu_type=Atom+', async () => {
      const cell = makeCell({
        node: 'node5',
        kind: GpuSweepCellKind.MMLU,
        gpu_type: 'Atom+',
      });

      await (
        service as unknown as {
          dispatchCell: (s: GpuSweep, c: GpuSweepCell) => Promise<void>;
        }
      ).dispatchCell(sweep, cell);

      expect(npuEvalService.create).toHaveBeenCalledTimes(1);
      expect(mpExamService.create).not.toHaveBeenCalled();
      expect(mmExamService.create).not.toHaveBeenCalled();
      const dto = npuEvalService.create.mock.calls[0][0];
      expect(dto.npu_type).toBe('Atom+');
      expect(dto.benchmark).toBe('mmlu');
      expect(dto.framework).toBe('vllm-rbln');
      expect(dto.dataset).toBe('mmlu');
      expect((dto as Record<string, unknown>).device_type).toBeUndefined();
    });

    it('routes a node2 (vendor=nvidia) mlperf cell to MpExamService.create — no NPU regression', async () => {
      const cell = makeCell({
        node: 'node2',
        kind: GpuSweepCellKind.MLPERF,
        gpu_type: 'NVIDIA-L40',
      });

      await (
        service as unknown as {
          dispatchCell: (s: GpuSweep, c: GpuSweepCell) => Promise<void>;
        }
      ).dispatchCell(sweep, cell);

      expect(mpExamService.create).toHaveBeenCalledTimes(1);
      expect(npuEvalService.create).not.toHaveBeenCalled();
      const dto = mpExamService.create.mock.calls[0][0];
      expect(dto.device_type).toBe('GPU');
      expect(dto.gpu_type).toBe('NVIDIA-L40');
    });

    it('routes a node3 (vendor=nvidia) mmlu cell to MmExamService.create — no NPU regression', async () => {
      const cell = makeCell({
        node: 'node3',
        kind: GpuSweepCellKind.MMLU,
        gpu_type: 'NVIDIA-L40-44GiB',
      });

      await (
        service as unknown as {
          dispatchCell: (s: GpuSweep, c: GpuSweepCell) => Promise<void>;
        }
      ).dispatchCell(sweep, cell);

      expect(mmExamService.create).toHaveBeenCalledTimes(1);
      expect(npuEvalService.create).not.toHaveBeenCalled();
      const dto = mmExamService.create.mock.calls[0][0];
      expect(dto.device_type).toBe('GPU');
      expect(dto.gpu_type).toBe('NVIDIA-L40-44GiB');
    });
  });
});
