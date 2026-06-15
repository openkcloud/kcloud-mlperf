import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Dashboard No-Leak — E2E specs
// Acceptance criterion: each benchmark page only shows its iframe when that
// benchmark kind is actually running on a device of the matching class.
//
// NOTE: These tests mock the SSE endpoint. Against the deployed app (v27) the
// idle placeholder may not appear because the change has not been redeployed.
// Mark as BLOCKED-pending-redeploy for the PASS rate against live environment.
// ---------------------------------------------------------------------------

const makeSnapshot = (slots: object[]) => ({
  slots,
  sweep_progress: { completed: 0, total: 96, paused: true },
  operator_race_alerts: 0,
  timestamp: new Date().toISOString(),
});

const GPU_SLOT_MLPERF = {
  device_type: 'gpu',
  vendor: 'nvidia',
  model: 'NVIDIA-L40',
  node: 'node2',
  slot_id: 1,
  status: 'running',
  pending_join_reason: null,
  last_seen: null,
  current_exam: { id: 101, kind: 'mp', exam_name: 'mlperf-run-1', elapsed_seconds: 120 },
  last_known_metric: { tps: 55.2, tt100t_seconds: null },
  last_metric_timestamp: null,
  metrics_status: 'available',
};

const GPU_SLOT_MMLU = {
  ...GPU_SLOT_MLPERF,
  current_exam: { id: 102, kind: 'mm', exam_name: 'mmlu-run-1', elapsed_seconds: 60 },
};

const GPU_SLOT_IDLE = {
  ...GPU_SLOT_MLPERF,
  status: 'idle',
  current_exam: null,
  last_known_metric: { tps: null, tt100t_seconds: null },
  metrics_status: 'unavailable',
};

async function mockSse(page: import('@playwright/test').Page, slots: object[]) {
  const snapshot = makeSnapshot(slots);
  await page.route('**/realtime/exams**', async (route) => {
    const url = route.request().url();
    if (url.includes('/snapshot')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ type: 'snapshot', data: snapshot }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', data: snapshot })}\n\n`,
      });
    }
  });
}

// ---------------------------------------------------------------------------

test.describe('MLPerf page — dashboard scoping', () => {
  test('shows idle placeholder when no MLPerf exam is running', async ({ page }) => {
    await mockSse(page, [GPU_SLOT_IDLE]);
    await page.goto('/mlperf');
    await expect(
      page.getByText(/No MLPerf benchmark currently running on GPU devices/i)
    ).toBeVisible({ timeout: 5000 });
    // iframe must NOT be present
    await expect(page.locator('iframe[title*="MLPerf"]')).not.toBeVisible();
  });

  test('shows iframe when MLPerf exam is running', async ({ page }) => {
    await mockSse(page, [GPU_SLOT_MLPERF]);
    await page.goto('/mlperf');
    // Placeholder must NOT appear
    await expect(
      page.getByText(/No MLPerf benchmark currently running on GPU devices/i)
    ).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('iframe').first()).toBeVisible({ timeout: 5000 });
  });

  test('shows idle placeholder when MMLU (not MLPerf) is running on GPU', async ({ page }) => {
    await mockSse(page, [GPU_SLOT_MMLU]);
    await page.goto('/mlperf');
    await expect(
      page.getByText(/No MLPerf benchmark currently running on GPU devices/i)
    ).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------

test.describe('MMLU page — dashboard scoping', () => {
  test('shows idle placeholder when no MMLU exam is running', async ({ page }) => {
    await mockSse(page, [GPU_SLOT_IDLE]);
    await page.goto('/mmlu');
    await expect(
      page.getByText(/No MMLU-Pro benchmark currently running on GPU devices/i)
    ).toBeVisible({ timeout: 5000 });
  });

  test('shows iframe when MMLU exam is running', async ({ page }) => {
    await mockSse(page, [GPU_SLOT_MMLU]);
    await page.goto('/mmlu');
    await expect(
      page.getByText(/No MMLU-Pro benchmark currently running on GPU devices/i)
    ).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('iframe').first()).toBeVisible({ timeout: 5000 });
  });

  test('shows idle placeholder when MLPerf (not MMLU) is running on GPU', async ({ page }) => {
    await mockSse(page, [GPU_SLOT_MLPERF]);
    await page.goto('/mmlu');
    await expect(
      page.getByText(/No MMLU-Pro benchmark currently running on GPU devices/i)
    ).toBeVisible({ timeout: 5000 });
  });
});
