import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import {
  buildBundle,
  ComparisonRun,
  ListResponse,
  parseArgs,
} from '../../scripts/publish/build-publication-bundle';

// ---------------------------------------------------------------------------
// Snapshot test for the WS-H publication bundle layout.
//
// Strategy:
//   - Provide a fixture ListResponse via a stub fetcher.
//   - Run buildBundle() pointed at a tmp dir.
//   - Untar the resulting .tgz and assert the file structure matches the
//     manifest contract.
//   - Skip gracefully if `tar` is unavailable on PATH (CI sandboxes etc.).
// ---------------------------------------------------------------------------

const fixtureRuns: ComparisonRun[] = [
  {
    id: 101,
    benchmark: 'mlperf',
    name: 'mlperf-llama8b-101-S2026-05-11-llama8b',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    hardware: {
      type: 'gpu',
      vendor: 'nvidia',
      model: 'L40',
      canonical: 'L40',
      node: 'node1',
    },
    status: 'completed',
    started_at: '2026-05-11T00:00:00Z',
    completed_at: '2026-05-11T01:00:00Z',
    elapsed_seconds: 3600,
    metrics: {
      tt100t_seconds: 4.2,
      tps: 100.5,
      accuracy_pct: 76.1,
      throughput: 100.5,
    },
    artifacts: ['/nfs/results/mlperf/101/run.log'],
    precision: 'fp16',
    scenario: 'Offline',
    batch_size: 1,
    dataset: 'cnn-dailymail',
    data_number: 0,
    max_output_tokens: 128,
    source_table: 'mp_exam',
    failure_reason: null,
    config_fingerprint: 'fp:abc123',
    drift_flag: false,
    is_canonical: true,
    precision_mismatch: false,
  },
  {
    id: 202,
    benchmark: 'mmlu',
    name: 'mmlu-llama8b-202',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    hardware: {
      type: 'npu',
      vendor: 'furiosa',
      model: 'rngd',
      canonical: 'RNGD',
      node: 'node5',
    },
    status: 'completed',
    started_at: '2026-05-11T02:00:00Z',
    completed_at: '2026-05-11T02:30:00Z',
    elapsed_seconds: 1800,
    metrics: {
      tt100t_seconds: 6.1,
      tps: 80.2,
      accuracy_pct: 74.0,
      throughput: 80.2,
    },
    artifacts: ['/nfs/results/mmlu/202/run.log'],
    precision: 'fp8',
    scenario: null,
    batch_size: 1,
    dataset: 'mmlu-pro',
    data_number: 0,
    max_output_tokens: 32,
    source_table: 'npu_exam',
    failure_reason: null,
    config_fingerprint: 'fp:xyz789',
    drift_flag: false,
    is_canonical: true,
    precision_mismatch: true,
  },
];

const fixtureResponse: ListResponse = {
  total: fixtureRuns.length,
  runs: fixtureRuns,
};

const stubFetch = async (_url: string): Promise<unknown> => fixtureResponse;

function tarAvailable(): boolean {
  try {
    execFileSync('tar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('publication-bundle (snapshot)', () => {
  describe('parseArgs', () => {
    it('parses --all-canonical with defaults', () => {
      const opts = parseArgs(['--all-canonical']);
      expect(opts.selector.kind).toBe('all-canonical');
      expect(opts.apiBase).toBe('http://localhost:9999');
      expect(opts.dryRun).toBe(false);
    });

    it('parses --exam with id and overrides', () => {
      const opts = parseArgs([
        '--exam',
        '42',
        '--api',
        'http://example:1234/',
        '--dry-run',
      ]);
      if (opts.selector.kind !== 'exam') throw new Error('expected exam');
      expect(opts.selector.id).toBe('42');
      expect(opts.apiBase).toBe('http://example:1234');
      expect(opts.dryRun).toBe(true);
    });

    it('parses --sweep id', () => {
      const opts = parseArgs(['--sweep', 'S2026-05-11-llama8b']);
      if (opts.selector.kind !== 'sweep') throw new Error('expected sweep');
      expect(opts.selector.id).toBe('S2026-05-11-llama8b');
    });

    it('rejects no selector', () => {
      expect(() => parseArgs([])).toThrow(/Exactly one/);
    });

    it('rejects multiple selectors', () => {
      expect(() => parseArgs(['--exam', '1', '--sweep', 'S'])).toThrow(
        /Exactly one/,
      );
    });

    it('rejects unknown args', () => {
      expect(() => parseArgs(['--exam', '1', '--bogus'])).toThrow(
        /Unknown arg/,
      );
    });
  });

  describe('buildBundle (with mocked fetch)', () => {
    let tmpRoot = '';
    let originalCwd = '';

    beforeAll(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pubbundle-test-'));
      originalCwd = process.cwd();
      process.chdir(tmpRoot);
    });

    afterAll(() => {
      process.chdir(originalCwd);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('produces a manifest in dry-run mode without writing tarball', async () => {
      const result = await buildBundle({
        selector: { kind: 'all-canonical' },
        apiBase: 'http://stub',
        outDir: path.join(tmpRoot, 'out-dryrun'),
        dryRun: true,
        allowDegraded: false,
        fetchJson: stubFetch,
        now: () => new Date('2026-05-11T03:04:05.000Z'),
      });

      expect(result.manifest.bundle_id).toMatch(
        /^all-canonical-2026-05-11T03-04-05-000Z$/,
      );
      expect(result.manifest.selector.kind).toBe('all-canonical');
      expect(result.manifest.files).toEqual(
        expect.arrayContaining([
          'methods.md',
          'results.csv',
          'reproducibility.json',
          'methodology_caveats.md',
          'ADR.md',
          'mlperf/101/mlperf_log_summary.txt',
          'mlperf/101/mlperf_log_detail.txt',
          'mlperf/101/accuracy.txt',
          'mlperf/101/mlperf.conf',
          'mlperf/101/user.conf',
          'mlperf/101/system_desc_id.json',
          'compliance/TEST01/verify_accuracy.txt',
          'compliance/TEST04/verify_performance.txt',
          'compliance/TEST05/verify_performance.txt',
          'raw_logs/run-101.log',
          'raw_logs/run-202.log',
        ]),
      );

      // Tarball must NOT exist in dry-run.
      expect(fs.existsSync(result.tarballPath)).toBe(false);
    });

    (tarAvailable() ? it : it.skip)(
      'writes a tarball whose contents match the manifest',
      async () => {
        const outDir = path.join(tmpRoot, 'out');
        const result = await buildBundle({
          selector: { kind: 'all-canonical' },
          apiBase: 'http://stub',
          outDir,
          dryRun: false,
          allowDegraded: false,
          fetchJson: stubFetch,
          now: () => new Date('2026-05-11T04:05:06.000Z'),
        });

        expect(fs.existsSync(result.tarballPath)).toBe(true);

        // Untar into another tmp dir and verify the file tree.
        const extractDir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'pubbundle-extract-'),
        );
        try {
          execFileSync('tar', ['-xzf', result.tarballPath, '-C', extractDir], {
            stdio: 'inherit',
          });

          const bundleRoot = path.join(extractDir, result.manifest.bundle_id);
          for (const rel of result.manifest.files) {
            const full = path.join(bundleRoot, rel);
            expect(fs.existsSync(full)).toBe(true);
          }
          expect(fs.existsSync(path.join(bundleRoot, 'manifest.json'))).toBe(
            true,
          );

          // Spot check: results.csv has the right header + correct row count.
          const csv = fs
            .readFileSync(path.join(bundleRoot, 'results.csv'), 'utf8')
            .trim()
            .split('\n');
          expect(csv[0]).toContain('id,benchmark,model,vendor,hardware');
          expect(csv).toHaveLength(1 + fixtureRuns.length);

          // reproducibility.json has the chart_sha256 field.
          const repro = JSON.parse(
            fs.readFileSync(
              path.join(bundleRoot, 'reproducibility.json'),
              'utf8',
            ),
          ) as { chart_sha256: string; rows: unknown[] };
          expect(repro.chart_sha256).toMatch(/^[a-f0-9]{64}$/);
          expect(repro.rows).toHaveLength(fixtureRuns.length);

          // methodology_caveats.md surfaces the precision_mismatch on run 202.
          const caveats = fs.readFileSync(
            path.join(bundleRoot, 'methodology_caveats.md'),
            'utf8',
          );
          expect(caveats).toContain('precision_mismatch on run 202');
          expect(caveats).toContain('LoadGen');
        } finally {
          fs.rmSync(extractDir, { recursive: true, force: true });
        }
      },
    );

    it('records bundle-level caveats when fetch fails with --allow-degraded', async () => {
      const erroringFetch = async (): Promise<never> => {
        throw new Error('synthetic upstream error');
      };
      const result = await buildBundle({
        selector: { kind: 'all-canonical' },
        apiBase: 'http://stub',
        outDir: path.join(tmpRoot, 'out-degraded'),
        dryRun: true,
        allowDegraded: true,
        fetchJson: erroringFetch,
        now: () => new Date('2026-05-11T05:06:07.000Z'),
      });

      expect(result.manifest.caveats).toEqual(
        expect.arrayContaining([
          expect.stringContaining('upstream-fetch-failed'),
        ]),
      );
    });
  });
});
