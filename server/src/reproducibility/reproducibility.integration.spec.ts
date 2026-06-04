/**
 * Integration test (US-003): asserts that the create() flow merges
 * captured reproducibility metadata into the saved entity row by spying
 * on the helper and inspecting the repo.create / repo.save call args.
 * Uses NpuEvalService because it has the simplest create() signature
 * (no gRPC scheduling required for the test path).
 */
import * as repro from './reproducibility.metadata';

describe('exam create() flow merges reproducibility metadata (US-003)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('NpuEvalService.create merges captureReproducibilityMetadata() output into the entity passed to repo.create', async () => {
    // Stub the helper to return a known payload so we can assert merging.
    const stubMeta = {
      platform_commit_sha: 'deadbee',
      image_digest: 'sha256:test',
      k8s_pod_name: 'pod-test',
      k8s_node_name: 'node-test',
      runtime_versions: '{"node":"22"}',
      result_schema_version: 'v3',
    };
    jest
      .spyOn(repro, 'captureReproducibilityMetadata')
      .mockReturnValue(stubMeta);

    // Lazy import after spy is installed so the service captures the mocked
    // module binding (Jest's ESM-aware module mocking handles this on require).
    // We re-require to pick up the mocked export.
    jest.resetModules();
    jest.doMock('./reproducibility.metadata', () => ({
      ...repro,
      captureReproducibilityMetadata: () => stubMeta,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NpuEvalService } = require('../npu-eval/npu-eval.service');

    // Build minimal mocks for everything the service expects in its constructor.
    const npuExamRepoMock: any = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 1, ...x })),
    };
    const npuExamResultRepoMock: any = {};
    const schedulerRegistryMock: any = {
      addTimeout: jest.fn(),
      deleteTimeout: jest.fn(),
      getTimeout: jest.fn(),
    };

    // The NpuEvalService constructor signature varies; use a positional
    // construction with the dependencies it injects via constructor.
    // This service injects: @InjectRepository(NpuExam), @InjectRepository(NpuExamResult), SchedulerRegistry
    const service = new NpuEvalService(
      npuExamRepoMock,
      npuExamResultRepoMock,
      schedulerRegistryMock,
    );

    // Stub scheduleBenchmark so we don't fork the actual benchmark.
    jest.spyOn(service, 'scheduleBenchmark').mockResolvedValue(undefined);

    const dto: any = {
      name: 't1',
      description: 'd1',
      benchmark: 'mlperf',
      model: 'meta-llama/Llama-3.1-8B-Instruct',
      precision: 'FP8',
      framework: 'furiosa-llm',
      batch_size: 1,
      dataset: 'cnn_eval',
      data_number: 100,
      npu_type: 'RNGD',
      npu_num: 1,
      cpu_core: 8,
      ram_capacity: 32,
      retry_num: 1,
      max_output_tokens: 128,
      started_at: new Date(Date.now() + 60_000).toISOString(),
    };

    await service.create(dto);

    expect(npuExamRepoMock.create).toHaveBeenCalledTimes(1);
    const arg = npuExamRepoMock.create.mock.calls[0][0];
    expect(arg).toMatchObject(stubMeta);
    expect(arg.platform_commit_sha).toBe('deadbee');
    expect(arg.k8s_pod_name).toBe('pod-test');
  });
});
