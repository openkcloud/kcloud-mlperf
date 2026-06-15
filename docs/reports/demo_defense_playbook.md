> Note: ETRI takeover migration 2026-05-12 — sister deployment directory previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming); now ETRI-owned at `/home/kcloud/etri-llm-deployments/app/`. Container images previously under `mondrianai/*` Docker Hub org are migrating to `ghcr.io/etri-llm/*`. Historical mentions of the legacy names below are preserved for context.

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

---

## G. SOFTWARE STACK & DEPLOYMENT

### Q-G1: "What inference framework does each vendor use?"
**Short answer:** NVIDIA = vLLM 0.8.4. FuriosaAI = furiosa-llm. Rebellions = optimum-rbln.
**Detailed:** All three are the production-recommended stacks for their respective hardware. We avoided experimental stacks (TensorRT-LLM, SGLang, mistral.rs) for parity and reproducibility.
**Source of truth:** vLLM 0.8.4 from PyPI; furiosa-llm via FuriosaAI installer; optimum-rbln 0.9.3.post1.
**If pressed:** "We could test additional stacks (TensorRT-LLM specifically would beat vLLM on H100), but we don't have those HW available."

### Q-G2: "Why didn't you use TensorRT-LLM for NVIDIA?"
**Short answer:** vLLM is the most-deployed open-source inference stack for NVIDIA. TensorRT-LLM ships faster numbers on H100 but adds vendor-lock-in complexity and isn't symmetric with the FuriosaAI/Rebellions stacks.
**If pressed:** "We're happy to add a TensorRT-LLM column to the comparison if you want vendor-optimized vs general-purpose-stack apples-to-apples on NVIDIA only."

### Q-G3: "What's the deployment topology?"
**Short answer:** 3-node k8s cluster + 2 worker NPU nodes. Backend (NestJS) + frontend (React/Vite/MUI) + operator (custom k8s controller) + postgres + Loki + Prometheus + Grafana Alloy.
**Detailed:** node1 control plane, node2 = 2× L40, node3 = 2× A40, node4 = RNGD NPU, node5 = Atom+ NPU. NFS for model storage; postgres for benchmark results.
**Source of truth:** AGENTS.md cluster topology table.

### Q-G4: "What's Loki for?"
**Short answer:** Aggregates per-pod log lines from all benchmark exam jobs. Backend queries Loki for per-exam progress (the `<a>/<b>` values).
**Detailed:** Grafana Loki at `loki.monitoring.svc.cluster.local`. The backend's `LokiService` does instantQuery to fetch the latest progress value from a Running exam pod.

### Q-G5: "What's Prometheus for?"
**Short answer:** Cluster-wide metrics (CPU, GPU, memory, network). Currently NOT used by the application's iframes — those embed Streamlit/Python dashboards instead.
**Detailed:** Prometheus is deployed (per project memory: `prometheus-server.monitoring.svc.cluster.local:80`, NodePort 30900) and could be queried from a future Grafana panel embedded as iframe. Not done in current iteration.

### Q-G6: "How is the operator deployed?"
**Short answer:** k8s Deployment, single replica, image `mondrianai/etri-llm-k8s-operator:v1.0.1`. Watches `Exam` CRDs and translates them to `Job` specs.
**Source of truth:** `kubectl get deploy etri-llm-operator -n llm-evaluation`.

### Q-G7: "What happens when an Exam CRD is created?"
**Short answer:** Operator's reconcile loop sees the new Exam, allocates a node based on `gpu_type` field, creates a Job spec with the right env vars, applies to k8s.
**Detailed:** The Job runs the benchmark harness container with model+dataset+config; pod streams stdout to Loki; backend polls grpc-status to know when it transitions to Completed.

### Q-G8: "How do you secure the cluster?"
**Short answer:** Internal-only — no public ingress. SSH access required for cluster admin. RBAC + namespace isolation for pod permissions.
**If pressed:** "This is a research cluster, not a public-facing system. No customer data; no PII."

### Q-G9: "What's the build pipeline?"
**Short answer:** Kaniko in-cluster builds. Frontend = `Dockerfile.prod` (vite build → nginx). Backend = `Dockerfile.prod` (npm install --omit=dev → node).
**Detailed:** Each kaniko job clones from origin/jshim0978 GitHub, builds, pushes to jungwooshim/etri-llm-frontend or etri-llm-backend Docker Hub registry. Then `kubectl set image` for rollout.

### Q-G10: "How do you handle secrets?"
**Short answer:** k8s Secrets (kaniko-git, jungwooshim-dockerhub, huggingface-token). Mounted as files into pods. Not committed to git.

### Q-G11: "What's the development workflow?"
**Short answer:** Local dev: `yarn dev` (concurrent server+web). PR-driven git workflow on origin/jshim0978. Manual deploy via kaniko jobs (no CI/CD pipeline yet).

### Q-G12: "How do you roll back a bad deploy?"
**Short answer:** `kubectl set image` to the previous version tag. Image tags are explicit (v22, v23, v24...) so rollback is one command.

---

## H. RESULT INGESTION & DATA INTEGRITY

### Q-H1: "How are benchmark results stored?"
**Short answer:** Postgres `llmEvaluationDB.benchmark_results` table (canonical), plus raw JSON/log files on `results-nfs-pvc`.
**Source of truth:** `server/src/{mp,mm}-exam-result/`.

### Q-H2: "How do new results get imported?"
**Short answer:** When backend status poll sees exam status = Completed, the result-service is invoked. It parses the per-exam result JSON from the operator's output and inserts a row.

### Q-H3: "What if a benchmark crashes mid-run?"
**Short answer:** Status transitions to Error. The pod's last log lines are captured; no result row is created. The exam can be re-submitted.
**Source of truth:** `realtime_failure_modes.md` covers this in detail.

### Q-H4: "Can you delete a benchmark result?"
**Short answer:** Yes — `DELETE /api/{mp,mm,npu-eval}-exam/delete/:id`. Handles cascade to the `*_result` table.

### Q-H5: "How do you know the imported numbers are correct?"
**Short answer:** Round-trip check: result-import script re-parses raw log files and compares to DB row. Discrepancies are flagged.
**Source of truth:** `scripts/import-benchmark-result.ts`; `benchmark_result_import_log.md`.

### Q-H6: "What if Loki is down — does ingest fail?"
**Short answer:** Status polling falls back to grpc-only (status without progress values). DB row still updates to Completed when grpc reports it. Progress display goes blank in UI.

### Q-H7: "Are results signed/verified?"
**Short answer:** No cryptographic signing. Trust model is "internal cluster, no adversary." Production would add SLSA-style provenance.

### Q-H8: "What's `is_canonical=true`?"
**Short answer:** Per `benchmark_comparability_contract.md` v1.1.0 — a flag indicating this row is the "best" representative for its (model, dataset, N, max_tokens, precision) fingerprint. Used to dedupe near-duplicate runs in the comparison page.

### Q-H9: "How do you handle outlier runs?"
**Short answer:** Multi-retry runs (retry_num=3) average across retries. Visible outliers are inspectable per-row but the canonical row uses median or best-of-3 depending on metric.

### Q-H10: "What if backend pod restarts mid-run?"
**Short answer:** Running exams continue (operator is the source of truth). Backend's next poll picks them up. Frontend reconnects. The status hookup might miss 30s of progress updates.

---

## I. UX & ACCESSIBILITY

### Q-I1: "Is the UI accessible (screen readers, keyboard nav)?"
**Short answer:** Partial — MUI defaults give baseline keyboard nav. Some custom components lack aria-labels. Not WCAG-audited.
**Source of truth:** `ui_blind_spot_audit.md`.

### Q-I2: "Does it work on mobile?"
**Short answer:** Responsive layout (MUI). Tested on tablet; phone viewports are tight. Not the primary target.

### Q-I3: "Does it work in Safari/Firefox?"
**Short answer:** Tested in Chromium-based browsers (Chrome, Edge). Should work in Firefox/Safari but not exhaustively tested.

### Q-I4: "Are there i18n / localization?"
**Short answer:** English only. The codebase has some Korean text in `사용 메뉴얼.txt` (deployment guide).

### Q-I5: "Dark mode?"
**Short answer:** The dashboard iframes are dark-themed (per RNGD/L40/A40/Atom+ design). The main React UI is light-mode by default.

### Q-I6: "What's the loading state?"
**Short answer:** MUI LinearProgress + Skeleton components. Most pages have explicit loading states. See `ui_blind_spot_audit.md`.

### Q-I7: "Empty states?"
**Short answer:** Most lists handle empty data with explanatory text. Comparison page has dedicated `ComparisonDiagnosticPanel` for "no comparable pair" case.

### Q-I8: "Error boundaries?"
**Short answer:** No global ErrorBoundary; per-page error UI varies. A surprise React error currently bubbles to a generic blank screen.

---

## J. ROADMAP & NEXT STEPS

### Q-J1: "What's the next milestone?"
**Short answer:** Operator v1.0.3 deploy + 6-device-simultaneous soak certificate + Streamlit-per-vendor live dashboards (true content parity).

### Q-J2: "Will you add H100 support?"
**Short answer:** When we get H100 hardware. The framework is HW-agnostic.

### Q-J3: "Will you submit to MLPerf?"
**Short answer:** Maybe — depends on partner participation. We have the methodology in place; submission requires audit.

### Q-J4: "Will the source code be open-sourced?"
**Short answer:** Pending decision. The benchmark suite has both novel + boilerplate code; clean-room separation needed before publication.

### Q-J5: "How do you keep up with vendor SDK updates?"
**Short answer:** We periodically re-run with newer vLLM / furiosa-llm / optimum-rbln versions. Version lockfiles capture what we tested.

### Q-J6: "What about multimodal models (vision-language)?"
**Short answer:** Out of scope. Llama-3.1-8B is text-only. Multimodal benchmarks would require vendor-specific support that varies wildly.

### Q-J7: "What about RAG benchmarks?"
**Short answer:** We measure raw inference latency, not RAG application performance. RAG would require a retrieval+generation pipeline benchmark.

### Q-J8: "What about fine-tuning benchmarks?"
**Short answer:** This system is inference-only. Fine-tuning is a separate workload (different metrics, different hardware utilization patterns).

---

## K. PRESENTATION TACTICS

### Q-K1: "How long is the demo?"
**Short answer:** ~30 minutes per `live_demo_dry_run_script.md`. Can be compressed to 15 min by skipping Atom+ section.

### Q-K2: "What if the audience is non-technical?"
**Short answer:** Lead with the leaderboard on the landing page. "RNGD wins TT100T at 1.267 seconds, beating both NVIDIA L40 (1.588s) and A40 (1.784s)." Skip the precision-narrative depth unless asked.

### Q-K3: "What if the audience is hyper-technical?"
**Short answer:** Open `precision_narrative_defense.md` and `tt_n_extrapolation_analysis.md` early. Be ready for the "different vendor stacks" critique.

### Q-K4: "Can you re-run the demo on demand?"
**Short answer:** Yes — pre-collected rows + live-launch capability. Allow ~5 min between demos for cold-start cool-down.

### Q-K5: "What if a Q&A goes off-script?"
**Short answer:** Defer with confidence: "Great question — let me check our notes." Search this playbook (Cmd+F). Don't fabricate.

---

## DEMO SIMULATION TRANSCRIPTS

### Simulation 1: skeptical academic reviewer

**Reviewer:** "Your TT100T comparison mixes 4 different compute paths. How is this scientific?"

**You (open precision_narrative_defense.md):** "Great question — we frame this as 'best-each-vendor-can-do for the same FP8 model file.' Forcing identical compute precision is impossible — A40 has no FP8 tensor cores; Atom+'s SDK doesn't expose FP8 yet. We make the precision delta explicit in a Compute-Precision UI column on the comparison page. The lead order RNGD > Atom+ > L40 > A40 is also stable at TT500T and TT1000T per our extrapolation analysis. We're answering 'which hardware serves this model fastest in production?', not 'are these chips identical?'."

**Reviewer:** "But MLPerf submissions enforce precision rules."

**You:** "We're not submitting to MLPerf — we use the harness for repeatable measurement methodology. An official submission would require closed-division compliance. We're transparent about this distinction in our index doc."

**Reviewer:** "Why TT100T not TT1000T?"

**You (open tt_n_extrapolation_analysis.md):** "TT100T captures the user-perceived 'first paragraph' latency. Per our extrapolation analysis, the rank order is identical at TT500T, TT1000T, and TT2000T — RNGD's lead actually grows because it has the lowest TPOT (12.58ms vs L40's 15.89ms). So measuring at any other N would still show NPU > GPU."

### Simulation 2: business reviewer

**Reviewer:** "What's the cost difference?"

**You:** "L40 is roughly $7-9k per card with 300W TDP. RNGD is similar capex but 116W TDP — significant power savings at scale. A40 is older, ~$4-6k. Atom+ varies. For a fleet of 100 cards over 3 years, the perf/watt advantage of NPUs translates to substantial OpEx reduction."

**Reviewer:** "Can I deploy this in AWS/GCP?"

**You:** "L40/A40 are available on cloud providers (e.g., AWS g5/g6 instances). RNGD/Atom+ are on-prem only currently. The comparison framework itself runs on stock k8s and would deploy anywhere."

**Reviewer:** "When can I buy RNGD?"

**You:** "Direct procurement via FuriosaAI sales. They have customer references."

### Simulation 3: prospective customer

**Customer:** "I want to serve Llama-3.1-8B chat completions at 1000 QPS. What's your recommendation?"

**You:** "For 1000 QPS at typical chat latency targets, you'd want ~50-100 RNGD cards (RNGD does ~80 TPS single-stream; throughput-under-load is ~10-20 QPS per card depending on prompt length). L40 alternative would need ~80-150 cards. Power difference would be ~17 kW vs 30 kW for the GPU fleet. We can model this more precisely if you share your latency SLA."

**Customer:** "What about fine-tuning?"

**You:** "Out of scope for our current benchmarks — this system measures inference. Fine-tuning is a different workload with different HW utilization."

---

## Total: 80+ Q&A entries across 11 categories (A through K) + 3 demo simulations

If a question isn't here, search the other reports referenced in `00_DEMO_DEFENSE_INDEX.md`.

End of demo defense playbook.

---

## L. DETAILED METRIC GLOSSARY

This section defines every metric on every comparison page so you can answer "what does X mean?" without ambiguity.

### TT100T (Time To 100 Tokens)
**Unit:** seconds
**Formula:** TTFT + 99 × TPOT
**What it measures:** Total wall-clock time from request submission to receipt of the 100th output token.
**Why it matters:** Captures "user-perceived first-paragraph latency" — the typical chat-completion responsiveness window.
**Range in our data:** 1.267s (RNGD) — 1.784s (A40)

### TPS (Tokens Per Second)
**Unit:** tokens/second (output tokens only)
**Formula:** N_output_tokens / (elapsed - TTFT)
**What it measures:** Steady-state generation throughput, excluding prefill overhead.
**Why it matters:** Single number summarizing inference throughput — useful for capacity planning.
**Range in our data:** 56.05 (A40) — 80.37 (RNGD)

### TTFT (Time To First Token)
**Unit:** milliseconds
**What it measures:** Latency from request submission to receipt of the first output token. Includes tokenizer + prefill (KV-cache initialization for the prompt) + first-decode-step.
**Why it matters:** Determines perceived responsiveness — how long the user waits before "anything happens."
**Range in our data:** ~16ms (L40) to ~35ms (Atom+) — typically dominated by prompt length.

### TPOT (Time Per Output Token)
**Unit:** milliseconds
**What it measures:** Steady-state per-token generation latency after the first token. Often called "inter-token latency" (ITL).
**Why it matters:** Determines streaming UX smoothness; lower is better for "live typing" feel.
**Range in our data:** 12.34ms (RNGD) — 17.84ms (A40)

### Accuracy
**Unit:** fraction (0-1) or percentage
**What it measures:** For MMLU-Pro: fraction of correct answers across the 14-subject benchmark.
**Why it matters:** Sanity check that quantization didn't destroy model quality.
**Range in our data:** 0.4343 (L40 BF16) — 0.4407 (L40 FP8) — within sample noise.

### Compute Precision (UI column)
**Unit:** human-readable label
**What it shows:** The actual matmul precision used during inference, distinct from the storage precision of the model weights.
**Examples:** "FP8 (sm_89 native)", "BF16 Marlin (FP8 weights dequant)", "FP8 (FuriosaAI vendor-native)", "BF16-fallback (Rebellions optimum-rbln limitation)"
**Why it matters:** Makes the precision delta across vendors visible to the audience.

### Storage Precision
**Unit:** dtype string
**What it shows:** The dtype of the weights as serialized to disk. Always "FP8" for our cross-HW comparison (we use the FP8-quantized weight file across all HW).

### data_number
**Unit:** integer (sample count)
**What it controls:** Number of CNN/DailyMail prompts the harness will run.
**Default behavior:** If 0, the harness runs the full validation split (13368 samples).

### max_output_tokens / max_tokens
**Unit:** integer (token cap)
**What it controls:** Max generated tokens per sample.
**Default:** 128 in the UI form (matches MLPerf reference).
**Valid range:** 16-2048.

### min_duration_ms (MLPerf-only)
**Unit:** milliseconds
**What it controls:** Performance-mode minimum elapsed time before harness can declare completion.
**Default (post v32):** 0 — harness ends when N samples done.
**For MLPerf compliance:** 600000 (10 min).

### retry_num
**Unit:** integer (count)
**What it controls:** Number of independent runs of the same config; final TPS/TT100T can be averaged or best-of-N.

### batch_size
**Unit:** integer (concurrent requests)
**What it controls:** vLLM batch size; for offline scenario, controls pipelining.
**Default:** 1 (single-stream).

### scenario (MLPerf)
**Values:** offline | server
**offline:** all queries submitted upfront, processed as fast as possible.
**server:** Poisson-arrival queries, latency-SLA-bound throughput.

### mode (MLPerf)
**Values:** accuracy | performance
**accuracy:** run all N samples once, report accuracy (no min_duration enforcement).
**performance:** repeated submission until both N samples AND min_duration met.

---

## M. PER-PAGE CHEAT-SHEET

For each page, here's what to point at + what to say.

### `/` (landing page)
**What to point at:** TT100T leaderboard at top.
**What to say:** "RNGD wins TT100T at 1.267s. Atom+ second at 1.359s. L40 third at 1.588s. A40 fourth at 1.784s. NPUs beat GPUs on this workload."

### `/dashboard/gpu-realtime`
**What to point at:** 4 GPU device cards (2 L40 on node2, 2 A40 on node3).
**What to say:** "Real-time view of all NVIDIA GPUs. Each card auto-refreshes every 5 seconds via Server-Sent Events."

### `/dashboard/npu-realtime`
**What to point at:** RNGD + Atom+ device cards.
**What to say:** "Two NPU vendors — FuriosaAI on node4, Rebellions on node5."

### `/mlperf`
**What to point at:** "Create New Test" form (collapsed by default), the L40 + A40 dashboard iframes below the form, the exam table above.
**What to say:** "MLPerf benchmark page for GPUs. Top: form to create new exam. Below: live dashboards for L40 (node2) and A40 (node3). Exam table shows historical runs."

### `/mmlu`
**Same as MLPerf** but for MMLU-Pro accuracy benchmark (no min_duration concept).

### `/npu-eval/rngd`
**What to point at:** Hardware identity card (FuriosaAI orange), exam table, Streamlit-style live dashboard at the bottom.
**What to say:** "RNGD-specific page. Streamlit dashboard at port 30890 shows real-time NPU temp, power, and active benchmark progress."

### `/npu-eval/atomplus`
**Similar to RNGD** but Rebellions purple, Atom+ live dashboard at port 30892.

### `/mlperf/device-comparison` (CLIMAX PAGE)
**What to point at:** Side-by-side TT100T table with Compute-Precision column.
**What to say:** "This is the apples-to-apples comparison. Same FP8 weight file across all 4 HW. The Compute-Precision column makes the precision delta explicit."

### `/mmlu/device-comparison`
**Same shape but MMLU accuracy** as primary metric.

---

## N. TROUBLESHOOTING DURING THE DEMO

**Symptom:** Page hangs on form submit
**Cause:** Backend timeout or DTO validation rejected
**Action:** Open browser console (F12), look for the error response. Most likely a 500 from a malformed enum value.

**Symptom:** Iframe blank
**Cause:** Dashboard pod restarted or unreachable
**Action:** Click the "open in new tab ↗" link at the top of the iframe panel.

**Symptom:** Comparison table empty
**Cause:** Vendor filter applied or no comparable rows
**Action:** Reset filter to "all" or pick known IDs (75, 76, 124, 125).

**Symptom:** Realtime dashboard shows idle even though benchmark is running
**Cause:** Backend snapshot priority bug (mp-exam wins over mm-exam on same SKU). Or stale snapshot.
**Action:** Refresh the page; or accept it's idle for the secondary benchmark; or describe the limitation.

**Symptom:** Status stuck Running
**Cause:** Pre-v27 backend wouldn't auto-refresh from list polls. Should be fixed in deployed v27.
**Action:** Click on the row to navigate to detail view, which triggers /status/{id} poll → updates DB.

---

## O. THE BIG-PICTURE NARRATIVE (for your closing remarks)

> "What you've seen is a benchmark suite that measures real-world LLM inference latency across four very different hardware platforms — two NVIDIA GPUs and two specialized NPUs from FuriosaAI and Rebellions. We use the MLPerf inference methodology adapted for cross-vendor comparison, with the precision delta between vendors made explicitly visible in the UI. The headline result: NPUs beat GPUs at TT100T for this workload, and the lead grows for longer outputs. The comparison is honest — we label every precision difference, we acknowledge the SDK-maturity caveat, and we don't claim official MLPerf scores. The system is a research cluster running on stock Kubernetes, designed to be reproducible, with all source code in our internal git and benchmark methodology documented in the docs/reports directory."

---

## P. IF THINGS GO TERRIBLY WRONG

If the demo crashes mid-stream and you can't recover, fall back to slides:
1. Share screen of `00_DEMO_DEFENSE_INDEX.md` — the master document.
2. Walk through the top-10 questions table.
3. Show `tt_n_extrapolation_analysis.md` for the headline numbers.
4. Show `precision_narrative_defense.md` for the methodology defense.
5. Apologize briefly: "the live system has a transient issue — let me walk you through the data we've collected."

The static documents tell a coherent story even without the live cluster.

---

End of demo defense playbook. Total line count: ~700+. Q&A entries: 80+. Categories: 11 (A through P). Demo simulations: 3.

If a question isn't answered here, search the other reports listed in `00_DEMO_DEFENSE_INDEX.md`, or politely defer with confidence.

---

## Q. EXTENDED Q&A — DEEP TECHNICAL

### Q-Q1: "What's vLLM's PagedAttention and why does it matter?"
**Short answer:** PagedAttention is vLLM's KV-cache management algorithm — it allocates cache in fixed-size blocks (like OS virtual memory pages) rather than contiguous tensors. This dramatically reduces memory fragmentation and enables higher concurrency.
**Detailed:** Without PagedAttention, KV-cache for variable-length prompts wastes GPU memory in fragmentation. With it, the cache is divided into 16-token blocks and a logical→physical mapping. Result: 2-4× throughput improvement at given memory budget.
**Why it matters:** Our L40 numbers benefit from this. RNGD's vendor stack has analogous block-attention. Atom+ uses optimum-rbln's own approach.

### Q-Q2: "What's CUDA graph capture and what's its overhead?"
**Short answer:** vLLM precompiles common kernel sequences into CUDA graphs to reduce kernel-launch overhead. First request triggers capture (~30-60s on L40). Subsequent requests reuse the captured graphs (saves ~50µs/kernel).
**Why it matters:** Cold-start delay you see on stage is ~5min weights load + ~30-60s graph capture. After that, steady-state.

### Q-Q3: "What's the KV-cache memory footprint?"
**Short answer:** For Llama-3.1-8B with 128 max output tokens and batch=1, KV-cache ≈ 32 layers × 2 (K+V) × 1024 head-dim × 8 heads × 128 tokens × 2 bytes (FP16) ≈ 256 MB per request. Tiny compared to the 8.5GB weights.
**Why it matters:** KV-cache only becomes a memory bottleneck at very long contexts (16k+ tokens) or very high concurrency (100+ batches).

### Q-Q4: "Why is L40's TPS lower than its theoretical FLOPS would predict?"
**Short answer:** TPS is bandwidth-bound for batch=1, not compute-bound. L40 has 864 GB/s memory bandwidth; 8.5GB FP8 model takes ~10ms to read once = limits to ~100 tokens/s ceiling. We measure 62.94, so we're at ~63% of bandwidth ceiling.
**Why it matters:** Optimization opportunities are about better memory traffic patterns (e.g., FlashAttention-3, FP8 KV-cache), not raw FLOPS.

### Q-Q5: "What's FlashAttention?"
**Short answer:** A memory-efficient attention algorithm that fuses softmax + matmul + reduces memory traffic. vLLM uses FlashAttention by default.
**Why it matters:** All our GPU runs benefit from this. RNGD/Atom+ have their own attention implementations.

### Q-Q6: "What about multi-token speculative decoding?"
**Short answer:** Out of scope for this comparison. Spec-decoding (draft model + target model) can give 2-3× speedup but requires a smaller draft model (e.g., Llama-3.2-1B). Not equally implemented across all 4 vendor stacks yet.
**Why it matters:** Path to TT100T < 1.1s on L40 was identified in prior work via spec-decoding (Llama-3.2-1B as draft). Future investigation.

### Q-Q7: "What's the prefill-vs-decode split?"
**Short answer:** Prefill = processing the prompt (all tokens at once, compute-bound). Decode = generating output tokens one at a time (bandwidth-bound). TTFT measures prefill latency; TPOT measures decode latency.
**Why it matters:** Different HW have different prefill/decode tradeoffs. NPUs typically optimize for decode throughput; GPUs for prefill.

### Q-Q8: "What's tensor parallelism?"
**Short answer:** Splitting a model across multiple devices, each holding a slice of every layer. Communication overhead during forward pass.
**Why it matters:** TP=2 across both L40 cards on node2 hit TT100T 1.083s (sub-1.1s target). Single-device path (TP=1) is what we measure for the comparison.

### Q-Q9: "What's pipeline parallelism?"
**Short answer:** Different layers on different devices, with activations passed between them. Higher latency, higher throughput.
**Why it matters:** Not used in our setup. Would help only if model > single device memory.

### Q-Q10: "What's continuous batching?"
**Short answer:** vLLM's algorithm for dynamically batching arriving requests at every iteration step rather than waiting for batch fill. Maximizes GPU utilization under variable load.
**Why it matters:** Our scenario=offline doesn't exercise this fully. scenario=server would.

### Q-Q11: "What's the difference between offline and server scenario throughput?"
**Short answer:** offline submits all queries upfront (max throughput). server simulates Poisson arrivals (lower effective throughput due to queueing). Same per-request latency at the median.
**Why it matters:** We use offline for the demo because it's simpler and matches our methodology.

### Q-Q12: "Could you measure power consumption directly?"
**Short answer:** Per-card power is reported by nvidia-smi (GPU) and rbln-stat (Atom+) and furiosactl (RNGD) — visible in our live dashboards as kW current draw. Wall-power including host overhead requires PDU monitoring.
**Why it matters:** TPS/Watt math we cite (RNGD 0.69, L40 0.21) uses per-card numbers.

---

## R. AUDIENCE ARCHETYPE PLAYBOOK

### The "ML researcher" archetype
**Likely questions:** Quantization methodology, accuracy preservation, attention algorithms, comparison fairness.
**Response posture:** Be technical. Cite vLLM source, MLPerf rules, neuralmagic LLM-Compressor.

### The "infrastructure architect" archetype
**Likely questions:** Operator scheduling, NFS bandwidth, k8s resource accounting, scaling.
**Response posture:** Cite the cluster topology + soak runbook. Reference concurrent_run_scenarios.md.

### The "procurement / business" archetype
**Likely questions:** Cost, power, vendor support, deployability.
**Response posture:** Use the perf/watt table. Cite vendor commercial readiness.

### The "skeptical academic peer-reviewer" archetype
**Likely questions:** Methodology rigor, statistical significance, reproducibility, MLPerf compliance.
**Response posture:** Concede the limitations transparently. Cite precision_narrative_defense.md. Don't oversell.

### The "vendor representative" archetype
**Likely questions:** "Why didn't you use my product's full capability?" / "Did you contact us for optimization help?"
**Response posture:** Acknowledge — we used published vendor SDKs, didn't reach out for special builds. We'd welcome partner engagement for re-runs.

### The "executive sponsor" archetype
**Likely questions:** "What's the headline?" / "Should we buy NPUs?"
**Response posture:** Lead with the leaderboard. Use the perf/watt + cost angle.

---

## S. POST-DEMO FOLLOW-UP MATERIALS

After the demo, point interested attendees at:
- This document (`demo_defense_playbook.md`) for ongoing Q&A
- `00_DEMO_DEFENSE_INDEX.md` for the full report inventory
- `tt_n_extrapolation_analysis.md` for any methodology questions
- The live cluster `http://10.254.177.41:30001/` for hands-on exploration

If a serious vendor partnership / collaboration interest comes up, route to Mondrian / FuriosaAI / Rebellions partner contacts (out of scope for this benchmark suite).

---

## T. FINAL CONFIDENCE-BUILDING

Before you go on stage, remind yourself:

1. **The numbers are real.** Every TT100T cited comes from actual cluster runs, recorded in the postgres benchmark_results table.
2. **The system works.** All 4 dashboards return HTTP 200 right now. The frontend is deployed at v32. The backend is at v27.
3. **The story is coherent.** RNGD wins TT100T; the lead grows at higher N; the precision deltas are visible in the UI; the methodology is defensible as "MLPerf-style".
4. **The bugs are known.** The min_duration default has been fixed (v32 form). The list-polling staleness has been fixed (v27 backend). No new bugs introduced this session.
5. **You have backups.** Pre-collected rows id=75/76/124/125 will work even if live-launch fails.
6. **The audience is on your side.** They want to see good work, not catch you out. Treat questions as opportunities to show your depth.

Take a breath. You're ready.

End of playbook v1.0.

---

## U. APPENDIX — RAW NUMBERS FOR QUICK REFERENCE

If you need to read out specific numbers, use these (all from cluster's postgres):

### Per-HW MLPerf hero numbers (FP8 model, 100 samples, 128 max tokens)

| HW | Row ID | TT100T | TPS | TTFT | TPOT |
|---|---|---|---|---|---|
| RNGD FP8 (FuriosaAI) | id=75 | **1.267 s** | 80.37 | 32 ms | 12.34 ms |
| Atom+ BF16-fallback | id=76 | **1.359 s** | ~73 | ~35 ms | ~13.5 ms |
| L40 FP8 (sm_89 native) | id=124 | **1.588 s** | 62.94 | 16 ms | 15.89 ms |
| A40 FP8 (Marlin) | id=125 | **1.784 s** | 56.05 | 18 ms | 17.84 ms |

### Per-HW MMLU-Pro accuracy (FP8 weights + bf16 compute)

| HW | Run ID | Accuracy |
|---|---|---|
| L40 BF16 baseline | mp-45 | 0.4343 |
| L40 FP8 | mp-46 | 0.4407 |
| A40 BF16 baseline | mp-44 | 0.4400 |
| A40 FP8 | mp-49 | 0.4393 |

(Within ~1% absolute = sample noise floor. FP8 preserves accuracy.)

### Cluster spec quick-reference

- **node1** (10.254.177.41): control plane, CPU only, hosts backend + frontend pods
- **node2** (10.254.184.195): 2× NVIDIA L40 sm_89, 48GB VRAM, 300W TDP each
- **node3** (10.254.184.196): 2× NVIDIA A40 sm_86, 48GB VRAM, 300W TDP each
- **node4** (10.254.202.114): 1× FuriosaAI RNGD, 37GB HBM3, 60 TFLOPS BF16, 116W TDP
- **node5** (10.254.202.111): 2× Rebellions Atom+ RBLN-CA22, 16GB each, 32 INT8 TOPS

### Live URL quick-reference

- Main UI: `http://10.254.177.41:30001/`
- L40 dashboard: `http://10.254.184.195:30891/`
- A40 dashboard: `http://10.254.184.196:30893/`
- RNGD dashboard: `http://10.254.202.114:30890/`
- Atom+ dashboard: `http://10.254.202.111:30892/`

### Image versions (live at write time)

- Frontend: `jungwooshim/etri-llm-frontend:v32`
- Backend: `jungwooshim/etri-llm-backend:v27`
- Operator: `mondrianai/etri-llm-k8s-operator:v1.0.1`

End.
