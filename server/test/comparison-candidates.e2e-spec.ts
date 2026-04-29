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

function makeMp(overrides: Partial<MpExam> = {}): MpExam {
  return {
    id: 1,
    name: 'mlperf-l40',
    description: '',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    precision: 'BF16',
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

function makeMm(overrides: Partial<MmExam> = {}): MmExam {
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

function makeNpu(overrides: Partial<NpuExam> = {}): NpuExam {
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
    max_output_tokens: 0,
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

function buildRepoMock<T>(rows: T[]) {
  return {
    _rows: rows,
    find: jest.fn().mockImplementation((opts?: { where?: Partial<T> }) => {
      if (!opts || !opts.where) return Promise.resolve(rows);
      const where = opts.where;
      const filtered = rows.filter((r) =>
        Object.entries(where).every(
          ([k, v]) => (r as Record<string, unknown>)[k] === v,
        ),
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

describe('ComparisonController GET /api/comparison/candidates (e2e)', () => {
  let app: INestApplication<App>;

  async function bootApp(fixtures: {
    mp: MpExam[];
    mm: MmExam[];
    npu: NpuExam[];
  }) {
    const mpRepo = buildRepoMock<MpExam>(fixtures.mp);
    const mmRepo = buildRepoMock<MmExam>(fixtures.mm);
    const npuRepo = buildRepoMock<NpuExam>(fixtures.npu);
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
  // GPU run as source -> finds NPU candidate as hardware-optimized
  // -------------------------------------------------------------------
  it('GPU mlperf source returns NPU sibling under hardware-optimized', async () => {
    await bootApp({
      mp: [
        makeMp({
          id: 1,
          gpu_type: 'NVIDIA-L40',
          precision: 'BF16',
          results: [
            {
              id: 10,
              exam_id: 1,
              result_number: 1,
              result_perf_tps: 60,
              result_perf_sps: 1,
              result_tt100t: 1.5,
            } as MpExamResult,
          ],
        }),
      ],
      mm: [],
      npu: [
        makeNpu({
          id: 200,
          npu_type: 'RNGD',
          precision: 'FP8',
          results: [
            {
              id: 300,
              exam_id: 200,
              result_number: 1,
              result_tt100t: 0.9,
              result_tps: 90,
              result_sps: 2,
              result_accuracy: 0,
            } as NpuExamResult,
          ],
        }),
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/api/comparison/candidates?runId=1')
      .expect(200);

    const body = res.body.data ?? res.body;
    expect(body.empty).toBe(false);
    expect(body.source.id).toBe(1);
    expect(body.source.hardware.type).toBe('gpu');
    expect(body.totals.hardware_optimized).toBe(1);
    expect(body.candidates.hardware_optimized).toHaveLength(1);
    const npu = body.candidates.hardware_optimized[0];
    expect(npu.id).toBe(200);
    expect(npu.hardware.type).toBe('npu');
    expect(npu.hardware.vendor).toBe('furiosa');
    expect(npu.comparability_class).toBe('hardware-optimized');
    expect(npu.metrics.tt100t_seconds).toBe(0.9);
    expect(typeof npu.comparability_reason).toBe('string');
  });

  // -------------------------------------------------------------------
  // NPU run as source -> finds GPU candidate as hardware-optimized
  // -------------------------------------------------------------------
  it('NPU mlperf source returns GPU sibling under hardware-optimized', async () => {
    await bootApp({
      mp: [
        makeMp({
          id: 1,
          gpu_type: 'NVIDIA-L40',
          precision: 'BF16',
          results: [],
        }),
      ],
      mm: [],
      npu: [
        makeNpu({
          id: 200,
          npu_type: 'RNGD',
          precision: 'FP8',
          results: [],
        }),
      ],
    });

    // NPU id collides with mp id space — so use a non-colliding id.
    const res = await request(app.getHttpServer())
      .get('/api/comparison/candidates?runId=200')
      .expect(200);

    const body = res.body.data ?? res.body;
    expect(body.empty).toBe(false);
    // The id=200 mp ID could collide; resolveSourceRun should pick mp first.
    // But since there is no mp with id=200, it picks npu.
    expect(body.source.id).toBe(200);
    expect(body.source.hardware.type).toBe('npu');
    expect(body.totals.hardware_optimized).toBe(1);
    const gpu = body.candidates.hardware_optimized[0];
    expect(gpu.id).toBe(1);
    expect(gpu.hardware.type).toBe('gpu');
    expect(gpu.comparability_class).toBe('hardware-optimized');
  });

  // -------------------------------------------------------------------
  // Strict comparability — same precision/batch/etc
  // -------------------------------------------------------------------
  it('groups identical-config siblings under strict', async () => {
    await bootApp({
      mp: [
        makeMp({ id: 1, gpu_type: 'NVIDIA-L40', precision: 'BF16' }),
        makeMp({ id: 2, gpu_type: 'NVIDIA-A40', precision: 'BF16' }),
      ],
      mm: [],
      npu: [],
    });

    const res = await request(app.getHttpServer())
      .get('/api/comparison/candidates?runId=1')
      .expect(200);

    const body = res.body.data ?? res.body;
    expect(body.empty).toBe(false);
    expect(body.totals.strict).toBe(1);
    expect(body.candidates.strict[0].id).toBe(2);
    expect(body.candidates.strict[0].comparability_class).toBe('strict');
  });

  // -------------------------------------------------------------------
  // No siblings -> diagnostic envelope
  // -------------------------------------------------------------------
  it('returns diagnostic envelope when no siblings exist', async () => {
    await bootApp({
      mp: [makeMp({ id: 42, model: 'lonely-model' })],
      mm: [],
      npu: [],
    });

    const res = await request(app.getHttpServer())
      .get('/api/comparison/candidates?runId=42')
      .expect(200);

    const body = res.body.data ?? res.body;
    expect(body.empty).toBe(true);
    expect(body.reason).toBe('no_siblings_found');
    expect(body.source.run_id).toBe(42);
    expect(body.source.model).toBe('lonely-model');
    expect(body.totals.siblings_considered).toBe(0);
    expect(typeof body.message).toBe('string');
  });

  // -------------------------------------------------------------------
  // Source run not found -> diagnostic envelope
  // -------------------------------------------------------------------
  it('returns source_run_not_found when runId missing from DB', async () => {
    await bootApp({
      mp: [makeMp({ id: 1 })],
      mm: [],
      npu: [],
    });

    const res = await request(app.getHttpServer())
      .get('/api/comparison/candidates?runId=99999')
      .expect(200);

    const body = res.body.data ?? res.body;
    expect(body.empty).toBe(true);
    expect(body.reason).toBe('source_run_not_found');
    expect(body.totals.siblings_considered).toBe(0);
  });

  // -------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------
  it('rejects missing runId with 400', async () => {
    await bootApp({ mp: [], mm: [], npu: [] });
    await request(app.getHttpServer())
      .get('/api/comparison/candidates')
      .expect(400);
  });

  it('rejects non-numeric runId with 400', async () => {
    await bootApp({ mp: [], mm: [], npu: [] });
    await request(app.getHttpServer())
      .get('/api/comparison/candidates?runId=abc')
      .expect(400);
  });

  it('rejects invalid hardware filter with 400', async () => {
    await bootApp({
      mp: [makeMp({ id: 1 })],
      mm: [],
      npu: [],
    });
    await request(app.getHttpServer())
      .get('/api/comparison/candidates?runId=1&hardware=quantum')
      .expect(400);
  });

  // -------------------------------------------------------------------
  // Related class — same model/benchmark, different dataset/scenario
  // -------------------------------------------------------------------
  it('classifies different-dataset sibling as related', async () => {
    await bootApp({
      mp: [
        makeMp({
          id: 1,
          gpu_type: 'NVIDIA-L40',
          precision: 'BF16',
          dataset: 'cnn-dailymail',
        }),
        makeMp({
          id: 2,
          gpu_type: 'NVIDIA-L40',
          precision: 'BF16',
          dataset: 'openwebtext',
          batch_size: 4,
        }),
      ],
      mm: [],
      npu: [],
    });

    const res = await request(app.getHttpServer())
      .get('/api/comparison/candidates?runId=1')
      .expect(200);

    const body = res.body.data ?? res.body;
    expect(body.empty).toBe(false);
    expect(body.totals.related).toBe(1);
    expect(body.candidates.related[0].id).toBe(2);
    expect(body.candidates.related[0].comparability_class).toBe('related');
  });

  // -------------------------------------------------------------------
  // Filters narrow the candidate set
  // -------------------------------------------------------------------
  it('applies hardware=gpu filter to exclude NPU siblings', async () => {
    await bootApp({
      mp: [
        makeMp({ id: 1, gpu_type: 'NVIDIA-L40', precision: 'BF16' }),
        makeMp({ id: 2, gpu_type: 'NVIDIA-A40', precision: 'BF16' }),
      ],
      mm: [],
      npu: [makeNpu({ id: 200, npu_type: 'RNGD', precision: 'FP8' })],
    });

    const res = await request(app.getHttpServer())
      .get('/api/comparison/candidates?runId=1&hardware=gpu')
      .expect(200);

    const body = res.body.data ?? res.body;
    expect(body.empty).toBe(false);
    const allCandidates = [
      ...body.candidates.strict,
      ...body.candidates.hardware_optimized,
      ...body.candidates.related,
    ];
    for (const c of allCandidates) {
      expect(c.hardware.type).toBe('gpu');
    }
  });
});
