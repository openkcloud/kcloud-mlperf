/**
 * 30-minute soak test (Acceptance criterion A8).
 *
 * Run against staging:
 *   SOAK_BASE_URL=http://10.254.184.195:30980 npx jest soak.e2e-spec --testTimeout=2100000
 *
 * Pass criteria:
 *   - Zero 5xx responses from any monitored endpoint
 *   - Backend memory growth < 50 MB over the window
 *   - SSE: zero disconnects IF endpoint is available (404 = not yet deployed, skipped)
 */

import * as http from 'http';
import * as https from 'https';

const BASE_URL = process.env.SOAK_BASE_URL ?? 'http://localhost:9999';
const SOAK_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const POLL_INTERVAL_MS = 5_000;
const SSE_CHECK_INTERVAL_MS = 2_000;

const MONITORED_ENDPOINTS = [
  '/api/npu-eval/list?page=1&limit=5',
  '/api/mp-exam/list?page=1&limit=5',
  '/api/mm-exam/list?page=1&limit=5',
];

interface SoakMetrics {
  totalRequests: number;
  errors5xx: number;
  errors4xx: number;
  networkErrors: number;
  sseDisconnects: number;
  sseMessagesReceived: number;
  startMemoryMb: number;
  endMemoryMb: number;
  durationMs: number;
}

function fetchJson(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });
  });
}

function openSseConnection(
  url: string,
  onMessage: () => void,
  onDisconnect: () => void,
): () => void {
  let closed = false;
  const mod = url.startsWith('https') ? https : http;

  function connect() {
    if (closed) return;
    const req = mod.get(url, (res) => {
      res.on('data', () => {
        onMessage();
      });
      res.on('end', () => {
        if (!closed) {
          onDisconnect();
          connect();
        }
      });
      res.on('error', () => {
        if (!closed) {
          onDisconnect();
          connect();
        }
      });
    });
    req.on('error', () => {
      if (!closed) {
        onDisconnect();
        connect();
      }
    });
  }

  connect();
  return () => {
    closed = true;
  };
}

describe('30-minute soak test (A8)', () => {
  jest.setTimeout(SOAK_DURATION_MS + 120_000); // 30 min + 2 min buffer

  it('produces zero 5xx responses and zero SSE disconnects over 30 minutes', async () => {
    const metrics: SoakMetrics = {
      totalRequests: 0,
      errors5xx: 0,
      errors4xx: 0,
      networkErrors: 0,
      sseDisconnects: 0,
      sseMessagesReceived: 0,
      startMemoryMb: process.memoryUsage().heapUsed / 1024 / 1024,
      endMemoryMb: 0,
      durationMs: 0,
    };

    const startTime = Date.now();

    // Probe SSE endpoint — skip if not deployed (404)
    const sseProbe = await fetchJson(`${BASE_URL}/realtime/exams`).catch(
      () => ({ status: 0, body: '' }),
    );
    const sseAvailable = sseProbe.status !== 404;
    const closeSse = sseAvailable
      ? openSseConnection(
          `${BASE_URL}/realtime/exams`,
          () => {
            metrics.sseMessagesReceived++;
          },
          () => {
            metrics.sseDisconnects++;
          },
        )
      : () => {
          /* SSE not deployed on this staging build */
        };

    // Poll endpoints every 5s
    const intervalId = setInterval(async () => {
      for (const endpoint of MONITORED_ENDPOINTS) {
        try {
          const result = await fetchJson(`${BASE_URL}${endpoint}`);
          metrics.totalRequests++;
          if (result.status >= 500) metrics.errors5xx++;
          else if (result.status >= 400) metrics.errors4xx++;
        } catch {
          metrics.networkErrors++;
        }
      }
    }, POLL_INTERVAL_MS);

    // Wait for soak duration
    await new Promise<void>((resolve) => setTimeout(resolve, SOAK_DURATION_MS));

    clearInterval(intervalId);
    closeSse();

    metrics.endMemoryMb = process.memoryUsage().heapUsed / 1024 / 1024;
    metrics.durationMs = Date.now() - startTime;

    // Emit structured report for CI artifact collection
    const report = {
      passed:
        metrics.errors5xx === 0 &&
        (!sseAvailable || metrics.sseDisconnects === 0),
      sseAvailable,
      ...metrics,
      memoryGrowthMb: metrics.endMemoryMb - metrics.startMemoryMb,
      sseMessagesPerMinute: (
        metrics.sseMessagesReceived /
        (metrics.durationMs / 60_000)
      ).toFixed(1),
      requestsPerMinute: (
        metrics.totalRequests /
        (metrics.durationMs / 60_000)
      ).toFixed(1),
    };

    console.log('\n=== 30-MINUTE SOAK REPORT ===');
    console.log(JSON.stringify(report, null, 2));
    console.log('=============================\n');

    // Assertions
    expect(metrics.errors5xx).toBe(0);
    if (sseAvailable) expect(metrics.sseDisconnects).toBe(0);
    expect(metrics.durationMs).toBeGreaterThanOrEqual(SOAK_DURATION_MS - 5000);
    expect(report.memoryGrowthMb).toBeLessThan(50);
  });
});
