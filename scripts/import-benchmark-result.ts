#!/usr/bin/env ts-node
/**
 * Import a benchmark result from results/{run-id}/result.json into the DB.
 *
 * Usage:
 *   ts-node scripts/import-benchmark-result.ts [--dry-run] [--path <result.json>]
 *
 * With no --path, reads from stdin or uses a sample fixture.
 *
 * Exit codes: 0 = success/skipped (idempotent), 1 = validation error, 2 = DB error
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

// ---------------------------------------------------------------------------
// Schema — mirrors .omc/handoffs/result-schema.json
// ---------------------------------------------------------------------------

export interface BenchmarkResult {
  run_id: string;
  hardware: string;
  vendor: 'nvidia' | 'furiosa' | 'rebellions' | 'unknown';
  benchmark: 'mlperf' | 'mmlu';
  model: string;
  precision: string;
  started_at: string;   // ISO 8601
  completed_at: string; // ISO 8601
  status: 'completed' | 'failed';
  failure_reason: string | null;
  tt100t_seconds: number | null;
  elapsed_seconds: number;
  throughput_tokens_per_sec: number | null;
  raw_metrics: Record<string, unknown>;
  logs_path: string;
  artifact_path: string;
  config_fingerprint: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(obj: unknown): BenchmarkResult {
  if (!obj || typeof obj !== 'object') {
    throw new Error('result.json must be a JSON object');
  }
  const r = obj as Record<string, unknown>;

  const required = [
    'run_id', 'hardware', 'vendor', 'benchmark', 'model', 'precision',
    'started_at', 'completed_at', 'status', 'failure_reason', 'tt100t_seconds',
    'elapsed_seconds', 'throughput_tokens_per_sec', 'raw_metrics',
    'logs_path', 'artifact_path', 'config_fingerprint',
  ] as const;

  for (const k of required) {
    if (!(k in r)) throw new Error(`Missing required field: ${k}`);
  }

  if (!['mlperf', 'mmlu'].includes(r.benchmark as string)) {
    throw new Error(`benchmark must be 'mlperf' or 'mmlu', got: ${r.benchmark}`);
  }
  if (!['completed', 'failed'].includes(r.status as string)) {
    throw new Error(`status must be 'completed' or 'failed', got: ${r.status}`);
  }
  if (!['nvidia', 'furiosa', 'rebellions', 'unknown'].includes(r.vendor as string)) {
    throw new Error(`vendor must be one of nvidia/furiosa/rebellions/unknown, got: ${r.vendor}`);
  }
  if (typeof r.elapsed_seconds !== 'number' || r.elapsed_seconds < 0) {
    throw new Error('elapsed_seconds must be a non-negative number');
  }
  if (typeof r.raw_metrics !== 'object' || r.raw_metrics === null) {
    throw new Error('raw_metrics must be an object');
  }

  return r as unknown as BenchmarkResult;
}

// ---------------------------------------------------------------------------
// Compute elapsed from ISO timestamps
// ---------------------------------------------------------------------------

export function computeElapsed(startedAt: string, completedAt: string): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (isNaN(start) || isNaN(end)) return 0;
  return Math.max(0, (end - start) / 1000);
}

// ---------------------------------------------------------------------------
// Backend POST (idempotent upsert via custom endpoint)
// ---------------------------------------------------------------------------

interface ImportResponse {
  imported: boolean;
  skipped: boolean;
  run_id: string;
  reason?: string;
}

function postJson(url: string, body: unknown): Promise<ImportResponse> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            const json = JSON.parse(text) as { data?: ImportResponse } & ImportResponse;
            resolve((json.data ?? json) as ImportResponse);
          } catch (e) {
            reject(new Error(`Failed to parse backend response: ${e}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Derive config_fingerprint stub (replaced once W8 lands)
// ---------------------------------------------------------------------------

function stubFingerprint(r: BenchmarkResult): string {
  if (r.config_fingerprint && r.config_fingerprint !== 'unfingerprinted') {
    return r.config_fingerprint;
  }
  // Deterministic stub based on observable config fields
  const key = [r.benchmark, r.model, r.precision, r.hardware].join('|');
  return `stub-${Buffer.from(key).toString('base64').slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const pathIdx = args.indexOf('--path');
  const resultPath = pathIdx !== -1 ? args[pathIdx + 1] : null;

  const backendUrl =
    process.env.IMPORT_BACKEND_URL ||
    'http://localhost:3000/api/import/benchmark-result';

  // Load input
  let raw: string;
  if (resultPath) {
    raw = fs.readFileSync(path.resolve(resultPath), 'utf8');
  } else if (!process.stdin.isTTY && process.stdin.readable) {
    try {
      raw = fs.readFileSync('/dev/stdin', 'utf8');
      if (!raw.trim()) throw new Error('empty stdin');
    } catch {
      raw = JSON.stringify(sampleResult());
      console.log('[import] Empty stdin; using built-in sample fixture');
    }
  } else {
    // No input — use sample fixture for --dry-run smoke test
    raw = JSON.stringify(sampleResult());
    console.log('[import] No --path given; using built-in sample fixture');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[import] ERROR: Invalid JSON:', e);
    process.exit(1);
  }

  let result: BenchmarkResult;
  try {
    result = validate(parsed);
  } catch (e) {
    console.error('[import] ERROR: Validation failed:', (e as Error).message);
    process.exit(1);
  }

  // Fill in derived fields if missing
  if (!result.elapsed_seconds || result.elapsed_seconds === 0) {
    result.elapsed_seconds = computeElapsed(result.started_at, result.completed_at);
  }
  result.config_fingerprint = stubFingerprint(result);

  console.log('[import] Validated result:', {
    run_id: result.run_id,
    benchmark: result.benchmark,
    status: result.status,
    elapsed_seconds: result.elapsed_seconds,
    tt100t_seconds: result.tt100t_seconds,
  });

  if (dryRun) {
    console.log('[import] --dry-run: skipping backend POST');
    console.log('[import] Payload preview:', JSON.stringify(result, null, 2));
    console.log('[import] SUCCESS (dry-run)');
    process.exit(0);
  }

  try {
    const resp = await postJson(backendUrl, result);
    if (resp.skipped) {
      console.log(`[import] SKIPPED (already imported): run_id=${result.run_id}`);
    } else if (resp.imported) {
      console.log(`[import] IMPORTED: run_id=${result.run_id}`);
    } else {
      console.log('[import] Backend response:', resp);
    }
  } catch (e) {
    console.error('[import] ERROR: Backend POST failed:', (e as Error).message);
    console.error('[import] Set IMPORT_BACKEND_URL env var if backend is not on localhost:3000');
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Sample fixture (used for --dry-run smoke test)
// ---------------------------------------------------------------------------

export function sampleResult(): BenchmarkResult {
  const started = '2026-04-29T07:16:49+09:00';
  const completed = '2026-04-29T07:46:49+09:00';
  return {
    run_id: 'mlperf-1-1',
    hardware: 'NVIDIA-L40',
    vendor: 'nvidia',
    benchmark: 'mlperf',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    precision: 'FP16',
    started_at: started,
    completed_at: completed,
    status: 'completed',
    failure_reason: null,
    tt100t_seconds: 1.588,
    elapsed_seconds: computeElapsed(started, completed),
    throughput_tokens_per_sec: 62.94,
    raw_metrics: {
      result_perf_tps: 62.94,
      result_perf_sps: 1.4,
      result_perf_tps_best: 146960,
      result_perf_sps_best: null,
      result_perf_valid: 'VALID',
      result_perf_latency: null,
      result_perf_serv_ttft: null,
      result_perf_serv_tpot: null,
      result_acc_rg_1: null,
      result_acc_rg_2: null,
      result_acc_rg_l: null,
      result_acc_rg_lsum: null,
      result_acc_total: null,
      result_vram_peak: 38.2,
      result_gpu_util: 0.87,
    },
    logs_path: 'results/mlperf-1/1/',
    artifact_path: 'results/mlperf-1/1/exam_result.zip',
    config_fingerprint: 'unfingerprinted',
  };
}

// Only run when invoked directly (not when imported by tests)
if (require.main === module) {
  main().catch((e) => {
    console.error('[import] FATAL:', e);
    process.exit(2);
  });
}
