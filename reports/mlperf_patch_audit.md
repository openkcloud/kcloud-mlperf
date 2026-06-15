> Note: ETRI takeover migration 2026-05-12 — directory previously named `mondrianai-etri-llm-deployments-a9c4c59c4869` (legacy subcontractor naming); now ETRI-owned at `/home/kcloud/etri-llm-deployments/app/`. Container images previously under `mondrianai/*` Docker Hub org are migrating to `ghcr.io/etri-llm/*`. Historical mentions of the legacy names below are preserved for context.

# MLPerf Patch Audit — RUN_ID 20260428-072038-a612a54

## Finding: No upstream MLPerf source found in either repository

Neither `etri-llm-exam-solution` nor `mondrianai-etri-llm-deployments-a9c4c59c4869` contains a clone, submodule, or vendored copy of `github.com/mlcommons/inference`.

### Search conducted
- `.gitmodules` scan: only `kubespray/.gitmodules` found (unrelated)
- `find` for `libmlperf_loadgen*`, `mlperf_log_detail*`, `truncate_accuracy_log.py`, `submission_checker`: zero results
- `find` for `loadgen/`, `compliance/`: zero results
- `grep` for `mlcommons/inference`, `mlperf-inference` package references in `package.json` / `requirements.txt` / `pyproject.toml`: zero results (no Python dependency manifest found in either repo)

### What exists instead

| Artifact | Location | Origin |
|----------|----------|--------|
| `mlperf_log_summary.txt` files (17 files) | `server/mnt/result/mlperf-{id}/{n}/` | Output artifacts — produced by operator Job containers at runtime |
| `submission_report.zip` files (8 files) | `server/mnt/result/mlperf-{id}/1/` | Binary — contents not inspected; origin unknown |
| `exam_result.zip` files | `server/mnt/result/mlperf-{id}/1/` | Binary — likely aggregated result archives |
| Custom Python benchmark runner | `server/src/npu-eval/templates/npu-benchmark-job.yaml` | Fully custom; no LoadGen dependency |

### Conclusion

Because no upstream source is present, no patch analysis is possible. The `submission_report.zip` files suggest some post-processing occurred (possibly the upstream submission checker was run inside the operator container), but this cannot be verified from the repository contents alone.

**Patches found: NONE** (upstream source not present — patch analysis is not applicable).

To perform a meaningful patch audit, the operator image (`mondrianai/etri-llm-k8s-operator:v1.0.1`) must be inspected for embedded MLPerf source and any modifications to `loadgen/`, `language/llama2/`, or `compliance/` directories relative to the `mlcommons/inference` tag in use.
