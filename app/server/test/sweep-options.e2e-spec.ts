import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';

import { GpuSweepController } from '../src/gpu-sweep/gpu-sweep.controller';
import { GpuSweepService } from '../src/gpu-sweep/gpu-sweep.service';
import { GpuSweep } from '../src/gpu-sweep/entities/gpu-sweep.entity';
import { GpuSweepCell } from '../src/gpu-sweep/entities/gpu-sweep-cell.entity';
import { MpExamService } from '../src/mp-exam/mp-exam.service';
import { MmExamService } from '../src/mm-exam/mm-exam.service';
import { TransformInterceptor } from '../src/interceptors/transform/transform.interceptor';

// ---------------------------------------------------------------------------
// /api/gpu-sweep/options — sweep-control catalogue
//
// Contract: even when the feature flag is off or a node is pending join, the
// endpoint MUST return every category (benchmarks/hardware/nodes/models/...)
// so the UI can render disabled options with a tooltip rather than rendering
// an empty page.
//
// Constructed with a hand-rolled provider list (instead of importing
// GpuSweepModule) so we don't pull in TypeORM's DataSource graph.
// ---------------------------------------------------------------------------

const ORIGINAL_FLAG = process.env.GPU_SWEEP_ENABLED;
const ORIGINAL_NODE5 = process.env.NODE5_STATE;

async function buildApp(): Promise<INestApplication<App>> {
  const sweepRepoMock = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    increment: jest.fn(),
  };
  const cellRepoMock = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mpExamServiceMock = { create: jest.fn(), stopMpExam: jest.fn() };
  const mmExamServiceMock = { create: jest.fn(), stop: jest.fn() };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
    controllers: [GpuSweepController],
    providers: [
      GpuSweepService,
      { provide: getRepositoryToken(GpuSweep), useValue: sweepRepoMock },
      { provide: getRepositoryToken(GpuSweepCell), useValue: cellRepoMock },
      { provide: MpExamService, useValue: mpExamServiceMock },
      { provide: MmExamService, useValue: mmExamServiceMock },
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.init();
  return app;
}

describe('GET /api/gpu-sweep/options (e2e)', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    if (app) await app.close();
    if (ORIGINAL_FLAG === undefined) delete process.env.GPU_SWEEP_ENABLED;
    else process.env.GPU_SWEEP_ENABLED = ORIGINAL_FLAG;
    if (ORIGINAL_NODE5 === undefined) delete process.env.NODE5_STATE;
    else process.env.NODE5_STATE = ORIGINAL_NODE5;
  });

  it('returns 200 and the full catalogue when GPU_SWEEP_ENABLED=true', async () => {
    process.env.GPU_SWEEP_ENABLED = 'true';
    process.env.NODE5_STATE = 'pending_join';
    app = await buildApp();

    const res = await request(app.getHttpServer())
      .get('/api/gpu-sweep/options')
      .expect(200);

    const body = res.body.data ?? res.body;

    expect(body.enabled).toBe(true);
    expect(body.feature_flag_reason).toBeNull();

    // Benchmarks — all four canonical IDs present
    const benchmarkKeys = body.benchmarks.map((b: any) => b.key);
    expect(benchmarkKeys).toEqual(
      expect.arrayContaining([
        'mlperf-perf',
        'mlperf-acc',
        'mmlu-pro',
        'tt100',
      ]),
    );

    // Hardware: gpu-nvidia, npu-rngd, npu-rebellions-atomplus
    const hwByKey: Record<string, any> = Object.fromEntries(
      body.hardware.map((h: any) => [h.key, h]),
    );
    expect(hwByKey['gpu-nvidia']).toBeDefined();
    expect(hwByKey['npu-rngd']).toBeDefined();
    expect(hwByKey['npu-rebellions-atomplus']).toBeDefined();

    // Atom+ MUST be vendor=rebellions (not furiosa)
    expect(hwByKey['npu-rebellions-atomplus'].vendor).toBe('rebellions');
    expect(hwByKey['npu-rebellions-atomplus'].node).toBe('node5');
    expect(hwByKey['npu-rngd'].vendor).toBe('furiosa');
    expect(hwByKey['npu-rngd'].node).toBe('node4');

    // Nodes: 4 entries, node5 pending_join
    const nodesByName: Record<string, any> = Object.fromEntries(
      body.nodes.map((n: any) => [n.name, n]),
    );
    expect(Object.keys(nodesByName).sort()).toEqual([
      'node2',
      'node3',
      'node4',
      'node5',
    ]);
    expect(nodesByName.node5.state).toBe('pending_join');
    expect(nodesByName.node5.enabled).toBe(false);
    expect(nodesByName.node5.disabled_reason).toBe('node_pending_join');

    // Atom+ disabled because node5 is pending_join
    expect(hwByKey['npu-rebellions-atomplus'].enabled).toBe(false);
    expect(hwByKey['npu-rebellions-atomplus'].disabled_reason).toBe(
      'node_pending_join',
    );

    // Models: llama-3.1-8b-instruct with fp8/bf16
    const modelKeys = body.models.map((m: any) => m.key);
    expect(modelKeys).toContain('llama-3.1-8b-instruct');
    const llama = body.models.find(
      (m: any) => m.key === 'llama-3.1-8b-instruct',
    );
    expect(llama.precisions).toEqual(expect.arrayContaining(['fp8', 'bf16']));

    // Precisions / scenarios / batch sizes / concurrencies all present
    expect(body.precisions.map((p: any) => p.key)).toEqual(
      expect.arrayContaining(['fp8', 'bf16']),
    );
    expect(body.scenarios.map((s: any) => s.key)).toEqual(
      expect.arrayContaining(['offline', 'server']),
    );
    expect(body.batch_sizes).toEqual(expect.arrayContaining([1, 2, 4, 8]));
    expect(Array.isArray(body.concurrencies)).toBe(true);
    expect(body.concurrencies.length).toBeGreaterThan(0);
  });

  it('returns the full catalogue with feature_flag_off when disabled', async () => {
    process.env.GPU_SWEEP_ENABLED = 'false';
    process.env.NODE5_STATE = 'pending_join';
    app = await buildApp();

    const res = await request(app.getHttpServer())
      .get('/api/gpu-sweep/options')
      .expect(200);

    const body = res.body.data ?? res.body;

    expect(body.enabled).toBe(false);
    expect(body.feature_flag_reason).toBe('feature_flag_off');

    // Catalogue is NEVER empty
    expect(body.benchmarks.length).toBeGreaterThan(0);
    expect(body.hardware.length).toBe(3);
    expect(body.nodes.length).toBe(4);
    expect(body.models.length).toBeGreaterThan(0);

    // Every benchmark disabled with feature_flag_off
    for (const b of body.benchmarks) {
      expect(b.enabled).toBe(false);
      expect(b.disabled_reason).toBe('feature_flag_off');
    }
    for (const h of body.hardware) {
      expect(h.enabled).toBe(false);
      // Atom+ may carry node_pending_join; others must be feature_flag_off
      expect(['feature_flag_off', 'node_pending_join']).toContain(
        h.disabled_reason,
      );
    }
    // node5 still labelled pending_join, never silently masked
    const node5 = body.nodes.find((n: any) => n.name === 'node5');
    expect(node5.state).toBe('pending_join');
  });

  it('marks node5 active when NODE5_STATE=active', async () => {
    process.env.GPU_SWEEP_ENABLED = 'true';
    process.env.NODE5_STATE = 'active';
    app = await buildApp();

    const res = await request(app.getHttpServer())
      .get('/api/gpu-sweep/options')
      .expect(200);

    const body = res.body.data ?? res.body;

    const node5 = body.nodes.find((n: any) => n.name === 'node5');
    expect(node5.state).toBe('active');
    expect(node5.enabled).toBe(true);
    expect(node5.disabled_reason).toBeNull();

    const atom = body.hardware.find(
      (h: any) => h.key === 'npu-rebellions-atomplus',
    );
    expect(atom.enabled).toBe(true);
    expect(atom.disabled_reason).toBeNull();
  });
});
