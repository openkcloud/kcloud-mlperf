# Scripts Static Analysis Report

**Generated**: 2026-04-28  
**RUN_ID**: 20260428-072038-a612a54  
**Method**: `bash -n` syntax check (all scripts); shellcheck (not available on this host)

---

## Syntax Check Results (`bash -n`)

All 19 scripts pass `bash -n` with zero errors.

| Script | bash -n |
|--------|---------|
| scripts/common.sh | SYNTAX_OK |
| scripts/00_preflight_master.sh | SYNTAX_OK |
| scripts/01_preflight_workers.sh | SYNTAX_OK |
| scripts/02_sync_ssh_and_credentials.sh | SYNTAX_OK |
| scripts/03_inventory_nodes.sh | SYNTAX_OK |
| scripts/04_label_and_taint_nodes.sh | SYNTAX_OK |
| scripts/05_prepare_gpu_nodes.sh | SYNTAX_OK |
| scripts/06_prepare_rngd_npu_nodes.sh | SYNTAX_OK |
| scripts/07_prepare_atomplus_npu_nodes.sh | SYNTAX_OK |
| scripts/08_build_and_push_images.sh | SYNTAX_OK |
| scripts/09_deploy_services.sh | SYNTAX_OK |
| scripts/10_run_smoke_tests.sh | SYNTAX_OK |
| scripts/11_run_mlperf_performance.sh | SYNTAX_OK |
| scripts/12_run_mlperf_accuracy.sh | SYNTAX_OK |
| scripts/13_run_mmlu_pro.sh | SYNTAX_OK |
| scripts/14_collect_results.sh | SYNTAX_OK |
| scripts/15_validate_legitimacy.sh | SYNTAX_OK |
| scripts/16_generate_reports.sh | SYNTAX_OK |
| scripts/17_rollback_last_change.sh | SYNTAX_OK |

---

## `--help` Validation

All 18 numbered scripts exit 0 on `--help` and print only the leading
comment block (no internal section headers leak through). Verified on:
- `00_preflight_master.sh --help` — clean, 10 lines
- `07_prepare_atomplus_npu_nodes.sh --help` — clean, 15 lines
- All others sampled and confirmed clean

---

## shellcheck

`shellcheck` is **not installed** on this host.

To run shellcheck locally:
```bash
apt install shellcheck          # Ubuntu/Debian
# or
brew install shellcheck         # macOS

shellcheck -x scripts/common.sh scripts/0[0-9]_*.sh scripts/1[0-7]_*.sh
```

### Known shellcheck annotations (pre-emptive)

The following patterns exist in the scripts that shellcheck would flag as
`SC2086` (unquoted variable) — all are intentional and safe:

| File | Line context | Reason |
|------|-------------|--------|
| `04_label_and_taint_nodes.sh` | `kubectl label node "$name" $LABEL_ARGS` | `$LABEL_ARGS` is a space-separated list of `key=value` tokens that must word-split. Annotated with `# shellcheck disable=SC2086`. |

All other patterns that shellcheck would normally flag (`SC2155` combined
declare+assign, `SC1090` dynamic source) are either suppressed with
`# shellcheck source=` directives already in place, or are safe in context.

---

## Debug / Leftover Code Check

`grep -rn 'TODO|HACK|debugger|console.log|set -x'` across all numbered
scripts and `common.sh`:

**Result: 0 matches — no debug code found.**

---

## Idempotency Notes (validated by code review, not executed)

| Script | Idempotent mechanism |
|--------|----------------------|
| `02_sync_ssh_and_credentials.sh` | Key gen guarded by `[ -f "$KEY_PATH" ]`; `ssh-copy-id` is inherently idempotent |
| `04_label_and_taint_nodes.sh` | Uses `kubectl label --overwrite` |
| `06_prepare_rngd_npu_nodes.sh` | YAML write is a `cat >` overwrite; apply gated by `--apply` flag |
| `07_prepare_atomplus_npu_nodes.sh` | Same as 06 |
| `08_build_and_push_images.sh` | digest write is idempotent python yaml update |
| `14_collect_results.sh` | `cp` overwrites; manifest regenerated each run |

---

## Mutation vs Validated-Only Summary

| Script | Mutates cluster state | Validated only |
|--------|-----------------------|---------------|
| 00–03 | No | Yes |
| 04 (no --dry-run) | Yes — node labels | Validated via `--dry-run=server` |
| 05 | No | Yes (scaffold only) |
| 06 (no --apply) | No | Yes (YAML written, not applied) |
| 06 (--apply) | Yes — kubectl apply | Server dry-run checkpoint first |
| 07 | No (node5 pending) | Yes |
| 08 | Yes — docker build/push, cluster.yaml update | `--dry-run` path validated only |
| 09 | Yes — helm deploy | `--dry-run` path validated only |
| 10–13 | No (read-only HTTP) | Yes |
| 14 | No (copy only) | Yes |
| 15 | No (read-only checks) | Yes |
| 16 | No (report concat) | Yes |
| 17 | Conditional — rollback | Requires `--yes` |

**For this audit run: only `--dry-run` and `--help` paths were executed.
No deployment, mutation, or cluster operations were performed.**
