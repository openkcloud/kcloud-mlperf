# Demo morning checklist — Monday May 11

Print this. Run through it 60 min before audience. If any check fails, fix before the demo starts.

## T-60 min: smoke check

```bash
ssh -p 122 kcloud@10.254.177.41
cd /home/kcloud/etri-llm-exam-solution
bash scripts/demo-morning-smoke.sh
```

Expected output ends with `✅ All smoke checks passed.  Ready for demo.` and shows:
- All 5 nodes Ready
- 5 app pods Running (backend, frontend, db, api, operator)
- /api/comparison/list returns TT100T values 1.2-2.0 s for all 4 vendors
- All 4 Streamlit dashboards reachable

## T-30 min: visual rehearsal

Open these tabs in order. Cmd+Shift+R if cached:

1. http://10.254.177.41:30001/ — homepage loads
2. http://10.254.177.41:30001/ml-perf — list page, latest canonical-sweep rows visible
3. http://10.254.177.41:30001/ml-perf/test-result/161 — L40 per-exam, TT100T should show **~1.58 s** (NOT 1584 — if you see 1584, frontend is on v40, redeploy v41)
4. http://10.254.177.41:30001/ml-perf/test-result/162 — A40 per-exam, **~1.77 s**
5. http://10.254.177.41:30001/npu/rngd — RNGD page, embedded Streamlit at node4:30890
6. http://10.254.177.41:30001/npu/atomplus — Atom+ page, embedded Streamlit at node5:30892
7. http://10.254.177.41:30001/compare?benchmark=mlperf — cross-vendor table, all 4 in **1.25-1.80 s** range

## T-5 min: sanity refresh

```bash
# Kill any orphaned benchmark Jobs from prior testing
kubectl get jobs -n llm-evaluation | grep mlperf
# kubectl delete job -n llm-evaluation <names>

# Confirm latest deployed images
kubectl get deploy -n llm-evaluation -o jsonpath='{range .items[*]}{.metadata.name}{"="}{.spec.template.spec.containers[0].image}{"\n"}{end}'
```

Expected:
- etri-llm-backend = `jungwooshim/etri-llm-backend:v32` (or v31 if not rolled out)
- etri-llm-frontend = `jungwooshim/etri-llm-frontend:v41`

## During demo (live)

Hero numbers (memorize):

| Device | TT100T (mean ± σ) | TPS | Compute precision | Source DB id |
|---|---|---|---|---|
| FuriosaAI **RNGD** | **1.379 ± 0.001 s** | 73 | FP8 native silicon | canonical 84, variance 86 |
| NVIDIA **L40** | **1.585 ± 0.001 s** | 63 | FP8 native (sm_89) | canonical 161, variance 163 |
| NVIDIA **A40** | **1.772 ± 0.001 s** | 56 | BF16 Marlin (sm_86 has no FP8) | canonical 162, variance 164 |
| Rebellions **Atom+** | **3.630 ± 0.014 s** | 27.8 | FP16 (RBLN-CA22 has no FP8) | canonical 92, variance 93 |

Note Atom+ is genuinely 2.6× slower than RNGD — that reflects real silicon differences (256 GB/s vs 1.5 TB/s memory bandwidth, FP16 32 TFLOPS vs FP8 512 TFLOPS, different price/power point). Variance σ across 5 reruns is 1 ms for GPU/RNGD, 14 ms for Atom+ — all extremely tight.

**Disregard prior "Atom+" rows in DB with id ≤ 91** — they are RNGD-served measurements from before the per-vendor URL routing fix shipped May 8.

## Recovery

| Symptom | Fix |
|---|---|
| /compare shows 1500 next to 1.3 | Backend not on v30+. `kubectl set image deploy/etri-llm-backend -n llm-evaluation etri-llm-backend=jungwooshim/etri-llm-backend:v32` |
| Per-exam page shows 1584 | Frontend not on v41. `kubectl set image deploy/etri-llm-frontend -n llm-evaluation etri-llm-frontend=jungwooshim/etri-llm-frontend:v41` |
| Streamlit iframe blank | Browser may need direct VPN to 10.254.x.x (not just 10.254.177.41). Test directly: http://10.254.184.195:30891/ |
| Benchmark stuck Running | `kubectl delete jobs -n llm-evaluation -l exam-id=<id>`, then click Stop in UI |
| Cmd+Shift+R didn't help | Clear all site cache, or open in private window |

## Reference

- Audit: `docs/reports/demo-monday/cross-vendor-tt100t-audit.md`
- Defense playbook: see audit § "Demo-day playbook"
- Talking points: see audit § "Talking points"
- Precision truth table: see audit § "Per-vendor model variants"
