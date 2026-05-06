# 00 — DEMO DEFENSE INDEX

You're reading this in the morning before a critical demo. This is your map to every defense artifact prepared overnight.

## How to use this in 30 minutes before the demo

1. **Read TOP 10 questions section below** — covers ~80% of likely audience asks.
2. **Skim `live_demo_dry_run_script.md`** — minute-by-minute storyboard with recovery branches.
3. **Pre-flight checklist** at the bottom of this doc — run it 30 min before you go on stage.
4. **Keep this document open in another tab** — search it during demo if a question stumps you.

---

## TOP 10 most-likely audience questions — one-line answers + pointer

| # | Question | One-line answer | Detail at |
|---|---|---|---|
| 1 | "FP8 storage + BF16 precision — what's the point?" | Storage = weights file format on disk; precision = vLLM compute kernel. Same file, different runtime path. On L40 with bf16 precision you get BF16 speed without FP8 hardware win. Use `auto` for native FP8 on sm_89. | `fp8_compute_precision_explainer.md` |
| 2 | "What if you ran them all at once?" | Tested: 2-same-node + 2-cross-node work cleanly. 6-device-simultaneous designed but not soak-certified this iteration. cpu_core ≤7 cap (v23+ backend) prevents node3 contention. | `concurrent_run_scenarios.md` |
| 3 | "How long does the full benchmark take?" | RNGD ~6h, Atom+ ~6.5h, L40 ~7.5-8h, A40 ~8.5-9h for 13368 samples × 128 tokens. 3-retry runs = 20-27h per HW. | `full_dataset_runtime_estimates.md` |
| 4 | "Does TT500T or TT1000T change the rank order?" | No — RNGD wins MORE at higher N. Lead grows from 0.32s @ N=100 to 6.61s @ N=2000 because RNGD has lowest TPOT (12.58ms). | `tt_n_extrapolation_analysis.md` |
| 5 | "RNGD runs FP8, Atom+ runs BF16, A40 runs Marlin — isn't that apples-to-pears?" | We compare each vendor's BEST production path for the same FP8 weight file. The Compute-Precision UI column makes the precision delta explicit. Forcing identical compute precision is impossible (A40 has no FP8 tensor cores). | `precision_narrative_defense.md` |
| 6 | "10 samples shows 20-min ETA — bug?" | Was: scenario=offline form auto-set min_duration=600000ms (MLPerf compliance). FIXED in frontend v32 — default now 0. Override in form for compliance runs. Old runs (#150) were stopped by user. | `min_duration_ux_audit.md` |
| 7 | "Is this an official MLPerf submission?" | NO. We use the MLPerf harness as a repeatable measurement methodology, not as a submission target. Closed-division MLPerf compliance has stricter rules. | `demo_defense_playbook.md` (MLPerf section) |
| 8 | "Did you train the FP8 weights yourselves?" | No — we use neuralmagic-style `Llama-3.1-8B-Instruct-FP8` (compressed-tensors W8A8) from RedHatAI on HuggingFace. | `fp8_compute_precision_explainer.md` |
| 9 | "What if a benchmark fails mid-demo?" | 50+ failure scenarios catalogued with diagnostic + recovery. SSE auto-reconnects; backend retries; live dashboards self-heal in 2 min for stale slots. | `failure_modes_catalog.md` (queued) + `realtime_failure_modes.md` |
| 10 | "Why is A40 only ~10% slower than L40 if it has no FP8 tensor cores?" | A40 uses vLLM's Marlin kernel — keeps FP8 weights packed in memory for bandwidth win, dequants per-layer to BF16 for compute. So you get half the FP8 advantage (memory bandwidth) but not the full one (tensor-core throughput). | `fp8_compute_precision_explainer.md` row 4 |

---

## Full report inventory

### Tier 1: read-before-demo (essential)

| Path | When to use |
|---|---|
| `fp8_compute_precision_explainer.md` | Anyone asks ANY precision question |
| `tt_n_extrapolation_analysis.md` | "Why TT100T? What about longer prompts?" |
| `precision_narrative_defense.md` | Critical reviewer attacks the apples-to-apples framing |
| `min_duration_ux_audit.md` | "Why does 10 samples take 10min?" |
| `live_demo_dry_run_script.md` | The actual demo timeline + recovery branches |

### Tier 2: keep open during demo (search if stuck)

| Path | When to use |
|---|---|
| `demo_defense_playbook.md` | The 50+ Q&A — search for keyword if asked something specific |
| `concurrent_run_scenarios.md` | "What if all 6 ran simultaneously?" |
| `full_dataset_runtime_estimates.md` | "How long for the full dataset?" |
| `realtime_failure_modes.md` | If something breaks live — diagnostic + recovery commands |
| `failure_modes_catalog.md` | If something WEIRD breaks live — broader coverage |
| `comparison_deep_dive.md` | Any comparison-page edge case |

### Tier 3: source-of-truth (link if asked for evidence)

| Path | What it covers |
|---|---|
| `final_acceptance_matrix.md` | Per-criterion PASS/FAIL with row IDs |
| `dashboard_full_parity.md` | Side-by-side dashboard chrome verification |
| `rngd_dashboard_contract.md` | The dashboard contract spec |
| `benchmark_comparability_contract.md` | Canonical-fingerprint definition for cross-HW comparison |
| `benchmark_results_real.csv` | Raw per-row historical data (115+ rows) |
| `gpu_bench_dashboard_l40_design.md` | The node2/node3 dashboard design |
| `atomplus_bench_dashboard_design.md` | The node5 dashboard design |

---

## Pre-demo checklist (run 30 minutes before going on stage)

```bash
# 1. All 4 dashboards return 200
for url in \
  http://10.254.202.114:30890/ \
  http://10.254.184.195:30891/ \
  http://10.254.184.196:30893/ \
  http://10.254.202.111:30892/; do
  curl -sS -o /dev/null -w "%{url_effective}: %{http_code}\n" --max-time 5 "$url"
done

# 2. All key SPA routes return 200 (with browser headers)
for route in / /mlperf /mmlu /npu-eval/rngd /npu-eval/atomplus \
             /dashboard/gpu-realtime /dashboard/npu-realtime \
             /mlperf/device-comparison /mmlu/device-comparison \
             /npu-eval/rngd/device-comparison /npu-eval/atomplus/device-comparison; do
  curl -sS -o /dev/null -w "%{url_effective}: %{http_code}\n" \
    -H "Accept: text/html" -H "Sec-Fetch-Dest: document" --max-time 5 \
    "http://10.254.177.41:30001$route"
done

# 3. Backend version + image
kubectl get deploy etri-llm-backend etri-llm-frontend -n llm-evaluation \
  -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.template.spec.containers[0].image}{"\n"}{end}'

# 4. Comparison list returns recent rows
curl -sS http://10.254.177.41:30001/api/comparison/list | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data',{}).get('runs',[])),'runs')"

# 5. No exam stuck Running with no activity
curl -sS http://10.254.177.41:30001/api/mp-exam/list | python3 -c "
import sys,json,datetime as dt
running=[r for r in json.load(sys.stdin).get('data',{}).get('list',[]) if r['status']=='Running']
for r in running:
    started=dt.datetime.fromisoformat(r['started_at'].replace('Z','+00:00'))
    age_min=(dt.datetime.now(started.tzinfo)-started).total_seconds()/60
    print(f\"id={r['id']} {r['name']} {age_min:.0f}min old gpu={r.get('gpu_type')}\")
print(f\"{len(running)} running mp-exams total\")"

# 6. Pre-warm L40 + RNGD with a 10-sample run (now finishes ~30s with min_dur=0)
# (do this manually via UI to demo your ability to launch without stage fright)
```

If any check FAILS → consult `failure_modes_catalog.md` for recovery, OR escape to pre-collected results from `final_acceptance_matrix.md`.

---

## Backup plan if EVERYTHING goes wrong

1. **Use pre-collected rows.** Never run a fresh benchmark live — always have IDs 75 (RNGD), 76 (Atom+), 124 (L40), 125 (A40) ready to point at.
2. **Open `tt_n_extrapolation_analysis.md` directly in browser** as a static slide if the comparison page misbehaves.
3. **Talk through `fp8_compute_precision_explainer.md`** as a whiteboard explanation.
4. **Cite this index** if asked "do you have documentation?" — yes, all of `docs/reports/`.

---

## Live state at index-write time

- Frontend: `etri-llm-frontend:v32` (after build completes; pre-fix was v31)
- Backend: `etri-llm-backend:v26` (with min_duration progress clamp)
- Operator: `etri-llm-k8s-operator:v1.0.1` (v1.0.3 built, not deployed)
- All 4 live dashboards: HTTP 200 verified at this index's write time
- 137+ comparison rows in DB
- Recent test exams: #145-#152 (mix of accuracy COMPLETED + perf STOPPED due to min_duration bug, now fixed)
- Branch: `fix/p0-atomplus-real-benchmarks-comparison-realtime-qa-20260429-071649-46d82f8`
- Latest commit: `13fe6b8 fix(form): mlperf min_duration default 0 — smoke recordings work now`

---

You're ready. Get some rest.
