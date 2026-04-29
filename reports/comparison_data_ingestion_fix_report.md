# Comparison Ingestion — Lane E Report

**RUN_ID**: 20260429-060404-82c193e
**Live URLs**:
- http://10.254.177.41:30001/mlperf/device-comparison
- http://10.254.177.41:30001/mmlu/device-comparison
- http://10.254.177.41:30001/npu-eval/device-comparison

## Browser-side state (Playwright)

| Route | "Data Ingestion Error" hit | Console errors | Network failures |
|---|---|---|---|
| `/mlperf/device-comparison` | 0 | 0 | 0 |
| `/mmlu/device-comparison` | 0 | 0 | 0 |
| `/npu-eval/device-comparison` | 0 | 0 | 0 |

Initial AND after-pick checks (comparison click-through audit) both return 0 forbidden hits.

Screenshots: `.omc/qa-live-ui/screenshots-final-rev14/{mlperf,mmlu,npu}-comparison.png`

## API endpoints verified live (via the proxied frontend NodePort)

```
GET /api/comparison/list                      → 200, 102 runs (40 mlperf + 17 mmlu + 45 npu_eval)
GET /api/comparison/list?hardware=npu         → 200, 45 runs
GET /api/comparison/diagnostics               → 200, ingestion.errors = 0
GET /api/comparison/candidates?runId=72  (GPU) → 200, source + comparable NPU candidates
GET /api/comparison/candidates?runId=66  (NPU) → 200, source + 36 related candidates
GET /api/comparison/mlperf/72/66          (PAIR) → 200, data.a.metrics + data.b.metrics
```

## Why the user historically saw "Data Ingestion Error"

Two root causes — both fixed:

1. **Frontend called `/comparison/candidates/<id>` (path param)** while the backend exposes `?runId=<id>` (query param). Every candidate fetch 404'd; the picker fell back to the `ingestion_failed` diagnostic banner. Fixed in earlier commit `3cb204a` (CandidatesApi.getCandidates uses query param).
2. **NEW THIS SESSION**: Even after #1 was fixed, the comparison endpoints were called WITHOUT `/api` prefix (e.g. `/comparison/list`). With no nginx proxy in the frontend pod, those URLs hit the SPA fallback and returned `text/html` index.html. The axios interceptor blew up on the HTML string. Some pages crashed (home, sweep-control, realtime); comparison pages had loading guards so they showed perpetual "loading" — but if any consumer surfaced a fallback, the user could see a generic "Data Ingestion Error" message.

The proxy fix shipped in helm rev 14 maps `/comparison/...` → `/api/comparison/...` on the backend, so all 5 documented endpoints reach the right Express controller.

## Comparison row schema

The live `/api/comparison/list` row includes (verified via cluster):

```json
{
  "id": 66,
  "benchmark": "mlperf",
  "name": "MLPERF-FP8-PlanB-v2-confirm-Node4-0429-1015",
  "model": "furiosa-ai/Llama-3.1-8B-Instruct-FP8",
  "hardware": { "type": "npu", "vendor": "furiosa", "model": "RNGD", "node": null },
  "status": "Completed",
  "started_at": "2026-04-29T10:15:31+09:00",
  "completed_at": "2026-04-29T10:16:11+09:00",
  "metrics": { "tt100t_seconds": 1.260500667, "tps": 79.16, "accuracy_pct": 0, "throughput": 0.4985 },
  "artifacts": [],
  "precision": "FP8",
  "scenario": null,
  "batch_size": 1,
  "dataset": "CNN-DailyMail",
  "data_number": 20,
  "max_output_tokens": 1024,
  "source_table": "npu_exam"
}
```

Covers most of Lane E's required fields (run_id, benchmark, hardware, status, model, dataset, precision, scenario, latency-via-tt100t, throughput, accuracy, source_table, artifacts). The candidates endpoint additionally returns `comparability_class` and `comparability_score`.

## Comparison menu consolidation decision

The mission allowed for three specialized comparison menus OR consolidating to one "Compare Runs". Decision: **keep three** — `MLPerf vs NPU`, `MMLU vs NPU`, `NPU vs GPU` — because each pre-filters runs by benchmark family, which the user found useful. All three share the same backend endpoints and the same UX pattern, and ALL THREE are now confirmed working with the proxy fix. If the user later prefers a single Compare Runs menu, that's a small UI change against the same APIs.

## Acceptance

- ✅ No comparison route shows "Data Ingestion Error" (G12)
- ✅ Selecting a GPU run returns comparable NPU candidates (G13) — verified `/api/comparison/candidates?runId=72` returns NPU candidates
- ✅ Comparing two valid runs shows meaningful metrics (G14) — verified `/api/comparison/mlperf/72/66` returns paired `metrics`
- ✅ Browser-verified (G14) — 0 forbidden hits, 0 console errors
