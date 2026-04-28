# Node4 Local Handoff — NPU Benchmark Suite

**Date**: 2026-04-23
**From**: Claude Code on node1 (10.254.177.41)
**To**: Claude Code on node4 (10.254.202.114)

---

## TL;DR

You're on the NPU node (RNGD). Your job is to:
1. Get `furiosa-llm serve` running locally
2. Run 3 error-free benchmark runs (MLPerf + MMLU) using the benchmark script
3. POST results to the backend API
4. Verify everything shows up in the Web UI at `http://10.254.177.41:30001`
5. Fix any errors, re-run until clean

---

## Current State of the Cluster

### Nodes
| Node | IP | Role |
|------|-----|------|
| node1 | 10.254.177.41 | Control plane, kubectl, project code |
| node2 | 10.254.184.195 | L40 GPU |
| node3 | 10.254.184.196 | A40 GPU, NFS server |
| node4 | 10.254.202.114 | **YOU ARE HERE** — RNGD NPU |

### Running Services
- **Backend API**: `http://10.254.177.41:30980/api` (NestJS, NodePort 30980)
- **Frontend UI**: `http://10.254.177.41:30001` (React, NodePort 30001)
- **Database**: PostgreSQL in k8s (ClusterIP)
- **Inference server**: `npu-inference-server` pod on node4 with hostNetwork at port 8000
  - **IMPORTANT**: Kill this pod before starting furiosa-llm locally. It's using the NPU.
  - Run: `kubectl delete pod npu-inference-server -n llm-evaluation` (from node1) OR just kill the process locally

### NPU Hardware
- FuriosaAI RNGD: 1 card, 8 PEs, 48GB HBM3, 256 TFLOPS BF16, 512 TOPS INT8
- Device: `/dev/rngd/npu0pe0` through `npu0pe7`
- Furiosa SDK: `furiosa-llm v2026.1.0` (installed at system level)

### Model Location
- **Root's HF cache**: `/root/.cache/huggingface/hub/models--furiosa-ai--Llama-3.1-8B-Instruct/`
  - This is the pre-compiled Furiosa artifact (NOT raw HF weights)
  - Contains `.edf` files for RNGD execution
- **NFS models** (mounted): `/mnt/models/Llama-3.1-8B-Instruct/` — raw HF safetensors (NOT for furiosa-llm)
- **HF Token**: `${HF_TOKEN}`

### Dataset Location (NFS)
- MLPerf: `/mnt/datasets/cnn_eval.json` — 13,368 CNN-DailyMail articles
- MMLU: `/mnt/datasets/mmlu-pro/` — MMLU-Pro question files

---

## Step 1: Kill existing inference server

The k8s pod `npu-inference-server` is using the NPU right now. Kill it:

```bash
# Option A: via kubectl (if you have access)
kubectl delete pod npu-inference-server -n llm-evaluation --force --grace-period=0

# Option B: kill locally
fuser -k /dev/rngd/npu0pe0
# or find and kill the process
ps aux | grep furiosa-llm | grep -v grep | awk '{print $2}' | xargs kill -9
```

Also stop exam #15 running in the backend (it's trying to reach the inference server):

```bash
curl -X PATCH http://10.254.177.41:30980/api/npu-eval/stop/15
```

---

## Step 2: Start furiosa-llm serve locally

```bash
sudo furiosa-llm serve furiosa-ai/Llama-3.1-8B-Instruct \
  --host=0.0.0.0 \
  --port=8000 \
  --device=npu:0:*
```

**Notes**:
- May need `sudo` depending on device permissions
- Model loads in ~20 seconds from cache
- Verify: `curl http://localhost:8000/health`
- If you get EBUSY: `sudo fuser -k /dev/rngd/npu0pe0` then retry
- If import errors: check `/home/kcloud/.local/lib/python3.10/site-packages/` for stale packages
  - Previously had to remove old `furiosa_native_runtime` and `aiohttp` from there

---

## Step 3: Run benchmarks

### 3A. Quick Smoke Test (verify it works)

```bash
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"furiosa-ai/Llama-3.1-8B-Instruct","messages":[{"role":"user","content":"What is 2+2?"}],"max_tokens":50,"temperature":0}'
```

### 3B. Full Benchmark Script

Create and run this benchmark script. It iterates over dataset samples, measures all metrics, and POSTs results to the backend API.

```python
#!/usr/bin/env python3
"""NPU Benchmark Runner — runs locally on node4, posts results to backend API."""

import time, json, requests, os, sys

SERVER = "http://localhost:8000"
API_BASE = "http://10.254.177.41:30980/api"
MODEL = "furiosa-ai/Llama-3.1-8B-Instruct"

def load_mlperf_samples(path="/mnt/datasets/cnn_eval.json", limit=0):
    with open(path) as f:
        data = json.load(f)
    samples = []
    for item in data:
        text = item.get("article", item.get("text", item.get("input", "")))
        if text:
            samples.append(f"Summarize the following article:\n\n{text[:2000]}")
    return samples if limit == 0 else samples[:limit]

def load_mmlu_samples(path="/mnt/datasets/mmlu-pro", limit=0):
    samples = []
    for fname in sorted(os.listdir(path)):
        fpath = os.path.join(path, fname)
        if fname.endswith(".jsonl"):
            with open(fpath) as f:
                for line in f:
                    try:
                        item = json.loads(line.strip())
                        q = item.get("question", item.get("input", ""))
                        if q: samples.append(q)
                    except: pass
        elif fname.endswith(".json"):
            with open(fpath) as f:
                data = json.load(f)
            if isinstance(data, list):
                for item in data:
                    q = item.get("question", item.get("input", ""))
                    if q: samples.append(q)
    return samples if limit == 0 else samples[:limit]

def run_benchmark(samples, max_tokens=4096, run_num=1):
    """Run one benchmark pass over all samples."""
    run_start = time.perf_counter()
    total_tokens = 0
    total_ttft = 0
    total_tpot_sum = 0
    tt100t_values = []
    completed = 0
    errors = 0

    for idx, prompt in enumerate(samples):
        sample_start = time.perf_counter()
        first_token_time = None
        token_100_time = None
        token_count = 0

        try:
            resp = requests.post(
                f"{SERVER}/v1/chat/completions",
                json={"model": MODEL, "messages": [{"role": "user", "content": prompt}],
                      "max_tokens": max_tokens, "temperature": 0.0, "stream": True},
                stream=True, timeout=300)

            for line in resp.iter_lines():
                if line:
                    decoded = line.decode("utf-8")
                    if decoded.startswith("data: ") and decoded != "data: [DONE]":
                        token_count += 1
                        if first_token_time is None:
                            first_token_time = time.perf_counter()
                        if token_count == 100 and token_100_time is None:
                            token_100_time = time.perf_counter()
        except Exception as e:
            print(f"  Sample {idx+1}: ERROR - {e}", flush=True)
            errors += 1
            continue

        sample_end = time.perf_counter()
        if first_token_time:
            total_ttft += (first_token_time - sample_start)
            if token_count > 1:
                total_tpot_sum += (sample_end - first_token_time) / (token_count - 1)
        if token_100_time:
            tt100t_values.append(token_100_time - sample_start)

        total_tokens += token_count
        completed += 1

        if (idx + 1) % 100 == 0 or (idx + 1) == len(samples):
            elapsed = time.perf_counter() - run_start
            print(f"  Run {run_num}: {idx+1}/{len(samples)} samples, {total_tokens} tokens, {elapsed:.1f}s, {errors} errors", flush=True)

    run_time = time.perf_counter() - run_start
    return {
        "ttft": round(total_ttft / completed, 4) if completed else None,
        "tt100t": round(sum(tt100t_values) / len(tt100t_values), 4) if tt100t_values else None,
        "tps": round(total_tokens / run_time, 2) if run_time > 0 else 0,
        "tps_best": round(total_tokens / run_time, 2),
        "sps": round(completed / run_time, 4) if run_time > 0 else 0,
        "latency": round(run_time, 4),
        "tpot": round(total_tpot_sum / completed, 6) if completed else None,
        "best_tt100t": round(min(tt100t_values), 4) if tt100t_values else None,
        "completed": completed,
        "errors": errors,
    }

def create_exam(name, benchmark, dataset, data_number=0, max_output_tokens=0, retry_num=3):
    """Create exam via backend API."""
    from datetime import datetime
    resp = requests.post(f"{API_BASE}/npu-eval/create", json={
        "name": name,
        "description": f"Local node4 benchmark - {benchmark}",
        "benchmark": benchmark,
        "model": MODEL,
        "precision": "BF16",
        "framework": "furiosa-llm",
        "batch_size": 1,
        "dataset": dataset,
        "data_number": data_number,
        "npu_type": "RNGD",
        "npu_num": 1,
        "cpu_core": 8,
        "ram_capacity": 64,
        "retry_num": retry_num,
        "max_output_tokens": max_output_tokens,
        "started_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+09:00"),
    })
    data = resp.json()["data"]
    print(f"Created exam #{data['id']}: {name}")
    return data["id"]

def update_exam_status(exam_id, status):
    """Update exam status via API."""
    if status == "Running":
        requests.patch(f"{API_BASE}/npu-eval/start-time/{exam_id}")
    elif status == "Completed":
        requests.patch(f"{API_BASE}/npu-eval/update/{exam_id}", json={"status": "Completed"})
    elif status == "Error":
        requests.patch(f"{API_BASE}/npu-eval/update/{exam_id}", json={"status": "Error"})

def post_result(exam_id, run_num, result):
    """Post benchmark result to backend API."""
    requests.post(f"{API_BASE}/npu-eval/results/create", json={
        "examId": exam_id,
        "resultNumber": run_num,
        "ttft": result["ttft"],
        "tt100t": result["tt100t"],
        "tps": result["tps"],
        "tpsBest": result["tps_best"],
        "sps": result["sps"],
        "latency": result["latency"],
        "tpot": result["tpot"],
        "accuracy": 0,
        "npuMemPeak": 0,
        "npuUtil": 0,
        "npuPower": 0,
        "valid": "true" if result["errors"] == 0 else "false",
    })

def run_full_benchmark(benchmark, dataset, samples, num_runs=3, max_tokens=4096, data_number=0):
    """Create exam, run benchmark, post results."""
    exam_name = f"{benchmark.upper()}-Full-Node4-{time.strftime('%H%M')}"
    exam_id = create_exam(exam_name, benchmark, dataset, data_number=data_number,
                          max_output_tokens=0, retry_num=num_runs)

    update_exam_status(exam_id, "Running")
    print(f"\n{'='*60}")
    print(f"Exam #{exam_id}: {exam_name}")
    print(f"Benchmark: {benchmark}, Samples: {len(samples)}, Runs: {num_runs}, Max tokens: {max_tokens}")
    print(f"{'='*60}")

    all_clean = True
    for run in range(1, num_runs + 1):
        print(f"\n--- Run {run}/{num_runs} ---")
        result = run_benchmark(samples, max_tokens=max_tokens, run_num=run)
        post_result(exam_id, run, result)

        tag = "PASS" if result["errors"] == 0 else "FAIL"
        tt100t_str = f'{result["tt100t"]:.4f}s' if result["tt100t"] else "N/A"
        print(f"\n  [{tag}] TT100T={tt100t_str} TPS={result['tps']} TTFT={result['ttft']}s "
              f"errors={result['errors']}/{result['completed']}")

        if result["errors"] > 0:
            all_clean = False

    update_exam_status(exam_id, "Completed")
    print(f"\nExam #{exam_id}: COMPLETED — {'ALL CLEAN' if all_clean else 'HAD ERRORS'}")
    return exam_id, all_clean


if __name__ == "__main__":
    # Verify server is up
    print("Checking inference server...", flush=True)
    try:
        r = requests.get(f"{SERVER}/health", timeout=5)
        assert r.status_code == 200
        print("Server healthy!", flush=True)
    except:
        print("ERROR: Inference server not running at localhost:8000")
        print("Start it: sudo furiosa-llm serve furiosa-ai/Llama-3.1-8B-Instruct --host=0.0.0.0 --port=8000 --device=npu:0:*")
        sys.exit(1)

    # --- MLPerf Benchmark ---
    print("\n" + "="*60)
    print("LOADING MLPerf (CNN-DailyMail) DATASET")
    print("="*60)
    mlperf_samples = load_mlperf_samples()
    print(f"Loaded {len(mlperf_samples)} samples")

    mlperf_id, mlperf_clean = run_full_benchmark(
        "mlperf", "CNN-DailyMail", mlperf_samples, num_runs=3, max_tokens=4096
    )

    # --- MMLU Benchmark ---
    print("\n" + "="*60)
    print("LOADING MMLU-Pro DATASET")
    print("="*60)
    mmlu_samples = load_mmlu_samples()
    print(f"Loaded {len(mmlu_samples)} samples")

    mmlu_id, mmlu_clean = run_full_benchmark(
        "mmlu", "MMLU-Pro", mmlu_samples, num_runs=3, max_tokens=4096
    )

    # --- Summary ---
    print("\n" + "="*60)
    print("FINAL SUMMARY")
    print("="*60)
    print(f"  MLPerf (Exam #{mlperf_id}): {'CLEAN' if mlperf_clean else 'HAD ERRORS'}")
    print(f"  MMLU   (Exam #{mmlu_id}):   {'CLEAN' if mmlu_clean else 'HAD ERRORS'}")
    print(f"\nVerify results in Web UI: http://10.254.177.41:30001")
    print("Navigate to: NPU Evaluation → click the eye icon on each exam")
```

Save as `/home/kcloud/run_benchmarks.py` and run:

```bash
sudo python3 /home/kcloud/run_benchmarks.py
```

**Note**: Full MLPerf (13,368 samples × 3 runs) takes ~36 hours. For a quicker validation, edit `load_mlperf_samples(limit=100)` and `load_mmlu_samples(limit=100)`.

---

## Step 4: Verify results in Web UI

After benchmarks complete, check:

1. **NPU Evaluation page** (`http://10.254.177.41:30001` → NPU Evaluation)
   - New exams should show as "Completed" with green status
   - Click the eye icon to see results
   - Charts should render with TT100T, TPS, TTFT, TPOT data

2. **GPU vs NPU Comparison** (button on NPU page)
   - Select your new NPU exam → "Compare with GPU" → select a GPU exam
   - Side-by-side charts should render

3. **Error check**: No exams stuck in "Pending" or "Error"

---

## Step 5: Fix errors if any

If the benchmark script reports errors:

### Common errors and fixes:

| Error | Fix |
|-------|-----|
| `EBUSY` on NPU device | `sudo fuser -k /dev/rngd/npu0pe0` then restart server |
| `Connection refused` | Server crashed — restart furiosa-llm serve |
| `ImportError` for furiosa modules | Remove stale packages: `rm -rf ~/.local/lib/python3.10/site-packages/furiosa*` |
| `aiohttp` errors | `rm -rf ~/.local/lib/python3.10/site-packages/aiohttp*` |
| Request timeout (300s) | Some samples may generate very long outputs — reduce max_tokens |
| `more_itertools` error | `pip install 'more-itertools==10.5.0'` |

### Re-run strategy:
If you get errors, fix the root cause, then re-run the benchmark script. It creates new exams each time. Delete failed exams via:
```bash
curl -X DELETE http://10.254.177.41:30980/api/npu-eval/delete/<EXAM_ID>
```

---

## Step 6: Web App Diagnosis (optional)

After benchmarks are clean, do a full Web UI walkthrough:

1. Create a new exam from the UI form (small — 5 samples, 200 tokens)
2. Watch it transition: Pending → Preparing → Running → Completed
3. View results page — all charts render
4. Try GPU vs NPU comparison
5. Try stopping a running exam
6. Try deleting an exam

**Note**: The automated orchestration in the backend (`npu-eval.service.ts`) now handles the full lifecycle. Exams created from the UI will auto-run IF the inference server is reachable at `http://10.254.202.114:8000`.

---

## Backend Architecture (for context)

The backend runs in k8s on node4. The NpuEvalService was rewritten to include:
- `scheduleBenchmark()` → schedules exec after delay
- `executeBenchmark()` → PENDING → PREPARING → RUNNING → COMPLETED
- `streamCompletion()` → SSE token counting via Node.js http module
- `loadDatasetSamples()` → reads from NFS mount at `/usr/src/app/mnt/datasets/`
- Inference server URL: `NPU_INFERENCE_URL` env var, defaults to `http://10.254.202.114:8000`

Source code: `/home/kcloud/etri-llm-exam-solution/server/src/npu-eval/npu-eval.service.ts`

---

## Performance Baseline (from 3,426 overnight runs)

| Metric | Best | Average | Worst |
|--------|------|---------|-------|
| TT100T | 1.692s | 1.776s | 1.856s |
| TPS | 59.06 | 56.51 | 54.24 |
| TTFT | 26.2ms | 30.7ms | 41.5ms |
| TPOT | 16.82ms | 17.63ms | 18.37ms |

**TT100T target is 1.1s** — NOT achievable with current single-card BF16 artifact. Would need FP8 quantized artifact or speculative decoding or multiple NPU cards.

---

## Important: Before you start

1. **Stop exam #15** (it's running from the backend, consuming the NPU via the k8s pod):
   ```bash
   curl -X PATCH http://10.254.177.41:30980/api/npu-eval/stop/15
   ```

2. **Kill the inference k8s pod** (it's using the NPU device):
   ```bash
   # From node4 locally:
   ps aux | grep furiosa-llm | grep -v grep | awk '{print $2}' | xargs sudo kill -9 2>/dev/null
   sudo fuser -k /dev/rngd/npu0pe0 2>/dev/null
   ```

3. **Then start your own local furiosa-llm serve** (step 2 above)

Good luck!
