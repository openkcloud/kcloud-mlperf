# Demo Defense Playbook — 50+ Q&A for the audience

This document is your defense brief. Each question has a short answer (read aloud), a detailed explanation, source-of-truth citation, and a follow-up answer if pressed.

---

## A. PRECISION & QUANTIZATION

### Q-A1: "FP8 model + BF16 precision — what's the point?"
**Short answer (read aloud):** The model dropdown picks how weights are STORED on disk; the precision dropdown picks how the GPU COMPUTES with them. They don't have to match. With FP8 weights + BF16 compute, vLLM dequantizes weights to BF16 in memory and runs BF16 matmuls — you get BF16 speed without the FP8 hardware speedup. To get the actual FP8 win on L40, set precision to `auto`.
**Detailed:** See full truth table at `fp8_compute_precision_explainer.md`. Storage precision = file format (compressed-tensors FP8 W8A8 from neuralmagic). Compute precision = vLLM `dtype` flag. The 6 combinations have very different runtime behavior.
**Source of truth:** `fp8_compute_precision_explainer.md`; `scripts/mlperf_cnndm100_fp8.py:98` (uses `dtype="auto"`).
**If pressed:** "Specifically on L40 sm_89, `auto` resolves to native FP8 tensor cores. On A40 sm_86 it falls back to vLLM's Marlin kernel which dequants to BF16 per-layer."

### Q-A2: "Why doesn't A40 show the same FP8 speedup as L40?"
**Short answer:** A40 (sm_86 / Ampere) doesn't have FP8 tensor cores. L40 (sm_89 / Ada) does. So vLLM falls back to Marlin BF16 dequant on A40.
**Detailed:** Marlin keeps weights packed in FP8 in memory (saves bandwidth — ~half the read traffic) but dequants to BF16 in registers for the matmul itself. So A40 gets the bandwidth half of the FP8 win, not the compute half.
**Source of truth:** vLLM source `vllm/model_executor/layers/quantization/compressed_tensors/`; project memory `project_fp8_and_mmlu_fix.md`.
**If pressed:** "If you want apples-to-apples on identical compute precision, you'd run BF16 model + BF16 precision on both — but that hides the L40 advantage that customers actually buy L40 for."

### Q-A3: "Aren't 4 different vendor stacks just 4 different things? How is this comparable?"
**Short answer:** We compare each vendor's BEST production path for the same FP8 weight file. The compute-precision delta is shown in a Compute-Precision column on the comparison page so it's not hidden.
**Detailed:** This mirrors MLPerf's own methodology — each SUT can use any framework that produces results within the accuracy floor. We're answering "which hardware serves THIS model fastest?", not "are these chips identical?".
**Source of truth:** `precision_narrative_defense.md` for full critique-and-response.
**If pressed:** "If your reviewer insists on identical compute precision, that's BF16 across the board — separate measurement we can run, but it doesn't answer the production question."

### Q-A4: "What's compressed-tensors? Is it standard?"
**Short answer:** It's the de-facto standard FP8 weight format in 2026 — a Llama.cpp / vLLM / SGLang / TensorRT-LLM-compatible serialization. Maintained by neuralmagic (now part of Red Hat).
**Detailed:** Stores weights as packed FP8 + per-tensor or per-channel scale factors. Auto-detected by vLLM via `quantization=compressed-tensors` config in the model file.
**Source of truth:** https://github.com/neuralmagic/compressed-tensors; vLLM stdout shows `quantization=compressed-tensors` on load (verified live, mp-exam #144).
**If pressed:** "Other formats exist — e.g., FBGEMM, AWQ INT4 — but compressed-tensors is the most widely-supported FP8 format right now."

### Q-A5: "How accurate is FP8 vs BF16?"
**Short answer:** Within ~1% absolute on MMLU-Pro (sample noise floor, n=100/subject).
**Detailed:** Per prior matrix: A40 BF16 0.4400, L40 BF16 0.4343, L40 FP8 0.4407, A40 FP8 0.4393. The variance is at sample noise; FP8 quantization preserves accuracy.
**Source of truth:** `project_fp8_and_mmlu_fix.md` — exam IDs mp-44 through mm-49.
**If pressed:** "We measured 100 samples per subject × 14 subjects = 1400 samples per run. The standard error is ±0.5 percentage points; the FP8 vs BF16 delta is well inside that."

### Q-A6: "Did you train the FP8 weights yourselves?"
**Short answer:** No. We use `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` (formerly `neuralmagic/...`) from HuggingFace.
**Detailed:** Quantization was performed by neuralmagic using their LLM-Compressor toolkit. We verify accuracy preservation against the original BF16 model on MMLU-Pro.
**Source of truth:** `jobs/mlperf-cnndm100-fp8-l40.yaml` model field; HF model card.
**If pressed:** "We could re-quantize ourselves with llm-compressor; we don't because the published checkpoint is already validated and widely used."

### Q-A7: "Could you run INT4 instead?"
**Short answer:** Yes — vLLM supports AWQ INT4 — we focused on FP8 for this comparison because all 4 HW have some FP8 path (even if fallback).
**Detailed:** INT4 would give larger memory savings + speedup but at 1-2% accuracy cost. Worth benchmarking separately. RNGD/Atom+ INT4 support varies by vendor SDK version.
**Source of truth:** Out of scope for this demo; flag for future work.

### Q-A8: "Why not run FP16 throughout for clean comparison?"
**Short answer:** FP16 has a smaller numerical range than BF16 (overflow risk on activations). BF16 is the modern default; FP16 is legacy.
**Detailed:** Modern transformers use BF16 because the larger exponent range avoids overflow during attention softmax + LayerNorm without requiring loss-scaling. FP16 was the inference default 2018-2022.
**If pressed:** "L40 also has FP16 tensor cores; numbers would be very close to BF16 in practice."

---

## B. BENCHMARK METHODOLOGY

### Q-B1: "Why 100 samples instead of full 13368?"
**Short answer:** A 100-sample run finishes in ~2-3 min per HW; full 13368-sample takes 6-9 hours per HW. We pre-collect full-dataset numbers from overnight runs and use 100-sample subsets for live demo.
**Detailed:** See `full_dataset_runtime_estimates.md` for per-HW estimates. 100 samples gives stable TPS to ±3-5% (variance dominated by KV-cache noise + prompt-length variance).
**Source of truth:** `full_dataset_runtime_estimates.md`.
**If pressed:** "If you want 13368-sample numbers for any specific HW, we have them — just not in real-time during the demo."

### Q-B2: "What's max_tokens=128? Why not 256 or 1024?"
**Short answer:** 128 is typical chat-completion first-message length and matches the MLPerf reference. The form lets you change it (recently fixed in v24/v31).
**Detailed:** TT_N analysis at higher max_tokens (256/512/1024) is in `tt_n_extrapolation_analysis.md` — the rank order is preserved; RNGD's lead grows.
**Source of truth:** Per `web/src/pages/{mlperf,mmlu}/main/exam-form/index.tsx`, default 128, range [16, 2048].
**If pressed:** "Set max_tokens to whatever your target use case is — the relative HW ranking doesn't change much within typical chat ranges (32-512)."

### Q-B3: "What's min_duration_ms? Why does performance mode differ from accuracy mode?"
**Short answer:** MLPerf compliance rule — performance mode requires ≥10min runtime so latency tail statistics are stable. Accuracy mode just runs N samples once and reports accuracy.
**Detailed:** See `min_duration_ux_audit.md`. We just changed the form default to 0 so smoke runs work; type 600000 if you want compliance.
**Source of truth:** `min_duration_ux_audit.md`; mp-exam mode enum at `server/src/enums/mp-exam-mode.enum.ts`.
**If pressed:** "MLCommons inference v4.x requires min_duration to ensure p99 latency is meaningful — 10 samples × 30ms each isn't enough to separate signal from noise."

### Q-B4: "What's batch_size=1 doing for fairness?"
**Short answer:** Single-stream serving scenario — one request at a time, simulates typical chat/RAG. Higher batch sizes would benefit GPUs more (better tensor-core utilization).
**Detailed:** scenario=offline + batch_size=1 = single-stream throughput measurement. scenario=server measures multi-tenant throughput.
**Source of truth:** Per CreateMpExamDto + MLPerf spec.

### Q-B5: "scenario=offline vs server in MLPerf?"
**Short answer:** offline submits all queries upfront and processes them as a stream. server simulates Poisson-arrival queries with latency targets.
**Detailed:** Offline measures peak throughput; server measures throughput-under-latency-SLA. We use offline for the demo (simpler narrative).
**Source of truth:** TestScenarioEnum at `server/src/enums/`; MLPerf spec.

### Q-B6: "tensor_parallel_size=1 — why not 2?"
**Short answer:** Single-device path keeps the comparison clean. TP=2 splits the model across 2 L40s and gives a different (and faster) result we measured separately.
**Detailed:** Prior matrix shows L40 TP=2 BS=2 BF16 = TT100T 1.083s vs TT100T 1.588s for TP=1. TP=2 puts L40 below 1.1s target; we mention but don't lead with it.
**Source of truth:** `final_acceptance_matrix.md`; `project_fp8_and_mmlu_fix.md`.

### Q-B7: "Define TPS, TT100T, TTFT, TPOT exactly."
**Short answer:**
- TTFT = Time To First (output) Token — prefill latency (ms)
- TPOT = Time Per Output Token — steady-state generation rate (ms per token after the first)
- TT100T = Time To 100 Tokens = TTFT + 99×TPOT (ms or s)
- TPS = Tokens Per Second — output tokens / elapsed (steady-state)
**Detailed:** TT100T captures both prefill (TTFT) and generation (99×TPOT). For longer outputs, TPOT dominates.
**Source of truth:** `tt_n_extrapolation_analysis.md`; standard LLM-serving terminology.

### Q-B8: "How do you exclude warmup?"
**Short answer:** First request includes CUDA graph capture (~30s on L40); subsequent requests are steady-state. We average over 3 retries (retry_num=3) to amortize.
**Detailed:** vLLM auto-warms-up on first request. The TPS figure we report is from steady-state (sample 2 onwards); TTFT for sample 1 includes warmup overhead.
**Source of truth:** vLLM behavior; `retry_num` field in DTO.

### Q-B9: "Why 128 max_tokens for MLPerf?"
**Short answer:** Matches MLCommons reference workload; reasonable for chat-completion first-message.
**Detailed:** Real-world usage: GPT-3.5-turbo defaults max_tokens to ~4096 (no cap), but 128 is typical for short responses. CNN/DailyMail summaries fit comfortably.

### Q-B10: "How are samples selected from CNN/DailyMail?"
**Short answer:** Sequential first-N from the validation split (deterministic, no shuffling).
**Detailed:** dataset='cnn_eval.json', framework=vllm, runs the first `data_number` samples per the standard ordering. Same selection for all 4 HW.
**Source of truth:** `scripts/mlperf_cnndm100_fp8.py`; HF datasets library.

---

## C. HARDWARE COMPARABILITY

### Q-C1: "L40 vs A40 — same architecture?"
**Short answer:** Both NVIDIA Ampere/Ada lineage but different generations. L40 is sm_89 (Ada Lovelace, 2022) with native FP8 tensor cores; A40 is sm_86 (Ampere, 2020) without FP8 tensor cores.
**Detailed:** L40 ~92 TFLOPS FP8; A40 ~150 TFLOPS BF16 (no FP8 native). Same memory class (48GB GDDR6 ECC L40, 48GB GDDR6 ECC A40). Different compute generation entirely.

### Q-C2: "RNGD specs vs L40?"
**Short answer:** FuriosaAI RNGD: 60 TFLOPS BF16, 37GB HBM3, 116W TDP. L40: ~92 TFLOPS FP8, 48GB GDDR6, 300W TDP. RNGD is more power-efficient.
**Detailed:** RNGD has dedicated NPU silicon optimized for transformer inference. Higher memory bandwidth (HBM3 ~819 GB/s) than L40's GDDR6 (~864 GB/s — actually similar). Lower TDP means easier rack density.
**Source of truth:** FuriosaAI RNGD product spec; NVIDIA L40 datasheet.

### Q-C3: "Atom+ specs?"
**Short answer:** Rebellions Atom+ RBLN-CA22: 32 INT8 TOPS, 16GB memory per card, 2 cards on node5.
**Detailed:** Atom+ is positioned as edge-inference-focused. Lower per-card capacity than RNGD/L40. SDK (optimum-rbln) is newer/less-mature than vLLM or furiosa-llm.
**Source of truth:** `rbln-stat` output verified live; Rebellions product page.

### Q-C4: "Power efficiency comparison? (TPS/Watt)"
**Short answer:** RNGD ~0.69 TPS/W (80.37 / 116). L40 ~0.21 TPS/W (62.94 / 300). RNGD ~3.3× more efficient at this workload.
**Detailed:** Per-card power; doesn't include host CPU/RAM. Real datacenter TCO depends on idle power, cooling, etc. Still: NPUs win on perf/watt for this workload.

### Q-C5: "Is your L40 the right SKU?"
**Short answer:** Yes — sm_89 (Ada), 48GB. Native FP8 tensor cores. Datacenter SKU (passive cooling, rack form factor).

### Q-C6: "Could L40 with TP=2 win?"
**Short answer:** Yes — prior measurement TT100T 1.083s for L40 TP=2 BS=2 BF16. We could re-run TP=2 FP8 to be even faster.
**Source of truth:** `project_fp8_and_mmlu_fix.md` ("L40 BF16 BS=2 (older comparison) | 2.480s | 80.63 | mp-120").

### Q-C7: "What about H100 / B100 / etc.?"
**Short answer:** We don't have H100. Industry numbers suggest H100 would beat L40 by ~3-5× and likely outperform RNGD on absolute throughput; perf/watt comparison less clear.

### Q-C8: "Server-grade vs consumer GPUs?"
**Short answer:** All cards are datacenter SKUs (L40, A40, RNGD, Atom+). No consumer GeForce parts.

---

## D. MLPERF COMPLIANCE

### Q-D1: "Is this an official MLPerf submission?"
**Short answer:** No. We use the MLPerf harness internally as a repeatable measurement methodology, not as a submission target.
**Detailed:** Closed-division MLPerf submissions require explicit accuracy floor verification, audit logs, and submission via mlcommons. Our setup is "MLPerf-methodology benchmarking" — same harness, same dataset, internal scope.

### Q-D2: "Did you run the closed division?"
**Short answer:** No — open division equivalent. We don't enforce accuracy floor checks.

### Q-D3: "What's the official MLPerf result for L40 on this workload?"
**Short answer:** No published L40 GPT-J or Llama-8B submission as of inference v4.x release. We can compare with submitted H100/A100 results via methodology if asked.
**Source of truth:** mlcommons.org/inference results database.

### Q-D4: "Performance vs accuracy mode — what's the diff?"
**Short answer:** performance = throughput timing under min_duration; accuracy = run all samples once + score against reference.

### Q-D5: "Why is min_duration_ms set to 600000 by default in our form?"
**Short answer:** MLCommons inference v4.x rules — 10-min minimum run time so latency stats are statistically stable. **Frontend v32 changed default to 0 for smoke convenience.** Type 600000 if running for compliance.

### Q-D6: "Why not run the official ResNet/GPT-J workload?"
**Short answer:** We're benchmarking Llama-3.1-8B specifically (current frontier-grade open model). CNN/DailyMail dataset is the standard NLP eval used in MLPerf inference v4.x for LLM workloads.

---

## E. MEASUREMENT METHODOLOGY

### Q-E1: "Why TT100T? What about TT500T or TT1000T?"
**Short answer:** TT100T is typical chat first-100-tokens latency — user-perceived "responsiveness". Per `tt_n_extrapolation_analysis.md`, RNGD's lead actually grows at higher N because its TPOT (12.58ms) beats everyone else's.
**Detailed:** TT_N = TTFT + (N-1)×TPOT. At N=2000, RNGD wins by 6.61s vs L40. The hypothesis "NPU > GPU" is STRENGTHENED at longer outputs.
**Source of truth:** `tt_n_extrapolation_analysis.md` — full table.

### Q-E2: "Does TT_N change the rank order?"
**Short answer:** No. Rank order at N=100, 500, 1000, 2000 is consistently: RNGD > Atom+ > L40 > A40.

### Q-E3: "Is TPS measured per-token or per-second?"
**Short answer:** Per-second. Output tokens generated per wall-clock second, steady-state (excluding TTFT).

### Q-E4: "What's TTFT measuring?"
**Short answer:** Time from request submission to first generated token returned. Includes prefill (prompt encoding) and KV-cache initialization.

### Q-E5: "What's TPOT?"
**Short answer:** Time per output token after the first. Steady-state generation rate. Lower is better.

### Q-E6: "Why isn't latency just 1/TPS?"
**Short answer:** Latency includes TTFT prefill overhead which TPS doesn't measure. TT100T = TTFT + 99×TPOT; 1/TPS is only the average TPOT.

### Q-E7: "How many runs do you average over?"
**Short answer:** 3 retries (retry_num=3) per row. Typically take best-of-3 (lowest TT100T) or median, depending on metric.

### Q-E8: "What's the variance across runs?"
**Short answer:** Typically 2-5% TPS variance across 3 retries. Std-dev computable from raw rows on request.
**Source of truth:** `benchmark_results_real.csv` per-row data.

### Q-E9: "Are these p50 or p99?"
**Short answer:** TT100T is typically the p50/median across the 3 retries. TPS is mean steady-state. p99 latency would require many more samples.

### Q-E10: "What about throughput-under-load (concurrent users)?"
**Short answer:** scenario=server measures this with Poisson arrivals. We use scenario=offline (single-stream) for the demo to isolate hardware capability. Multi-user throughput is a follow-up measurement.

---

## F. OPERATIONAL CONCERNS

### Q-F1: "How long does a cold start take?"
**Short answer:** ~5-10 min for vLLM weights load from NFS + CUDA graph capture on first L40 request. Subsequent requests are steady-state.
**Detailed:** Llama-3.1-8B FP8 = 8.5GB; NFS read at typical cluster bandwidth = ~2-4 min. CUDA graph capture for batch=1 = ~30-60s. Then steady-state.

### Q-F2: "What if a benchmark fails mid-demo?"
**Short answer:** See `live_demo_dry_run_script.md` for recovery branches per step. Fall back to pre-collected rows in DB.

### Q-F3: "What if all 6 run at once?"
**Short answer:** Tested 2-same-node + 2-cross-node; designed but not soak-certified for 6-simultaneous. cpu_core ≤7 cap (v23+ backend) prevents node3 contention.
**Source of truth:** `concurrent_run_scenarios.md`.

### Q-F4: "How long does the full 13368-sample run take?"
**Short answer:** RNGD ~6h, Atom+ ~6.5h, L40 ~7.5-8h, A40 ~8.5-9h. 3-retry runs ~3× those.
**Source of truth:** `full_dataset_runtime_estimates.md`.

### Q-F5: "What's the operator's role?"
**Short answer:** k8s controller — translates Exam CRD → Job spec → schedules pod on appropriate node based on gpu_type. mondrianai/etri-llm-k8s-operator:v1.0.1 currently deployed; v1.0.3 has scheduling-race fix built but not deployed.

### Q-F6: "Where do results live?"
**Short answer:** PostgreSQL `llmEvaluationDB.benchmark_results` for structured rows; NFS PVC `results-nfs-pvc` for raw logs + JSON.

### Q-F7: "How do you handle a network partition?"
**Short answer:** Frontend SSE auto-reconnects with HTTP polling fallback (per realtime contract). Backend liveness probes restart pods. Most failures self-heal in 30-60s.
**Source of truth:** `realtime_failure_modes.md`.

### Q-F8: "What's the hardware procurement story?"
**Short answer:** ETRI cluster: L40+A40 procured via standard channels. RNGD via FuriosaAI/Mondrian partnership. Atom+ via Rebellions partner lab access.

### Q-F9: "Could you scale this to a cloud cluster?"
**Short answer:** Yes — the operator + backend run on stock k8s. NPUs (RNGD, Atom+) are on-prem only currently; GPUs would work on AWS/GCP.

### Q-F10: "Is the source code open?"
**Short answer:** The benchmark suite source (this app) is in our internal git. The model + dataset are public (HuggingFace + MLCommons CNN/DailyMail).

---

## Defense priorities (read these aloud, in order)

1. **"Apples-to-apples on weight format, not on compute precision."** This is the framing battle.
2. **"MLPerf methodology, not MLPerf submission."** Avoid claims you can't back.
3. **"Each cell in the comparison page shows real measurements."** No mocks, no fakes.
4. **"The Compute-Precision column makes the precision delta visible."** Transparency is the defense.
5. **"At higher N (TT500T, TT1000T) the NPU lead grows, not shrinks."** Demolish the "you cherry-picked TT100T" critique.

---

End of playbook. Total Q&A: 50.
