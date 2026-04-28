# How to View and Interpret Benchmark Results

## Where Are the Results?

### Frontend URLs

**Dashboard (Real-Time Monitoring)**
- `http://<frontend-host>/dashboard/gpu-realtime` — Live GPU utilization and exam status during runs
- `http://<frontend-host>/dashboard/sweep-control` — Manual exam creation and sweep orchestration

**Benchmark Result Pages (Post-Completion)**
- `http://<frontend-host>/mlperf/test-result?id=<exam-id>` — MLPerf accuracy or performance graphs
- `http://<frontend-host>/mmlu/test-result?id=<exam-id>` — MMLU-Pro subject-by-subject accuracy
- `http://<frontend-host>/npu/test-result?id=<exam-id>` — NPU time-to-100-tokens and latency
- `http://<frontend-host>/mlperf/device-comparison` — Cross-GPU MLPerf results
- `http://<frontend-host>/mmlu/device-comparison` — Cross-GPU MMLU-Pro results
- `http://<frontend-host>/npu/device-comparison` — Cross-NPU results

**Device Overviews**
- `http://<frontend-host>/mlperf/main` — All MLPerf exams with status, create new
- `http://<frontend-host>/mmlu/main` — All MMLU-Pro exams with status, create new
- `http://<frontend-host>/npu/main` — All NPU exams with status, create new

### Backend Raw Artifacts

**NFS Path** (on cluster control plane, requires SSH access)
```
/mnt/nfs/results/<RUN_ID>/
├── mlperf/
│   ├── results.json
│   ├── accuracy_report.csv
│   └── submission/
└── mmlu/
    ├── results.json
    └── accuracy_by_subject.csv
```

**Download via Web UI**
- Each result page has a "Download" button that exports the raw data file (JSON, CSV, or Excel)
- The download endpoint: `GET /api/<benchmark>-result/exam-result/{exam_id}/{result_number}/download`

## Finding a Specific Run by RUN_ID

### Method 1: Direct URL (if you know the exam_id)
1. Navigate to the relevant benchmark page:
   - MLPerf: `http://<frontend-host>/mlperf/test-result?id=<exam_id>`
   - MMLU: `http://<frontend-host>/mmlu/test-result?id=<exam_id>`
   - NPU: `http://<frontend-host>/npu/test-result?id=<exam_id>`
2. Replace `<exam_id>` with the numeric ID from your RUN_ID (first 8 chars or check the database)

### Method 2: Browse the Exam List
1. Go to the benchmark main page (e.g., `http://<frontend-host>/mlperf/main`)
2. The table shows all exams sorted by start time (newest first)
3. Click on the row to navigate to the result page
4. Ctrl+F (or Cmd+F) to search for your RUN_ID substring

### Method 3: Check Kubernetes Pod Logs
If you're on the cluster:
```bash
kubectl logs -n llm-evaluation deploy/etri-llm-backend -f | grep RUN_ID
```
This shows which exam IDs map to your run.

## Raw Artifacts: Where and How to Download

### Via NFS (Requires Cluster Access)
SSH into the control plane and navigate to `/mnt/nfs/results/<RUN_ID>/`:
```bash
ssh kcloud@<control-plane-ip>
ls -lh /mnt/nfs/results/<RUN_ID>/
```

### Via Web UI (No SSH Required)
1. Open the result page in the browser
2. Bottom panel: "Artifacts" section lists all available files with sizes
3. Click file name to download directly, or click the folder icon to download entire `results/` directory as `.tar.gz`

### Via REST API
```bash
curl -o results.tar.gz \
  http://<backend-host>/api/results/<RUN_ID>/download?format=tar.gz
```

## Interpreting Comparability Badges

Result pages display badges that indicate how fairly you can compare two runs:

### `apples_to_apples` (Green)
- Same model, precision, hardware, and batch settings
- Fair comparison; differences reflect only minor variance
- Use for regression detection or reproducibility checks

### `hardware_optimized` (Blue)
- Same model and precision, but different hardware (e.g., L40 vs. A40)
- Results are NOT directly comparable due to memory, clock speed, or architecture differences
- Use for hardware selection analysis, not performance regressions
- Annotation: "Not comparable for latency; accuracy may differ due to numerical precision"

### `non_comparable_diagnostic` (Orange)
- Different model, precision, or major parameter changes (batch size > 2x, quantization level)
- For diagnostic purposes only; do not use for benchmark claims
- Example: "8B FP8 vs. 70B BF16" — different models entirely

### How to Read a Badge
1. Open the device-comparison page (e.g., `/mlperf/device-comparison`)
2. Hover over the badge next to a result row to see the reason
3. Click "Details" to see the exact configuration delta

## Spotting a Failed Run

A run is considered failed if ANY of these conditions are true:

### Obvious Failure Indicators
- **Status badge shows "FAILED"** (red) on the main exam list
- **Error message in the status footer** (e.g., "Pod evicted", "OOM", "Timeout after 2h")
- **Missing results** — result graphs are blank, download buttons are disabled

### Subtle Failure Indicators
- **Failure Rate > 0%** — Visible in the result page's metrics section
  - MLPerf: "Failed samples: 5/100" indicates 5% failure rate
  - MMLU: "Inference errors: 2/14000" indicates 0.014% failure rate
  - NPU: "Invalid runs: 1/5" means 1 out of 5 repetitions failed
- **Latency Outliers** — A single run is 5–10x slower than others
  - Example: Rep 1: 0.55s TT100T, Rep 2: 0.58s, Rep 3: 5.2s (outlier)
  - Indicates transient system load or pod scheduling issue
- **Missing Accuracy** — Accuracy field is "N/A" while latency is present
  - Suggests inference completed but validation step was skipped or failed
- **Partial Metrics** — Only some fields are populated (e.g., TPS but no TT100T)
  - Check the logs (bottom panel) for error messages

### How to Investigate
1. Open the result page and scroll to the **Live Log Stream** (bottom panel)
2. Search the logs for:
   - `ERROR` or `Exception` — error traces
   - `timeout` or `OOM` — resource exhaustion
   - `accuracy` or `inf` — invalid outputs
3. If logs are truncated, click **Download Full Logs** to get the complete pod output
4. Cross-reference with Loki dashboard (if available) for system metrics during the run

## Comparing Two Runs Side-by-Side

### Approach 1: Manual Browser Tabs
1. Open first result page in Tab 1: `http://<host>/mlperf/test-result?id=<exam_id_1>`
2. Open second result page in Tab 2: `http://<host>/mlperf/test-result?id=<exam_id_2>`
3. Arrange windows side-by-side (e.g., with `cmd+left` and `cmd+right` on macOS, or Windows Snap on Windows)
4. Scroll both pages in parallel to compare graphs and metrics

### Approach 2: Device Comparison Page
1. Navigate to `/mlperf/device-comparison` (or MMLU or NPU variant)
2. Use the filter dropdowns at the top to select:
   - Model (e.g., "Llama-3.1-8B-Instruct")
   - Precision (e.g., "FP8")
   - Hardware (e.g., "L40 x 2")
3. The table shows all matching exams in chronological order
4. Click any row to jump to the detailed result page
5. Use the "Comparability" badge to assess fairness of comparison

### Approach 3: Download and Compare Locally
1. Download both exams' raw JSON/CSV via the web UI download buttons
2. Use a local tool (Excel, Pandas, jq) to compare:
   ```bash
   jq -r '.accuracy, .latency' results_1.json results_2.json
   ```
3. Useful for spreadsheet analysis or automated regression detection

## Quick Reference: Metrics Meaning

| Metric | Benchmark | Range | Good Value | Notes |
|--------|-----------|-------|-----------|-------|
| TT100T (Time-to-100-Tokens) | MLPerf, NPU | 0.1–10s | < 1.1s | Measures responsiveness; lower is better |
| TPS (Tokens per Second) | MLPerf, NPU | 1–100 | > 50 | Throughput; higher is better |
| TTFT (Time to First Token) | NPU | 1–500ms | < 100ms | Latency-sensitive workloads; lower is better |
| Accuracy | MMLU | 0–100% | > 50% | Subject-by-subject; overall should be balanced |
| Accuracy (Submission Valid) | MLPerf | 0–100% | 100% | If < 100%, results may be rejected by MLCommons |
| VRAM Peak | MLPerf, NPU | 1–80GB | As low as possible | Memory efficiency; impacts maximum batch size |
| GPU Utilization | MLPerf, NPU | 0–100% | > 70% | Indicates good hardware saturation |

## Troubleshooting: "I Can't Find My Results"

| Problem | Solution |
|---------|----------|
| Result page shows "No data" | Check the exam ID is correct; reload page; verify exam status is "COMPLETED" |
| Download button is disabled | Run may still be in progress; wait for status to change to "COMPLETED" or "FAILED" |
| Graphs are blank | Exam may have completed with 0% success rate; check logs for errors |
| Logs in footer are empty | Logs may have been rotated; fetch full pod logs via kubectl or Loki dashboard |
| Device comparison shows no results | No exams match the filter criteria; try broader filters or check that exams completed |
| Latency is unrealistic (e.g., 0.001s) | May be a data entry error or unit mismatch; check raw JSON for the actual value |
