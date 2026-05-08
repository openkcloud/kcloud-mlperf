import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ComparisonModule } from '../src/comparison/comparison.module';
import { MpExam } from '../src/entities/mp-exam.entity';
import { MpExamResult } from '../src/entities/mp-exam-result.entity';
import { MmExam } from '../src/entities/mm-exam.entity';
import { MmExamResult } from '../src/entities/mm-exam-result.entity';
import { NpuExam } from '../src/entities/npu-exam.entity';
import { NpuExamResult } from '../src/entities/npu-exam-result.entity';
import { StatusEnum } from '../src/enums/status.enum';

// ----------------------------------------------------------------------
// Test fixtures — covers GPU L40, GPU A40, NPU RNGD (furiosa), NPU Atom+
// (rebellions) across empty/partial/failed/running/completed states.
// ----------------------------------------------------------------------

function makeMpExam(overrides: Partial<MpExam> = {}): MpExam {
  return {
    id: 1,
    name: 'mlperf-l40',
    description: '',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    precision: 'FP16',
    mode: 'Performance',
    framework: 'pytorch',
    batch_size: 1,
    min_duration: 1,
    dataset: 'cnn-dailymail',
    data_number: 100,
    scenario: 'Offline',
    target_qps: 1,
    num_workers: 1,
    tensor_parallel_size: 1,
    status: StatusEnum.COMPLETED,
    device_type: 'GPU',
    gpu_type: 'NVIDIA-L40',
    gpu_num: 1,
    cpu_core: 8,
    ram_capacity: 32,
    retry_num: 1,
    error_log: '',
    started_at: '2026-04-28T10:00:00+09:00',
    end_at: '2026-04-28T10:30:00+09:00',
    created_at: new Date(),
    modified_at: new Date(),
    results: [],
    ...overrides,
  } as MpExam;
}

function makeMmExam(overrides: Partial<MmExam> = {}): MmExam {
  return {
    id: 100,
    name: 'mmlu-a40',
    description: '',
    n_train: 0,
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    precision: 'FP16',
    framework: 'vllm',
    subject: 'all',
    dataset: 'mmlu-pro',
    data_number: 100,
    batch_size: 1,
    gpu_util: 0.9,
    device_type: 'GPU',
    gpu_type: 'NVIDIA-A40',
    gpu_num: 1,
    cpu_core: 8,
    ram_capacity: 32,
    retry_num: 1,
    status: StatusEnum.COMPLETED,
    error_log: '',
    started_at: '2026-04-28T11:00:00+09:00',
    end_at: '2026-04-28T11:45:00+09:00',
    created_at: new Date(),
    modified_at: new Date(),
    results: [],
    ...overrides,
  } as MmExam;
}

function makeNpuExam(overrides: Partial<NpuExam> = {}): NpuExam {
  return {
    id: 200,
    name: 'npu-rngd',
    description: '',
    benchmark: 'mlperf',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    precision: 'FP8',
    framework: 'furiosa-llm',
    batch_size: 1,
    dataset: 'cnn-dailymail',
    data_number: 100,
    npu_type: 'RNGD',
    npu_num: 1,
    cpu_core: 8,
    ram_capacity: 32,
    retry_num: 1,
    max_output_tokens: 4096,
    status: StatusEnum.COMPLETED,
    error_log: '',
    started_at: '2026-04-28T12:00:00+09:00',
    end_at: '2026-04-28T12:30:00+09:00',
    created_at: new Date(),
    modified_at: new Date(),
    results: [],
    ...overrides,
  } as NpuExam;
}

// Builds a chainable mock that supports: find, findOne with relations option.
function buildRepoMock<T>(rows: T[]) {
  return {
    _rows: rows,
    find: jest.fn().mockImplementation((opts?: { where?: Partial<T> }) => {
      if (!opts || !opts.where) return Promise.resolve(rows);
      const where = opts.where;
      const filtered = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          // TypeORM In() expression — naive support
          if (
            v &&
            typeof v === 'object' &&
            (v as { _type?: string })._type === 'in'
          ) {
            const arr = (v as { _value: unknown[] })._value;
            return arr.includes((r as Record<string, unknown>)[k]);
          }
          return (r as Record<string, unknown>)[k] === v;
        }),
      );
      return Promise.resolve(filtered);
    }),
    findOne: jest.fn().mockImplementation((opts: { where: Partial<T> }) => {
      const where = opts.where;
      const found = rows.find((r) =>
        Object.entries(where).every(
          ([k, v]) => (r as Record<string, unknown>)[k] === v,
        ),
      );
      return Promise.resolve(found || null);
    }),
  };
}

// ----------------------------------------------------------------------

describe('ComparisonController (e2e)', () => {
  let app: INestApplication<App>;
  let mpRepo: ReturnType<typeof buildRepoMock<MpExam>>;
  let mmRepo: ReturnType<typeof buildRepoMock<MmExam>>;
  let npuRepo: ReturnType<typeof buildRepoMock<NpuExam>>;

  // Default fixture: 1 mp (L40, completed), 1 mm (A40, completed),
  // 1 npu RNGD running, 1 npu Atom+ failed.
  function bootstrapWith(opts?: {
    mp?: MpExam[];
    mm?: MmExam[];
    npu?: NpuExam[];
  }) {
    const defaultMp: MpExam[] = opts?.mp ?? [
      makeMpExam({
        id: 1,
        gpu_type: 'NVIDIA-L40',
        results: [
          {
            id: 10,
            exam_id: 1,
            result_number: 1,
            result_perf_tps: 62.94,
            result_perf_sps: 1.4,
            result_tt100t: 1588,
          } as MpExamResult,
        ],
      }),
    ];
    const defaultMm: MmExam[] = opts?.mm ?? [
      makeMmExam({
        id: 100,
        gpu_type: 'NVIDIA-A40',
        results: [
          {
            id: 200,
            exam_id: 100,
            result_number: 1,
            result_acc_total: 64.5,
          } as MmExamResult,
        ],
      }),
    ];
    const defaultNpu: NpuExam[] = opts?.npu ?? [
      makeNpuExam({
        id: 200,
        npu_type: 'RNGD',
        status: StatusEnum.RUNNING,
        end_at: '',
        results: [
          {
            id: 300,
            exam_id: 200,
            result_number: 1,
            result_tt100t: 0.92,
            result_tps: 87.1,
            result_sps: 2.3,
            result_accuracy: 0,
          } as NpuExamResult,
        ],
      }),
      makeNpuExam({
        id: 201,
        name: 'npu-atom',
        npu_type: 'Atom+',
        status: StatusEnum.ERROR,
        error_log: 'inference server unreachable',
        results: [],
      }),
    ];

    return { mp: defaultMp, mm: defaultMm, npu: defaultNpu };
  }

  async function bootApp(fixtures: {
    mp: MpExam[];
    mm: MmExam[];
    npu: NpuExam[];
  }) {
    mpRepo = buildRepoMock<MpExam>(fixtures.mp);
    mmRepo = buildRepoMock<MmExam>(fixtures.mm);
    npuRepo = buildRepoMock<NpuExam>(fixtures.npu);
    const mpResultRepo = buildRepoMock<MpExamResult>([]);
    const mmResultRepo = buildRepoMock<MmExamResult>([]);
    const npuResultRepo = buildRepoMock<NpuExamResult>([]);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ComparisonModule],
    })
      .overrideProvider(getRepositoryToken(MpExam))
      .useValue(mpRepo)
      .overrideProvider(getRepositoryToken(MpExamResult))
      .useValue(mpResultRepo)
      .overrideProvider(getRepositoryToken(MmExam))
      .useValue(mmRepo)
      .overrideProvider(getRepositoryToken(MmExamResult))
      .useValue(mmResultRepo)
      .overrideProvider(getRepositoryToken(NpuExam))
      .useValue(npuRepo)
      .overrideProvider(getRepositoryToken(NpuExamResult))
      .useValue(npuResultRepo)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------------
  // /api/comparison/list — completed state
  // -------------------------------------------------------------------

  describe('GET /api/comparison/list', () => {
    it('returns normalized rows across all benchmarks and hardware', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(false);
      expect(body.total).toBe(4);
      expect(Array.isArray(body.runs)).toBe(true);

      // L40 row
      const l40 = body.runs.find(
        (r: { hardware: { model: string } }) =>
          r.hardware.model === 'NVIDIA-L40',
      );
      expect(l40).toBeDefined();
      expect(l40.hardware.type).toBe('gpu');
      expect(l40.hardware.vendor).toBe('nvidia');
      expect(l40.hardware.canonical).toBe('L40');
      expect(l40.benchmark).toBe('mlperf');
      expect(l40.metrics.tt100t_seconds).toBe(1.588);
      expect(l40.metrics.tps).toBe(62.94);
      expect(Array.isArray(l40.artifacts)).toBe(true);
      expect(l40.artifacts.length).toBeGreaterThan(0);
      expect(typeof l40.config_fingerprint).toBe('string');
      expect(l40.config_fingerprint.length).toBe(64);
      expect(typeof l40.drift_flag).toBe('boolean');
      expect(l40.failure_reason).toBeNull();
      expect(typeof l40.elapsed_seconds).toBe('number');

      // A40 row
      const a40 = body.runs.find(
        (r: { hardware: { model: string } }) =>
          r.hardware.model === 'NVIDIA-A40',
      );
      expect(a40).toBeDefined();
      expect(a40.benchmark).toBe('mmlu');
      expect(a40.metrics.accuracy_pct).toBe(64.5);
      expect(a40.hardware.canonical).toBe('A40');

      // RNGD (furiosa)
      const rngd = body.runs.find(
        (r: { hardware: { model: string } }) => r.hardware.model === 'RNGD',
      );
      expect(rngd).toBeDefined();
      expect(rngd.hardware.type).toBe('npu');
      expect(rngd.hardware.vendor).toBe('furiosa');
      expect(rngd.hardware.canonical).toBe('RNGD');
      expect(rngd.status).toBe(StatusEnum.RUNNING);

      // Atom+ (rebellions)
      const atom = body.runs.find(
        (r: { hardware: { model: string } }) => r.hardware.model === 'Atom+',
      );
      expect(atom).toBeDefined();
      expect(atom.hardware.type).toBe('npu');
      expect(atom.hardware.vendor).toBe('rebellions');
      expect(atom.hardware.canonical).toBe('Atom+');
      expect(atom.status).toBe(StatusEnum.ERROR);
      expect(atom.failure_reason).toBe('inference server unreachable');
    });

    // ---------- empty state ----------
    it('returns diagnostic envelope with reason="no_runs_exist" when DB has no rows', async () => {
      await bootApp({ mp: [], mm: [], npu: [] });

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(true);
      expect(body.reason).toBe('no_runs_exist');
      expect(body.total_runs).toBe(0);
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
    });

    // ---------- partial / filtered state ----------
    it('returns reason="all_runs_filtered" when filters exclude all rows', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list?hardware=npu&node=node-does-not-exist')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(true);
      expect(body.reason).toBe('all_runs_filtered');
      expect(body.total_runs).toBeGreaterThan(0);
      expect(body.filtered_runs).toBe(0);
      expect(body.filters_applied.hardware).toBe('npu');
      expect(body.filters_applied.node).toBe('node-does-not-exist');
    });

    it('filters by benchmark=mlperf', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list?benchmark=mlperf')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(false);
      // L40 mp + RNGD npu (mlperf benchmark) = 2
      const benchmarks = body.runs.map(
        (r: { benchmark: string }) => r.benchmark,
      );
      expect(benchmarks.every((b: string) => b === 'mlperf')).toBe(true);
    });

    it('filters by hardware=gpu', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list?hardware=gpu')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(false);
      const types = body.runs.map(
        (r: { hardware: { type: string } }) => r.hardware.type,
      );
      expect(types.every((t: string) => t === 'gpu')).toBe(true);
    });

    it('filters by hardware=npu', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list?hardware=npu')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(false);
      const types = body.runs.map(
        (r: { hardware: { type: string } }) => r.hardware.type,
      );
      expect(types.every((t: string) => t === 'npu')).toBe(true);
    });

    it('rejects invalid benchmark filter with 400', async () => {
      await bootApp(bootstrapWith());

      await request(app.getHttpServer())
        .get('/api/comparison/list?benchmark=bogus')
        .expect(400);
    });

    it('rejects invalid hardware filter with 400', async () => {
      await bootApp(bootstrapWith());

      await request(app.getHttpServer())
        .get('/api/comparison/list?hardware=quantum')
        .expect(400);
    });

    // ---------- ingestion-failed state ----------
    it('returns reason="ingestion_failed" when DB read throws', async () => {
      await bootApp({ mp: [], mm: [], npu: [] });
      // Force a thrown error from one of the repo finds.
      mpRepo.find.mockRejectedValueOnce(new Error('db connection lost'));

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(true);
      expect(body.reason).toBe('ingestion_failed');
      expect(body.message).toContain('db connection lost');
    });
  });

  // -------------------------------------------------------------------
  // /api/comparison/:benchmark/:idA/:idB — pair comparison
  // -------------------------------------------------------------------

  describe('GET /api/comparison/:benchmark/:idA/:idB', () => {
    it('returns pair with delta when both runs exist (mlperf, GPU vs NPU)', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/mlperf/1/200')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.benchmark).toBe('mlperf');
      expect(body.a.id).toBe(1);
      expect(body.a.hardware.type).toBe('gpu');
      expect(body.b.id).toBe(200);
      expect(body.b.hardware.type).toBe('npu');
      expect(body.delta).toBeDefined();
      // 1.588 - 0.92 = 0.668
      expect(body.delta.tt100t_seconds).toBeCloseTo(0.668, 2);
      // 62.94 - 87.1 = -24.16
      expect(body.delta.tps).toBeCloseTo(-24.16, 2);
    });

    it('404s when one of the ids does not exist', async () => {
      await bootApp(bootstrapWith());

      await request(app.getHttpServer())
        .get('/api/comparison/mlperf/1/9999')
        .expect(404);
    });

    it('rejects invalid benchmark with 400', async () => {
      await bootApp(bootstrapWith());

      await request(app.getHttpServer())
        .get('/api/comparison/bogus/1/2')
        .expect(400);
    });
  });

  // -------------------------------------------------------------------
  // /api/comparison/diagnostics
  // -------------------------------------------------------------------

  describe('GET /api/comparison/diagnostics', () => {
    it('returns counts per benchmark with hardware availability', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/diagnostics')
        .expect(200);

      const body = res.body.data ?? res.body;

      expect(body.benchmarks.mlperf.total).toBe(1);
      expect(body.benchmarks.mlperf.completed).toBe(1);
      expect(body.benchmarks.mmlu.total).toBe(1);
      expect(body.benchmarks.mmlu.completed).toBe(1);
      expect(body.benchmarks.npu_eval.total).toBe(2);
      expect(body.benchmarks.npu_eval.running).toBe(1);
      expect(body.benchmarks.npu_eval.failed).toBe(1);

      expect(body.hardware.gpu_available).toBe(true);
      expect(body.hardware.npu_available).toBe(true);
      expect(body.hardware.vendors_seen).toContain('nvidia');
      expect(body.hardware.vendors_seen).toContain('furiosa');
      expect(body.hardware.vendors_seen).toContain('rebellions');

      expect(body.ingestion).toBeDefined();
      expect(typeof body.generated_at).toBe('string');
    });

    it('reports no hardware available when DB is empty', async () => {
      await bootApp({ mp: [], mm: [], npu: [] });

      const res = await request(app.getHttpServer())
        .get('/api/comparison/diagnostics')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.hardware.gpu_available).toBe(false);
      expect(body.hardware.npu_available).toBe(false);
      expect(body.benchmarks.mlperf.total).toBe(0);
      expect(body.benchmarks.mmlu.total).toBe(0);
      expect(body.benchmarks.npu_eval.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Vendor classification — defects from the brief: do NOT mix RNGD ↔ Atom+
  // -------------------------------------------------------------------

  describe('vendor classification regression', () => {
    it('classifies RNGD as furiosa, Atom+ as rebellions, not the reverse', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list?hardware=npu')
        .expect(200);

      const body = res.body.data ?? res.body;
      const rngd = body.runs.find(
        (r: { hardware: { model: string } }) => r.hardware.model === 'RNGD',
      );
      const atom = body.runs.find(
        (r: { hardware: { model: string } }) => r.hardware.model === 'Atom+',
      );
      expect(rngd.hardware.vendor).toBe('furiosa');
      expect(rngd.hardware.vendor).not.toBe('rebellions');
      expect(atom.hardware.vendor).toBe('rebellions');
      expect(atom.hardware.vendor).not.toBe('furiosa');
    });
  });

  // -------------------------------------------------------------------
  // Export endpoints
  // -------------------------------------------------------------------

  describe('GET /api/comparison/export.csv', () => {
    it('returns CSV with correct header and data rows', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/export.csv')
        .expect(200);

      const csv: string = res.text;
      const lines = csv.split('\n').filter((l) => l.length > 0);
      // Header line
      expect(lines[0]).toContain('id');
      expect(lines[0]).toContain('vendor');
      expect(lines[0]).toContain('hardware');
      expect(lines[0]).toContain('benchmark');
      expect(lines[0]).toContain('tt100t_seconds');
      expect(lines[0]).toContain('config_fingerprint');
      expect(lines[0]).toContain('drift_flag');
      // At least one data row
      expect(lines.length).toBeGreaterThan(1);
    });

    it('respects limit param', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/export.csv?limit=1')
        .expect(200);

      const lines = res.text.split('\n').filter((l) => l.length > 0);
      // header + 1 data row
      expect(lines.length).toBe(2);
    });

    it('returns only header when no runs match filters', async () => {
      await bootApp({ mp: [], mm: [], npu: [] });

      const res = await request(app.getHttpServer())
        .get('/api/comparison/export.csv')
        .expect(200);

      const lines = res.text.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(1); // header only
    });
  });

  describe('GET /api/comparison/export.json', () => {
    it('returns JSON with runs array containing ComparisonRunRow shape', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/export.json')
        .expect(200);

      const body = res.body;
      expect(typeof body.total).toBe('number');
      expect(body.total).toBeGreaterThan(0);
      expect(Array.isArray(body.runs)).toBe(true);

      const first = body.runs[0];
      expect(typeof first.id).toBe('number');
      expect(['nvidia', 'furiosa', 'rebellions', 'unknown']).toContain(
        first.vendor,
      );
      expect(['mlperf-inference', 'mmlu-pro']).toContain(first.benchmark);
      expect(['completed', 'failed', 'running', 'pending']).toContain(
        first.status,
      );
      expect(typeof first.config_fingerprint).toBe('string');
      expect(first.config_fingerprint.length).toBe(64);
      expect(typeof first.drift_flag).toBe('boolean');
    });

    it('respects limit param', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/export.json?limit=2')
        .expect(200);

      expect(res.body.runs.length).toBe(2);
    });

    it('returns empty runs array when no data', async () => {
      await bootApp({ mp: [], mm: [], npu: [] });

      const res = await request(app.getHttpServer())
        .get('/api/comparison/export.json')
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.runs).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // New fields: elapsed_seconds, failure_reason, config_fingerprint, drift_flag
  // -------------------------------------------------------------------

  describe('new ComparisonRunRow fields', () => {
    it('failure_reason is populated for ERROR runs', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list?hardware=npu')
        .expect(200);

      const body = res.body.data ?? res.body;
      const atom = body.runs.find(
        (r: { hardware: { model: string } }) => r.hardware.model === 'Atom+',
      );
      expect(atom.failure_reason).toBe('inference server unreachable');
    });

    it('elapsed_seconds is computed for completed runs with start+end timestamps', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list?benchmark=mlperf&hardware=gpu')
        .expect(200);

      const body = res.body.data ?? res.body;
      const l40 = body.runs[0];
      // 10:00 → 10:30 = 1800 seconds
      expect(l40.elapsed_seconds).toBe(1800);
    });

    it('drift_flag is false when only one run per (benchmark, model, hardware) group', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list')
        .expect(200);

      const body = res.body.data ?? res.body;
      // Fixture has unique hardware per run — no drift expected
      for (const run of body.runs as Array<{ drift_flag: boolean }>) {
        expect(run.drift_flag).toBe(false);
      }
    });

    it('config_fingerprint is a 64-char hex string', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list')
        .expect(200);

      const body = res.body.data ?? res.body;
      for (const run of body.runs as Array<{ config_fingerprint: string }>) {
        expect(run.config_fingerprint).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  // -------------------------------------------------------------------
  // Task #11 required tests
  // -------------------------------------------------------------------

  describe('comparable-load: GPU ↔ NPU pair loads with hardware-optimized class', () => {
    it('GPU L40 mlperf run finds RNGD NPU sibling as hardware-optimized', async () => {
      const fixtures = bootstrapWith({
        mp: [
          makeMpExam({
            id: 1,
            gpu_type: 'NVIDIA-L40',
            precision: 'BF16',
            dataset: 'cnn_eval.json',
            model: 'Llama-3.1-8B-Instruct',
            results: [
              {
                id: 10,
                exam_id: 1,
                result_number: 1,
                result_perf_tps: 62.94,
                result_perf_sps: 1.4,
                result_tt100t: 1588,
              } as MpExamResult,
            ],
          }),
        ],
        npu: [
          makeNpuExam({
            id: 200,
            npu_type: 'RNGD',
            precision: 'FP8',
            benchmark: 'mlperf',
            dataset: 'CNN-DailyMail',
            // vendor-prefixed model name — normalizer should strip it
            model: 'meta-llama/Llama-3.1-8B-Instruct',
            status: StatusEnum.COMPLETED,
            end_at: '2026-04-28T12:30:00+09:00',
            results: [
              {
                id: 300,
                exam_id: 200,
                result_number: 1,
                result_tt100t: 0.92,
                result_tps: 87.1,
                result_sps: 2.3,
                result_accuracy: 0,
              } as NpuExamResult,
            ],
          }),
        ],
      });
      await bootApp(fixtures);

      const res = await request(app.getHttpServer())
        .get('/api/comparison/candidates?runId=1')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(false);
      expect(body.source.id).toBe(1);
      expect(body.totals.hardware_optimized).toBeGreaterThanOrEqual(1);
      const npu = body.candidates.hardware_optimized.find(
        (c: { id: number }) => c.id === 200,
      );
      expect(npu).toBeDefined();
      expect(npu.hardware.type).toBe('npu');
      expect(npu.comparability_class).toBe('hardware-optimized');
    });
  });

  describe('non-comparable-filtered: different model is NOT grouped as hardware-optimized', () => {
    it('NPU run with different model is classified as related, not hardware-optimized', async () => {
      const fixtures = bootstrapWith({
        mp: [
          makeMpExam({
            id: 1,
            gpu_type: 'NVIDIA-L40',
            precision: 'BF16',
            dataset: 'cnn_eval.json',
            model: 'Llama-3.1-8B-Instruct',
            results: [],
          }),
        ],
        npu: [
          makeNpuExam({
            id: 200,
            npu_type: 'RNGD',
            precision: 'FP8',
            benchmark: 'mlperf',
            dataset: 'CNN-DailyMail',
            model: 'Qwen/Qwen2.5-7B-Instruct',
            status: StatusEnum.COMPLETED,
            end_at: '2026-04-28T12:30:00+09:00',
            results: [
              {
                id: 300,
                exam_id: 200,
                result_number: 1,
                result_tt100t: 0.5,
                result_tps: 100,
                result_sps: 1,
                result_accuracy: 0,
              } as NpuExamResult,
            ],
          }),
        ],
      });
      await bootApp(fixtures);

      const res = await request(app.getHttpServer())
        .get('/api/comparison/candidates?runId=1')
        .expect(200);

      const body = res.body.data ?? res.body;
      // Different model: should NOT appear in hardware_optimized
      expect(body.candidates.hardware_optimized).toHaveLength(0);
    });
  });

  describe('no-data-with-reason: empty state returns diagnostic message', () => {
    it('returns reason and message when run has no comparable siblings', async () => {
      await bootApp({
        mp: [makeMpExam({ id: 7, model: 'unique-model-xyz', results: [] })],
        mm: [],
        npu: [],
      });

      const res = await request(app.getHttpServer())
        .get('/api/comparison/candidates?runId=7')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(true);
      expect(body.reason).toBe('no_siblings_found');
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
      expect(body.source.run_id).toBe(7);
      expect(body.totals.siblings_considered).toBe(0);
    });

    it('returns source_run_not_found with message when runId does not exist', async () => {
      await bootApp({ mp: [], mm: [], npu: [] });

      const res = await request(app.getHttpServer())
        .get('/api/comparison/candidates?runId=9999')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(true);
      expect(body.reason).toBe('source_run_not_found');
      expect(typeof body.message).toBe('string');
      expect(body.message).toContain('9999');
    });
  });

  describe('failed-runs-visible: ERROR runs appear in list with failure details', () => {
    it('failed NPU run appears in /list with status=ERROR and failure_reason populated', async () => {
      await bootApp(bootstrapWith());

      const res = await request(app.getHttpServer())
        .get('/api/comparison/list?hardware=npu')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(false);

      const failedRun = body.runs.find(
        (r: { status: string }) => r.status === StatusEnum.ERROR,
      );
      expect(failedRun).toBeDefined();
      expect(failedRun.failure_reason).toBeTruthy();
      expect(typeof failedRun.config_fingerprint).toBe('string');
      expect(failedRun.config_fingerprint.length).toBe(64);
    });

    it('failed run is still returned as a candidate sibling (users need to see it)', async () => {
      const fixtures = bootstrapWith({
        mp: [
          makeMpExam({
            id: 1,
            gpu_type: 'NVIDIA-L40',
            precision: 'BF16',
            dataset: 'cnn_eval.json',
            model: 'Llama-3.1-8B-Instruct',
            results: [],
          }),
        ],
        npu: [
          makeNpuExam({
            id: 200,
            npu_type: 'RNGD',
            precision: 'FP8',
            benchmark: 'mlperf',
            dataset: 'CNN-DailyMail',
            model: 'meta-llama/Llama-3.1-8B-Instruct',
            status: StatusEnum.ERROR,
            error_log: 'inference timeout',
            results: [],
          }),
        ],
      });
      await bootApp(fixtures);

      const res = await request(app.getHttpServer())
        .get('/api/comparison/candidates?runId=1')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(body.empty).toBe(false);
      const allCandidates = [
        ...body.candidates.strict,
        ...body.candidates.hardware_optimized,
        ...body.candidates.related,
      ];
      const failedCandidate = allCandidates.find(
        (c: { id: number }) => c.id === 200,
      );
      expect(failedCandidate).toBeDefined();
      expect(failedCandidate.failure_reason).toBe('inference timeout');
      expect(failedCandidate.status).toBe(StatusEnum.ERROR);
    });
  });
});
