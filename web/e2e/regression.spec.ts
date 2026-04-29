// Regression spec covering every user-reported defect class.
// Run against the live cluster: BASE_URL=http://10.254.177.41:30001
// Run against a dev server: BASE_URL=http://localhost:5173
//
//   npx playwright test --reporter=line
//
// Prerequisites:
//   npm install --save-dev @playwright/test
//   npx playwright install chromium
//
// Each test corresponds 1:1 with a user-reported failure plus the
// post-fix invariants the recovery mission required.

import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || process.env.BASE_URL || 'http://10.254.177.41:30001';

const FORBIDDEN_TEXT = [
  'Malformed realtime frame',
  'Data Ingestion Error',
  'Data ingestion error',
];

async function load(page: import('@playwright/test').Page, route: string) {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[console.error] ${m.text()}`);
  });
  await page.goto(BASE + route, { waitUntil: 'load', timeout: 25_000 });
  await page.waitForTimeout(4000); // let SSE / candidates land
  return consoleErrors;
}

async function bodyText(page: import('@playwright/test').Page) {
  return page.locator('body').innerText();
}

test.describe('navigation — no duplicate menus', () => {
  test('exactly one RNGD link and one Atom+ link in sidebar', async ({ page }) => {
    await load(page, '/');
    const rngd = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, [role="link"]'));
      return links.filter((a) =>
        /RNGD/i.test(a.textContent || '') && /NPU\s+Eval/i.test(a.textContent || '')
      ).length;
    });
    const atom = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, [role="link"]'));
      return links.filter(
        (a) => /Atom\+|Rebellions\s+Atom/i.test(a.textContent || '') && /NPU\s+Eval/i.test(a.textContent || '')
      ).length;
    });
    expect(rngd).toBe(1);
    expect(atom).toBe(1);
  });
});

test.describe('Atom+ NPU Eval — honest BLOCKED state', () => {
  test('page reachable, shows BLOCKED diagnostic, no Run button', async ({ page }) => {
    const errors = await load(page, '/npu-eval/atomplus');
    expect(errors, 'no console errors').toEqual([]);
    const text = await bodyText(page);
    expect(text).toMatch(/Awaiting|Rebellions|device plugin/i);
    const runButtons = await page
      .locator('button')
      .filter({ hasText: /^run\b|launch|start benchmark/i })
      .count();
    expect(runButtons).toBe(0);
  });
});

test.describe('RNGD NPU Eval — TT100T badge wired', () => {
  test('TT100T values render (not hardcoded null)', async ({ page }) => {
    const errors = await load(page, '/npu-eval/rngd');
    expect(errors, 'no console errors').toEqual([]);
    const text = await bodyText(page);
    expect(text).toMatch(/1\.2[0-9]/); // real RNGD TT100T values are ~1.26s
  });
});

test.describe('GPU realtime dashboard', () => {
  test('no Malformed realtime frame, no console errors', async ({ page }) => {
    const errors = await load(page, '/dashboard/gpu-realtime');
    expect(errors).toEqual([]);
    const text = await bodyText(page);
    for (const f of FORBIDDEN_TEXT) {
      expect(text, `forbidden text "${f}" must not appear`).not.toContain(f);
    }
  });
});

test.describe('NPU realtime dashboard', () => {
  test('no Malformed realtime frame, no console errors', async ({ page }) => {
    const errors = await load(page, '/dashboard/npu-realtime');
    expect(errors).toEqual([]);
    const text = await bodyText(page);
    for (const f of FORBIDDEN_TEXT) {
      expect(text).not.toContain(f);
    }
  });
});

test.describe('comparison ingestion', () => {
  for (const [name, route] of [
    ['mlperf', '/mlperf/device-comparison'],
    ['mmlu', '/mmlu/device-comparison'],
    ['npu', '/npu-eval/device-comparison'],
  ] as const) {
    test(`${name} comparison page has no Data Ingestion Error`, async ({ page }) => {
      const errors = await load(page, route);
      expect(errors).toEqual([]);
      const text = await bodyText(page);
      for (const f of FORBIDDEN_TEXT) {
        expect(text).not.toContain(f);
      }
    });
  }
});

test.describe('comparison API contract', () => {
  test('candidates + pair endpoints return real data', async ({ request }) => {
    const list = await request.get(BASE + '/api/comparison/list?limit=2');
    expect(list.ok()).toBeTruthy();
    const listBody = await list.json();
    expect(listBody.data.total).toBeGreaterThan(0);

    const diag = await request.get(BASE + '/api/comparison/diagnostics');
    expect(diag.ok()).toBeTruthy();
    const diagBody = await diag.json();
    expect(diagBody.data.ingestion.errors).toBe(0);

    // Pick the first run id and confirm candidates flow.
    const runId = listBody.data.runs[0].id;
    const cand = await request.get(BASE + `/api/comparison/candidates?runId=${runId}`);
    expect(cand.ok()).toBeTruthy();
    const candBody = await cand.json();
    expect(candBody.data.source.id).toBe(runId);
  });
});

test.describe('home page (MLPerf root) — no synchronous TypeError', () => {
  test('renders without pageerror', async ({ page }) => {
    const errors = await load(page, '/');
    expect(errors).toEqual([]);
  });
});

test.describe('sweep control — admin-only, no crash', () => {
  test('admin sweep page renders without TypeError', async ({ page }) => {
    const errors = await load(page, '/admin/sweep-control');
    expect(errors).toEqual([]);
    const text = await bodyText(page);
    expect(text).toMatch(/Admin-only|Sweep|admin/i);
  });
});
