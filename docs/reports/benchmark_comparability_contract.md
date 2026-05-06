# Benchmark Comparability Contract

**Version:** 1.3.0
**Scope:** MLPerf Inference (100-sample CNN-DailyMail subset, FP8 strict) + MMLU-Pro full eval
**Hardware targets:** L40, A40, RNGD, Atom+

**Changelog:**
- v1.3.0 (2026-05-06): BREAKING — user-authorized contract correction. FP8 strict across ALL 4 HW (no BF16 fallback). Dataset subset: CNN-DailyMail 100 samples. Vendor-specific FP8 model IDs per HW. dataset_subset added as fingerprint field. Removed precision_mismatch_targets.
- v1.2.0 (2026-05-06): Added §10 reconciliation: RNGD precision confirmed bf16, Atom+ id=70 excluded.
- v1.1.0 (2026-05-06): Initial canonical contract. max_output_tokens=128, CNN-DailyMail 3.0.0, offline scenario.
- v1.0.0 (prior team): Base schema.

---

## 1. Purpose

Two benchmark runs are "directly comparable" if and only if they share the same canonical config fingerprint. This document defines what fields enter the fingerprint, which hardware-specific fields are excluded, and the FP8-strict precision policy across all hardware targets.

---

## 2. Canonical Fingerprint

The fingerprint is a SHA-256 hex digest of the following normalized fields. Any deviation in these fields produces a different hash and disqualifies the run from direct comparison.

| Field | MLPerf canonical value | MMLU-Pro canonical value |
|---|---|---|
| `benchmark` | `mlperf` | `mmlu` |
| `model` | `meta-llama/Llama-3.1-8B-Instruct-FP8` (normalized; see §3.3) | `meta-llama/Llama-3.1-8B-Instruct` |
| `dataset` | `CNN-DailyMail` | `TIGER-Lab/MMLU-Pro` |
| `dataset_version` | `3.0.0` (pinned) | `main` (pinned commit) |
| `dataset_subset.name` | `cnn_dailymail` | — (absent = empty in hash) |
| `dataset_subset.n_samples` | `100` | — (absent = 0 in hash) |
| `precision` | `fp8` (ALL hardware targets) | `bf16` (all targets) |
| `batch_size` | `1` | `1` |
| `data_number` | `100` | `0` (full dataset) |
| `decoding.temperature` | `0.0` | `0.0` |
| `decoding.top_p` | `1.0` | — (absent = 0 in hash) |
| `decoding.top_k` | `0` | — (absent = 0 in hash) |
| `scenario` | `offline` | — (absent = empty in hash) |
| `max_output_tokens` | `128` | — (absent = 0 in hash) |

**Fields excluded from the fingerprint (metadata only):** `hardware_target`, `node`, `runtime`, `runtime_version`, `driver_version`, `tensor_parallel_size`, `git_commit`, `command`, `logs_path`, `result_artifact_path`, `fp8_blocked`, `stderr_proof`.

---

## 3. MLPerf Benchmark Rules

### 3.1 Benchmark type
`mlperf-inference` only.

### 3.2 Dataset
CNN-DailyMail (`abisee/cnn_dailymail`, version `3.0.0`), 100-sample authorized subset. The `dataset_subset` field `{ name: "cnn_dailymail", n_samples: 100 }` is included in the fingerprint so a 100-sample run never matches a full-dataset run from previous contract versions.

### 3.3 Model — vendor-specific FP8 variants
Each hardware target uses a vendor-optimized FP8 model. All variants must be normalized to `meta-llama/Llama-3.1-8B-Instruct-FP8` before fingerprinting so cross-hardware runs hash to the same value:

| Hardware | HuggingFace model ID |
|---|---|
| L40, L40_44GiB | `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` |
| A40, A40_44GiB | `neuralmagic/Meta-Llama-3.1-8B-Instruct-FP8` |
| RNGD | `furiosa-ai/Llama-3.1-8B-Instruct-FP8` (fallback: `furiosa-ai/Llama-3.1-8B-Instruct-FP8-MLPerf`) |
| Atom+ | `rebellions/Llama-3.1-8B-Instruct-FP8` (runtime flag: `RBLN_QUANTIZATION=fp8`) |

### 3.4 Precision — FP8 STRICT, no BF16 fallback
`precision=fp8` is required for ALL four hardware targets. This is non-negotiable per user authorization (2026-05-06). There is no `precision_mismatch_targets` list. If a hardware target genuinely cannot load an FP8 model, it must be marked **HARD BLOCKED** with `fp8_blocked=true` and a `stderr_proof` path in run metadata. Silent BF16 fallback is not permitted and will produce a different fingerprint that is excluded from the canonical comparison group.

### 3.5 Output tokens
`max_output_tokens=128` for all canonical MLPerf runs.

### 3.6 Scenario
`offline` only for canonical runs. Server-scenario runs produce a different fingerprint.

---

## 4. MMLU-Pro Benchmark Rules

### 4.1 Scope
Full eval: all 57 MMLU-Pro subjects, `data_number=0` (full dataset per subject), 5-shot evaluation (`n_train=5`).

### 4.2 Precision
`bf16` for all hardware targets. FP8 is not used for MMLU-Pro to ensure accuracy parity across targets.

### 4.3 Decoding
Greedy decoding: `temperature=0.0`. `top_p` and `top_k` absent (normalized to 0 in fingerprint).

---

## 5. Precision Policy (v1.3.0)

`precision=fp8` is required for ALL four hardware targets for MLPerf canonical runs. There is no BF16 fallback and no `precision_mismatch_targets` list. This supersedes the v1.2.0 per-HW bf16 table entirely.

| Target | Canonical precision | FP8 model ID | Notes |
|---|---|---|---|
| L40 | fp8 | `RedHatAI/Meta-Llama-3.1-8B-Instruct-FP8` | Ada Lovelace native FP8 |
| A40 | fp8 | `neuralmagic/Meta-Llama-3.1-8B-Instruct-FP8` | FP8 weights, bf16 compute via vllm auto-promotion |
| RNGD | fp8 | `furiosa-ai/Llama-3.1-8B-Instruct-FP8` | Furiosa quant pipeline; fallback: `furiosa-ai/Llama-3.1-8B-Instruct-FP8-MLPerf` |
| Atom+ | fp8 | `rebellions/Llama-3.1-8B-Instruct-FP8` | Runtime flag: `RBLN_QUANTIZATION=fp8` |

If a hardware target cannot load any FP8 model variant, it must be marked **HARD BLOCKED**: set `fp8_blocked=true` and provide a `stderr_proof` path (log file showing the load failure) in run metadata. The run is recorded as BLOCKED, not as a bf16 fallback. Silent BF16 substitution is not permitted.

All per-HW vendor model IDs must be normalized to `meta-llama/Llama-3.1-8B-Instruct-FP8` before calling `canonicalize()` so that all four hardware targets map to the same fingerprint hash.

---

## 6. Required Metadata Fields

Every canonical run record must include the following fields (in addition to the fingerprint fields above):

- `hardware_target` — one of: `L40`, `A40`, `RNGD`, `Atom+`
- `node` — k8s node name (e.g. `node2`, `node4`)
- `runtime` — `vllm` | `furiosa-llm` | `rbln-model-serving`
- `runtime_version` — semver string
- `timestamp` — ISO-8601 UTC
- `success` — boolean

Optional but required when applicable:
- `fp8_blocked` — boolean; `true` when hardware cannot load any FP8 model variant
- `stderr_proof` — path to log file proving FP8 load failure (required when `fp8_blocked=true`)
- `driver_version` — CUDA or NPU driver version
- `git_commit` — short SHA of the benchmark harness
- `command` — exact CLI invocation (env vars redacted)
- `logs_path` — path to run logs artifact
- `result_artifact_path` — path to result zip

---

## 7. Comparability Rules

1. **Same fingerprint required.** Runs must share an identical SHA-256 fingerprint to be placed in the same comparison cell.
2. **Hardware identity excluded.** `hardware_target`, `node`, `runtime`, and driver fields do not enter the fingerprint. Different hardware with identical config fields maps to the same fingerprint.
3. **FP8 strict — no BF16 comparison rows.** BF16 MLPerf runs produce a different fingerprint and are excluded from the canonical comparison table entirely. There are no "annotated cross-precision rows" in v1.3.0.
4. **Canonical subset only.** For MLPerf, only runs with `data_number=100` AND `dataset_subset.n_samples=100` are canonical. Runs with any other `data_number` (including 13368) are in a different fingerprint group and must not appear in the canonical comparison table.
5. **Pinned dataset version.** Runs with `dataset_version` other than the pinned value (`3.0.0` for CNN-DailyMail, `main` at the pinned commit for MMLU-Pro) are ineligible.
6. **Deterministic decoding only.** Runs with `temperature > 0` are ineligible for canonical comparison.
7. **Offline scenario only (MLPerf).** Server-scenario MLPerf runs are tracked separately and do not mix with offline results.

---

## 8. Config Fingerprint Implementation

Source: `server/src/comparison/config-fingerprint.ts`

- `canonicalize(run)` — returns SHA-256 hex digest
- `isSameConfig(a, b)` — returns `true` if fingerprints match
- `diffConfig(a, b)` — returns list of field paths that differ

Normalization rules:
- String fields: trim, lowercase, collapse whitespace; `null`/`undefined` → `""`
- Numeric fields: `null`/`undefined` → `0`
- Key order is sorted before JSON serialization (deterministic regardless of insertion order)

---

## 9. Dataset Choice Rationale

CNN-DailyMail is selected as the MLPerf reference dataset for the following reasons:
- It is the established MLPerf Inference v4.x reference dataset for Llama-3.1-8B summarization evaluation.
- It has a fixed, versioned test split (13,368 samples in version 3.0.0) enabling reproducible full-dataset runs.
- OpenOrca is used in instruction-following evaluation contexts but is not the MLPerf reference for this model class.

---

## 10. Contract Reconciliation Decisions (v1.2.0)

### 10.1 RNGD Precision: bf16 confirmed, FP8-tagged rows rejected

**Issue (raised by W15 critic):** DB rows for RNGD MLPerf are tagged `precision=FP8`, contradicting the contract's `precision=bf16` for RNGD.

**Decision: Option (b) — contract stands at bf16. FP8-tagged RNGD rows are excluded from canonical comparison.**

**Rationale:** All authoritative sources confirm RNGD uses bf16:
- `.omc/handoffs/canonical-config.yaml`: `RNGD: "bf16"  # FuriosaAI furiosa-llm native format"`
- `.omc/handoffs/SESSION_HANDOFF_train_a.md`: RNGD baseline (#27) is cited as a standard bf16 evaluation point.
- furiosa-llm's model serving architecture quantizes to a hardware-native format at load time from a bf16 checkpoint; the runtime does not expose an FP8 precision setting in its public API.
- The FP8 tag on existing DB rows reflects a data-entry error in the benchmark harness, not a real hardware capability change.

**Operational consequence:** Any RNGD result row with `precision=fp8` in its metadata must be excluded from the canonical comparison table. These rows may appear in an "informational" appendix labeled "non-canonical precision — excluded from fingerprint group." W8 must ensure new RNGD MLPerf runs are submitted with `precision=bf16`. W10 must filter `precision=fp8` RNGD rows from the canonical export.

### 10.2 Atom+ max_output_tokens=128: contract confirmed, historical row excluded

**Issue (raised by W15 critic):** DB row id=70 (Atom+ Llama-3.1-8B MLPerf, node5 SSH fallback) used `max_output_tokens=100` and `data_number=5` (smoke run). W8 task #72 is running a corrected full run with `max_output_tokens=128` and `data_number=13368`.

**Decision: Contract max_output_tokens=128 is confirmed. No relaxation. Row id=70 is permanently excluded from the canonical fingerprint group.**

**Rationale:**
- The v1.1.0 contract was explicit: `max_output_tokens=128`. Row id=70 predates the contract and used legacy parameters.
- `max_output_tokens` is a fingerprint field. A run with 100 cannot be placed in the same comparison cell as a run with 128 — different hash, different cell.
- Row id=70 also used `data_number=5` (smoke), which violates the full-dataset requirement independently.
- The correct action is for W8 to produce a fresh Atom+ run compliant with the contract. Once that run exists, it will fingerprint-match the canonical group.
- Row id=70 should be labeled `non_canonical=true` and `exclusion_reason="max_output_tokens=100 (canonical=128), data_number=5 (canonical=13368)"` in the W10 export.

### 10.3 Summary table

| Issue | Decision | Contract change | Action required |
|---|---|---|---|
| RNGD precision (FP8 in DB vs bf16 in contract) | Keep bf16; reject FP8-tagged rows | None | W8: submit new RNGD runs with precision=bf16. W10: filter FP8 RNGD rows to non-canonical. |
| Atom+ max_output_tokens=100 (row id=70) | Keep 128; exclude row id=70 | None | W8 #72: run Atom+ with max_output_tokens=128, data_number=13368. W10: mark id=70 non_canonical. |
