# MLPerf Inference 5.1 Compliance Checklist — RUN_ID 20260428-072038-a612a54

Verdict basis: **DERIVED_REFERENCE_PATCHED** — see `mlperf_legitimacy_report.md`

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | LoadGen library present in submission toolchain | **UNKNOWN** | `libmlperf_loadgen.so` not found in either repo; operator container not inspectable from source |
| 2 | `mlperf_log_summary.txt` produced per run | **YES** | 17 files under `server/mnt/result/mlperf-{49..58,124}/{1,2}/` with correct LoadGen schema |
| 3 | `mlperf_log_detail.txt` produced per run | **NO** | Not found in either repository or result directories |
| 4 | `mlperf_log_accuracy.json` produced per accuracy run | **NO** | Not found; ROUGE scores present inline in summary only |
| 5 | Offline scenario exercised | **YES** | `mlperf_log_summary.txt` files contain `Scenario : Offline` entries; `cluster.yaml` lists `offline` |
| 6 | Server scenario exercised | **YES** | `mlperf_log_summary.txt:5` — `Scenario : Server`; `cluster.yaml` lists `server` |
| 7 | Result validity: at least one VALID result | **NO** | `server/mnt/result/mlperf-49/1/mlperf_log_summary.txt:9` — `Result is : INVALID`; early stopping not satisfied; all inspected files show INVALID |
| 8 | Accuracy script present (ROUGE for Llama3) | **UNKNOWN** | ROUGE scores appear in summary; script source not found in either repo — likely inside operator container |
| 9 | Compliance checker run (`compliance/v5.1/`) | **NO** | No compliance directory, no `TEST01`/`TEST04`/`TEST05` artifacts found |
| 10 | Submission checker artifacts present | **UNKNOWN** | `submission_report.zip` files exist but are binary and unverified; no checker script found |
| 11 | RNG seeds match upstream specification | **PARTIAL** | Seeds present (`qsl_rng_seed: 1780908523862526354`, etc.) and match known LoadGen defaults; cannot confirm they match v5.1 without source |
| 12 | `performance_sample_count` matches workload spec | **YES** | `performance_sample_count : 13368` matches MLPerf Llama3 QSL size |
| 13 | MLCommons inference repo cloned at pinned tag | **NO** | No clone or submodule found in either repository |
| 14 | NPU path uses LoadGen | **NO** | `npu-benchmark-job.yaml` is a fully custom HTTP-streaming Python runner with no LoadGen dependency |
| 15 | Patches reviewed by submission checker | **UNKNOWN** | No patches identified (no source present); not reviewable |

### Summary Counts
- YES: 4
- NO: 6
- UNKNOWN: 4
- PARTIAL: 1

### Critical Blockers for Compliance

1. **All GPU results are INVALID** — early stopping criteria not met (run sizes too small: 100 queries vs. ~459 needed). QPS targets must be raised or run duration extended.
2. **`mlperf_log_detail.txt` and `mlperf_log_accuracy.json` are absent** — required for submission.
3. **Compliance tests (TEST01/TEST04/TEST05) not run** — required by MLPerf submission rules.
4. **NPU evaluation does not use LoadGen** — any NPU result cannot be presented as MLPerf-compliant.
5. **No pinned mlcommons/inference git tag** — reproducibility cannot be guaranteed.
