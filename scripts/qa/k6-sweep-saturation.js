#!/usr/bin/env k6
// WS-T02 — Load test: sweep saturation, concurrent POSTs, SSE flood
// Usage:
//   k6 run scripts/qa/k6-sweep-saturation.js
//   k6 run --env SCENARIO=concurrent_posts scripts/qa/k6-sweep-saturation.js
//   k6 run --env SCENARIO=sse_flood --env BASE_URL=http://localhost:3000 scripts/qa/k6-sweep-saturation.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SCENARIO = __ENV.SCENARIO || 'sweep_saturation';

const errorRate = new Rate('errors');
const successCount = new Counter('successes');

// ── Scenario 1: sweep saturation (110 cells, max_concurrent=2) ──────────────
const sweepSaturationOptions = {
  scenarios: {
    sweep_saturation: {
      executor: 'constant-vus',
      vus: 5,
      duration: '120s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],          // <1% failures
    http_req_duration: ['p(95)<2000'],       // p95 < 2s
    errors: ['rate<0.01'],
  },
};

// ── Scenario 2: 50 simultaneous benchmark POSTs ──────────────────────────────
const concurrentPostsOptions = {
  scenarios: {
    concurrent_posts: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 50,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
};

// ── Scenario 3: SSE flood (50 concurrent subscribers) ───────────────────────
const sseFloodOptions = {
  scenarios: {
    sse_flood: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
    },
  },
  thresholds: {
    // checks pass for both 200 group and 503 group
    checks: ['rate>0.95'],
  },
};

export const options =
  SCENARIO === 'concurrent_posts'
    ? concurrentPostsOptions
    : SCENARIO === 'sse_flood'
    ? sseFloodOptions
    : sweepSaturationOptions;

// ── Default function dispatches based on SCENARIO env var ───────────────────
export default function () {
  if (SCENARIO === 'concurrent_posts') {
    runConcurrentPosts();
  } else if (SCENARIO === 'sse_flood') {
    runSseFlood();
  } else {
    runSweepSaturation();
  }
}

// ── Scenario 1 impl ──────────────────────────────────────────────────────────
function runSweepSaturation() {
  // Poll the sweep status endpoint to assert no 5xx during a running sweep.
  // The sweep itself is pre-created manually; this script monitors and asserts.
  const sweepId = __ENV.SWEEP_ID || '1';
  const res = http.get(`${BASE_URL}/api/sweep/${sweepId}`, {
    headers: { 'Content-Type': 'application/json' },
  });

  const ok = check(res, {
    'sweep status not 5xx': (r) => r.status < 500,
    'sweep status 2xx or 404': (r) => r.status === 200 || r.status === 404,
  });

  errorRate.add(!ok);
  if (ok) successCount.add(1);

  sleep(1);
}

// ── Scenario 2 impl ──────────────────────────────────────────────────────────
function runConcurrentPosts() {
  const vuId = __VU;
  const iterationId = __ITER;
  const uniqueName = `load-test-vu${vuId}-iter${iterationId}-${Date.now()}`;

  const payload = JSON.stringify({
    name: uniqueName,
    gpu_type: 'NVIDIA-L40',
    device_type: 'GPU',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    dataset: 'cnn_eval',
    precision: 'FP8',
    batch_size: 1,
    data_number: 13368,
    scenario: 'Offline',
  });

  const res = http.post(`${BASE_URL}/api/mp-exam`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  const ok = check(res, {
    'POST not 5xx': (r) => r.status < 500,
    'POST accepted (201 or 409)': (r) => r.status === 201 || r.status === 409 || r.status === 200,
  });

  errorRate.add(!ok);
  if (ok) successCount.add(1);
}

// ── Scenario 3 impl ──────────────────────────────────────────────────────────
function runSseFlood() {
  const res = http.get(`${BASE_URL}/api/realtime/stream`, {
    headers: { Accept: 'text/event-stream' },
    timeout: '5s',
  });

  // VUs 1-20: expect 200; VUs 21+: expect 503 with X-Fallback header
  if (__VU <= 20) {
    const ok = check(res, {
      '200 OK for first 20 VUs': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  } else {
    const ok = check(res, {
      '503 for overflow VUs': (r) => r.status === 503,
      'X-Fallback header present': (r) => r.headers['X-Fallback'] === 'true',
    });
    errorRate.add(!ok);
  }

  sleep(1);
}
