// Atom+ angry-user QA — verifies new runs id=67, id=68 visible end-to-end
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://10.254.177.41:30001';
const APIBASE = 'http://10.254.177.41:30980/api';
const OUT = '/work/atomplus_qa_results.json';

const ROUTES = [
  '/',
  '/dashboard/gpu-realtime',
  '/dashboard/npu-realtime',
  '/npu-eval/rngd',
  '/npu-eval/atomplus',
  '/mlperf/device-comparison',
  '/mmlu/device-comparison',
  '/npu-eval/device-comparison',
];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const out = { ts: new Date().toISOString(), api_baseline: {}, route_audits: [], comparison_flow: {} };

  // 1. API baseline — show ATOM+ runs
  for (const path of ['/comparison/list', '/comparison/list?hardware=npu', '/comparison/candidates?runId=67', '/comparison/candidates?runId=68', '/comparison/mlperf/72/67', '/comparison/mlperf/72/68', '/devices', '/realtime/exams/snapshot']) {
    try {
      const page = await context.newPage();
      const resp = await page.request.get(`${APIBASE}${path}`);
      const body = await resp.json();
      out.api_baseline[path] = { status: resp.status(), top_keys: Object.keys(body).slice(0, 5) };
      if (path === '/comparison/list?hardware=npu') {
        const runs = (body.data || {}).runs || [];
        const atomplus = runs.filter(r => (r.hardware || {}).vendor === 'rebellions');
        out.api_baseline[path].total_npu_runs = runs.length;
        out.api_baseline[path].atomplus_runs = atomplus.map(r => ({ id: r.id, model: r.model, tt100t: r.metrics.tt100t_seconds, status: r.status }));
      }
      await page.close();
    } catch (e) { out.api_baseline[path] = { error: String(e).slice(0, 200) }; }
  }

  // 2. Route audits
  for (const route of ROUTES) {
    const page = await context.newPage();
    const consoleErrors = [];
    const networkErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    page.on('requestfailed', r => networkErrors.push(`${r.method()} ${r.url()} : ${r.failure()?.errorText || 'unknown'}`.slice(0, 200)));
    let navOk = false, snapshot = '';
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 25000 });
      await page.waitForTimeout(1500);
      navOk = true;
      const html = await page.content();
      const lower = html.toLowerCase();
      const flags = {
        atom_visible: /atom[+\s]/.test(html),
        rebellions_visible: /rebellions/i.test(html),
        ATOMPLUS_run_name: /ATOMPLUS-Qwen2\.5/.test(html),
        data_ingestion_error: /data ingestion error/i.test(html),
        malformed_realtime: /malformed realtime frame/i.test(html),
        runtime_pending: /runtime pending|awaiting upstream/i.test(html),
        runtime_ready: /runtime, scheduler, and tt100t benchmark all green|atom\+ ready/i.test(html),
      };
      const screenshotPath = `/work/screenshot-${route.replace(/[^a-z0-9]/gi, '_')}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      out.route_audits.push({ route, navOk, consoleErrorCount: consoleErrors.length, consoleErrors: consoleErrors.slice(0, 5), networkErrorCount: networkErrors.length, networkErrors: networkErrors.slice(0, 5), flags, screenshot: screenshotPath });
    } catch (e) {
      out.route_audits.push({ route, navOk: false, error: String(e).slice(0, 300), consoleErrors, networkErrors });
    }
    await page.close();
  }

  // 3. Comparison click-through: select run from picker
  try {
    const page = await context.newPage();
    await page.goto(`${BASE}/npu-eval/device-comparison`, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(2000);
    const html1 = await page.content();
    out.comparison_flow.npu_compare_atomplus_in_picker = /ATOMPLUS-Qwen2\.5/.test(html1);
    out.comparison_flow.npu_compare_no_ingestion_err = !/data ingestion error/i.test(html1);
    await page.screenshot({ path: '/work/screenshot-compare-npu.png', fullPage: false });
    await page.close();
  } catch (e) { out.comparison_flow.error = String(e).slice(0, 300); }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`OUTPUT: ${OUT}`);
  console.log('SUMMARY:');
  console.log(`  routes audited: ${out.route_audits.length}`);
  const cleanRoutes = out.route_audits.filter(r => r.navOk && (r.consoleErrorCount || 0) === 0 && (r.networkErrorCount || 0) === 0).length;
  console.log(`  clean routes (0 console + 0 network errors + navOk): ${cleanRoutes}/${out.route_audits.length}`);
  const atomplusVisible = out.route_audits.find(r => r.route === '/npu-eval/atomplus');
  console.log(`  /npu-eval/atomplus flags: ${JSON.stringify(atomplusVisible?.flags)}`);
  const npucompare = out.route_audits.find(r => r.route === '/npu-eval/device-comparison');
  console.log(`  /npu-eval/device-comparison ATOMPLUS run name visible: ${npucompare?.flags?.ATOMPLUS_run_name}`);
  await browser.close();
})();
