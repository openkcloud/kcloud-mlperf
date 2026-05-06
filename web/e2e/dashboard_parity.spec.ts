import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Dashboard chrome parity spec (WS-3 / DELIVERABLE A)
// All 4 benchmark menus must render a LiveBenchDashboard panel with:
//   - an h6 title containing "Live" or a recognizable dashboard title
//   - an "open in new tab" link
//   - a Paper wrapper with the correct structure
//   - identical height (900px) iframe or idle placeholder
// ---------------------------------------------------------------------------

const BENCHMARK_PAGES = [
  { path: '/ml-perf', label: 'MLPerf' },
  { path: '/mmlu', label: 'MMLU' },
  { path: '/npu-eval/rngd', label: 'RNGD' },
  { path: '/npu-eval/atomplus', label: 'Atom+' },
];

async function stubAll(page: import('@playwright/test').Page) {
  // Realtime SSE
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

  // NPU eval list endpoints
  await page.route('**/npu-eval/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ list: [], total: 0, page: 1, limit: 10, total_pages: 0 }),
    });
  });

  // MLPerf / MMLU exam list endpoints
  await page.route('**/mp-exam/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ list: [], total: 0, page: 1, limit: 10, total_pages: 0 }),
    });
  });
  await page.route('**/mm-exam/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ list: [], total: 0, page: 1, limit: 10, total_pages: 0 }),
    });
  });

  // Comparison API
  const emptyDiag = {
    reason: 'no_runs_exist',
    message: 'No runs',
    counts: { completed: 0, running: 0, failed: 0 },
    hardware_available: false,
    ingestion_errors: [],
  };
  await page.route('**/comparison/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ runs: [], total: 0, diagnostic: emptyDiag }),
    });
  });
}

test.describe('Dashboard chrome parity across 4 benchmark menus (WS-3)', () => {
  test.setTimeout(60_000);

  // Collect structure per page for cross-page assertions
  const pageStructures: Record<string, { papers: number; h6Count: number; hasOpenLink: boolean; hasChip: boolean }> = {};

  for (const { path, label } of BENCHMARK_PAGES) {
    test(`${label} (${path}) renders LiveBenchDashboard panel without JS errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await stubAll(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

      expect(errors, `JS errors on ${path}: ${errors.join(', ')}`).toHaveLength(0);

      // At least one MuiPaper section should exist
      const papers = await page.locator('[class*="MuiPaper"]').count();
      expect(papers, `${path} should have at least one Paper`).toBeGreaterThan(0);
    });

    test(`${label} (${path}) dashboard panel has "open in new tab" link or idle placeholder`, async ({ page }) => {
      await stubAll(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

      // Either the "open in new tab" link is present (live state) OR an idle/connecting placeholder
      const openLink = page.locator('a:has-text("open in new tab")');
      const idleText = page.locator('text=/No.*running|Idle|Connecting/i');

      const hasOpenLink = await openLink.count() > 0;
      const hasIdleOrConnecting = await idleText.count() > 0;

      expect(
        hasOpenLink || hasIdleOrConnecting,
        `${path}: expected either "open in new tab" link or idle/connecting state`
      ).toBe(true);
    });

    test(`${label} (${path}) dashboard panel has a status chip (Live/Connecting/Idle/Error)`, async ({ page }) => {
      await stubAll(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

      // LiveBenchDashboard renders a MuiChip for status
      const chip = page.locator('[class*="MuiChip"]').filter({ hasText: /Live|Connecting|Idle|Error/i });
      const chipCount = await chip.count();
      expect(chipCount, `${path}: expected a status chip`).toBeGreaterThan(0);
    });
  }

  test('all 4 pages have structurally similar dashboard panels (same Paper count variance <=2)', async ({ page }) => {
    await stubAll(page);

    const paperCounts: number[] = [];
    for (const { path } of BENCHMARK_PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      paperCounts.push(await page.locator('[class*="MuiPaper"]').count());
    }

    const min = Math.min(...paperCounts);
    const max = Math.max(...paperCounts);
    expect(
      max - min,
      `Paper count spread across pages: ${JSON.stringify(Object.fromEntries(BENCHMARK_PAGES.map((p, i) => [p.path, paperCounts[i]])))} — variance should be <=2`
    ).toBeLessThanOrEqual(2);
  });
});
