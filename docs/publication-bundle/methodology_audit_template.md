# Methodology Audit Template

This template combines the Pineau-style ML reproducibility checklist (NeurIPS
2019) with the MLPerf 5.1 disclosure checklist. Copy this file alongside any
publication bundle and fill in **Y / N / N-A** plus a one-line comment for
every item before you ship.

How to score:
- **Y** — claim is satisfied and evidence is in the bundle.
- **N** — claim is *not* satisfied; explain in the comment.
- **N-A** — claim does not apply to this bundle (e.g., MLPerf-only items in an
  MMLU-only bundle); explain in the comment.

---

## Section A — Pineau ML Reproducibility Checklist

A reasonable adaptation of the canonical 30-item list. Re-numbered for
local clarity; the canonical version lives at
https://www.cs.mcgill.ca/~jpineau/ReproducibilityChecklist.pdf

| #   | Item                                                                                                                              | Y / N / N-A | Comment |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------- |
| 1   | A clear description of the mathematical setting, algorithm, and/or model.                                                          |             |         |
| 2   | A link to a downloadable source code, with specification of all dependencies, including external libraries.                        |             |         |
| 3   | A complete description of the data collection process, including sample size.                                                      |             |         |
| 4   | A link to a downloadable version of the dataset or simulation environment.                                                         |             |         |
| 5   | An explanation of any data that were excluded, and all pre-processing steps.                                                       |             |         |
| 6   | The exact number of training and evaluation runs.                                                                                  |             |         |
| 7   | A clear definition of the specific measure or statistics used to report results.                                                   |             |         |
| 8   | A description of results with central tendency (e.g., mean) AND variation (e.g., stddev).                                          |             |         |
| 9   | The average runtime for each result, or estimated energy cost.                                                                     |             |         |
| 10  | A description of the computing infrastructure used.                                                                                |             |         |
| 11  | The range of hyper-parameters considered, method to select the best configuration, and specification of the final hyper-parameters.|             |         |
| 12  | The exact number of evaluation samples per (training run x evaluation point).                                                      |             |         |
| 13  | A clear definition of the train / validation / test splits.                                                                        |             |         |
| 14  | All known limitations, potential biases, and ethical considerations of the model.                                                  |             |         |
| 15  | A statement on whether the dataset is publicly accessible, and if not, what the access conditions are.                             |             |         |
| 16  | If human subjects are involved, IRB approval / consent statement.                                                                  |             |         |
| 17  | All assumptions and theoretical claims clearly stated.                                                                             |             |         |
| 18  | All proofs of theoretical results provided (or location of the proof linked).                                                      |             |         |
| 19  | All data, code, and intermediate artifacts version-controlled.                                                                     |             |         |
| 20  | Random seeds reported and reusable.                                                                                                |             |         |
| 21  | Hardware specifications (model, count, interconnect) reported.                                                                     |             |         |
| 22  | Software stack (OS, framework, driver, kernel patches) reported.                                                                   |             |         |
| 23  | Pre-trained model weights versioned by content hash (e.g., SHA-256).                                                               |             |         |
| 24  | Tokenizer / preprocessing pipeline versioned and reproducible.                                                                     |             |         |
| 25  | Inference parameters (batch size, max output tokens, decoding strategy) reported.                                                  |             |         |
| 26  | Warmup and steady-state measurement protocol described.                                                                            |             |         |
| 27  | Statistical significance methodology (e.g., N=11, bootstrap CI) reported.                                                          |             |         |
| 28  | Any deviations from a published benchmark protocol explicitly listed.                                                              |             |         |
| 29  | Conflict-of-interest statement (vendor relationships, funding).                                                                    |             |         |
| 30  | Reviewer-accessible reproduction recipe (`make reproduce` or equivalent).                                                          |             |         |

---

## Section B — MLPerf 5.1 Disclosure Checklist

Distilled from the MLPerf-Inference v5.1 submission rules
(`mlcommons/inference/blob/master/submission_rules.adoc`). For a real
submission, run upstream `submission_checker.py`; this section is for
internal pre-flight only.

| #   | Item                                                                                                  | Y / N / N-A | Comment |
| --- | ----------------------------------------------------------------------------------------------------- | ----------- | ------- |
| 1   | `system_desc_id.json` present per submitter system, fields match upstream schema.                      |             |         |
| 2   | `mlperf_log_summary.txt` produced by the official LoadGen harness for every Performance run.           |             |         |
| 3   | `mlperf_log_detail.txt` produced by LoadGen for every Performance run.                                 |             |         |
| 4   | `accuracy.txt` (AccuracyMode) within the per-benchmark accuracy threshold.                             |             |         |
| 5   | `mlperf.conf` is the upstream-distributed file (unmodified) for the target version.                    |             |         |
| 6   | `user.conf` overrides only allowed parameters per the rules.                                           |             |         |
| 7   | Compliance suite TEST01 (accuracy invariance) executed and passing.                                    |             |         |
| 8   | Compliance suite TEST04 (performance equivalence) executed and passing.                                |             |         |
| 9   | Compliance suite TEST05 (accuracy stability) executed and passing.                                     |             |         |
| 10  | Scenario(s) declared (Offline / Server / SingleStream / MultiStream) match the workload's allowed set.|             |         |
| 11  | Submitted division correctly declared (Closed / Open / Network).                                       |             |         |
| 12  | Submitted category correctly declared (Datacenter / Edge).                                             |             |         |
| 13  | Power measurement plan declared (or N/A).                                                              |             |         |
| 14  | Energy efficiency disclosure included where required.                                                  |             |         |
| 15  | Submitter, organization, division, category fields match the submission CSV.                           |             |         |
| 16  | LoadGen version recorded in `mlperf_log_detail.txt`.                                                   |             |         |
| 17  | Calibration data (if applicable) listed and downloadable.                                              |             |         |
| 18  | Quantization recipe documented (precision per layer / op).                                             |             |         |
| 19  | Tokenizer SHA matches the canonical tokenizer for the target model.                                    |             |         |
| 20  | Submitter checksum (`md5sums.txt` or equivalent) covers every artifact in the bundle.                  |             |         |

---

## Section C — Reviewer sign-off

| Reviewer       | Date       | Verdict          | Notes |
| -------------- | ---------- | ---------------- | ----- |
|                |            | accept / reject  |       |
|                |            | accept / reject  |       |
