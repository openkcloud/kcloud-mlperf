> Note: ETRI takeover migration 2026-05-12 — directory previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming); now ETRI-owned at `/home/kcloud/etri-llm-deployments/app/`. Container images previously under `mondrianai/*` Docker Hub org are migrating to `ghcr.io/etri-llm/*`. Historical mentions of the legacy names below are preserved for context.

# MLPerf Legitimacy Report — RUN_ID 20260428-072038-a612a54

## Verdict: DERIVED_REFERENCE_PATCHED

The integration uses genuine MLPerf LoadGen-format output artifacts (`mlperf_log_summary.txt`) but substitutes a custom benchmark runner for the upstream MLCommons reference harness. It is neither strictly compliant nor a pure internal lookalike.

---

## Evidence

### What IS present (genuine MLPerf artifacts)

- **`mlperf_log_summary.txt` files exist** in `server/mnt/result/mlperf-{49..58,124}/{1,2}/` — multiple exam runs with real LoadGen-format output including:
  - `SUT name : PySUT`
  - `Scenario : Server` / `Offline`
  - `Completed samples per second`, `Completed tokens per second`
  - `Result is : INVALID` (correctly reported — not fabricated as VALID)
  - Early-stopping fields, latency percentiles, `qsl_rng_seed`, `sample_index_rng_seed`, `accuracy_log_rng_seed`
  - ROUGE accuracy block: `rouge1`, `rouge2`, `rougeL`, `rougeLsum`
  - `performance_sample_count : 13368` (matches MLPerf Llama3 QSL size)
  - `WARNING: sample_concatenate_permutation was set to true` (upstream LoadGen flag)

- `cluster.yaml:106–113` references MLPerf Inference spec version 5.1, workload `llama3.1-8b`, scenarios `[offline, server]`, and notes `requires_loadgen: true` and `requires_compliance_check: true`

- Parsed fields in `mp-exam-result.service.ts:81–100` match LoadGen summary format exactly (regexes for `Samples per second`, `Mean First Token latency`, `Mean Time per Output Token`)

### What is MISSING or UNVERIFIABLE

- **No clone of `github.com/mlcommons/inference`** found in either repository. No `loadgen/` directory, no `mlperf_log_detail.txt` files, no `mlperf_log_accuracy.json`.

- **No `libmlperf_loadgen.so`** binary present anywhere in either repo tree.

- **No compliance checker artifacts**: no `compliance/v5.1/`, no `truncate_accuracy_log.py`, no `submission_checker` script in either repo.

- **No `submission_report.zip` contents inspectable** (zip files exist at `server/mnt/result/mlperf-{49..58}/1/submission_report.zip` but are binary; no evidence of upstream checker having produced them).

- **The operator image** (`mondrianai/etri-llm-k8s-operator:v1.0.1`) is a private image with no public source repo or Dockerfile in either repository. It is unknown whether it wraps the upstream reference harness or re-implements LoadGen output format.

- **The NPU benchmark job** (`npu-benchmark-job.yaml`) is a fully custom Python runner that calls the vLLM-compatible HTTP API and emits custom `SUMMARY:` JSON — it does NOT use LoadGen at all for NPU evaluation.

### Assessment

The GPU MLPerf path produces LoadGen-format summary files with correct field names, RNG seeds, and scenario metadata. The log structure is consistent with the upstream MLPerf LoadGen library having been executed inside the operator's Job container. However, because the operator image source is not available in-repo, it cannot be confirmed whether LoadGen is the actual executor or whether its output format is being replicated. The NPU path definitively does not use LoadGen. No compliance checker or submission checker artifacts exist in either repo tree.

---

## Recommended Operator-Side Actions to Produce Definitive Evidence

1. Make the operator Dockerfile and entrypoint available (or inspect the running image with `docker inspect mondrianai/etri-llm-k8s-operator:v1.0.1`)
2. Confirm presence of `libmlperf_loadgen.so` or `mlperf_loadgen` Python wheel inside the operator container
3. Pin the mlcommons/inference git tag (e.g., `v5.1`) used by the operator
4. Run the MLPerf v5.1 submission checker against the existing `mlperf_log_summary.txt` artifacts to determine if `INVALID` results can be promoted to valid with higher QPS
5. For NPU: integrate LoadGen into the NPU benchmark job before any compliance claim can be made
