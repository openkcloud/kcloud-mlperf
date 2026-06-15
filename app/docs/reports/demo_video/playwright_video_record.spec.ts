/**
 * Demo video recording spec — WS-5
 *
 * Uses Playwright's built-in video recording (video: 'on').
 * Each test = one segment. Videos land in the --output directory as .webm files.
 *
 * Run command (from web/ directory, after all blocking tasks complete):
 *
 *   cd /home/kcloud/etri-llm-exam-solution/web
 *   E2E_BASE_URL=http://10.254.177.41:30001 \
 *     npx playwright test \
 *     ../docs/reports/demo_video/playwright_video_record.spec.ts \
 *     --reporter=line \
 *     --video=on \
 *     --output=/home/kcloud/etri-llm-exam-solution/docs/reports/demo_video/segments
 *
 * Videos will be at: docs/reports/demo_video/segments/<test-name>/video.webm
 *
 * Convert to mp4 after recording:
 *   ffmpeg -i segments/<test-name>/video.webm -c:v libx264 -c:a aac segments/segment-N.mp4
 *
 * PRE-FLIGHT GATE: Do NOT run this spec until tasks #7, #8, #9, #11 are COMPLETED.
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://10.254.177.41:30001';
const RNGD_STREAMLIT = 'http://10.254.202.114:30890/';

// Slower, deliberate navigation for demo quality
const NAV_TIMEOUT = 45_000;
const RENDER_PAUSE = 4_000;   // pause for UI to settle before next action
const CLIMAX_PAUSE = 8_000;   // extended pause on the 4-row matrix

async function goto(page: Page, path: string) {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
  await page.waitForTimeout(RENDER_PAUSE);
}

async function assertNoErrorToast(page: Page, segmentId: string) {
  const body = await page.locator('body').innerText();
  const forbidden = [
    'Data Ingestion Error',
    'Malformed realtime frame',
    'Unhandled Error',
    '500 Internal Server Error',
  ];
  for (const phrase of forbidden) {
    if (body.includes(phrase)) {
      throw new Error(`[${segmentId}] Error toast detected: "${phrase}" — ABORT segment, retake required`);
    }
  }
}

// ── Segment 1: Home + Leaderboard ────────────────────────────────────────────

test('segment-1 — Home page and TT100T leaderboard', async ({ page }) => {
  // 1.1 Load home page
  await goto(page, '/');
  await assertNoErrorToast(page, 'S1');

  // 1.2-1.4 Vendor cards visible
  const body = await page.locator('body').innerText();
  expect(body).toMatch(/NVIDIA|FuriosaAI|Rebellions/i);
  await page.waitForTimeout(2_000);

  // 1.5 Scroll to leaderboard
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(RENDER_PAUSE);

  // 1.6-1.7 TT100T leaderboard: verify RNGD and Atom+ rows
  const leaderboardText = await page.locator('body').innerText();
  const hasRngd = /1\.26|1\.27|rngd|furiosa/i.test(leaderboardText);
  const hasAtom = /1\.37|1\.38|atom|rebellions/i.test(leaderboardText);
  if (!hasRngd) console.log('NOTE: RNGD 1.267s not found in leaderboard');
  if (!hasAtom) console.log('NOTE: Atom+ 1.375s not found in leaderboard');
  await page.waitForTimeout(3_000);

  // 1.8 Scroll to Recent Activity
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(RENDER_PAUSE);

  // 1.9 Scroll to Quick Links
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(2_000);

  await assertNoErrorToast(page, 'S1-end');
});

// ── Segment 2: RNGD NPU Evaluation ───────────────────────────────────────────

test('segment-2 — RNGD NPU evaluation page', async ({ page }) => {
  // 2.1 Navigate to RNGD page
  await goto(page, '/npu-eval/rngd');
  await assertNoErrorToast(page, 'S2');

  // 2.2 Hardware card visible
  const body = await page.locator('body').innerText();
  expect(body).toMatch(/rngd|furiosa/i);
  await page.waitForTimeout(2_000);

  // 2.3-2.5 Completed exam results table: look for id=75 or TT100T ~1.267
  const hasResult = /1\.26|1\.267|75|fp8/i.test(body);
  if (!hasResult) console.log('NOTE: RNGD canonical result (id=75, TT100T=1.267) not visible in table');
  await page.waitForTimeout(RENDER_PAUSE);

  // 2.6-2.7 Scroll to LiveBenchDashboard iframe
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(5_000); // extra wait for iframe to load

  // Check iframe presence (non-blocking — streamlit may be slow)
  const iframes = await page.locator('iframe').all();
  let streamlitIframeFound = false;
  for (const iframe of iframes) {
    const src = await iframe.getAttribute('src').catch(() => '');
    if (src && (src.includes('30890') || src.includes('10.254.202.114'))) {
      streamlitIframeFound = true;
    }
  }
  if (!streamlitIframeFound) {
    console.log('NOTE: RNGD Streamlit iframe not detected — may be idle placeholder or slow load');
  }
  await page.waitForTimeout(3_000);

  // 2.8 Click comparison button if present
  const compBtn = page.locator('button, a').filter({ hasText: /comparison|compare/i }).first();
  if (await compBtn.count() > 0) {
    await compBtn.click();
    await page.waitForTimeout(RENDER_PAUSE);
    await assertNoErrorToast(page, 'S2-comparison');
    await page.waitForTimeout(3_000);
  } else {
    // Navigate directly
    await goto(page, '/npu-eval/rngd/device-comparison');
    await assertNoErrorToast(page, 'S2-comparison-direct');
  }

  await assertNoErrorToast(page, 'S2-end');
});

// ── Segment 3: Atom+ NPU Evaluation ──────────────────────────────────────────

test('segment-3 — Atom+ NPU evaluation page', async ({ page }) => {
  // 3.1 Navigate to Atom+ page
  await goto(page, '/npu-eval/atomplus');
  await assertNoErrorToast(page, 'S3');

  // 3.2 Hardware card
  const body = await page.locator('body').innerText();
  expect(body).toMatch(/atom|rebellions/i);
  await page.waitForTimeout(2_000);

  // 3.3-3.5 Results table: look for id=74 or id=76 or TT100T ~1.375
  const hasResult = /1\.37|1\.38|74|76/i.test(body);
  if (!hasResult) console.log('NOTE: Atom+ canonical result not clearly visible in table');
  await page.waitForTimeout(RENDER_PAUSE);

  // 3.4 Precision disclosure visible
  const hasPrecision = /bf16|fp8|precision|fallback/i.test(body);
  if (!hasPrecision) console.log('NOTE: Precision label not found on Atom+ page');
  await page.waitForTimeout(3_000);

  // 3.6-3.7 Scroll to LiveBenchDashboard
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(5_000);

  await assertNoErrorToast(page, 'S3-end');
});

// ── Segment 4: GPU MLPerf + MMLU + CLIMAX (4-row matrix) ─────────────────────

test('segment-4 — GPU MLPerf, MMLU, and 4-row device-comparison CLIMAX', async ({ page }) => {
  // 4.1-4.4 MLPerf page
  await goto(page, '/ml-perf');
  await assertNoErrorToast(page, 'S4-mlperf');

  const mlperfBody = await page.locator('body').innerText();
  // Iframe or idle placeholder should be present (WS-2 filter)
  const hasIframeOrPlaceholder = /idle|no mlperf|prometheus|live/i.test(mlperfBody);
  if (!hasIframeOrPlaceholder) console.log('NOTE: MLPerf page: no iframe/idle placeholder detected');
  await page.waitForTimeout(RENDER_PAUSE);

  // Results table
  const hasGpuRows = /l40|a40|blocked|tt100t/i.test(mlperfBody);
  if (!hasGpuRows) console.log('NOTE: MLPerf results table: no GPU rows found');
  await page.waitForTimeout(3_000);

  // Compute-Precision column (REV-1)
  const hasComputePrecision = /compute.?precision|storage.?precision|marlin|sm_89|sm_86/i.test(mlperfBody);
  if (!hasComputePrecision) console.log('NOTE: Compute-Precision column not visible (WS-3 REV-1 may not be deployed)');
  await page.waitForTimeout(3_000);

  // 4.5-4.6 MMLU page
  await goto(page, '/mmlu');
  await assertNoErrorToast(page, 'S4-mmlu');
  await page.waitForTimeout(3_000);

  // 4.7 Navigate to the climax page
  await goto(page, '/mlperf/device-comparison');
  await assertNoErrorToast(page, 'S4-climax-nav');

  // 4.8 CLIMAX: verify 4-row matrix is present
  const climaxBody = await page.locator('body').innerText();
  const hwLabels = ['l40', 'a40', 'rngd', 'furiosa', 'atom', 'rebellions'];
  const foundHw = hwLabels.filter(hw => climaxBody.toLowerCase().includes(hw));
  console.log(`Climax matrix: detected HW labels = [${foundHw.join(', ')}]`);

  // HARD ASSERTION: must have content (not a blank/error page)
  expect(climaxBody.length).toBeGreaterThan(200);
  expect(climaxBody).not.toContain('Data Ingestion Error');

  // Warn (not fail) if <4 HW labels — team-lead will judge from the video
  if (foundHw.length < 4) {
    console.log(`WARNING: Expected 4 HW labels in climax matrix, found ${foundHw.length}: [${foundHw.join(', ')}]`);
    console.log('If <4 rows are visible: send [ESCALATION REQUIRED] to team-lead before releasing this segment.');
  }

  // Extended pause so viewer can see the full matrix
  await page.waitForTimeout(CLIMAX_PAUSE);

  // 4.9 Scroll through matrix
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(3_000);
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(3_000);

  await assertNoErrorToast(page, 'S4-end');
});

// ── Segment 5: Concurrent 6-device run + home leaderboard live update ─────────

test('segment-5 — Concurrent multi-device run and live leaderboard', async ({ page }) => {
  // 5.1 Start at home
  await goto(page, '/');
  await assertNoErrorToast(page, 'S5');
  await page.waitForTimeout(2_000);

  // 5.2 Navigate to RNGD page and launch a small benchmark (n_samples=5)
  // Note: actual benchmark launch requires UI interaction with the "New Exam" form.
  // This spec demonstrates the concurrent status view; actual launches done by the
  // demo presenter or pre-launched before starting this segment.
  // If pre-launching via API, use:
  //   curl -X POST http://10.254.177.41:30980/api/npu-exam \
  //     -H 'Content-Type: application/json' \
  //     -d '{"hardware":"rngd","n_samples":5,"max_tokens":128,"model":"Llama-3.1-8B-Instruct-FP8"}'

  // 5.3-5.4 Home page Recent Activity — should show running jobs
  await goto(page, '/');
  await assertNoErrorToast(page, 'S5-home');

  const activityBody = await page.locator('body').innerText();
  const hasRunning = /running|preparing|pending|queued/i.test(activityBody);
  if (!hasRunning) {
    console.log('NOTE: No running jobs detected in Recent Activity. Pre-launch benchmarks before recording this segment.');
  }
  await page.waitForTimeout(5_000);

  // 5.5 Navigate to RNGD page to show active benchmark
  await goto(page, '/npu-eval/rngd');
  await assertNoErrorToast(page, 'S5-rngd');
  await page.waitForTimeout(RENDER_PAUSE);

  // 5.6 Navigate to MLPerf — expect iframe visible when GPU MLPerf is running
  await goto(page, '/ml-perf');
  await assertNoErrorToast(page, 'S5-mlperf');
  await page.waitForTimeout(RENDER_PAUSE);

  // 5.7-5.8 Return to home, show leaderboard updating
  await goto(page, '/');
  await assertNoErrorToast(page, 'S5-home2');
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(5_000);

  // Final: Recent Activity with completed rows from concurrent run
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(4_000);

  await assertNoErrorToast(page, 'S5-end');
});
