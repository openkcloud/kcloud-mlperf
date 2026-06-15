#!/usr/bin/env ts-node
/**
 * WS-H Publication Bundle Builder (MLPerf 5.1 Compliant target).
 *
 * Per AG-10 = (a), the bundle aims to mirror the MLPerf 5.1 submission
 * layout as closely as possible. Where real LoadGen output is unavailable
 * because the source benchmark wasn't run through the LoadGen harness,
 * we emit clearly labelled placeholders and append a caveat to
 * `methodology_caveats.md`.
 *
 * Usage:
 *   ts-node scripts/publish/build-publication-bundle.ts \
 *       (--exam <id> | --sweep <id> | --all-canonical) \
 *       [--api <http://localhost:9999>] \
 *       [--out <dist/publication-bundles>] \
 *       [--dry-run]
 *
 * Output:
 *   dist/publication-bundles/<sweep-id>-<timestamp>.tgz
 *
 * Exit codes:
 *   0 = bundle built (or dry-run printed manifest)
 *   1 = invalid CLI args
 *   2 = upstream fetch error (continues with placeholders if --allow-degraded)
 *   3 = tarball creation failed
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import { execFileSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types — minimal mirror of /api/comparison/list response (NormalizedRun)
// ---------------------------------------------------------------------------

export interface ComparisonRun {
  id: number;
  benchmark: 'mlperf' | 'mmlu';
  name: string;
  model: string;
  hardware: {
    type: 'gpu' | 'npu';
    vendor: string;
    model: string;
    canonical: string;
    node: string | null;
  };
  status: string;
  started_at: string | null;
  completed_at: string | null;
  elapsed_seconds: number | null;
  metrics: {
    tt100t_seconds: number | null;
    tps: number | null;
    accuracy_pct: number | null;
    throughput: number | null;
  };
  artifacts: string[];
  precision: string | null;
  scenario: string | null;
  batch_size: number | null;
  dataset: string | null;
  data_number: number | null;
  max_output_tokens: number | null;
  source_table: string;
  failure_reason: string | null;
  config_fingerprint: string;
  drift_flag: boolean;
  is_canonical: boolean;
  precision_mismatch: boolean;
}

export interface ListResponse {
  empty?: boolean;
  reason?: string;
  message?: string;
  total?: number;
  runs?: ComparisonRun[];
}

export interface PairResponse {
  benchmark: string;
  a: ComparisonRun;
  b: ComparisonRun;
  incompatibility_reasons?: string[];
  fairness_assessment?: { verdict?: string; reasons?: string[] };
}

export interface BundleOptions {
  selector:
    | { kind: 'exam'; id: string }
    | { kind: 'sweep'; id: string }
    | { kind: 'all-canonical' };
  apiBase: string;
  outDir: string;
  dryRun: boolean;
  allowDegraded: boolean;
  /** Inject custom fetcher for tests; if absent uses http(s) module. */
  fetchJson?: (url: string) => Promise<unknown>;
  /** Inject filesystem writer for tests. */
  now?: () => Date;
}

export interface BundleManifest {
  bundle_id: string;
  built_at: string;
  selector: BundleOptions['selector'];
  api_base: string;
  files: string[];
  caveats: string[];
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function printHelp(): void {
  const help = `WS-H Publication Bundle Builder (MLPerf 5.1 Compliant)

Usage:
  ts-node scripts/publish/build-publication-bundle.ts \\
      (--exam <id> | --sweep <id> | --all-canonical) \\
      [--api <http://localhost:9999>] [--out <dist/publication-bundles>] \\
      [--dry-run] [--allow-degraded]

Options:
  --exam <id>            Build bundle for one exam id.
  --sweep <id>           Build bundle for a sweep id.
  --all-canonical        Build bundle from all canonical (full-dataset) runs.
  --api <url>            Backend base URL. Default: http://localhost:9999
  --out <dir>            Output directory. Default: dist/publication-bundles
  --dry-run              Print the manifest without writing the tarball.
  --allow-degraded       Continue with placeholders if upstream fetch fails.
  --help, -h             Show this help.

Examples:
  ts-node build-publication-bundle.ts --all-canonical --dry-run
  ts-node build-publication-bundle.ts --sweep S2026-05-11-llama8b
  ts-node build-publication-bundle.ts --exam 1234 --api http://10.254.177.41:30980
`;
  process.stdout.write(help);
}

export function parseArgs(argv: string[]): BundleOptions {
  let exam: string | null = null;
  let sweep: string | null = null;
  let allCanonical = false;
  let api = 'http://localhost:9999';
  let out = path.join('dist', 'publication-bundles');
  let dryRun = false;
  let allowDegraded = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        return {} as BundleOptions; // unreachable
      case '--exam':
        exam = argv[++i] ?? '';
        break;
      case '--sweep':
        sweep = argv[++i] ?? '';
        break;
      case '--all-canonical':
        allCanonical = true;
        break;
      case '--api':
        api = argv[++i] ?? api;
        break;
      case '--out':
        out = argv[++i] ?? out;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--allow-degraded':
        allowDegraded = true;
        break;
      default:
        throw new Error(`Unknown arg: ${a}`);
    }
  }

  const provided = [exam, sweep, allCanonical ? 'all' : null].filter(
    (v) => v != null && v !== '',
  );
  if (provided.length !== 1) {
    throw new Error(
      'Exactly one of --exam, --sweep, or --all-canonical is required',
    );
  }

  let selector: BundleOptions['selector'];
  if (exam != null && exam !== '') {
    selector = { kind: 'exam', id: exam };
  } else if (sweep != null && sweep !== '') {
    selector = { kind: 'sweep', id: sweep };
  } else {
    selector = { kind: 'all-canonical' };
  }

  return {
    selector,
    apiBase: api.replace(/\/$/, ''),
    outDir: out,
    dryRun,
    allowDegraded,
  };
}

// ---------------------------------------------------------------------------
// HTTP fetch (no extra deps)
// ---------------------------------------------------------------------------

function defaultFetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode == null || res.statusCode >= 400) {
          reject(
            new Error(
              `HTTP ${res.statusCode ?? 'unknown'} from ${url}: ${body.slice(0, 200)}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(
            new Error(
              `Invalid JSON from ${url}: ${(e as Error).message} (body: ${body.slice(0, 200)})`,
            ),
          );
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => req.destroy(new Error(`timeout fetching ${url}`)));
  });
}

// ---------------------------------------------------------------------------
// Helpers — selectors and fetches
// ---------------------------------------------------------------------------

export async function fetchRuns(
  opts: BundleOptions,
): Promise<{ runs: ComparisonRun[]; caveats: string[] }> {
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const url = `${opts.apiBase}/api/comparison/list?benchmark=all&hardware=all&limit=10000`;
  const caveats: string[] = [];

  let body: ListResponse;
  try {
    body = (await fetchJson(url)) as ListResponse;
  } catch (e) {
    if (opts.allowDegraded) {
      caveats.push(
        `upstream-fetch-failed: ${url} — ${(e as Error).message}; continuing with empty result set.`,
      );
      return { runs: [], caveats };
    }
    throw e;
  }

  if (body.empty || !body.runs) {
    caveats.push(`upstream-empty: ${body.message ?? body.reason ?? 'no runs'}`);
    return { runs: [], caveats };
  }

  let runs = body.runs;
  if (opts.selector.kind === 'exam') {
    const id = Number.parseInt(opts.selector.id, 10);
    runs = runs.filter((r) => r.id === id);
  } else if (opts.selector.kind === 'sweep') {
    const sid = opts.selector.id;
    // Sweep filter heuristic: sweep id appears in run.name or artifacts paths.
    runs = runs.filter(
      (r) =>
        r.name.includes(sid) ||
        r.artifacts.some((a) => a.includes(sid)) ||
        r.config_fingerprint.includes(sid),
    );
  } else {
    runs = runs.filter((r) => r.is_canonical);
  }

  return { runs, caveats };
}

// ---------------------------------------------------------------------------
// Generators — produce the in-bundle text artifacts
// ---------------------------------------------------------------------------

export function buildMethodsMd(
  runs: ComparisonRun[],
  selector: BundleOptions['selector'],
): string {
  const datasets = unique(runs.map((r) => r.dataset).filter(isString));
  const models = unique(runs.map((r) => r.model));
  const precisions = unique(
    runs.map((r) => r.precision).filter(isString),
  );
  const hardware = unique(runs.map((r) => r.hardware.canonical));
  const dataNumbers = unique(
    runs.map((r) => r.data_number).filter(isFiniteNumber),
  );

  return [
    '# Methods (auto-generated)',
    '',
    `Selector: ${selector.kind === 'all-canonical' ? 'all canonical (full dataset) runs' : `${selector.kind}=${selector.id}`}`,
    `Run count: ${runs.length}`,
    '',
    '## Models',
    ...models.map((m) => `- ${m}`),
    '',
    '## Datasets',
    ...datasets.map((d) => `- ${d}`),
    '',
    '## Precisions',
    ...precisions.map((p) => `- ${p}`),
    '',
    '## Hardware (canonical labels)',
    ...hardware.map((h) => `- ${h}`),
    '',
    '## Sample sizes',
    ...dataNumbers.map((n) =>
      n === 0 ? '- 0 = full canonical dataset (13368 samples)' : `- ${n}`,
    ),
    '',
    '## MLPerf 5.1 alignment',
    '',
    '- Scenario: see per-run scenario in `results.csv`.',
    '- LoadGen artifacts: see `mlperf/<run-id>/`. Real LoadGen output requires running the upstream MLPerf-Inference harness; placeholders are emitted when unavailable (see `methodology_caveats.md`).',
    '- Compliance suites (TEST01/TEST04/TEST05): see `compliance/`.',
    '- For a real submission, run upstream `submission_checker.py` from mlcommons/inference; this bundle ships a local subset checker (`scripts/publish/submission_checker_local.py`).',
    '',
  ].join('\n');
}

export function buildResultsCsv(runs: ComparisonRun[]): string {
  const headers = [
    'id',
    'benchmark',
    'model',
    'vendor',
    'hardware',
    'node',
    'status',
    'precision',
    'scenario',
    'batch_size',
    'dataset',
    'data_number',
    'max_output_tokens',
    'tt100t_seconds',
    'tps',
    'accuracy_pct',
    'throughput',
    'elapsed_seconds',
    'started_at',
    'completed_at',
    'config_fingerprint',
    'drift_flag',
    'is_canonical',
    'precision_mismatch',
    'failure_reason',
  ] as const;
  const escape = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines: string[] = [headers.join(',')];
  for (const r of runs) {
    const row: Record<(typeof headers)[number], unknown> = {
      id: r.id,
      benchmark: r.benchmark,
      model: r.model,
      vendor: r.hardware.vendor,
      hardware: r.hardware.canonical,
      node: r.hardware.node,
      status: r.status,
      precision: r.precision,
      scenario: r.scenario,
      batch_size: r.batch_size,
      dataset: r.dataset,
      data_number: r.data_number,
      max_output_tokens: r.max_output_tokens,
      tt100t_seconds: r.metrics.tt100t_seconds,
      tps: r.metrics.tps,
      accuracy_pct: r.metrics.accuracy_pct,
      throughput: r.metrics.throughput,
      elapsed_seconds: r.elapsed_seconds,
      started_at: r.started_at,
      completed_at: r.completed_at,
      config_fingerprint: r.config_fingerprint,
      drift_flag: r.drift_flag,
      is_canonical: r.is_canonical,
      precision_mismatch: r.precision_mismatch,
      failure_reason: r.failure_reason,
    };
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

export function buildReproducibilityJson(
  runs: ComparisonRun[],
  bundleId: string,
  builtAt: string,
): string {
  // N=11 metadata: per the WS-G/WS-H contract, every reproducible run includes
  // 11 standardized metadata fields. We surface those + the chart SHA so a
  // reader can regenerate the figures from results.csv deterministically.
  const N11_FIELDS = [
    'benchmark',
    'model',
    'precision',
    'dataset',
    'data_number',
    'scenario',
    'max_output_tokens',
    'batch_size',
    'hardware_canonical',
    'config_fingerprint',
    'is_canonical',
  ] as const;

  const rows = runs.map((r) => ({
    id: r.id,
    benchmark: r.benchmark,
    model: r.model,
    precision: r.precision,
    dataset: r.dataset,
    data_number: r.data_number,
    scenario: r.scenario,
    max_output_tokens: r.max_output_tokens,
    batch_size: r.batch_size,
    hardware_canonical: r.hardware.canonical,
    config_fingerprint: r.config_fingerprint,
    is_canonical: r.is_canonical,
  }));

  // Chart SHA: deterministic content hash of the row payload so two
  // bundles built from the same DB snapshot produce identical SHAs.
  const chartSha = sha256Hex(JSON.stringify(rows));

  return (
    JSON.stringify(
      {
        bundle_id: bundleId,
        built_at: builtAt,
        n11_fields: N11_FIELDS,
        rows,
        chart_sha256: chartSha,
      },
      null,
      2,
    ) + '\n'
  );
}

export function buildMethodologyCaveatsMd(
  runs: ComparisonRun[],
  pairCaveats: string[],
  bundleCaveats: string[],
): string {
  // Roll up incompatibility_reasons for every potentially-comparable pair.
  // We don't fetch /pair for every cross-pair (O(N^2) HTTP); instead we
  // surface the static caveats ahead of time and let WS-G surface the
  // pairwise verdicts in the dashboard.
  const driftFlagged = runs.filter((r) => r.drift_flag);
  const precisionMismatch = runs.filter((r) => r.precision_mismatch);

  const lines = [
    '# Methodology Caveats',
    '',
    '## Bundle-level',
    ...(bundleCaveats.length
      ? bundleCaveats.map((c) => `- ${c}`)
      : ['- (none recorded at bundle build time)']),
    '',
    '## Pair-level incompatibility reasons',
    ...(pairCaveats.length
      ? pairCaveats.map((c) => `- ${c}`)
      : ['- (no pairs evaluated; consult `/api/comparison/<bench>/<a>/<b>` for live pair fairness verdicts)']),
    '',
    '## Drift / precision mismatches',
    `- Runs with drift_flag=true: ${driftFlagged.length}`,
    ...driftFlagged.map(
      (r) => `  - id=${r.id} (${r.benchmark}/${r.hardware.canonical})`,
    ),
    `- Runs with precision_mismatch=true: ${precisionMismatch.length}`,
    ...precisionMismatch.map(
      (r) =>
        `  - id=${r.id} (${r.benchmark}/${r.hardware.canonical} precision=${r.precision})`,
    ),
    '',
    '## Warmup & cache',
    '- Each per-row latency is reported as time-to-100-tokens (tt100t).',
    '- Per WS-A05 / W7 contract the harness performs an explicit warmup pass before timing; first-token latency is excluded from steady-state numbers.',
    '- KV cache is left enabled per the canonical config; cold-cache numbers are out of scope for this bundle.',
    '',
    '## MLPerf 5.1 placeholder gaps',
    '- LoadGen artifacts (mlperf_log_summary.txt, mlperf_log_detail.txt, accuracy.txt) are placeholders unless the underlying run was executed via the upstream LoadGen harness. Real submission requires re-running through mlcommons/inference.',
    '- Compliance suite results (TEST01/TEST04/TEST05) are placeholders for the same reason.',
    '- The local `submission_checker_local.py` validates bundle structure but is a strict subset of the upstream `submission_checker.py`.',
    '',
  ];
  return lines.join('\n');
}

export function buildAdrMd(
  runs: ComparisonRun[],
  selector: BundleOptions['selector'],
): string {
  const fingerprints = unique(runs.map((r) => r.config_fingerprint));
  return [
    '# ADR — Sweep Parameters',
    '',
    `## Decision: target MLPerf 5.1 compliance (per AG-10 = (a))`,
    '',
    'The bundle is structured to mirror the MLPerf 5.1 submission layout',
    'so that, where the underlying run was executed via the upstream',
    'LoadGen harness, the artifacts can be lifted directly into a real',
    'submission directory. Where the run was *not* executed via LoadGen',
    '(majority of current ETRI runs), placeholder files are emitted with',
    'a clear caveat and the local submission_checker only validates',
    'structural presence — not LoadGen log validity.',
    '',
    '## Selector',
    `- kind: ${selector.kind}`,
    selector.kind !== 'all-canonical' ? `- id: ${selector.id}` : '- id: (n/a)',
    '',
    '## Canonical config fingerprints included',
    ...(fingerprints.length
      ? fingerprints.map((f) => `- ${f}`)
      : ['- (none)']),
    '',
    '## Why we ship a local submission checker',
    'The upstream `submission_checker.py` from mlcommons/inference imports',
    'multiple Python packages and walks an opinionated directory tree. We',
    'ship a lightweight local subset so this bundle can be self-validated',
    'without pulling the full MLPerf-Inference repo. For a real submission',
    'you MUST run upstream `submission_checker.py` against this directory.',
    '',
  ].join('\n');
}

export function buildMlperfStubs(run: ComparisonRun): {
  summary: string;
  detail: string;
  accuracy: string;
  mlperfConf: string;
  userConf: string;
  systemDesc: string;
} {
  const placeholderHeader = [
    `# PLACEHOLDER — generated by build-publication-bundle.ts`,
    `# This file would normally be emitted by the MLPerf LoadGen harness.`,
    `# Source run: id=${run.id}, benchmark=${run.benchmark}, hardware=${run.hardware.canonical}`,
    `# See methodology_caveats.md for the LoadGen placeholder strategy.`,
    '',
  ].join('\n');

  const summary = [
    placeholderHeader,
    '================================================',
    'MLPerf Results Summary (placeholder)',
    '================================================',
    `SUT name : ${run.hardware.canonical}-sut`,
    `Scenario : ${run.scenario ?? 'Offline'}`,
    `Mode     : PerformanceOnly`,
    `Result is : (placeholder)`,
    '',
    '================================================',
    'Additional Stats',
    '================================================',
    `Tokens per second : ${run.metrics.tps ?? 'N/A'}`,
    `tt100t seconds    : ${run.metrics.tt100t_seconds ?? 'N/A'}`,
    `Throughput        : ${run.metrics.throughput ?? 'N/A'}`,
    '',
  ].join('\n');

  const detail = [
    placeholderHeader,
    `:::MLLOG {"key": "loadgen_version", "value": "PLACEHOLDER", "time_ms": 0}`,
    `:::MLLOG {"key": "scenario", "value": "${run.scenario ?? 'Offline'}", "time_ms": 0}`,
    `:::MLLOG {"key": "model_name", "value": "${run.model}", "time_ms": 0}`,
    `:::MLLOG {"key": "ds_total_samples", "value": ${run.data_number ?? 0}, "time_ms": 0}`,
    `:::MLLOG {"key": "result_total_run_time_seconds", "value": ${run.elapsed_seconds ?? 0}, "time_ms": 0}`,
    '',
  ].join('\n');

  const accuracy = [
    placeholderHeader,
    'AccuracyMode results (placeholder)',
    `accuracy_pct: ${run.metrics.accuracy_pct ?? 'N/A'}`,
    '',
  ].join('\n');

  const mlperfConf = [
    `# mlperf.conf placeholder for run id=${run.id}`,
    `*.${(run.scenario ?? 'Offline').toLowerCase()}.target_qps = 1.0`,
    `*.${(run.scenario ?? 'Offline').toLowerCase()}.min_duration = 600000`,
    `*.${(run.scenario ?? 'Offline').toLowerCase()}.min_query_count = 13368`,
    '',
  ].join('\n');

  const userConf = [
    `# user.conf placeholder for run id=${run.id}`,
    `${run.model}.${(run.scenario ?? 'Offline')}.target_qps = 1.0`,
    `${run.model}.${(run.scenario ?? 'Offline')}.performance_sample_count_override = ${run.data_number ?? 13368}`,
    '',
  ].join('\n');

  const systemDesc =
    JSON.stringify(
      {
        submitter: 'ETRI',
        division: 'open',
        status: 'placeholder',
        system_name: `${run.hardware.canonical}-${run.hardware.node ?? 'unknown'}`,
        accelerator_model_name: run.hardware.canonical,
        accelerator_vendor: run.hardware.vendor,
        host_processor_model_name: 'unknown',
        host_processors_per_node: 1,
        host_memory_capacity: 'unknown',
        framework: 'unknown',
        operating_system: 'linux',
        run_source_id: run.id,
        notes: 'PLACEHOLDER — see methodology_caveats.md',
      },
      null,
      2,
    ) + '\n';

  return { summary, detail, accuracy, mlperfConf, userConf, systemDesc };
}

export function buildComplianceStubs(): Record<string, string> {
  const stub = (name: string): string =>
    [
      `# PLACEHOLDER ${name} compliance result`,
      '# Real compliance results require running the corresponding MLPerf',
      '# compliance scripts (compliance/${name}/run_verification.py) against',
      '# the LoadGen output. See methodology_caveats.md.',
      '',
      'TEST PASS: false (placeholder — not run)',
      '',
    ].join('\n');
  return {
    'compliance/TEST01/verify_accuracy.txt': stub('TEST01'),
    'compliance/TEST04/verify_performance.txt': stub('TEST04'),
    'compliance/TEST05/verify_performance.txt': stub('TEST05'),
  };
}

// ---------------------------------------------------------------------------
// Bundle assembly + tarball
// ---------------------------------------------------------------------------

export interface BundleResult {
  bundleDir: string;
  tarballPath: string;
  manifest: BundleManifest;
}

export async function assembleBundleFiles(
  opts: BundleOptions,
  runs: ComparisonRun[],
  bundleCaveats: string[],
  bundleId: string,
  builtAt: string,
): Promise<{ files: Record<string, string>; manifest: BundleManifest }> {
  const files: Record<string, string> = {};

  files['methods.md'] = buildMethodsMd(runs, opts.selector);
  files['results.csv'] = buildResultsCsv(runs);
  files['reproducibility.json'] = buildReproducibilityJson(
    runs,
    bundleId,
    builtAt,
  );
  files['ADR.md'] = buildAdrMd(runs, opts.selector);

  // MLPerf stubs per run.
  const mlperfRuns = runs.filter((r) => r.benchmark === 'mlperf');
  for (const r of mlperfRuns) {
    const stubs = buildMlperfStubs(r);
    const dir = `mlperf/${r.id}`;
    files[`${dir}/mlperf_log_summary.txt`] = stubs.summary;
    files[`${dir}/mlperf_log_detail.txt`] = stubs.detail;
    files[`${dir}/accuracy.txt`] = stubs.accuracy;
    files[`${dir}/mlperf.conf`] = stubs.mlperfConf;
    files[`${dir}/user.conf`] = stubs.userConf;
    files[`${dir}/system_desc_id.json`] = stubs.systemDesc;
  }

  // Compliance stubs.
  const compliance = buildComplianceStubs();
  for (const [k, v] of Object.entries(compliance)) {
    files[k] = v;
  }

  // Raw logs — best effort. Try kubectl capture for known artifact paths;
  // emit a placeholder if unavailable. We never block bundle creation on
  // log fetch failures.
  for (const r of runs) {
    const logPath = `raw_logs/run-${r.id}.log`;
    files[logPath] = tryFetchLogs(r, opts);
  }

  // methodology_caveats.md needs to know about LoadGen placeholders + log
  // placeholders, so it's built last.
  const pairCaveats: string[] = [];
  for (const r of runs) {
    if (r.precision_mismatch) {
      pairCaveats.push(
        `precision_mismatch on run ${r.id} (${r.precision ?? 'unknown'})`,
      );
    }
    if (r.drift_flag) {
      pairCaveats.push(`config_drift on run ${r.id}`);
    }
  }
  if (mlperfRuns.length > 0) {
    bundleCaveats.push(
      `${mlperfRuns.length} MLPerf run(s) — LoadGen artifacts are placeholders unless the underlying run was executed via the upstream LoadGen harness.`,
    );
  }
  files['methodology_caveats.md'] = buildMethodologyCaveatsMd(
    runs,
    pairCaveats,
    bundleCaveats,
  );

  const manifest: BundleManifest = {
    bundle_id: bundleId,
    built_at: builtAt,
    selector: opts.selector,
    api_base: opts.apiBase,
    files: Object.keys(files).sort(),
    caveats: bundleCaveats,
  };

  return { files, manifest };
}

function tryFetchLogs(run: ComparisonRun, opts: BundleOptions): string {
  // Best effort: the comparison row's `artifacts[]` lists log paths that
  // WS-A/B05 dropped on NFS. We don't actually mount NFS in this script;
  // we record the candidate paths and flag the fetch as not-attempted so
  // the bundle stays self-contained. A real implementation would shell
  // out to `kubectl cp` or pull from Loki via the API.
  void opts; // reserved for future log-fetch wiring
  const lines = [
    `# raw log placeholder for run ${run.id} (${run.benchmark}/${run.hardware.canonical})`,
    `# bundle builder did not attempt to fetch from NFS/Loki to keep this`,
    `# script side-effect free; populate via:`,
    `#   kubectl logs -n llm-evaluation <pod> > raw_logs/run-${run.id}.log`,
    `# Candidate artifact paths recorded by the run:`,
    ...run.artifacts.map((a) => `#   ${a}`),
  ];
  return lines.join('\n') + '\n';
}

export async function writeBundleToDisk(
  files: Record<string, string>,
  manifest: BundleManifest,
  bundleRoot: string,
): Promise<void> {
  fs.mkdirSync(bundleRoot, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(bundleRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  // Always materialize the MLPerf and raw_logs subdirs even when no
  // runs were emitted — the local checker treats their absence as a
  // structural failure (degraded bundles still need a valid skeleton).
  fs.mkdirSync(path.join(bundleRoot, 'mlperf'), { recursive: true });
  fs.mkdirSync(path.join(bundleRoot, 'raw_logs'), { recursive: true });
  fs.writeFileSync(
    path.join(bundleRoot, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
}

export function tarballBundle(bundleRoot: string, tarballPath: string): void {
  fs.mkdirSync(path.dirname(tarballPath), { recursive: true });
  // -C parent so the tarball contains <bundle-id>/... not the abs path.
  const parent = path.dirname(bundleRoot);
  const base = path.basename(bundleRoot);
  execFileSync('tar', ['-czf', tarballPath, '-C', parent, base], {
    stdio: 'inherit',
  });
}

// ---------------------------------------------------------------------------
// Top-level orchestration
// ---------------------------------------------------------------------------

export async function buildBundle(opts: BundleOptions): Promise<BundleResult> {
  const now = (opts.now ?? (() => new Date()))();
  const builtAt = now.toISOString();
  const stamp = builtAt.replace(/[:.]/g, '-');
  const idPart =
    opts.selector.kind === 'all-canonical'
      ? 'all-canonical'
      : `${opts.selector.kind}-${opts.selector.id}`;
  const bundleId = `${idPart}-${stamp}`;

  const { runs, caveats } = await fetchRuns(opts);
  const { files, manifest } = await assembleBundleFiles(
    opts,
    runs,
    caveats,
    bundleId,
    builtAt,
  );

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pubbundle-'));
  const bundleRoot = path.join(tmpRoot, bundleId);
  const tarballPath = path.resolve(opts.outDir, `${bundleId}.tgz`);

  if (opts.dryRun) {
    process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
    return { bundleDir: bundleRoot, tarballPath, manifest };
  }

  await writeBundleToDisk(files, manifest, bundleRoot);
  try {
    tarballBundle(bundleRoot, tarballPath);
  } catch (e) {
    throw new Error(`tarball creation failed: ${(e as Error).message}`);
  }
  process.stdout.write(`bundle written: ${tarballPath}\n`);

  return { bundleDir: bundleRoot, tarballPath, manifest };
}

// ---------------------------------------------------------------------------
// Tiny utilities — kept inline to avoid a dependency graph
// ---------------------------------------------------------------------------

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function isString(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function sha256Hex(s: string): string {
  // crypto is a node built-in; require lazily so test harnesses that mock
  // out the module graph don't trip.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(s).digest('hex');
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let opts: BundleOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n\n`);
    printHelp();
    process.exit(1);
  }

  try {
    await buildBundle(opts);
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`fatal: ${(e as Error).message}\n`);
    process.exit(3);
  });
}
