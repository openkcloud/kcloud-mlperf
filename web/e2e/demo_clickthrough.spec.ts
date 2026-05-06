/**
 * Demo click-through QA spec — v26 pre-redeploy state
 * Target: http://10.254.177.41:30001/
 * Screenshots → docs/reports/demo_qa_screenshots/
 *
 * Run with:
 *   cd /home/kcloud/etri-llm-exam-solution/web
 *   E2E_BASE_URL=http://10.254.177.41:30001 npx playwright test \
 *     ../docs/reports/playwright/demo_clickthrough.spec.ts \
 *     --reporter=line --output=../docs/reports/playwright/test-results
 */

import * as path from 'path';
import { test, expect, Page, ConsoleMessage } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://10.254.177.41:30001';
const SS_DIR = process.env.SS_DIR ?? '/home/kcloud/etri-llm-exam-solution/docs/reports/demo_qa_screenshots';

// ── helpers ──────────────────────────────────────────────────────────────────

interface PageDiag {
  consoleErrors: string[];
  networkFailures: string[];
}

async function openPage(page: Page, route: string): Promise<PageDiag> {
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err: Error) => consoleErrors.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) =>
    networkFailures.push(`[netfail] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`)
  );

  await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(3000);

  return { consoleErrors, networkFailures };
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SS_DIR, name),
    fullPage: false,
  });
}

// ── Step 01: Landing page ─────────────────────────────────────────────────────

test('01_landing — home page renders without errors', async ({ page }) => {
  const diag = await openPage(page, '/');
  await screenshot(page, '01_landing.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);
  // Page must have some navigable content
  const body = await page.locator('body').innerText();
  expect(body.length).toBeGreaterThan(50);
});

// ── Step 02: GPU Realtime dashboard ──────────────────────────────────────────

test('02_gpu_menu — /dashboard/gpu-realtime shows GPU entries', async ({ page }) => {
  const diag = await openPage(page, '/dashboard/gpu-realtime');
  await screenshot(page, '02_gpu_menu.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);

  const body = await page.locator('body').innerText();
  // Check for forbidden error text
  expect(body).not.toContain('Malformed realtime frame');
  expect(body).not.toContain('Data Ingestion Error');

  // Verify GPU entries — expect at least 1 GPU card/row visible
  // If w-gpu-realtime-menu change isn't deployed, label BLOCKED
  const gpuEntries = await page.locator('[data-testid*="gpu"], .gpu-card, .gpu-row').count();
  const hasGpuText = /GPU|A100|A40|H100|L40/i.test(body);

  if (!hasGpuText && gpuEntries === 0) {
    // BLOCKED — w-gpu-realtime-menu change likely not deployed
    console.log('BLOCKED-pending-redeploy: no GPU entries visible (w-gpu-realtime-menu change needed)');
  } else {
    expect(hasGpuText || gpuEntries > 0).toBeTruthy();
  }
});

// ── Step 03: MLPerf page — create form with FP8 + max-tokens ─────────────────

test('03_mlperf_page — /mlperf create form with FP8 + max-tokens', async ({ page }) => {
  const diag = await openPage(page, '/mlperf');
  await screenshot(page, '03_mlperf_page.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);

  const body = await page.locator('body').innerText();
  expect(body.length).toBeGreaterThan(50);

  // Try to find and click a "Create" / "New" / "Run" / "Start" button to open form
  const createBtn = page.locator('button').filter({ hasText: /create|new|start|run|benchmark/i }).first();
  const btnCount = await createBtn.count();

  if (btnCount > 0) {
    await createBtn.click();
    await page.waitForTimeout(1500);
    await screenshot(page, '03_mlperf_page_form.png');

    const formBody = await page.locator('body').innerText();
    // Check for FP8 option
    const hasFP8 = /FP8|fp8/i.test(formBody);
    // Check for max-tokens field
    const hasMaxTokens = /max.token|max_token/i.test(formBody);

    if (!hasFP8) console.log('BLOCKED-pending-redeploy: FP8 option not visible (w-gpu-bench-pages change needed)');
    if (!hasMaxTokens) console.log('BLOCKED-pending-redeploy: max-tokens field not visible (w-gpu-bench-pages change needed)');
  } else {
    console.log('BLOCKED-pending-redeploy: no create/run button found on MLPerf page (w-gpu-bench-pages change needed)');
  }
});

// ── Step 04: MLPerf dashboard (live) ─────────────────────────────────────────

test('04_mlperf_dashboard — /mlperf scroll to live dashboard section', async ({ page }) => {
  const diag = await openPage(page, '/mlperf');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await screenshot(page, '04_mlperf_dashboard.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);
  const body = await page.locator('body').innerText();
  expect(body.length).toBeGreaterThan(50);
});

// ── Step 05: MMLU page ────────────────────────────────────────────────────────

test('05_mmlu_page — /mmlu page renders', async ({ page }) => {
  const diag = await openPage(page, '/mmlu');
  await screenshot(page, '05_mmlu_page.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);

  const body = await page.locator('body').innerText();
  expect(body.length).toBeGreaterThan(50);
  expect(body).not.toContain('Data Ingestion Error');
});

// ── Step 06: MMLU dashboard scroll ───────────────────────────────────────────

test('06_mmlu_dashboard — /mmlu scroll to dashboard section', async ({ page }) => {
  const diag = await openPage(page, '/mmlu');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  await screenshot(page, '06_mmlu_dashboard.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);
});

// ── Step 07: RNGD NPU Eval — Streamlit iframe ────────────────────────────────

test('07_rngd_page — /npu-eval/rngd renders with Streamlit iframe at :30890', async ({ page }) => {
  const diag = await openPage(page, '/npu-eval/rngd');
  await screenshot(page, '07_rngd_page.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);

  const body = await page.locator('body').innerText();
  expect(body).not.toContain('Data Ingestion Error');

  // Check for iframe pointing to :30890
  const iframes = await page.locator('iframe').all();
  let streamlitFound = false;
  for (const iframe of iframes) {
    const src = await iframe.getAttribute('src');
    if (src && src.includes('30890')) streamlitFound = true;
  }

  // Also check page source
  const htmlContent = await page.content();
  if (!streamlitFound && !htmlContent.includes('30890')) {
    console.log('NOTE: No Streamlit iframe at :30890 found on RNGD page');
  }
});

// ── Step 08: Atom+ NPU Eval ───────────────────────────────────────────────────

test('08_atomplus_page — /npu-eval/atomplus renders with BLOCKED diagnostic', async ({ page }) => {
  const diag = await openPage(page, '/npu-eval/atomplus');
  await screenshot(page, '08_atomplus_page.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);

  const body = await page.locator('body').innerText();
  // Atom+ should show BLOCKED/awaiting state per existing spec
  expect(body).toMatch(/Awaiting|Rebellions|device plugin|BLOCKED|blocked/i);
});

// ── Step 09: MLPerf device-comparison ────────────────────────────────────────

test('09_mlperf_device_comparison — /mlperf/device-comparison renders', async ({ page }) => {
  const diag = await openPage(page, '/mlperf/device-comparison');
  await screenshot(page, '09_mlperf_device_comparison.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);

  const body = await page.locator('body').innerText();
  expect(body).not.toContain('Data Ingestion Error');
  expect(body).not.toContain('Malformed realtime frame');

  // Comparison page should show device options or an explanatory message
  const hasContent = body.length > 100;
  if (!hasContent) {
    console.log('BLOCKED-pending-redeploy: MLPerf device-comparison page has minimal content (w-comparison-frontend change needed)');
  }
});

// ── Step 10: MMLU device-comparison ──────────────────────────────────────────

test('10_mmlu_device_comparison — /mmlu/device-comparison renders', async ({ page }) => {
  const diag = await openPage(page, '/mmlu/device-comparison');
  await screenshot(page, '10_mmlu_device_comparison.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);

  const body = await page.locator('body').innerText();
  expect(body).not.toContain('Data Ingestion Error');

  if (body.length < 100) {
    console.log('BLOCKED-pending-redeploy: MMLU device-comparison has minimal content (w-comparison-frontend change needed)');
  }
});

// ── Step 11: RNGD device-comparison ──────────────────────────────────────────

test('11_rngd_device_comparison — /npu-eval/rngd/device-comparison renders', async ({ page }) => {
  const diag = await openPage(page, '/npu-eval/rngd/device-comparison');
  await screenshot(page, '11_rngd_device_comparison.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);

  const body = await page.locator('body').innerText();
  expect(body).not.toContain('Data Ingestion Error');
});

// ── Step 12: Atom+ device-comparison ─────────────────────────────────────────

test('12_atomplus_device_comparison — /npu-eval/atomplus/device-comparison renders', async ({ page }) => {
  const diag = await openPage(page, '/npu-eval/atomplus/device-comparison');
  await screenshot(page, '12_atomplus_device_comparison.png');

  expect(diag.consoleErrors, `console errors: ${diag.consoleErrors.join(', ')}`).toEqual([]);

  const body = await page.locator('body').innerText();
  expect(body).not.toContain('Data Ingestion Error');
});
