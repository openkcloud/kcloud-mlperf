# ETRI LLM Benchmark Suite — Feature Map

Operator-facing guide to every menu item. Generated: 2026-04-28.

---

## Benchmarks

### MLPerf
Runs the MLPerf v5.1 inference benchmark against GPU nodes. From this page you can view the full history of completed and in-progress tests, check live status (how many repetitions have finished), navigate to individual result pages, select two runs to compare side-by-side, and create a new test. The create form (collapsed by default) lets you pick the model, dataset, precision (BF16/FP8/etc.), scenario (Offline or Server), mode (Accuracy or Performance), GPU type, tensor-parallel size, and number of repetitions. A toggle at the top-right hides auto-generated sweep runs from the table.

### MMLU-Pro
Runs the MMLU-Pro language-understanding benchmark. The workflow is identical to MLPerf: view history, start a new test, navigate to results. The result page shows per-subject accuracy bars across 14 academic disciplines (Physics, Chemistry, Law, Engineering, Economics, Health, Psychology, Business, Biology, Philosophy, Computer Science, History, Math, Other) plus an overall accuracy bar, with an Excel download button.

### NPU Eval (FuriosaAI RNGD)
Benchmarks the FuriosaAI RNGD NPU accelerator. From this page you can submit a new NPU exam (model, precision, batch size, dataset, repetitions, max output tokens), monitor running exams with a live progress bar, view an embedded live dashboard (node4) showing NPU temperature, power, and raw log tails, and navigate to result pages. The key performance indicator is TT100T (time to first 100 tokens): the result page shows a pass/fail alert against the 1.1-second target and bar charts for TPS, TTFT, TPOT, and total latency.

---

## Cross-Device Comparisons

### MLPerf vs NPU (sidebar label)
Shows a live GPU real-time feed filtered to MLPerf exams — same view as the GPU Realtime dashboard but scoped to MLPerf benchmark jobs. Note: this is a live operational view, not a historical MLPerf-vs-NPU result comparison. For a full historical NPU-vs-GPU comparison use the "NPU vs GPU" link.

### MMLU vs NPU (sidebar label)
Same as above but filtered to MMLU benchmark jobs. Live GPU feed, not a historical comparison.

### NPU vs GPU
A full side-by-side comparison tool. Select a completed NPU exam from the table, then pick a matching GPU exam (MLPerf or MMLU) from a modal. The page renders bar charts for average TPS (higher is better), average TT100T in seconds (lower is better, target < 1.1 s), and average latency, plus a summary table that declares the winner per metric.

---

## Operations

### GPU Realtime
The live benchmark operations dashboard. Shows a sweep progress bar (cells completed / total), individual device cards for each GPU node (NVIDIA L40, A40, L40-44GiB, A40-44GiB) with current status, TPS, TT100T, and elapsed time, a bar chart of current TPS across all GPU SKUs, and a table of active exam slots. The feed uses Server-Sent Events at 2-second intervals with automatic fallback to 5-second polling if SSE is unavailable.

### Sweep Control
Launches and controls an automated GPU benchmark sweep that tests every combination of precision (BF16, FP8), batch size (1/4/8/16), sample count (500/1000/2000), scenario (offline/server), and tensor-parallel size (1/2). The page shows how many benchmark cells the selected configuration would produce and estimates total duration. Buttons: Start full sweep, Run calibration (single-cell smoke test), Pause (suspends dispatching new cells), Drain (lets running cells finish then stops). Requires admin role; the feature must be enabled via the `VITE__GPU_SWEEP_ENABLED` environment variable — if not set the page shows a configuration notice instead.
