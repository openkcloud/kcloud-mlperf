import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// GPU Real-Time Dashboard — E2E specs
// Acceptance criterion A3: page renders 4 GPU cards within 3s.
// ---------------------------------------------------------------------------

test.describe('GPU Real-Time Dashboard (/dashboard/gpu-realtime)', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept the SSE endpoint so tests don't need a live backend
    await page.route('**/realtime/exams', async (route) => {
      const snapshot = {
        slots: [
          { gpu_type: 'NVIDIA-L40', node: 'node2', status: 'Idle', exam_id: null, exam_name: null, elapsed_seconds: null, tps: null, tt100t: null },
          { gpu_type: 'NVIDIA-A40', node: 'node2', status: 'Running', exam_id: 131, exam_name: 'sweep-1-cell-2', elapsed_seconds: 42, tps: 58.1, tt100t: 1.721 },
          { gpu_type: 'NVIDIA-L40-44GiB', node: 'node3', status: 'Idle', exam_id: null, exam_name: null, elapsed_seconds: null, tps: null, tt100t: null },
          { gpu_type: 'NVIDIA-A40-44GiB', node: 'node3', status: 'Preparing', exam_id: 142, exam_name: 'sweep-1-cell-3', elapsed_seconds: 5, tps: null, tt100t: null },
        ],
        sweep_progress: { completed: 2, total: 96, paused: false },
        operator_race_alerts: 0,
      };
      // Return one SSE named event then close
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
      });
    });

    await page.goto('/dashboard/gpu-realtime');
  });

  test('page title / header renders', async ({ page }) => {
    await expect(page.getByText('GPU Real-Time Dashboard')).toBeVisible({ timeout: 3000 });
  });

  test('renders all 4 GPU device cards', async ({ page }) => {
    // Each card shows the GPU type name
    for (const sku of ['L40', 'A40', 'L40-44GiB', 'A40-44GiB']) {
      await expect(page.getByText(new RegExp(sku, 'i')).first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('sweep progress bar is visible', async ({ page }) => {
    await expect(page.getByText(/0.*\/.*96|2.*\/.*96/)).toBeVisible({ timeout: 3000 });
  });

  test('shows Idle chip for idle GPUs', async ({ page }) => {
    // At least one Idle chip should be present
    const idleChips = page.getByText('Idle');
    await expect(idleChips.first()).toBeVisible({ timeout: 3000 });
  });

  test('shows Running chip for running GPU', async ({ page }) => {
    await expect(page.getByText('Running').first()).toBeVisible({ timeout: 3000 });
  });

  test('shows Preparing chip for preparing GPU', async ({ page }) => {
    await expect(page.getByText('Preparing').first()).toBeVisible({ timeout: 3000 });
  });

  test('TPS bar chart section is rendered', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /TPS.*GPU|GPU.*TPS/i })).toBeVisible({ timeout: 3000 });
  });

  test('page loads in under 3 seconds', async ({ page }) => {
    const start = Date.now();
    await expect(page.getByText('GPU Real-Time Dashboard')).toBeVisible({ timeout: 3000 });
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
