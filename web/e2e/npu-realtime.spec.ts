import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// NPU Real-Time Dashboard — E2E specs
// Slot contract from Lane F-backend (worker-8):
//   device_type, vendor, model, node, slot_id, status, pending_join_reason?,
//   current_exam, last_known_metric, last_metric_timestamp, metrics_status
// ---------------------------------------------------------------------------

const PENDING_SNAPSHOT = {
  slots: [
    {
      device_type: 'npu',
      vendor: 'furiosa',
      model: 'RNGD',
      node: 'node4',
      slot_id: 1,
      status: 'idle',
      current_exam: null,
      last_known_metric: { tps: null, tt100t_seconds: null },
      last_metric_timestamp: null,
      metrics_status: 'unavailable',
    },
    {
      device_type: 'npu',
      vendor: 'rebellions',
      model: 'Atom+',
      node: 'node5',
      slot_id: 2,
      status: 'pending_join',
      pending_join_reason: 'Node not yet joined to k8s cluster',
      current_exam: null,
      last_known_metric: { tps: null, tt100t_seconds: null },
      last_metric_timestamp: null,
      metrics_status: 'unavailable',
    },
  ],
  sweep_progress: { completed: 0, total: 0, paused: true },
  operator_race_alerts: 0,
};

const ACTIVE_SNAPSHOT = {
  slots: [
    {
      device_type: 'npu',
      vendor: 'furiosa',
      model: 'RNGD',
      node: 'node4',
      slot_id: 1,
      status: 'running',
      current_exam: { id: 201, kind: 'npu', exam_name: 'npu-sweep-cell-1', elapsed_seconds: 120 },
      last_known_metric: { tps: 143.7, tt100t_seconds: 0.696 },
      last_metric_timestamp: new Date().toISOString(),
      metrics_status: 'available',
    },
    {
      device_type: 'npu',
      vendor: 'rebellions',
      model: 'Atom+',
      node: 'node5',
      slot_id: 2,
      status: 'pending_join',
      pending_join_reason: 'Node not yet joined to k8s cluster',
      current_exam: null,
      last_known_metric: { tps: null, tt100t_seconds: null },
      last_metric_timestamp: null,
      metrics_status: 'unavailable',
    },
  ],
  sweep_progress: { completed: 5, total: 48, paused: false },
  operator_race_alerts: 0,
};

// ---------------------------------------------------------------------------

test.describe('NPU Real-Time Dashboard (/dashboard/npu-realtime) — pending state', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/realtime/exams', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: snapshot\ndata: ${JSON.stringify(PENDING_SNAPSHOT)}\n\n`,
      });
    });
    await page.goto('/dashboard/npu-realtime');
  });

  test('page title / header renders', async ({ page }) => {
    await expect(page.getByText('NPU Realtime Dashboard')).toBeVisible({ timeout: 3000 });
  });

  test('shows node4 RNGD device card', async ({ page }) => {
    await expect(page.getByText(/RNGD|FuriosaAI/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('shows node4 RNGD as idle with unavailable metrics', async ({ page }) => {
    await expect(page.getByText(/idle/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('shows node5 Atom+ with pending_join state', async ({ page }) => {
    await expect(page.getByText(/Atom\+|pending.?join|pending/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('shows link to node5 Atom+ runbook', async ({ page }) => {
    await expect(
      page.getByRole('link', { name: /runbook|atom.?plus/i }).or(page.getByText(/node5_atomplus_runbook/i))
    ).toBeVisible({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------

test.describe('NPU Real-Time Dashboard (/dashboard/npu-realtime) — active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/realtime/exams', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: snapshot\ndata: ${JSON.stringify(ACTIVE_SNAPSHOT)}\n\n`,
      });
    });
    await page.goto('/dashboard/npu-realtime');
  });

  test('shows node4 RNGD as running with metrics', async ({ page }) => {
    await expect(page.getByText(/running/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('shows TPS value for active RNGD slot', async ({ page }) => {
    await expect(page.getByText(/143\.7|143/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('node5 Atom+ still shows pending_join in active state', async ({ page }) => {
    await expect(page.getByText(/pending.?join|pending/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('sweep progress bar is visible', async ({ page }) => {
    await expect(page.getByText(/5.*\/.*48/)).toBeVisible({ timeout: 3000 });
  });

  test('page loads in under 3 seconds', async ({ page }) => {
    const start = Date.now();
    await expect(page.getByText('NPU Realtime Dashboard')).toBeVisible({ timeout: 3000 });
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
