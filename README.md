# kcloud-mlperf

**A pure MLPerf Inference harness for LLMs.** kcloud-mlperf provides *only* the MLPerf
Inference (v5.1) benchmark harness for large language models (Llama-3.1-8B) — continuing the
original kcloud-mlperf line. It bundles the MLCommons **official LoadGen** MLPerf path
(CNN/DailyMail summarization → ROUGE) together with the **MMLU-Pro** accuracy harness and a
vLLM throughput test, for LLM benchmarking on Kubernetes / bare metal across GPU and NPU
accelerators (NVIDIA, FuriosaAI RNGD, Rebellions Atom+).

> **Scope (intentional).** This repository is limited to the MLPerf inference harness.
> The full kcloud / ETRI LLM evaluation platform — the web application, cluster
> infrastructure, and the one-command installer — is **not** included here. It will be
> released separately as **`kcloud-tool`** at a later date.

## The harness

Everything lives in [`benchmarks/`](benchmarks/):

| Benchmark | What it measures | Implementation |
|---|---|---|
| **MLPerf Inference** | CNN/DailyMail summarization → ROUGE | MLCommons official LoadGen |
| **MMLU-Pro** | 5-shot CoT evaluation → accuracy | TIGER-Lab official |
| **LLM Inference** | vLLM throughput | vLLM backend |

Submodules (under `benchmarks/`):
- `benchmarks/mlcommons_inference` — [MLCommons inference](https://github.com/mlcommons/inference)
- `benchmarks/mmlu_pro` — [MMLU-Pro](https://github.com/TIGER-AI-Lab/MMLU-Pro)

## Quickstart

```bash
git clone --recursive https://github.com/openkcloud/kcloud-mlperf.git
cd kcloud-mlperf/benchmarks
# Set master/worker IPs + HF_TOKEN, then run. Always pass --smoke (10 samples) first.
```

> **Requirement:** you must have access to `meta-llama/Llama-3.1-8B-Instruct` on Hugging Face
> (accept the model license) and set `HF_TOKEN` / `HUGGINGFACE_HUB_TOKEN`.

See **[`benchmarks/README.md`](benchmarks/README.md)** for the complete first-time setup,
cluster bring-up, and run guide (Korean).

## License

See [LICENSE](LICENSE).
