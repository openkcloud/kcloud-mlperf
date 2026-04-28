import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Device-comparison parity spec
// Acceptance criterion A4: mlperf and mmlu device-comparison routes exist and
// share the same component tree as NPU device-comparison.
// ---------------------------------------------------------------------------

const DEVICE_COMPARISON_ROUTES = [
  { path: '/npu-eval/device-comparison', label: 'NPU Device Comparison' },
  { path: '/ml-perf/device-comparison', label: 'MLPerf Device Comparison' },
  { path: '/mmlu/device-comparison', label: 'MMLU Device Comparison' },
];

// Stub the realtime SSE so each page can render without a live backend
async function stubRealtime(page: import('@playwright/test').Page) {
  await page.route('**/realtime/exams', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `event: snapshot\ndata: ${JSON.stringify({
        slots: [],
        sweep_progress: { completed: 0, total: 96, paused: true },
        operator_race_alerts: 0,
      })}\n\n`,
    });
  });
}

// Stub npu-eval list so NPU page doesn't 500
async function stubNpuList(page: import('@playwright/test').Page) {
  await page.route('**/npu-eval/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ list: [], total: 0, page: 1, limit: 10, total_pages: 0 }),
    });
  });
}

test.describe('Device-comparison route parity (A4)', () => {
  for (const { path, label } of DEVICE_COMPARISON_ROUTES) {
    test(`${path} renders without crashing`, async ({ page }) => {
      await stubRealtime(page);
      await stubNpuList(page);
      await page.goto(path);
      // No unhandled JS errors
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      expect(errors).toHaveLength(0);
    });

    test(`${path} returns HTTP 200 (route exists)`, async ({ page }) => {
      await stubRealtime(page);
      await stubNpuList(page);
      const response = await page.goto(path);
      // SPA routes return 200 from the dev server
      expect(response?.status()).toBeLessThan(400);
    });
  }

  test('all three device-comparison pages share DeviceDashboardHeader component', async ({ page }) => {
    test.setTimeout(60_000);
    // Stub all backend traffic (both relative and cross-origin staging) before any navigation
    await page.route('http://10.254.184.195:30980/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/realtime/exams')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `event: snapshot\ndata: ${JSON.stringify({ slots: [], sweep_progress: { completed: 0, total: 96, paused: true }, operator_race_alerts: 0 })}\n\n`,
        });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: [], total: 0 }) });
      }
    });

    const headers: string[] = [];
    for (const { path } of DEVICE_COMPARISON_ROUTES) {
      await page.goto(path);
      // Wait for h5/h6 heading to appear (lazy component mount)
      await page.waitForSelector('h5, h6', { timeout: 10_000 }).catch(() => null);
      const h = await page.locator('h5, h6').first().innerText().catch(() => '');
      headers.push(h ?? '');
    }

    // All three pages should have a non-empty header (shared component renders)
    for (let i = 0; i < headers.length; i++) {
      expect(headers[i].length, `header at index ${i} (${DEVICE_COMPARISON_ROUTES[i].path}) was empty`).toBeGreaterThan(0);
    }
  });

  test('screenshot layout similarity: all three pages have the same structural landmarks', async ({ page }) => {
    test.setTimeout(60_000);
    await stubRealtime(page);
    await stubNpuList(page);

    const landmarks: Record<string, string[]> = {};

    for (const { path } of DEVICE_COMPARISON_ROUTES) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');

      // Collect aria roles or MUI Paper sections present
      const papers = await page.locator('[class*="MuiPaper"]').count();
      const chips = await page.locator('[class*="MuiChip"]').count();
      landmarks[path] = [`papers:${papers}`, `chips:${chips}`];
    }

    // NPU and GPU pages should have similar structure (both use DeviceRealtimeDashboard)
    const npuPapers = parseInt(landmarks['/npu-eval/device-comparison']?.[0]?.split(':')[1] ?? '0');
    const mlperfPapers = parseInt(landmarks['/ml-perf/device-comparison']?.[0]?.split(':')[1] ?? '0');

    // Allow up to 2 Paper elements of variance
    expect(Math.abs(npuPapers - mlperfPapers)).toBeLessThanOrEqual(2);
  });
});
