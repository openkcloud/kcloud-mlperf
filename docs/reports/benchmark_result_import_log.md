# Benchmark Result Import Log

Generated: 2026-05-06T02:20:41.504971+00:00

## Summary

| Metric | Value |
|--------|-------|
| Total rows | 116 |
| Completed | 105 |
| Failed | 7 |
| Running | 4 |
| Other | 0 |
| Full-dataset runs | 48 |
| Unique config fingerprints | 36 |
| Comparable groups (same fingerprint, multiple hardware) | 19 |
| Fake/mock violations | 0 |

## Data Sources

- Live API: `http://10.254.177.41:30980/api/comparison/list`
- Logs files: `logs/benchmarks/**/*.json`

## Status Distribution

### mlperf

| Status | Count |
|--------|-------|
| completed | 87 |
| failed | 5 |
| running | 4 |

### mmlu

| Status | Count |
|--------|-------|
| completed | 18 |
| failed | 2 |

## Comparable Groups (same config fingerprint)

These groups are eligible for direct hardware comparison in the UI.

- **16e0f9de196e7bf8...** (mlperf, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=500): A40, L40 (4 runs)
- **221b8b227a97be83...** (mlperf, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=0): A40, L40 (20 runs)
- **2390f9930b05ec00...** (mlperf, meta-llama/Llama-3.1-8B-Instruct, FP8, data_number=0): RNGD (3 runs)
- **23ca835274ad542e...** (mmlu, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=10): A40, L40 (3 runs)
- **41f27dfa495fa639...** (mlperf, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=500): A40, L40 (2 runs)
- **4dc450f06b43f512...** (mlperf, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=13368): Atom+, RNGD (2 runs)
- **5e4edfafaa02fbbb...** (mlperf, meta-llama/Llama-3.1-8B-Instruct-FP8, BF16, data_number=500): A40, L40 (4 runs)
- **64cb83ff471520fa...** (mmlu, meta-llama/Llama-3.1-8B-Instruct-FP8, BF16, data_number=100): A40, L40 (2 runs)
- **69ef103321159e58...** (mmlu, meta-llama/Llama-3.1-8B-Instruct-FP8, BF16, data_number=12102): A40, L40 (2 runs)
- **7640071d95d6ac1a...** (mmlu, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=100): A40, L40 (2 runs)
- **77ced3e61b00e59a...** (mmlu, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=0): A40, L40 (8 runs)
- **9038b8b0f7366f40...** (mlperf, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=100): A40, L40 (2 runs)
- **97bb6cbd74ee7a26...** (mlperf, meta-llama/Llama-3.1-8B-Instruct, FP8, data_number=5): RNGD (2 runs)
- **a26fefa19bebce11...** (mlperf, meta-llama/Llama-3.1-8B-Instruct-FP8, FP8, data_number=100): RNGD (25 runs)
- **afa54588c3cdc36b...** (mlperf, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=500): A40, L40 (2 runs)
- **d2ca3d1c58b2da14...** (mlperf, meta-llama/Llama-3.1-8B-Instruct-FP8, FP8, data_number=50): RNGD (6 runs)
- **d72cf4cad1f65889...** (mlperf, meta-llama/Llama-3.1-8B-Instruct-FP8, BF16, data_number=13368): A40, L40 (3 runs)
- **f07a0e173ea41559...** (mlperf, meta-llama/Llama-3.1-8B-Instruct-FP8, FP8, data_number=1000): RNGD (2 runs)
- **f92505f6d75a162c...** (mlperf, meta-llama/Llama-3.1-8B-Instruct, BF16, data_number=0): A40, L40 (5 runs)

## Fake/Mock Data Check

PASS — no mock/fake/todo/fixme/placeholder values detected in metric fields.

## Failed Runs

| run_id | hardware | benchmark | failure_reason |
|--------|----------|-----------|----------------|
| mlperf-69-npu_exam | RNGD | mlperf | Run status was Stopped |
| mmlu-54-mm_exam | A40 | mmlu | Reason : BackoffLimitExceeded / Message : Job has reached the specified backoff  |
| mmlu-53-mm_exam | A40 | mmlu | Reason : BackoffLimitExceeded / Message : Job has reached the specified backoff  |
| mlperf-62-npu_exam | RNGD | mlperf | Reconciled by user-pov RUN_ID 20260429-023224-e380f33: status=Running with start |
| mlperf-33-npu_exam | RNGD | mlperf | Run status was Stopped |
| mlperf-30-npu_exam | RNGD | mlperf | Run status was Stopped |
| mlperf-15-npu_exam | RNGD | mlperf | Run status was Stopped |
